export const DAILY_DRIFT_THRESHOLD_SECONDS = 10;
export const LIFETIME_DRIFT_THRESHOLD_SECONDS = 10;

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
