/**
 * A "capture run" is an unbroken stretch of tracked work: screenshots in the
 * same session with no idle gap between them.
 *
 * Why gaps mean idle, rather than needing an idle-segments table: the agent
 * provably does not capture while idle - both tick paths guard on
 * `!idle_now && now >= state.next_screenshot_at` (agent/tracker.rs). So a gap
 * longer than the maximum scheduled delay can only mean idle, a pause, or the
 * agent being down. Those are exactly the boundaries an activity correction
 * should respect.
 *
 * There is no per-interval idle record anywhere in the schema - sessions
 * carry only a cumulative idle_seconds - and inventing one to serve this
 * feature would be building a table to re-derive a signal that already
 * exists.
 * ponytail: gap-derived run boundaries; add real idle segments only if a
 * timeline UI ever needs exact idle start/end times.
 */

/** A gap beyond max-delay x this is an idle boundary rather than ordinary
 *  jitter in the randomised capture schedule. */
const RUN_GAP_MULTIPLIER = 1.5;

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * Split one session's screenshots into runs.
 *
 * @param screenshots  rows with { id, captured_at } - assumed same session
 * @param maxDelaySec  screenshot_max_delay_sec from activity_scoring_settings
 *                     (server-tunable; hardcoding 210 breaks any org that
 *                     raised it)
 * @returns array of arrays, each inner array a run in chronological order
 */
export function splitIntoRuns(screenshots, maxDelaySec) {
  const rows = (screenshots ?? [])
    .filter((s) => s && Number.isFinite(toMs(s.captured_at ?? s.capturedAt)))
    .map((s) => ({ ...s, _at: toMs(s.captured_at ?? s.capturedAt) }))
    .sort((a, b) => a._at - b._at);
  if (rows.length === 0) return [];

  const thresholdMs = Math.max(1, Number(maxDelaySec) || 0) * RUN_GAP_MULTIPLIER * 1000;
  const runs = [];
  let current = [rows[0]];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]._at - rows[i - 1]._at > thresholdMs) {
      runs.push(current);
      current = [];
    }
    current.push(rows[i]);
  }
  runs.push(current);
  return runs;
}

/**
 * The run containing a given screenshot, or just that screenshot when it sits
 * alone between two gaps. Returns [] when the id is not in the input at all.
 */
export function runContaining(screenshots, screenshotId, maxDelaySec) {
  const target = String(screenshotId);
  for (const run of splitIntoRuns(screenshots, maxDelaySec)) {
    if (run.some((s) => String(s.id) === target)) return run;
  }
  return [];
}
