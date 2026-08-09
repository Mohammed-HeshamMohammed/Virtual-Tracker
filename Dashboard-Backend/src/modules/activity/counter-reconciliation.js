// OBS-1: "the entire bug class in this plan was found by a user staring at a
// clock" - this compares the counter stores that are supposed to agree and
// logs when they don't, instead of waiting for the next user to notice.
// Deliberately diagnostic only: it must never write a correction, since a
// discrepancy here is exactly the alarm a real accounting bug should trip,
// and silently "fixing" it would hide the bug it exists to surface.
export const DAILY_DRIFT_THRESHOLD_SECONDS = 10;
export const LIFETIME_DRIFT_THRESHOLD_SECONDS = 10;

/**
 * @param {Map<string, number>} storeA
 * @param {Map<string, number>} storeB
 * @param {number} thresholdSeconds
 * @returns {{ memberId: string, a: number, b: number, diffSeconds: number }[]}
 */
export function findDriftedMembers(storeA, storeB, thresholdSeconds) {
  const memberIds = new Set([...storeA.keys(), ...storeB.keys()]);
  const drifted = [];
  for (const memberId of memberIds) {
    const a = storeA.get(memberId) ?? 0;
    const b = storeB.get(memberId) ?? 0;
    const diffSeconds = Math.abs(a - b);
    if (diffSeconds > thresholdSeconds) {
      drifted.push({ memberId, a, b, diffSeconds });
    }
  }
  return drifted;
}
