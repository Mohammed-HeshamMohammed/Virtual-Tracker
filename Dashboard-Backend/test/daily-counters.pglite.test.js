// Two per-member, per-day counters that are written many times a day: what a switched-off
// capability discarded (capture_policy_drops) and the notices about lost or stopped time
// (record_notices). Repeats must add up, not overwrite, and a notice must message the member once
// per day. Run against a real Postgres (PGlite) built from the boot schema.
//
// Replaces the SQL-text checks in policy-health and record-notices. Skips itself when PGlite is
// missing.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startPglite, seeder, srcUrl, loadPglite } from "./helpers/pglite.js";

if (!(await loadPglite())) {
  test("daily counters against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const pg = await startPglite();
  after(() => pg.close());
  const { member } = seeder(pg);
  const { recordPolicyDrops } = await import(srcUrl("modules/compliance/policy-health.js"));
  const { recordNotice } = await import(srcUrl("modules/activity/record-notices.js"));

  test("drops for the same capability on the same day add up", async () => {
    const m = await member("Employee");
    await recordPolicyDrops(m.id, { screenshots: 2, url_capture: 1 });
    await recordPolicyDrops(m.id, { screenshots: 3 });
    const rows = await pg.rows("SELECT capability, dropped FROM capture_policy_drops WHERE member_id = $1 ORDER BY capability", [m.id]);
    assert.deepEqual(rows.map((r) => [r.capability, Number(r.dropped)]), [["screenshots", 5], ["url_capture", 1]]);
  });

  test("a repeated notice adds its seconds and occurrences to the day's row and messages the member once", async () => {
    const m = await member("Employee", { timezone: "UTC" });
    const first = await recordNotice({ memberId: m.id, kind: "session_reaped", secondsAffected: 1800 });
    const second = await recordNotice({ memberId: m.id, kind: "session_reaped", secondsAffected: 600 });
    assert.ok(first && second);
    const rows = await pg.rows("SELECT seconds_affected, occurrences FROM record_notices WHERE member_id = $1", [m.id]);
    assert.deepEqual(rows.map((r) => [Number(r.seconds_affected), Number(r.occurrences)]), [[2400, 2]]);
    const sent = await pg.rows("SELECT title FROM notifications WHERE recipient_id = $1 AND type = 'record_notice'", [m.id]);
    assert.equal(sent.length, 1);
    assert.match(sent[0].title, /timer was stopped/i);
  });

  test("different kinds of notice keep their own rows", async () => {
    const m = await member("Employee", { timezone: "UTC" });
    await recordNotice({ memberId: m.id, kind: "session_reaped", secondsAffected: 60 });
    await recordNotice({ memberId: m.id, kind: "work_dropped" });
    const kinds = await pg.rows("SELECT kind FROM record_notices WHERE member_id = $1 ORDER BY kind", [m.id]);
    assert.deepEqual(kinds.map((k) => k.kind), ["session_reaped", "work_dropped"]);
  });
}
