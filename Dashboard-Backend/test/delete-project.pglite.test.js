// Deleting a project deletes everything that belongs to it - tasks and their children, work
// sessions and everything captured in them, time entries, progress and the project's own links -
// and keeps the apps and sites catalog, invoices and expenses (which stop pointing at it). A second
// project's rows are untouched.
//
// Run against a real Postgres (PGlite) built from the boot schema, with its ON DELETE CASCADE /
// SET NULL rules turned into plain foreign keys first: an older production schema had no cascades,
// which is why this delete used to fail, so the function has to remove every child itself and in
// an order the keys accept. Replaces the scripted-SQL checks in delete-project-cascade.test.js.
// Skips itself when PGlite is missing.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startPglite, seeder, srcUrl, loadPglite } from "./helpers/pglite.js";

if (!(await loadPglite())) {
  test("project delete against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const pg = await startPglite();
  after(() => pg.close());
  const { insert, member } = seeder(pg);

  // No cascades: every ON DELETE CASCADE / SET NULL key becomes a key that refuses the delete.
  await pg.rows(`DO $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS def
               FROM pg_constraint WHERE contype = 'f' AND confdeltype IN ('c', 'n') LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', r.tbl, r.conname,
          regexp_replace(r.def, 'ON DELETE (CASCADE|SET NULL)', '', 'g'));
      END LOOP;
    END $$`);
  // How long the delete may run, seen from inside it.
  await pg.rows("CREATE TABLE seen_timeout (value text)");
  await pg.rows(`CREATE FUNCTION note_timeout() RETURNS trigger AS $$
    BEGIN INSERT INTO seen_timeout VALUES (current_setting('statement_timeout')); RETURN OLD; END $$ LANGUAGE plpgsql`);
  await pg.rows("CREATE TRIGGER note_timeout BEFORE DELETE ON projects FOR EACH ROW EXECUTE FUNCTION note_timeout()");

  const { deleteProjectPg } = await import(srcUrl("lib/postgres/projects-postgres.service.js"));
  const { subscribeChanges } = await import(srcUrl("modules/realtime/change-bus.js"));
  const announced = [];
  subscribeChanges((change) => announced.push(change));

  const worker = await member("Employee");
  const lead = await member("Manager");
  const app = await insert("apps", { name: "Figma" });
  const category = await insert("activity_categories", { match_type: "app", pattern: "Figma" });
  const client = await insert("clients", { name: "Acme" });
  const team = await insert("teams", { name: "Team" });
  const invite = await insert("invites", { invite_token: "tok-delete-project-0001" });
  const invoice = await insert("invoices", { kind: "client", number: "INV-1", client_id: client.id });

  /** A project with one of everything that can hang off it. */
  async function populated(name) {
    const p = await insert("projects", { name });
    const t = await insert("tasks", { project_id: p.id, title: `${name} task` });
    const s = await insert("activity_sessions", { member_id: worker.id, project_id: p.id, task_id: t.id, status: "stopped", started_at: "2026-09-01T09:00:00Z", ended_at: "2026-09-01T10:00:00Z" });
    // A session tied to the project only through its task.
    const viaTask = await insert("activity_sessions", { member_id: lead.id, task_id: t.id, status: "stopped", started_at: "2026-09-02T09:00:00Z", ended_at: "2026-09-02T10:00:00Z" });
    const shot = await insert("activity_screenshots", { member_id: worker.id, session_id: s.id, task_id: t.id, captured_at: "2026-09-01T09:30:00Z" });
    await insert("activity_screenshots", { member_id: lead.id, session_id: viaTask.id, captured_at: "2026-09-02T09:30:00Z" });
    await insert("screenshot_access_log", { screenshot_id: shot.id, screenshot_owner: worker.id, reader_member_id: lead.id });
    await insert("activity_app_logs", { member_id: worker.id, session_id: s.id, app_id: app.id, started_at: "2026-09-01T09:10:00Z", duration_seconds: 60 });
    await insert("activity_url_logs", { member_id: worker.id, session_id: s.id, url: "https://example.test", visited_at: "2026-09-01T09:20:00Z" });
    await insert("activity_integrity_flags", { member_id: worker.id, session_id: s.id, flag_type: "screenshot_staleness" });
    await insert("activity_session_events", { session_id: s.id, action: "stop" });
    await insert("time_entries", { member_id: worker.id, project_id: p.id, task_id: t.id, date: "2026-09-01" });
    await insert("task_member_progress", { task_id: t.id, member_id: worker.id, project_id: p.id });
    await insert("daily_member_task_active_seconds", { member_id: worker.id, task_id: t.id, day: "2026-09-01" });
    await insert("task_assignments", { task_id: t.id, member_id: worker.id, project_id: p.id });
    for (const table of ["task_comments", "task_subtasks", "task_attachments"]) await insert(table, { task_id: t.id });
    await insert("task_hours", { task_id: t.id, user_id: worker.id });
    await insert("project_members", { project_id: p.id, member_id: worker.id });
    await insert("project_members", { project_id: p.id, member_id: lead.id, project_role: "manager" });
    await insert("project_member_limits", { project_id: p.id, member_id: worker.id });
    await insert("project_budget_notify_state", { project_id: p.id });
    await insert("project_budgets", { project_id: p.id });
    await insert("client_projects", { client_id: client.id, project_id: p.id });
    await insert("team_projects", { team_id: team.id, project_id: p.id });
    await insert("invite_projects", { invite_id: invite.id, project_id: p.id });
    await insert("pending_auth_members", { firebase_uid: `pending-${name}` });
    await insert("pending_auth_projects", { firebase_uid: `pending-${name}`, project_id: p.id });
    await insert("invoice_line_items", { invoice_id: invoice.id, project_id: p.id });
    await insert("expenses", { member_id: worker.id, date: "2026-09-01", project_id: p.id });
    return { p, t, sessions: [s.id, viaTask.id] };
  }

  // Every row that belongs to a project, table by table.
  const footprint = async ({ p, t, sessions }) => {
    const n = async (sql, params) => (await pg.rows(`SELECT count(*)::int AS n FROM ${sql}`, params))[0].n;
    return {
      tasks: await n("tasks WHERE project_id = $1", [p.id]),
      sessions: await n("activity_sessions WHERE id = ANY($1::uuid[])", [sessions]),
      screenshots: await n("activity_screenshots WHERE session_id = ANY($1::text[])", [sessions]),
      access_log: await n("screenshot_access_log l JOIN activity_screenshots s ON s.id = l.screenshot_id WHERE s.session_id = ANY($1::text[])", [sessions]),
      app_logs: await n("activity_app_logs WHERE session_id = ANY($1::text[])", [sessions]),
      url_logs: await n("activity_url_logs WHERE session_id = ANY($1::text[])", [sessions]),
      flags: await n("activity_integrity_flags WHERE session_id = ANY($1::text[])", [sessions]),
      events: await n("activity_session_events WHERE session_id = ANY($1::uuid[])", [sessions]),
      time_entries: await n("time_entries WHERE project_id = $1", [p.id]),
      progress: await n("task_member_progress WHERE project_id = $1", [p.id]),
      daily_task: await n("daily_member_task_active_seconds WHERE task_id = $1", [t.id]),
      task_children: await n("(SELECT task_id FROM task_comments UNION ALL SELECT task_id FROM task_subtasks UNION ALL SELECT task_id FROM task_attachments UNION ALL SELECT task_id FROM task_hours UNION ALL SELECT task_id FROM task_assignments) c WHERE task_id = $1", [t.id]),
      links: await n("(SELECT project_id FROM project_members UNION ALL SELECT project_id FROM project_member_limits UNION ALL SELECT project_id FROM project_budget_notify_state UNION ALL SELECT project_id FROM project_budgets UNION ALL SELECT project_id FROM client_projects UNION ALL SELECT project_id FROM team_projects UNION ALL SELECT project_id FROM invite_projects UNION ALL SELECT project_id FROM pending_auth_projects) l WHERE project_id = $1", [p.id]),
      project: await n("projects WHERE id = $1", [p.id]),
    };
  };
  const nothing = (fp) => Object.fromEntries(Object.keys(fp).map((k) => [k, 0]));

  const doomed = await populated("Doomed");
  const kept = await populated("Kept");
  const keptBefore = await footprint(kept);
  // A management project that rolls up Doomed's manager.
  const mgmt = await insert("projects", { name: "Portfolio", type: "management" });
  await insert("project_subprojects", { parent_project_id: mgmt.id, child_project_id: doomed.p.id });
  await insert("project_members", { project_id: mgmt.id, member_id: lead.id, project_role: "manager", source: "rolled_up" });

  const result = await deleteProjectPg(doomed.p.id, lead.id);

  test("every row that belonged to the project is gone, with no cascades to lean on", async () => {
    const left = await footprint(doomed);
    assert.deepEqual(left, nothing(left));
  });

  test("another project's rows are untouched", async () => {
    assert.deepEqual(await footprint(kept), keptBefore);
  });

  test("the apps and sites catalog and its classifications are kept", async () => {
    assert.equal((await pg.rows("SELECT id FROM apps WHERE id = $1", [app.id])).length, 1);
    assert.equal((await pg.rows("SELECT id FROM activity_categories WHERE id = $1", [category.id])).length, 1);
  });

  test("invoice lines and expenses are kept and stop pointing at the project", async () => {
    const lines = await pg.rows("SELECT project_id FROM invoice_line_items WHERE invoice_id = $1 ORDER BY project_id NULLS FIRST", [invoice.id]);
    assert.deepEqual(lines.map((l) => l.project_id), [null, kept.p.id]);
    const spent = await pg.rows("SELECT project_id FROM expenses ORDER BY project_id NULLS FIRST");
    assert.deepEqual(spent.map((e) => e.project_id), [null, kept.p.id]);
  });

  test("it ran with a long statement timeout, and reports who was on the project", async () => {
    const [seen] = await pg.rows("SELECT value FROM seen_timeout");
    assert.equal(seen.value, "5min");
    assert.deepEqual(result.memberIds.sort(), [lead.id, worker.id].sort());
  });

  test("the deletion is announced once", async () => {
    const deletions = announced.filter((c) => c.resource === "projects" && c.action === "deleted");
    assert.deepEqual(deletions.map((c) => c.id), [doomed.p.id]);
  });

  test("a management project that rolled it up drops the members it only had through it", async () => {
    for (let i = 0; i < 50; i++) {
      const left = await pg.rows("SELECT member_id FROM project_members WHERE project_id = $1", [mgmt.id]);
      if (left.length === 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail("the rolled-up manager is still on the management project");
  });

  test("a failure part way leaves the project exactly as it was", async () => {
    await pg.rows(`CREATE FUNCTION refuse() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$ LANGUAGE plpgsql`);
    await pg.rows("CREATE TRIGGER refuse BEFORE DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION refuse()");
    try {
      await assert.rejects(deleteProjectPg(kept.p.id, lead.id), /refused/);
      assert.deepEqual(await footprint(kept), keptBefore);
      assert.equal(announced.some((c) => c.id === kept.p.id && c.action === "deleted"), false, "nothing is announced");
    } finally {
      await pg.rows("DROP TRIGGER refuse ON tasks");
    }
  });
}
