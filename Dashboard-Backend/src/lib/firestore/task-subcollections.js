/** Task child entity keys mapped to Firestore subcollection names under tasks/{taskId}/.
 * time_tracking removed (implementation.md legacy cleanup) - that subcollection
 * has been dead since Phase 2 (task_member_progress in Postgres is the real
 * store); this registry only covers what's still genuinely Firestore-resident. */
export const TASK_CHILD_SUBCOLLECTIONS = Object.freeze({
  "task-comments": "comments",
  "task-subtasks": "subtasks",
  "task-attachments": "attachments",
  "task-hours": "hours",
});

/** URL path segments (under /api/tasks/:taskId/) mapped to schema entity keys. */
export const TASK_CHILD_URL_SEGMENTS = Object.freeze({
  comments: "task-comments",
  subtasks: "task-subtasks",
  attachments: "task-attachments",
  hours: "task-hours",
});

/**
 * @param {string} entityKey
 * @returns {boolean}
 */
export function isTaskChildEntityKey(entityKey) {
  return Object.prototype.hasOwnProperty.call(TASK_CHILD_SUBCOLLECTIONS, entityKey);
}

/**
 * @param {string} entityKey
 * @returns {string | undefined}
 */
export function getTaskChildSubcollectionName(entityKey) {
  return TASK_CHILD_SUBCOLLECTIONS[entityKey];
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} taskId
 * @param {string} entityKey
 */
export function taskChildCollectionRef(db, taskId, entityKey) {
  const sub = getTaskChildSubcollectionName(entityKey);
  if (!sub) throw new Error(`Unknown task child entity: ${entityKey}`);
  return db.collection("tasks").doc(taskId).collection(sub);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} taskId
 * @param {string} entityKey
 * @param {string} docId
 */
export function taskChildDocRef(db, taskId, entityKey, docId) {
  return taskChildCollectionRef(db, taskId, entityKey).doc(docId);
}

/**
 * Deletes the vestigial Firestore `tasks` doc mirror. comments/subtasks/
 * attachments/hours used to need their own manual batch-delete here - now
 * real Postgres tables (task_comments etc.,
 * ensure-lookup-schema.js), each with `task_id ... ON DELETE CASCADE`, the
 * same way task_assignments already worked before this change. Deleting the
 * Postgres `tasks` row (deleteTaskPg, called by the schema/routes.js DELETE
 * handler right after this) cascades all five child tables with no extra
 * call needed - same pattern as team_members/team_projects on team delete.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} taskId
 */
export async function deleteTaskWithChildren(db, taskId) {
  await db.collection("tasks").doc(taskId).delete();
}
