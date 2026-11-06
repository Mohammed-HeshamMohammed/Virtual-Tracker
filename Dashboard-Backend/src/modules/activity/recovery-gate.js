/**
 * Whether the "block tracking on days off" check applies to a session action.
 *
 * It is for starting work on a rest day. An agent re-opening the session the server just reaped
 * (reason recovered_after_reap) is not starting work: the shift began on a working day, and
 * refusing the re-open just after midnight into a day off left the timer stopped for good.
 * `hasRecentReap` is the server's own record of that reap, so the reason alone is not trusted.
 */
export function dayOffGateApplies({ action, reason, hasRecentReap }) {
  if (action !== "start") return false;
  return !(reason === "recovered_after_reap" && hasRecentReap === true);
}
