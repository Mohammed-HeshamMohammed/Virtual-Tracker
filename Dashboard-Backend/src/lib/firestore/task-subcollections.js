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

export const TASK_CHILD_SUBCOLLECTION_NAMES = Object.freeze([
  "comments",
  "subtasks",
  "attachments",
  "hours",
]);

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
 * Deletes the Firestore child subcollections (comments/subtasks/attachments/
 * hours - still Firestore-resident, out of scope for the Postgres migration)
 * and the vestigial Firestore `tasks` doc mirror.
 * task_assignments is NOT touched here anymore - it's fully Postgres now
 * (task-assignments-postgres.service.js), and its `task_id` FK is
 * `ON DELETE CASCADE`, so deleting the Postgres `tasks` row (deleteTaskPg,
 * called by the schema/routes.js DELETE handler right after this) already
 * cascade-deletes its task_assignments rows with no extra call needed.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} taskId
 */
export async function deleteTaskWithChildren(db, taskId) {
  const batch = db.batch();
  for (const sub of TASK_CHILD_SUBCOLLECTION_NAMES) {
    const snap = await db.collection("tasks").doc(taskId).collection(sub).get();
    for (const doc of snap.docs) batch.delete(doc.ref);
  }
  batch.delete(db.collection("tasks").doc(taskId));
  await batch.commit();
}
