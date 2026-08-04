import { hammingDistance } from "./perceptual-hash.js";

// Out of 64 dHash bits - "near-identical", not merely similar. A real scene
// change (even a subtle one, like a cursor moving across a mostly-static
// document) moves the hash further than this.
export const STALENESS_HAMMING_THRESHOLD = 4;
// Consecutive near-identical + high-activity captures required before
// flagging - a single static pair is normal (someone paused to read); a
// sustained run of them while "activity" stays high is the fraud pattern.
export const STALENESS_MIN_RUN = 3;
export const HIGH_ACTIVITY_THRESHOLD = 70;
export const CATEGORY_CONFLICT_MIN_SECONDS = 20 * 60;
// AC-1: a handful of captures is not enough signal to judge - a single
// injected click (a legitimate remote-control tool, an accessibility aid)
// must not read the same as a jiggler running the whole session.
export const INJECTED_INPUT_MIN_CAPTURES = 5;
export const INJECTED_INPUT_RATE_THRESHOLD = 0.5;

/**
 * AC-2 screenshot-staleness check: true if this session's captures contain a
 * sustained run where the screen barely changed while reported activity
 * stayed high - background playback with a jiggler/auto-clicker running
 * alongside it. A genuine low-activity reading/review session never trips
 * this: the activity-level side of the AND is what keeps it from flagging
 * someone who is legitimately just reading.
 * @param {{ perceptualHash: string, activityLevel: number }[]} screenshotsAsc - ordered oldest to newest, same session
 */
export function detectScreenshotStaleness(screenshotsAsc) {
  let run = 0;
  for (let i = 1; i < screenshotsAsc.length; i++) {
    const prev = screenshotsAsc[i - 1];
    const curr = screenshotsAsc[i];
    const isStaleAndActive =
      hammingDistance(prev.perceptualHash, curr.perceptualHash) <= STALENESS_HAMMING_THRESHOLD &&
      prev.activityLevel >= HIGH_ACTIVITY_THRESHOLD &&
      curr.activityLevel >= HIGH_ACTIVITY_THRESHOLD;
    run = isStaleAndActive ? run + 1 : 0;
    if (run >= STALENESS_MIN_RUN) return true;
  }
  return false;
}

/**
 * AC-2 category-conflict check: true if a session logged a sustained span of
 * distracting-category foreground time (CLS-1) while its screenshots'
 * average reported activity stayed high - "high activity while a video or
 * game is foreground for 40 minutes".
 * @param {number} distractingSeconds
 * @param {number} avgActivityLevel
 */
export function detectCategoryConflict(distractingSeconds, avgActivityLevel) {
  return distractingSeconds >= CATEGORY_CONFLICT_MIN_SECONDS && avgActivityLevel >= HIGH_ACTIVITY_THRESHOLD;
}

/**
 * AC-1: true if a large majority of this session's signal-bearing captures
 * (ACT-4's `keystroke_count`/`injected_event_count`) show OS-flagged
 * synthetic input, and there were enough of them to trust the ratio. The
 * server-side counterpart to the agent's own local `maybe_flag_synthetic_input`
 * warning - this is what actually makes the signal reviewable by a manager
 * and contestable by the employee (activity_integrity_flags), not just a log
 * line on the machine being flagged.
 * @param {number} totalWithSignal
 * @param {number} injected
 */
export function detectSustainedInjection(totalWithSignal, injected) {
  if (totalWithSignal < INJECTED_INPUT_MIN_CAPTURES) return false;
  return injected / totalWithSignal >= INJECTED_INPUT_RATE_THRESHOLD;
}
