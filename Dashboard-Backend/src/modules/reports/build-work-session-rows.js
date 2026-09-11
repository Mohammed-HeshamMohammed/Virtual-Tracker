import { localDayFor } from "./timezone-utils.js";
import { describeSessionReason } from "../activity/session-reasons.js";

/**
 * Decorates raw work-session rows with the identity of the member who worked
 * them, and — the point of this module — the day and timezone that day should
 * be read in.
 *
 * A session belongs to the local day it started in the *member's* zone, which
 * is the same rule Time & Activity applies (see build-time-and-activity-rows).
 * Before this existed the report derived its date by slicing the ISO string,
 * which is the UTC date: a member at UTC-5 starting 9pm on the 9th was stored
 * as 02:00Z on the 10th and reported as the 10th, disagreeing with Time &
 * Activity about the very same shift. The clock face had the opposite problem
 * — it was rendered in the *reader's* zone, so one shift showed a different
 * start time to a manager in Cairo than to one in Chicago.
 *
 * `memberTimezone` travels with the row so the client can render both on the
 * worker's clock rather than guessing.
 *
 * The query deliberately over-fetches a day either side (a member-local day
 * straddles the same dates expressed in UTC), so this also trims the result
 * back to the requested range.
 */
export function buildWorkSessionRows(sessions, nameMap, tzMap, fromDay, toDay) {
  return sessions
    .map((session) => {
      const memberTimezone = tzMap.get(session.memberId) ?? "UTC";
      return {
        ...session,
        memberName: nameMap.get(session.memberId)?.name ?? "Unknown",
        memberAvatarUrl: nameMap.get(session.memberId)?.avatarUrl ?? null,
        memberTimezone,
        localDay: localDayFor(new Date(session.startedAt), memberTimezone),
        // "Why did this end?" in words - only for sessions that have ended,
        // and only where something recorded a reason (PLAN D5). Sessions from
        // before reasons existed stay blank rather than claiming "unspecified".
        stoppedBy: session.endedAt && session.stopReason ? describeSessionReason(session.stopReason) : null,
      };
    })
    .filter((session) => session.localDay >= fromDay && session.localDay <= toDay);
}
