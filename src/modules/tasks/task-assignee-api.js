import { applyVisibilityFilter } from "../schema/visibility.js";
import { normalizeDoc } from "../schema/services/schema-crud.service.js";
import { enrichTasksWithAssignees, getTaskIdsAssignedToMembers } from "./task-assignments.js";

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

/** List tasks by primary assignee + task_assignments rows. */
export async function listTasksForAssignee(req, db, url, assigneeId) {
  const rows = [];
  const seen = new Set();

  const primarySnap = await db.collection("tasks").where("assigned_to", "==", assigneeId).limit(200).get();
  for (const doc of primarySnap.docs) {
    const row = normalizeDoc({ id: doc.id, ...doc.data() });
    if (!matchesTaskFilters(row, url)) continue;
    rows.push(row);
    seen.add(row.id);
  }

  const assignmentTaskIds = await getTaskIdsAssignedToMembers(db, [assigneeId]);
  const missingIds = [...assignmentTaskIds].filter((id) => !seen.has(id));
  if (missingIds.length > 0) {
    const extraDocs = await db.getAll(...missingIds.map((id) => db.collection("tasks").doc(id)));
    for (const doc of extraDocs) {
      if (!doc.exists) continue;
      const row = normalizeDoc({ id: doc.id, ...doc.data() });
      if (!matchesTaskFilters(row, url)) continue;
      rows.push(row);
      seen.add(row.id);
    }
  }

  let visible = await applyVisibilityFilter(req, db, "tasks", rows);
  visible = await enrichTasksWithAssignees(db, visible);
  return visible;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string[]} taskIds
 */
export async function enrichTaskIds(db, taskIds) {
  const unique = [...new Set(taskIds.filter(Boolean))];
  if (!unique.length) return [];

  const rows = [];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const docs = await db.getAll(...chunk.map((id) => db.collection("tasks").doc(id)));
    for (const doc of docs) {
      if (!doc.exists) continue;
      rows.push(normalizeDoc({ id: doc.id, ...doc.data() }));
    }
  }

  return enrichTasksWithAssignees(db, rows);
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} taskId
 */
export async function getEnrichedTaskById(req, db, taskId) {
  const doc = await db.collection("tasks").doc(taskId).get();
  if (!doc.exists) return null;

  let row = normalizeDoc({ id: doc.id, ...doc.data() });
  const [visible] = await applyVisibilityFilter(req, db, "tasks", [row]);
  if (!visible) return null;

  [row] = await enrichTasksWithAssignees(db, [visible]);
  return row;
}
