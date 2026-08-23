// One-time-per-project startup backfill: gives every "calling" project that
// predates the auto-created "Cold Calling" task (see POST /api/projects in
// routes.js) exactly one, same as if it had just been created. Without this,
// every calling project made before that feature shipped stays permanently
// invisible in the Tasks page and the Overview's Tasks panels - not because
// anything is broken, but because there is genuinely nothing in `tasks` for
// them yet.
import { query } from "../../lib/postgres/client.js";
import { createTaskPg } from "../../lib/postgres/tasks-postgres.service.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { coldCallingTaskTitle } from "./cold-calling-task.js";

export async function backfillColdCallingTasks() {
  const rows = await query(
    `SELECT p.id, p.name FROM projects p
     WHERE p.type = 'calling'
       AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = p.id)`,
  );
  if (rows.length === 0) return { checked: 0, created: 0 };

  let created = 0;
  for (const row of rows) {
    try {
      await createTaskPg({
        project_id: row.id,
        title: coldCallingTaskTitle(row.name),
        status: "todo",
        created_by: null,
      });
      created += 1;
    } catch (err) {
      logSafeWarn(`[cold-calling-task-backfill] skipping project ${row.id}:`, err);
    }
  }
  return { checked: rows.length, created };
}
