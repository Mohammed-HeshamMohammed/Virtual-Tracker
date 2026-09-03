import { hammingDistance } from "./perceptual-hash.js";

export const STALENESS_HAMMING_THRESHOLD = 4;
export const STALENESS_MIN_RUN = 3;
export const HIGH_ACTIVITY_THRESHOLD = 70;
export const CATEGORY_CONFLICT_MIN_SECONDS = 20 * 60;
export const INJECTED_INPUT_MIN_CAPTURES = 5;
export const INJECTED_INPUT_RATE_THRESHOLD = 0.5;

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

export function detectCategoryConflict(distractingSeconds, avgActivityLevel) {
  return distractingSeconds >= CATEGORY_CONFLICT_MIN_SECONDS && avgActivityLevel >= HIGH_ACTIVITY_THRESHOLD;
}

export function detectSustainedInjection(totalWithSignal, injected) {
  if (totalWithSignal < INJECTED_INPUT_MIN_CAPTURES) return false;
  return injected / totalWithSignal >= INJECTED_INPUT_RATE_THRESHOLD;
}
