import {
  isTaskChildEntityKey,
  taskChildCollectionRef,
  taskChildDocRef,
} from "../../lib/firestore/task-subcollections.js";

/**
 * Parse nested task child routes: /api/tasks/:taskId/:segment[/:childId]
 * @param {string} pathname
 * @returns {{ taskId: string, entityKey: string, childId: string | null } | null}
 */
export function parseTaskChildPath(pathname) {
  const match = /^\/api(?:\/v1)?\/tasks\/([^/]+)\/(comments|subtasks|attachments|hours|time_tracking)(?:\/([^/]+))?$/.exec(
    pathname,
  );
  if (!match) return null;
  const segment = match[2];
  const entityKeyMap = {
    comments: "task-comments",
    subtasks: "task-subtasks",
    attachments: "task-attachments",
    hours: "task-hours",
    time_tracking: "task-time-tracking",
  };
  return {
    taskId: match[1],
    entityKey: entityKeyMap[segment],
    childId: match[3] ?? null,
  };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ collection: string, key: string }} entity
 * @param {string | null | undefined} taskParentId
 */
export function resolveEntityCollectionRef(db, entity, taskParentId) {
  if (isTaskChildEntityKey(entity.key)) {
    if (!taskParentId) {
      throw new Error(`${entity.key} requires task_id (query param) or nested /api/tasks/:taskId/... route`);
    }
    return taskChildCollectionRef(db, taskParentId, entity.key);
  }
  return db.collection(entity.collection);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ collection: string, key: string }} entity
 * @param {string} docId
 * @param {string | null | undefined} taskParentId
 */
export function resolveEntityDocRef(db, entity, docId, taskParentId) {
  if (isTaskChildEntityKey(entity.key)) {
    if (!taskParentId) {
      throw new Error(`${entity.key} requires task_id`);
    }
    return taskChildDocRef(db, taskParentId, entity.key, docId);
  }
  return db.collection(entity.collection).doc(docId);
}

/**
 * @param {URL} url
 * @returns {string | null}
 */
export function resolveTaskParentIdFromQuery(url) {
  return url.searchParams.get("task_id") ?? url.searchParams.get("taskId") ?? null;
}
