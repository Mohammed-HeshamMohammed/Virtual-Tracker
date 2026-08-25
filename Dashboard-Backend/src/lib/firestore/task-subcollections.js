/** Task child entity keys. These were Firestore subcollections under
 * tasks/{taskId}/ until they moved to real Postgres tables (task_comments,
 * task_subtasks, task_attachments, task_hours). The keys are still the
 * routing identity the schema catalog and URL router use, so the set stays -
 * only the Firestore ref helpers that used to resolve them to collection
 * references are gone, along with the generic Firestore CRUD that called them. */
const TASK_CHILD_ENTITY_KEYS = new Set([
  "task-comments",
  "task-subtasks",
  "task-attachments",
  "task-hours",
]);

/**
 * @param {string} entityKey
 * @returns {boolean}
 */
export function isTaskChildEntityKey(entityKey) {
  return TASK_CHILD_ENTITY_KEYS.has(entityKey);
}

/**
 * Deletes the vestigial Firestore `tasks` doc mirror. The four child
 * entities are Postgres tables with `task_id ... ON DELETE CASCADE`, so
 * deleting the Postgres `tasks` row (deleteTaskPg, called by the
 * schema/routes.js DELETE handler right after this) cascades all of them -
 * same pattern task_assignments and team_members/team_projects already use.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} taskId
 */
export async function deleteTaskWithChildren(db, taskId) {
  await db.collection("tasks").doc(taskId).delete();
}
