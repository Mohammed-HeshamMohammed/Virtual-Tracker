import { query } from "../../lib/postgres/client.js";
import { logSafeWarn } from "../../http/sanitize-error.js";

export async function cleanupCallingProjectTasks() {
  try {
    const rows = await query(
      `DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE type = 'calling') RETURNING id`,
    );
    return { removed: rows.length };
  } catch (err) {
    logSafeWarn("[calling-project-task-cleanup] failed:", err);
    return { removed: 0 };
  }
}
