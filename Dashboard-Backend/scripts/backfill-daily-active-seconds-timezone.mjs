#!/usr/bin/env node
/**
 * Re-bucket daily_member_active_seconds into each member's own local day.
 *
 * Why this exists
 * ---------------
 * Those rows used to be keyed by casting a session's `started_at` with
 * Postgres' `::date`, i.e. by the database session's timezone (effectively
 * UTC). They are now keyed by the day that instant falls on in the *member's*
 * timezone. For anyone east or west of UTC that is a different day for
 * sessions started near midnight - a Cairo member (UTC+3) starting at 01:00
 * local was filed under the previous UTC day - so rows written before the
 * change disagree with rows written after it, and a "worked today" query can
 * read a mix of both.
 *
 * This recomputes the affected range from the sessions themselves.
 *
 * The dangerous part, and how it is handled
 * -----------------------------------------
 * `activity_sessions` are pruned by data retention; `daily_member_active_seconds`
 * are not. So for any period older than the retention window the buckets are
 * the ONLY surviving record - recomputing there would "recompute" them to
 * nothing and silently destroy payroll history.
 *
 * Therefore this script:
 *   - refuses to touch any day earlier than the oldest session still present
 *     (plus a safety margin), and reports what it skipped;
 *   - only ever rewrites days it can fully reconstruct;
 *   - is dry-run by default. Nothing is written without --apply;
 *   - is idempotent: running it twice changes nothing the second time.
 *
 * Usage:
 *   node scripts/backfill-daily-active-seconds-timezone.mjs            # report only
 *   node scripts/backfill-daily-active-seconds-timezone.mjs --apply    # write
 *   node scripts/backfill-daily-active-seconds-timezone.mjs --member <uuid>
 */
import { query } from "../src/lib/postgres/client.js";
import { canonicalizeTimeZone, localDayFor } from "../src/lib/time/timezone-utils.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const memberFlagIndex = args.indexOf("--member");
const ONLY_MEMBER = memberFlagIndex >= 0 ? args[memberFlagIndex + 1] : null;
// Sessions that ended just before the retention cutoff may already be gone
// while their buckets remain. Staying a day inside the oldest surviving
// session avoids rewriting a boundary day from partial data.
const SAFETY_MARGIN_DAYS = 1;

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log(APPLY ? "MODE: apply (will write)" : "MODE: dry run (no writes; pass --apply to write)");

  const [{ oldest } = {}] = await query(
    `SELECT MIN(started_at)::date::text AS oldest FROM activity_sessions`,
  );
  if (!oldest) {
    console.log("No sessions present at all - nothing can be recomputed. Exiting without changes.");
    return;
  }
  const floorDay = addDays(oldest, SAFETY_MARGIN_DAYS);
  console.log(`Oldest surviving session: ${oldest}`);
  console.log(`Will only rewrite days >= ${floorDay} (older buckets are unreconstructable and left alone)`);

  const skipped = await query(
    `SELECT count(*)::int AS n FROM daily_member_active_seconds WHERE day < $1::date`,
    [floorDay],
  );
  console.log(`Buckets older than that, preserved untouched: ${skipped[0]?.n ?? 0}`);

  const memberFilter = ONLY_MEMBER ? "AND s.member_id = $2" : "";
  const params = ONLY_MEMBER ? [floorDay, ONLY_MEMBER] : [floorDay];

  // Recompute from the sessions themselves, in the member's own zone. Only
  // sessions are summed; manual entries live in their own table and never fed
  // these buckets.
  const sessions = await query(
    `SELECT s.member_id, s.task_id, s.started_at, s.active_seconds,
            COALESCE(NULLIF(m.timezone, ''), 'UTC') AS timezone
       FROM activity_sessions s
       LEFT JOIN members m ON m.id = s.member_id
      WHERE s.started_at >= $1::date ${memberFilter}`,
    params,
  );
  console.log(`Sessions in range: ${sessions.length}`);

  const desiredMember = new Map();
  const desiredTask = new Map();
  for (const s of sessions) {
    const seconds = Math.max(0, Math.floor(Number(s.active_seconds) || 0));
    if (seconds === 0) continue;
    const day = localDayFor(new Date(s.started_at), canonicalizeTimeZone(s.timezone));
    const mKey = `${s.member_id}|${day}`;
    desiredMember.set(mKey, (desiredMember.get(mKey) ?? 0) + seconds);
    if (s.task_id) {
      const tKey = `${s.member_id}|${s.task_id}|${day}`;
      desiredTask.set(tKey, (desiredTask.get(tKey) ?? 0) + seconds);
    }
  }

  const existing = await query(
    `SELECT member_id, day::text AS day, active_seconds
       FROM daily_member_active_seconds
      WHERE day >= $1::date ${ONLY_MEMBER ? "AND member_id = $2" : ""}`,
    params,
  );

  let changes = 0;
  let unchanged = 0;
  const diffs = [];
  for (const row of existing) {
    const key = `${row.member_id}|${row.day}`;
    const want = desiredMember.get(key) ?? 0;
    const have = Math.max(0, Math.floor(Number(row.active_seconds) || 0));
    if (want === have) {
      unchanged++;
    } else {
      changes++;
      diffs.push({ member: row.member_id, day: row.day, have, want, delta: want - have });
    }
    desiredMember.delete(key);
  }
  const additions = [...desiredMember.entries()].filter(([, v]) => v > 0);

  console.log(`\nMember-day buckets: ${unchanged} already correct, ${changes} differ, ${additions.length} missing`);
  for (const d of diffs.slice(0, 25)) {
    console.log(`  ${d.day}  member=${d.member}  ${d.have}s -> ${d.want}s  (${d.delta >= 0 ? "+" : ""}${d.delta})`);
  }
  if (diffs.length > 25) console.log(`  ... and ${diffs.length - 25} more`);
  for (const [key, want] of additions.slice(0, 25)) {
    const [member, day] = key.split("|");
    console.log(`  ${day}  member=${member}  (missing) -> ${want}s`);
  }

  if (!APPLY) {
    console.log("\nDry run - nothing written. Re-run with --apply to write these changes.");
    return;
  }

  let written = 0;
  for (const d of diffs) {
    await query(
      `UPDATE daily_member_active_seconds SET active_seconds = $3, updated_at = now()
        WHERE member_id = $1 AND day = $2::date`,
      [d.member, d.day, d.want],
    );
    written++;
  }
  for (const [key, want] of additions) {
    const [member, day] = key.split("|");
    await query(
      `INSERT INTO daily_member_active_seconds (member_id, day, active_seconds)
       VALUES ($1, $2::date, $3)
       ON CONFLICT (member_id, day) DO UPDATE SET active_seconds = EXCLUDED.active_seconds, updated_at = now()`,
      [member, day, want],
    );
    written++;
  }

  // Per-task buckets follow the same rule; rebuilt only for the same range.
  let taskWritten = 0;
  for (const [key, want] of desiredTask.entries()) {
    const [member, task, day] = key.split("|");
    await query(
      `INSERT INTO daily_member_task_active_seconds (member_id, task_id, day, active_seconds)
       VALUES ($1, $2, $3::date, $4)
       ON CONFLICT (member_id, task_id, day)
       DO UPDATE SET active_seconds = EXCLUDED.active_seconds, updated_at = now()`,
      [member, task, day, want],
    );
    taskWritten++;
  }

  console.log(`\nWrote ${written} member-day rows and ${taskWritten} member-task-day rows.`);
  console.log("Re-run without --apply to confirm it now reports zero differences.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
