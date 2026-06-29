/** Task child entity keys mapped to Firestore subcollection names under tasks/{taskId}/. */
export const TASK_CHILD_SUBCOLLECTIONS = Object.freeze({
  "task-comments": "comments",
  "task-subtasks": "subtasks",
  "task-attachments": "attachments",
  "task-hours": "hours",
  "task-time-tracking": "time_tracking",
});

/** URL path segments (under /api/tasks/:taskId/) mapped to schema entity keys. */
export const TASK_CHILD_URL_SEGMENTS = Object.freeze({
  comments: "task-comments",
  subtasks: "task-subtasks",
  attachments: "task-attachments",
  hours: "task-hours",
  time_tracking: "task-time-tracking",
});

export const TASK_CHILD_SUBCOLLECTION_NAMES = Object.freeze([
  "comments",
  "subtasks",
  "attachments",
  "hours",
  "time_tracking",
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
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} taskId
 */
export async function deleteTaskWithChildren(db, taskId) {
  const batch = db.batch();
  for (const sub of TASK_CHILD_SUBCOLLECTION_NAMES) {
    const snap = await db.collection("tasks").doc(taskId).collection(sub).get();
    for (const doc of snap.docs) batch.delete(doc.ref);
  }
  const assignmentsSnap = await db.collection("task_assignments").where("task_id", "==", taskId).get();
  for (const doc of assignmentsSnap.docs) batch.delete(doc.ref);
  batch.delete(db.collection("tasks").doc(taskId));
  await batch.commit();
}
