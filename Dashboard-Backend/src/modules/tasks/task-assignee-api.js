import { applyVisibilityFilter } from "../schema/visibility.js";
import { enrichTasksWithAssignees, getTaskIdsAssignedToMembers } from "./task-assignments.js";
import { getTaskPg, getTasksByIdsPg, listTasksPg } from "../../lib/postgres/tasks-postgres.service.js";

function str(row, ...keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function matchesTaskFilters(row, url) {
  const projectId = url.searchParams.get("project_id") ?? url.searchParams.get("projectId");
  const teamId = url.searchParams.get("team_id") ?? url.searchParams.get("teamId");
  const status = url.searchParams.get("status");

  if (projectId) {
    const rowProject = str(row, "project_id", "projectId");
    if (rowProject !== projectId) return false;
  }
  if (teamId) {
    const rowTeam = str(row, "team_id", "teamId");
    if (rowTeam !== teamId) return false;
  }
  if (status) {
    const rowStatus = str(row, "status") || "todo";
    if (rowStatus !== status) return false;
  }
  return true;
}

export async function listTasksForAssignee(req, db, url, assigneeId) {
  const rows = [];
  const seen = new Set();

  const primaryRows = await listTasksPg({ assignedTo: assigneeId, limit: 200 });
  for (const row of primaryRows) {
    if (!matchesTaskFilters(row, url)) continue;
    rows.push(row);
    seen.add(row.id);
  }

  const assignmentTaskIds = await getTaskIdsAssignedToMembers(db, [assigneeId]);
  const missingIds = [...assignmentTaskIds].filter((id) => !seen.has(id));
  if (missingIds.length > 0) {
    const extraRows = await getTasksByIdsPg(missingIds);
    for (const row of extraRows) {
      if (!matchesTaskFilters(row, url)) continue;
      rows.push(row);
      seen.add(row.id);
    }
  }

  let visible = await applyVisibilityFilter(req, db, "tasks", rows);
  visible = await enrichTasksWithAssignees(db, visible);
  return visible;
}

export async function enrichTaskIds(db, taskIds) {
  const unique = [...new Set(taskIds.filter(Boolean))];
  if (!unique.length) return [];
  const rows = await getTasksByIdsPg(unique);
  return enrichTasksWithAssignees(db, rows);
}

export async function getEnrichedTaskById(req, db, taskId) {
  const row = await getTaskPg(taskId);
  if (!row) return null;

  const [visible] = await applyVisibilityFilter(req, db, "tasks", [row]);
  if (!visible) return null;

  const [enriched] = await enrichTasksWithAssignees(db, [visible]);
  return enriched;
}
