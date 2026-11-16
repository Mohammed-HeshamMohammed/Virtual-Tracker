// The Command Center's hours are display figures: manual time counts the way the Time & Activity
// report counts it (source 'manual', status 'approved'), so the two pages agree for the same week.
// Pending and rejected entries must not move them. Checked on real rows (PGlite).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startPglite, seeder, srcUrl, loadPglite } from "./helpers/pglite.js";

if (!(await loadPglite())) {
  test("command center hours against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const pg = await startPglite();
  after(() => pg.close());
  const { insert, member } = seeder(pg);
  const svc = await import(srcUrl("lib/postgres/projects-postgres.service.js"));

  const worker = await member("Employee", { timezone: "UTC" });
  const project = await insert("projects", { name: "Hours", timezone: "UTC" });
  const DAY = "2026-11-10";

  await insert("activity_sessions", {
    member_id: worker.id,
    project_id: project.id,
    status: "stopped",
    started_at: `${DAY}T09:00:00Z`,
    ended_at: `${DAY}T10:00:00Z`,
    active_seconds: 3600,
    idle_seconds: 600,
  });
  const entry = (status, duration) =>
    insert("time_entries", { member_id: worker.id, project_id: project.id, date: DAY, duration, status, source: "manual" });
  await entry("approved", 1800);
  await entry("pending", 900);
  await entry("rejected", 450);

  const range = { fromDay: DAY, toDay: DAY };

  test("project metrics count the session plus approved manual time only", async () => {
    const m = (await svc.getProjectActivityMetricsPg({ projectIds: [project.id], ...range })).get(project.id);
    assert.equal(m.activeSeconds, 3600 + 1800);
    assert.equal(m.idleSeconds, 600);
  });

  test("the daily trend, per-member seconds and personal figures agree with it", async () => {
    const day = (await svc.getDailyActivityTotalsPg({ projectIds: [project.id], ...range })).get(DAY);
    assert.equal(day.activeSeconds, 5400);
    const perMember = (await svc.getMemberActivitySecondsPg({ projectIds: [project.id], ...range })).get(project.id);
    assert.equal(perMember.get(worker.id), 5400);
    const mine = (await svc.getMemberDailyActivityTotalsPg({ projectIds: [project.id], memberId: worker.id, ...range })).get(DAY);
    assert.equal(mine.activeSeconds, 5400);
    const mineByProject = (await svc.getMemberProjectActivityMetricsPg({ projectIds: [project.id], memberId: worker.id, ...range })).get(project.id);
    assert.equal(mineByProject.activeSeconds, 5400);
  });

  test("approving the pending entry is what moves the figure", async () => {
    await pg.rows("UPDATE time_entries SET status = 'approved' WHERE status = 'pending'");
    const m = (await svc.getProjectActivityMetricsPg({ projectIds: [project.id], ...range })).get(project.id);
    assert.equal(m.activeSeconds, 3600 + 1800 + 900);
  });
}
