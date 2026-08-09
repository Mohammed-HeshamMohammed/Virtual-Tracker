// Groups raw activity_sessions rows into the day + per-member-per-day shape the
// report endpoint sends over the wire. Stays in seconds - features/reports/api/
// time-and-activity-api.ts on the frontend does the seconds -> "H:MM:SS" formatting.
//
// Each session is attributed to the member's own local calendar day(s), not UTC -
// see time-and-activity-report-plan.md "Known gap: per-member timezone" for why.
// A session that spans local midnight gets its active/idle seconds split
// proportionally by wall-clock duration on each side - an approximation (assumes
// even activity through the session), not exact, but far closer than attributing
// the whole session to whichever day it happened to start on.
import { localDayFor, localMidnightUtc, nextLocalDay } from "./timezone-utils.js";

/**
 * Splits one session's active/idle seconds across the local day(s) it spans.
 * @param {{ started_at: string, ended_at: string | null, updated_at: string, active_seconds: number, idle_seconds: number }} session
 * @param {string} timeZone
 * @returns {Array<{ day: string, activeSeconds: number, idleSeconds: number }>}
 */
function splitSessionByLocalDay(session, timeZone) {
  const start = new Date(session.started_at);
  const endRaw = new Date(session.ended_at ?? session.updated_at);
  const end = endRaw > start ? endRaw : new Date(start.getTime() + 1000); // guard zero/negative duration

  const startDay = localDayFor(start, timeZone);
  const endDay = localDayFor(end, timeZone);
  if (startDay === endDay) {
    return [{ day: startDay, activeSeconds: session.active_seconds, idleSeconds: session.idle_seconds }];
  }

  const totalMs = end.getTime() - start.getTime();
  const segments = [];
  let cursor = start;
  let day = startDay;
  while (day < endDay) {
    const boundary = localMidnightUtc(nextLocalDay(day), timeZone);
    const segmentEnd = boundary < end ? boundary : end;
    segments.push({ day, ms: Math.max(0, segmentEnd.getTime() - cursor.getTime()) });
    cursor = segmentEnd;
    day = nextLocalDay(day);
  }
  segments.push({ day: endDay, ms: Math.max(0, end.getTime() - cursor.getTime()) });

  return segments
    .filter((s) => s.ms > 0)
    .map((s) => ({
      day: s.day,
      activeSeconds: Math.round((session.active_seconds * s.ms) / totalMs),
      idleSeconds: Math.round((session.idle_seconds * s.ms) / totalMs),
    }));
}

/**
 * @param {Array<{
 *   member_id: string, project_id: string | null, project_name: string,
 *   started_at: string, ended_at: string | null, updated_at: string,
 *   active_seconds: number, idle_seconds: number,
 * }>} rawRows
 * @param {Map<string, { name: string }>} memberNameMap
 * @param {Map<string, string>} memberTimezones memberId -> IANA zone, "UTC" fallback assumed by caller
 * @param {string} fromDay 'YYYY-MM-DD' - segments outside [fromDay, toDay] are dropped (the SQL window is widened)
 * @param {string} toDay
 * @returns {{
 *   days: Array<{
 *     date: string,
 *     members: Array<{ memberId: string, name: string, activeSeconds: number, idleSeconds: number, projectNames: string[] }>,
 *   }>,
 * }}
 */
export function buildTimeAndActivityReportPayload(rawRows, memberNameMap, memberTimezones, fromDay, toDay) {
  /** @type {Map<string, Map<string, { activeSeconds: number, idleSeconds: number, projectNames: Set<string> }>>} */
  const byDay = new Map();

  for (const row of rawRows) {
    const timeZone = memberTimezones.get(row.member_id) ?? "UTC";
    const segments = splitSessionByLocalDay(row, timeZone);

    for (const segment of segments) {
      if (segment.day < fromDay || segment.day > toDay) continue;

      if (!byDay.has(segment.day)) byDay.set(segment.day, new Map());
      const byMember = byDay.get(segment.day);
      if (!byMember.has(row.member_id)) {
        byMember.set(row.member_id, { activeSeconds: 0, idleSeconds: 0, projectNames: new Set() });
      }
      const entry = byMember.get(row.member_id);
      entry.activeSeconds += segment.activeSeconds;
      entry.idleSeconds += segment.idleSeconds;
      if (row.project_name) entry.projectNames.add(row.project_name);
    }
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, byMember]) => ({
      date,
      members: [...byMember.entries()].map(([memberId, entry]) => ({
        memberId,
        name: memberNameMap.get(memberId)?.name ?? "Unknown",
        activeSeconds: entry.activeSeconds,
        idleSeconds: entry.idleSeconds,
        projectNames: [...entry.projectNames],
      })),
    }));

  return { days };
}
