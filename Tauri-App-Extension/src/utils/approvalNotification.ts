import type { AgentNotification } from "../types";

/** Id of the locally made "timesheets waiting" entry in the notification list. */
export const TIMESHEETS_NOTIFICATION_ID = "local:timesheets-pending";

/** Pending timesheets as a notification, so it lives in the bell with everything else that
 *  wants the user's attention instead of taking a card in the sidebar. `seenCount` is the
 *  count the user last opened it at: it reads as read until more timesheets arrive. */
export function timesheetNotification(pendingCount: number, seenCount: number): AgentNotification | null {
  if (pendingCount <= 0) return null;
  const plural = pendingCount === 1 ? "" : "s";
  return {
    id: TIMESHEETS_NOTIFICATION_ID,
    type: "timesheets",
    title: `${pendingCount} timesheet${plural} waiting on you`,
    message: "Open the dashboard to review and approve.",
    targetVersion: null,
    read: seenCount >= pendingCount,
    createdAt: null,
    actionLabel: "Review",
  };
}

/** "Seen at N" only means something while N or more are waiting. If some are approved and a new
 *  one arrives, the count can be back under the old mark and would read as already seen. */
export function clampSeenTimesheets(seen: number, pendingCount: number): number {
  return Math.min(seen, Math.max(0, pendingCount));
}
