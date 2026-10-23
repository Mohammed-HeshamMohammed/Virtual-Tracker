// Small rules about tracking, checked on real rows: the one-time capability backfill, linking a
// Client login to its client record, what deleting a task does to a running timer, and who counts
// as tracking on a project. Run against a real Postgres (PGlite) built from the boot schema.
//
// Replaces the SQL-text assertions in capability-gate, client-self-setup,
// delete-task-stops-sessions and project-member-limits-membership. Skips itself when PGlite is
// missing.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startPglite, seeder, srcUrl, loadPglite } from "./helpers/pglite.js";

if (!(await loadPglite())) {
  test("tracking rules against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const pg = await startPglite();
  after(() => pg.close());
  const { insert, member } = seeder(pg);
  const { backfillCapabilitiesInUse } = await import(srcUrl("modules/compliance/capability-gate.js"));
  const { getClientSelfSetupStatus } = await import(srcUrl("modules/clients/services/client-self-setup.js"));
  const { deleteTaskPg } = await import(srcUrl("lib/postgres/tasks-postgres.service.js"));
  const { isProjectTrackerPg } = await import(srcUrl("lib/postgres/projects-postgres.service.js"));
  const { MAIN_TENANT_ID } = await import(srcUrl("lib/postgres/ensure-tenancy-schema.js"));

  const worker = await member("Employee");
  const project = await insert("projects", { name: "P" });

  test("the backfill turns on only the capabilities with data behind them, once", async () => {
    const enabled = async () =>
      Object.fromEntries((await pg.rows("SELECT capability, enabled FROM monitoring_capabilities")).map((r) => [r.capability, r.enabled]));
    await pg.rows("UPDATE monitoring_capabilities SET enabled = false");
    const s = await insert("activity_sessions", { member_id: worker.id, status: "stopped", started_at: "2026-09-01T09:00:00Z", ended_at: "2026-09-01T10:00:00Z" });
    const app = await insert("apps", { name: "Figma" });
    await insert("activity_app_logs", { member_id: worker.id, session_id: s.id, app_id: app.id });
    const result = await backfillCapabilitiesInUse();
    assert.deepEqual(result.enabled, ["app_tracking"]);
    const after1 = await enabled();
    assert.equal(after1.app_tracking, true);
    assert.equal(after1.screenshots, false);
    assert.equal(after1.url_capture, false);

    // An Owner turns it off again: the backfill has already run and does not undo that.
    await pg.rows("UPDATE monitoring_capabilities SET enabled = false WHERE capability = 'app_tracking'");
    assert.equal((await backfillCapabilitiesInUse()).skipped, true);
    assert.equal((await enabled()).app_tracking, false);
  });

  test("a Client login is linked to the one client record listing its email, and asked when there are two", async () => {
    const solo = await member("Client", { work_email: "cara@acme.test", first_name: "Cara" });
    const acme = await insert("clients", { name: "Acme", email_addresses: "billing@acme.test, Cara@Acme.test" });
    const linked = await getClientSelfSetupStatus({ memberId: solo.id, roleName: "Client", tenantId: MAIN_TENANT_ID });
    assert.deepEqual([linked.required, linked.clientId, linked.autoLinked], [false, acme.id, true]);
    assert.equal((await pg.rows("SELECT member_id FROM clients WHERE id = $1", [acme.id]))[0].member_id, solo.id);

    const torn = await member("Client", { work_email: "dan@two.test" });
    const a = await insert("clients", { name: "Two A", email_addresses: "dan@two.test" });
    const b = await insert("clients", { name: "Two B", email_addresses: "dan@two.test" });
    const status = await getClientSelfSetupStatus({ memberId: torn.id, roleName: "Client", tenantId: MAIN_TENANT_ID });
    assert.equal(status.required, true);
    const links = await pg.rows("SELECT member_id FROM clients WHERE id = ANY($1::uuid[])", [[a.id, b.id]]);
    assert.deepEqual(links.map((l) => l.member_id), [null, null], "no guess was made");
  });

  // The boot schema cascades activity_sessions.task_id, so the task's sessions go with it, as a
  // project's do. What outlives them is the history entry saying the timer was stopped, by whom
  // and why - which is what the tracker and "why did my timer stop" read.
  test("deleting a task records that its running timer was stopped, by whom and why, and touches no other task's timer", async () => {
    const actor = await member("Manager");
    const task = await insert("tasks", { project_id: project.id, title: "Doomed" });
    const other = await insert("tasks", { project_id: project.id, title: "Other" });
    const running = await insert("activity_sessions", { member_id: worker.id, project_id: project.id, task_id: task.id, status: "active", started_at: new Date(Date.now() - 600_000).toISOString() });
    const done = await insert("activity_sessions", { member_id: actor.id, project_id: project.id, task_id: task.id, status: "stopped", started_at: "2026-09-01T09:00:00Z", ended_at: "2026-09-01T10:00:00Z" });
    const elsewhere = await insert("activity_sessions", { member_id: actor.id, project_id: project.id, task_id: other.id, status: "active", started_at: new Date(Date.now() - 60_000).toISOString() });
    await deleteTaskPg(task.id, actor.id);

    const events = await pg.rows("SELECT action, reason, actor_id, member_id FROM activity_session_events WHERE session_id = $1", [running.id]);
    assert.deepEqual(events, [{ action: "stop", reason: "task_deleted", actor_id: actor.id, member_id: worker.id }]);
    assert.deepEqual(await pg.rows("SELECT id FROM activity_session_events WHERE session_id = $1", [done.id]), [], "a finished session was not 'stopped' again");
    assert.deepEqual(await pg.rows("SELECT id FROM tasks WHERE id = $1", [task.id]), []);
    const [still] = await pg.rows("SELECT status, ended_at FROM activity_sessions WHERE id = $1", [elsewhere.id]);
    assert.deepEqual(still, { status: "active", ended_at: null });
  });

  test("an actor that is not a member id is recorded as unknown, not passed through", async () => {
    const task = await insert("tasks", { project_id: project.id, title: "Also doomed" });
    const running = await insert("activity_sessions", { member_id: worker.id, task_id: task.id, status: "active", started_at: new Date(Date.now() - 60_000).toISOString() });
    await deleteTaskPg(task.id, "system:cleanup");
    const events = await pg.rows("SELECT reason, actor_id FROM activity_session_events WHERE session_id = $1", [running.id]);
    assert.deepEqual(events, [{ reason: "task_deleted", actor_id: null }]);
  });

  test("a viewer on a project is not tracking on it; any other member is", async () => {
    const viewer = await member("Employee");
    const plain = await member("Employee");
    const lead = await member("Manager");
    await insert("project_members", { project_id: project.id, member_id: viewer.id, project_role: "Viewer" });
    await insert("project_members", { project_id: project.id, member_id: plain.id });
    await insert("project_members", { project_id: project.id, member_id: lead.id, project_role: "manager" });
    assert.equal(await isProjectTrackerPg(project.id, viewer.id), false);
    assert.equal(await isProjectTrackerPg(project.id, plain.id), true);
    assert.equal(await isProjectTrackerPg(project.id, lead.id), true);
    assert.equal(await isProjectTrackerPg(project.id, worker.id), false, "not on the project at all");
  });
}
