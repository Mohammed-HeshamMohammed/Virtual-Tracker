
import { query } from "../../lib/postgres/client.js";
import { publishChange } from "../realtime/change-bus.js";

const MANAGER_PROJECT_ROLE = "manager";

export async function syncManagementProjectMembers(parentProjectId, actorId) {
  if (!parentProjectId) return { added: 0, removed: 0 };

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

export async function listSubProjectIdsPg(parentProjectId) {
  const rows = await query(
    "SELECT child_project_id FROM project_subprojects WHERE parent_project_id = $1 ORDER BY linked_at",
    [parentProjectId],
  );
  return rows.map((r) => r.child_project_id).filter(Boolean);
}

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
