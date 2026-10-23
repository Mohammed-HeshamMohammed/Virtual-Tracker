// Recorded time is never silently lowered: a late or racing sync cannot overwrite active or idle
// seconds downward. The one exception is the agent's idle rewind, posted as a stop, which may lower
// active seconds (never idle seconds). Run against a real Postgres (PGlite) built from the boot
// schema, checking the stored rows - this replaces regexes over the upsert's SQL text in
// active-seconds-clamp.test.js. Skips itself when PGlite is missing.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startPglite, seeder, srcUrl, loadPglite } from "./helpers/pglite.js";

if (!(await loadPglite())) {
  test("tracked seconds clamp against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const pg = await startPglite();
  after(() => pg.close());
  const { insert, member } = seeder(pg);
  const { upsertTrackingRowPg } = await import(srcUrl("lib/postgres/task-member-progress.service.js"));
  const { updatePgSession } = await import(srcUrl("lib/postgres/activity-events-postgres.service.js"));

  const worker = await member("Employee", { timezone: "UTC" });
  const project = await insert("projects", { name: "P" });

  async function progressRow(seed) {
    const task = await insert("tasks", { project_id: project.id, title: "T" });
    const write = (fields, options) =>
      upsertTrackingRowPg({ task_id: task.id, member_id: worker.id, project_id: project.id, ...fields }, options);
    const stored = async () =>
      (await pg.rows("SELECT active_seconds, idle_seconds FROM task_member_progress WHERE task_id = $1", [task.id]))
        .map((r) => [Number(r.active_seconds), Number(r.idle_seconds)])[0];
    await write(seed);
    return { write, stored };
  }

  test("a routine sync cannot lower a task's active or idle seconds, and a higher value is kept", async () => {
    const row = await progressRow({ active_seconds: 500, idle_seconds: 50 });
    await row.write({ active_seconds: 400, idle_seconds: 10 });
    assert.deepEqual(await row.stored(), [500, 50]);
    await row.write({ active_seconds: 700, idle_seconds: 60 });
    assert.deepEqual(await row.stored(), [700, 60]);
  });

  test("a stop (allowDecrease) writes a lower active value, but idle still only goes up", async () => {
    const row = await progressRow({ active_seconds: 500, idle_seconds: 50 });
    await row.write({ active_seconds: 470, idle_seconds: 10, action: "stop" }, { allowDecrease: true });
    assert.deepEqual(await row.stored(), [470, 50]);
  });

  async function session(active, idle) {
    const s = await insert("activity_sessions", {
      member_id: worker.id, project_id: project.id, status: "active",
      started_at: new Date(Date.now() - 3600_000).toISOString(), active_seconds: active, idle_seconds: idle,
    });
    const stored = async () =>
      (await pg.rows("SELECT active_seconds, idle_seconds FROM activity_sessions WHERE id = $1", [s.id]))
        .map((r) => [r.active_seconds, r.idle_seconds])[0];
    return { id: s.id, stored };
  }

  test("the session row follows the same rule", async () => {
    const s = await session(1000, 300);
    await updatePgSession(s.id, { activeSeconds: 800, idleSeconds: 100, updatedAt: new Date() });
    assert.deepEqual(await s.stored(), [1000, 300], "a lower sync is clamped");
    await updatePgSession(s.id, { activeSeconds: 1200, updatedAt: new Date() });
    assert.deepEqual(await s.stored(), [1200, 300], "a higher sync is written");
    await updatePgSession(s.id, { status: "stopped", activeSeconds: 940, idleSeconds: 100, updatedAt: new Date() }, { allowDecrease: true });
    assert.deepEqual(await s.stored(), [940, 300], "the rewind lowers active, never idle");
  });
}
