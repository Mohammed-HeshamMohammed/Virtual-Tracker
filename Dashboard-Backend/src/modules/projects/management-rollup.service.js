// Keeps a management project's member list in step with the managers of the
// sub-projects linked beneath it.
//
// Why materialize into project_members instead of deriving the union at read
// time: project_members is what every access-control path already reads
// (viewerCanWriteProject, getViewerProjectIds, activity scoping, the timer's
// isProjectMemberForTimer). Deriving would mean teaching all of them about
// management projects; writing real rows means none of them change at all.
//
// The `source` column is what makes this safe to re-run. Rows this service
// creates are 'rolled_up' and it may prune them freely; anything a human
// picked is 'manual' and is never touched here.

import { query } from "../../lib/postgres/client.js";
import { publishChange } from "../realtime/change-bus.js";

/** Project roles that count as "manages this sub-project" for roll-up. */
const MANAGER_PROJECT_ROLE = "manager";

/**
 * Recomputes one management project's rolled-up members.
 *
 * @param {string} parentProjectId
 * @param {string} [actorId]
 * @returns {Promise<{ added: number, removed: number }>}
 */
export async function syncManagementProjectMembers(parentProjectId, actorId) {
  if (!parentProjectId) return { added: 0, removed: 0 };

  // Everyone who manages any linked sub-project. project_role is the
  // per-project role, which is what "manager of that project" means here -
  // an org-level admin who is not on the sub-project should not be pulled in
  // just for being senior.
  const desiredRows = await query(
    `SELECT DISTINCT pm.member_id
       FROM project_subprojects psp
       JOIN project_members pm ON pm.project_id = psp.child_project_id
      WHERE psp.parent_project_id = $1
        AND pm.project_role = $2`,
    [parentProjectId, MANAGER_PROJECT_ROLE],
  );
  const desired = new Set(desiredRows.map((r) => r.member_id).filter(Boolean));

  const existingRows = await query(
    "SELECT member_id, source FROM project_members WHERE project_id = $1",
    [parentProjectId],
  );
  const manual = new Set(existingRows.filter((r) => r.source !== "rolled_up").map((r) => r.member_id));
  const rolledUp = new Set(existingRows.filter((r) => r.source === "rolled_up").map((r) => r.member_id));

  // Someone already on the project by hand stays 'manual' - re-marking them
  // as rolled_up would make a later prune able to delete a manual choice.
  const toAdd = [...desired].filter((id) => !manual.has(id) && !rolledUp.has(id));
  const toRemove = [...rolledUp].filter((id) => !desired.has(id));

  if (toAdd.length) {
    await query(
      `INSERT INTO project_members (project_id, member_id, project_role, source, assigned_by, updated_by)
       SELECT $1, unnest($2::uuid[]), $3, 'rolled_up', $4, $4
       ON CONFLICT (project_id, member_id) DO NOTHING`,
      [parentProjectId, toAdd, MANAGER_PROJECT_ROLE, actorId ?? null],
    );
  }
  if (toRemove.length) {
    // Guarded on source so a concurrent manual add cannot be deleted by a
    // prune that was computed a moment earlier.
    await query(
      `DELETE FROM project_members
        WHERE project_id = $1 AND member_id = ANY($2::uuid[]) AND source = 'rolled_up'`,
      [parentProjectId, toRemove],
    );
  }

  if (toAdd.length || toRemove.length) {
    void publishChange("project-members", parentProjectId, "updated", actorId ?? undefined);
  }
  return { added: toAdd.length, removed: toRemove.length };
}

/**
 * Re-syncs every management project that `childProjectId` is linked under.
 * This is the hook that makes the roll-up continuous: it runs whenever a
 * project's own membership changes, so a manager added to a sub-project shows
 * up on its management project without anyone re-opening that project.
 *
 * Best-effort by design - a failed roll-up must not fail the membership edit
 * that triggered it. The next membership change (or a link edit) recomputes
 * from scratch, so a missed run is self-healing rather than permanent drift.
 *
 * @param {string} childProjectId
 * @param {string} [actorId]
 */
export async function syncManagementParentsOfProject(childProjectId, actorId) {
  if (!childProjectId) return;
  try {
    const parents = await query(
      "SELECT parent_project_id FROM project_subprojects WHERE child_project_id = $1",
      [childProjectId],
    );
    for (const row of parents) {
      await syncManagementProjectMembers(row.parent_project_id, actorId);
    }
  } catch {
    // Swallowed on purpose - see the doc comment above.
  }
}

/** @param {string} parentProjectId */
export async function listSubProjectIdsPg(parentProjectId) {
  const rows = await query(
    "SELECT child_project_id FROM project_subprojects WHERE parent_project_id = $1 ORDER BY linked_at",
    [parentProjectId],
  );
  return rows.map((r) => r.child_project_id).filter(Boolean);
}

/**
 * Replaces a management project's sub-project links, then re-syncs its
 * members. Only non-management projects may be children, so management
 * projects cannot chain into a cycle.
 *
 * @param {string} parentProjectId
 * @param {string[]} childProjectIds
 * @param {string} [actorId]
 */
export async function setSubProjectsPg(parentProjectId, childProjectIds, actorId) {
  const desired = [...new Set((childProjectIds ?? []).filter((id) => id && id !== parentProjectId))];

  const eligible = desired.length
    ? (
        await query(
          "SELECT id FROM projects WHERE id = ANY($1::uuid[]) AND type <> 'management'",
          [desired],
        )
      ).map((r) => r.id)
    : [];

  await query(
    `DELETE FROM project_subprojects
      WHERE parent_project_id = $1
        AND ($2::uuid[] IS NULL OR NOT (child_project_id = ANY($2::uuid[])))`,
    [parentProjectId, eligible.length ? eligible : null],
  );
  if (eligible.length) {
    await query(
      `INSERT INTO project_subprojects (parent_project_id, child_project_id, linked_by)
       SELECT $1, unnest($2::uuid[]), $3
       ON CONFLICT (parent_project_id, child_project_id) DO NOTHING`,
      [parentProjectId, eligible, actorId ?? null],
    );
  }

  await syncManagementProjectMembers(parentProjectId, actorId);
  return eligible;
}
