// One-time startup cleanup: removes any task rows left under "calling"
// projects. A short-lived earlier version of this feature auto-created a
// "Cold Calling" task for these projects (both at creation time and via a
// startup backfill) - calling projects have no tasks by design (the
// desktop tracker already runs its timer straight against the project, no
// task needed), and those rows showed up in the Tasks page without being
// meaningfully editable there. Idempotent - a no-op once the affected rows
// are gone, safe to run on every startup indefinitely.
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
