import type { MemberLimits } from "../types";

type LimitsScope = Pick<MemberLimits, "timeZone" | "todayDay" | "projectId">;

/**
 * Which calendar - and, for the project-scoped figures, which project - a limits
 * response was cut for. `null` while there is no response yet.
 *
 * Today's tiles keep a "never goes down" floor so a poll that lags the local
 * ticking clock doesn't read as seconds vanishing. That floor is only valid
 * while the numbers it compares describe the same thing: the same sessions cut
 * at another zone's midnights (the project changed, or declares another zone
 * than the member), or scoped to another project, are a different - and
 * legitimately lower - figure, and holding the old high-water mark over it
 * made Today climb on its own and stay there. Keying on what the response
 * itself says it was cut for (not on the selection, which runs ahead of the
 * next poll) lifts the floor exactly when the answer changes.
 *
 * A backend that predates `timeZone` and `todayDay` can't say, so the device's
 * own day stands in, as it always did.
 */
export function limitsCalendarKey(
  limits: LimitsScope | null | undefined,
  deviceDay: string,
  { includeProject = false }: { includeProject?: boolean } = {},
): string | null {
  if (!limits) return null;
  const calendar =
    limits.timeZone || limits.todayDay
      ? `${limits.timeZone ?? ""}|${limits.todayDay ?? ""}`
      : `device|${deviceDay}`;
  return includeProject ? `${calendar}|${limits.projectId ?? ""}` : calendar;
}
