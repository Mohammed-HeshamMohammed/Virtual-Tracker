import crypto from "node:crypto";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { categorize } from "../classification/activity-categories.js";
import {
  detectScreenshotStaleness,
  detectCategoryConflict,
  detectSustainedInjection,
  HIGH_ACTIVITY_THRESHOLD,
  INJECTED_INPUT_RATE_THRESHOLD,
} from "./integrity-checks.js";
import {
  fetchRecentScreenshotsPg,
  fetchRecentActivityLevelsBySessionPg,
  fetchRecentAppLogNamesPg,
  fetchRecentUrlLogDomainsPg,
  insertIntegrityFlagPg,
} from "../../lib/postgres/integrity-postgres.service.js";

// AC-2: "the comparison is a backend job" - paced for the sustained-span
// timescale these checks look for (tens of minutes), not a tick rate.
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
// Wide enough to catch a run spanning several SCREENSHOT_MIN/MAX_DELAY_SEC
// captures, or a CATEGORY_CONFLICT_MIN_SECONDS span, comfortably inside one window.
const LOOKBACK_MINUTES = 60;

let timer = null;

/** Idempotent - a second call while already scheduled is a no-op, same as the other sweep jobs. */
export function scheduleIntegritySweep() {
  if (timer) return;
  const run = () => runIntegrityChecks().catch((err) => logSafeWarn("[integrity sweep]", err));
  run();
  timer = setInterval(run, CHECK_INTERVAL_MS);
  timer.unref?.();
}

export async function runIntegrityChecks() {
  const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000);
  // AC-2 and AC-1 both drive off the same recent-screenshot rows, so they're
  // fetched once here and handed to two independent per-session checks
  // instead of scanning activity_screenshots twice.
  const screenshotRows = await fetchRecentScreenshotsPg(since);
  await Promise.all([
    runScreenshotStalenessCheck(screenshotRows),
    runInjectedInputCheck(screenshotRows),
    runCategoryConflictCheck(since),
  ]);
}

async function runScreenshotStalenessCheck(rows) {
  /** @type {Map<string, { memberId: string, shots: { perceptualHash: string, activityLevel: number }[] }>} */
  const bySession = new Map();
  for (const row of rows) {
    const entry = bySession.get(row.session_id) ?? { memberId: row.member_id, shots: [] };
    entry.shots.push({ perceptualHash: row.perceptual_hash, activityLevel: row.activity_level });
    bySession.set(row.session_id, entry);
  }
  for (const [sessionId, { memberId, shots }] of bySession) {
    if (!detectScreenshotStaleness(shots)) continue;
    await insertIntegrityFlagPg({
      id: crypto.randomUUID(),
      memberId,
      sessionId,
      flagType: "screenshot_staleness",
      detail: `Screen barely changed across a run of captures in the last ${LOOKBACK_MINUTES} minutes while activity stayed at/above ${HIGH_ACTIVITY_THRESHOLD}%.`,
    });
  }
}

/**
 * AC-1: the server-side, reviewable/contestable counterpart to the agent's
 * own local synthetic-input warning - see integrity-checks.js's
 * detectSustainedInjection for the "enough captures, high enough ratio"
 * reasoning.
 */
async function runInjectedInputCheck(rows) {
  /** @type {Map<string, { memberId: string, totalWithSignal: number, injected: number }>} */
  const bySession = new Map();
  for (const row of rows) {
    const keystrokeCount = Number(row.keystroke_count) || 0;
    const injectedEventCount = Number(row.injected_event_count) || 0;
    if (keystrokeCount === 0 && injectedEventCount === 0) continue; // no signal from this capture
    const entry = bySession.get(row.session_id) ?? { memberId: row.member_id, totalWithSignal: 0, injected: 0 };
    entry.totalWithSignal += 1;
    if (injectedEventCount > 0) entry.injected += 1;
    bySession.set(row.session_id, entry);
  }
  for (const [sessionId, { memberId, totalWithSignal, injected }] of bySession) {
    if (!detectSustainedInjection(totalWithSignal, injected)) continue;
    await insertIntegrityFlagPg({
      id: crypto.randomUUID(),
      memberId,
      sessionId,
      flagType: "injected_input",
      detail: `${injected}/${totalWithSignal} captures in the last ${LOOKBACK_MINUTES} minutes showed OS-flagged synthetic input (>=${Math.round(INJECTED_INPUT_RATE_THRESHOLD * 100)}%).`,
    });
  }
}

async function runCategoryConflictCheck(since) {
  const [appRows, urlRows, activityRows] = await Promise.all([
    fetchRecentAppLogNamesPg(since),
    fetchRecentUrlLogDomainsPg(since),
    fetchRecentActivityLevelsBySessionPg(since),
  ]);

  // Resolve category once per distinct app/domain name, not once per row -
  // the same handful of apps/domains repeat across every session in the window.
  const appCategoryCache = new Map();
  const domainCategoryCache = new Map();
  async function isDistractingApp(name) {
    if (!appCategoryCache.has(name)) appCategoryCache.set(name, categorize("app", name));
    return (await appCategoryCache.get(name)) === "distracting";
  }
  async function isDistractingDomain(name) {
    if (!domainCategoryCache.has(name)) domainCategoryCache.set(name, categorize("domain", name));
    return (await domainCategoryCache.get(name)) === "distracting";
  }

  /** @type {Map<string, { memberId: string, seconds: number }>} */
  const distractingBySession = new Map();
  for (const row of appRows) {
    if (!(await isDistractingApp(row.app_name))) continue;
    const entry = distractingBySession.get(row.session_id) ?? { memberId: row.member_id, seconds: 0 };
    entry.seconds += Number(row.duration_seconds) || 0;
    distractingBySession.set(row.session_id, entry);
  }
  for (const row of urlRows) {
    if (!(await isDistractingDomain(row.domain))) continue;
    const entry = distractingBySession.get(row.session_id) ?? { memberId: row.member_id, seconds: 0 };
    entry.seconds += Number(row.duration_seconds) || 0;
    distractingBySession.set(row.session_id, entry);
  }

  const avgActivityBySession = new Map(activityRows.map((r) => [r.session_id, Number(r.avg_activity) || 0]));

  for (const [sessionId, { memberId, seconds }] of distractingBySession) {
    const avgActivity = avgActivityBySession.get(sessionId) ?? 0;
    if (!detectCategoryConflict(seconds, avgActivity)) continue;
    await insertIntegrityFlagPg({
      id: crypto.randomUUID(),
      memberId,
      sessionId,
      flagType: "category_conflict",
      detail: `${Math.round(seconds / 60)} min of distracting-category foreground time in the last ${LOOKBACK_MINUTES} minutes while activity averaged ${Math.round(avgActivity)}%.`,
    });
  }
}
