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
