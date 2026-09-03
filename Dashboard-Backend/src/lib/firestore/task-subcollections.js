const TASK_CHILD_ENTITY_KEYS = new Set([
  "task-comments",
  "task-subtasks",
  "task-attachments",
  "task-hours",
]);

export function isTaskChildEntityKey(entityKey) {
  return TASK_CHILD_ENTITY_KEYS.has(entityKey);
}
