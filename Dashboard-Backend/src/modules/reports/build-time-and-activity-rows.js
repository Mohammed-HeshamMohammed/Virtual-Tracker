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
 *   client_name: string, team_name: string,
 *   started_at: string, ended_at: string | null, updated_at: string,
 *   active_seconds: number, idle_seconds: number,
 * }>} rawRows
 * @param {Map<string, { name: string }>} memberNameMap
 * @param {Map<string, string>} memberTimezones memberId -> IANA zone, "UTC" fallback assumed by caller
 * @param {string} fromDay 'YYYY-MM-DD' - segments outside [fromDay, toDay] are dropped (the SQL window is widened)
 * @param {string} toDay
 * @param {Map<string, number>} [memberRates] memberId -> hourly rate; omit/empty to report 0 cost
 * @returns {{
 *   days: Array<{
 *     date: string,
 *     members: Array<{ memberId: string, name: string, activeSeconds: number, idleSeconds: number, manualSeconds: number, spentAmount: number, projectNames: string[] }>,
 *   }>,
 *   entries: Array<{
 *     date: string, memberId: string, memberName: string,
 *     projectId: string | null, projectName: string, clientName: string, teamName: string,
 *     activeSeconds: number, idleSeconds: number, manualSeconds: number, spentAmount: number,
 *   }>,
 * }}
 */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * A member's rate as of a given calendar day - what "spent" should actually
 * mean, now that pay_rate_history exists. A flat number (the old shape,
 * still what every pre-existing test and any caller that hasn't been
 * updated passes) is a rate with no history to speak of - used unchanged
 * for every day, exactly like before this existed. An array is that
 * member's real timeline (ascending by effectiveDate, including their
 * current rate as its last point) - this picks whichever point was
 * actually in effect on `day`, so a raise or cut today no longer silently
 * changes what a *past* day's amount reads as. A day before the member's
 * earliest known point uses that earliest point, the same "only one rate
 * on file" assumption the flat-number shape already made for everything.
 * @param {Map<string, number | Array<{ effectiveDate: string, rate: number }>>} memberRates
 * @param {string} memberId
 * @param {string} day
 */
export function resolveRateForDay(memberRates, memberId, day) {
  const entry = memberRates.get(memberId);
  if (entry == null) return 0;
  if (typeof entry === "number") return entry;
  if (!Array.isArray(entry) || entry.length === 0) return 0;
  let rate = entry[0].rate;
  for (const point of entry) {
    if (point.effectiveDate <= day) rate = point.rate;
    else break;
  }
  return rate;
}

export function buildTimeAndActivityReportPayload(
  rawRows,
  memberNameMap,
  memberTimezones,
  fromDay,
  toDay,
  memberRates = new Map(),
  manualRows = [],
) {
  /** @type {Map<string, Map<string, { activeSeconds: number, idleSeconds: number, projectNames: Set<string> }>>} */
  const byDay = new Map();
  // Finer-grained than `byDay` (day+member+project, not just day+member) -
  // the "group by" dropdown (member/project/client/team/week) needs real
  // per-project seconds to aggregate from, which the day/member shape above
  // can't give it: a member touching two projects in one day collapses into
  // one row there with a Set of project *names*, never per-project time.
  // Kept as a second, parallel structure instead of restructuring `days`
  // itself, so every existing reader of `days`/`memberRows` (CSV/PDF export,
  // the chart, the default date-per-day view) is untouched.
  /** @type {Map<string, { date: string, memberId: string, projectId: string | null, projectName: string, clientName: string, teamName: string, activeSeconds: number, idleSeconds: number }>} */
  const byDayMemberProject = new Map();

  for (const row of rawRows) {
    const timeZone = memberTimezones.get(row.member_id) ?? "UTC";
    const segments = splitSessionByLocalDay(row, timeZone);

    for (const segment of segments) {
      if (segment.day < fromDay || segment.day > toDay) continue;

      if (!byDay.has(segment.day)) byDay.set(segment.day, new Map());
      const byMember = byDay.get(segment.day);
      if (!byMember.has(row.member_id)) {
        byMember.set(row.member_id, {
          activeSeconds: 0,
          idleSeconds: 0,
          manualSeconds: 0,
          projectNames: new Set(),
        });
      }
      const entry = byMember.get(row.member_id);
      entry.activeSeconds += segment.activeSeconds;
      entry.idleSeconds += segment.idleSeconds;
      if (row.project_name) entry.projectNames.add(row.project_name);

      const entryKey = `${segment.day}::${row.member_id}::${row.project_id ?? "none"}`;
      if (!byDayMemberProject.has(entryKey)) {
        byDayMemberProject.set(entryKey, {
          date: segment.day,
          memberId: row.member_id,
          projectId: row.project_id,
          projectName: row.project_name || "",
          clientName: row.client_name || "",
          teamName: row.team_name || "",
          activeSeconds: 0,
          idleSeconds: 0,
          manualSeconds: 0,
        });
      }
      const fine = byDayMemberProject.get(entryKey);
      fine.activeSeconds += segment.activeSeconds;
      fine.idleSeconds += segment.idleSeconds;
    }
  }

  // Manual entries fold into the same day/member and day/member/project
  // buckets, but into their own `manualSeconds` field - never into
  // active/idle. Those two drive the activity percentage, and a manual entry
  // is time nobody measured: counting it as active would let anyone type
  // eight hours and show 100% activity. It is real worked time, so it counts
  // toward totals; it is not observed time, so it stays out of the ratio.
  //
  // No day splitting - a manual entry's `date` is already a calendar day
  // (see getManualTimeEntryRowsPg), not a timestamp needing timezone
  // resolution the way a session that can cross midnight does.
  for (const row of manualRows) {
    if (row.day < fromDay || row.day > toDay) continue;

    if (!byDay.has(row.day)) byDay.set(row.day, new Map());
    const byMember = byDay.get(row.day);
    if (!byMember.has(row.member_id)) {
      byMember.set(row.member_id, {
        activeSeconds: 0,
        idleSeconds: 0,
        manualSeconds: 0,
        projectNames: new Set(),
      });
    }
    const entry = byMember.get(row.member_id);
    entry.manualSeconds = (entry.manualSeconds ?? 0) + row.manual_seconds;
    if (row.project_name) entry.projectNames.add(row.project_name);

    const entryKey = `${row.day}::${row.member_id}::${row.project_id ?? "none"}`;
    if (!byDayMemberProject.has(entryKey)) {
      byDayMemberProject.set(entryKey, {
        date: row.day,
        memberId: row.member_id,
        projectId: row.project_id,
        projectName: row.project_name || "",
        clientName: row.client_name || "",
        teamName: row.team_name || "",
        activeSeconds: 0,
        idleSeconds: 0,
        manualSeconds: 0,
      });
    }
    const fine = byDayMemberProject.get(entryKey);
    fine.manualSeconds = (fine.manualSeconds ?? 0) + row.manual_seconds;
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
        manualSeconds: entry.manualSeconds ?? 0,
        // Cost for the report's money columns. 0 when the caller passed no
        // rates (viewer not allowed to see compensation, or the member has
        // no pay rate set) - the frontend used to hardcode "$0.00" here
        // regardless, so every dollar figure read zero.
        //
        // Manual seconds are paid the same as tracked ones, so they belong
        // in the cost even though they stay out of the activity ratio.
        spentAmount: round2(
          ((entry.activeSeconds + (entry.manualSeconds ?? 0)) / 3600) * resolveRateForDay(memberRates, memberId, date),
        ),
        projectNames: [...entry.projectNames],
      })),
    }));

  const entries = [...byDayMemberProject.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({
      date: entry.date,
      memberId: entry.memberId,
      memberName: memberNameMap.get(entry.memberId)?.name ?? "Unknown",
      projectId: entry.projectId,
      projectName: entry.projectName,
      clientName: entry.clientName,
      teamName: entry.teamName,
      activeSeconds: entry.activeSeconds,
      idleSeconds: entry.idleSeconds,
      manualSeconds: entry.manualSeconds ?? 0,
      spentAmount: round2(
        ((entry.activeSeconds + (entry.manualSeconds ?? 0)) / 3600) *
          resolveRateForDay(memberRates, entry.memberId, entry.date),
      ),
    }));

  return { days, entries };
}
