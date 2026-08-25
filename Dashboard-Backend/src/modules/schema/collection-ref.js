/**
 * Parse nested task child routes: /api/tasks/:taskId/:segment[/:childId]
 * @param {string} pathname
 * @returns {{ taskId: string, entityKey: string, childId: string | null } | null}
 */
export function parseTaskChildPath(pathname) {
  const match = /^\/api(?:\/v1)?\/tasks\/([^/]+)\/(comments|subtasks|attachments|hours)(?:\/([^/]+))?$/.exec(
    pathname,
  );
  if (!match) return null;
  const segment = match[2];
  const entityKeyMap = {
    comments: "task-comments",
    subtasks: "task-subtasks",
    attachments: "task-attachments",
    hours: "task-hours",
  };
  return {
    taskId: match[1],
    entityKey: entityKeyMap[segment],
    childId: match[3] ?? null,
  };
}

/**
 * @param {URL} url
 * @returns {string | null}
 */
export function resolveTaskParentIdFromQuery(url) {
  return url.searchParams.get("task_id") ?? url.searchParams.get("taskId") ?? null;
}
