import { localDayFor, localMidnightUtc, nextLocalDay } from "./timezone-utils.js";

function splitSessionByLocalDay(session, timeZone) {
  const start = new Date(session.started_at);
  const endRaw = new Date(session.ended_at ?? session.updated_at);
  const end = endRaw > start ? endRaw : new Date(start.getTime() + 1000);

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

function round2(value) {
  return Math.round(value * 100) / 100;
}

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

export function resolveCurrencyForDay(memberRates, memberId, day) {
  const entry = memberRates.get(memberId);
  if (entry == null) return "USD";
  if (typeof entry === "number") return "USD";
  if (!Array.isArray(entry) || entry.length === 0) return "USD";
  let currency = entry[0].currency || "USD";
  for (const point of entry) {
    if (point.effectiveDate <= day) currency = point.currency || "USD";
    else break;
  }
  return currency;
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
  const byDay = new Map();
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
        avatarUrl: memberNameMap.get(memberId)?.avatarUrl ?? null,
        activeSeconds: entry.activeSeconds,
        idleSeconds: entry.idleSeconds,
        manualSeconds: entry.manualSeconds ?? 0,
        spentAmount: round2(
          ((entry.activeSeconds + (entry.manualSeconds ?? 0)) / 3600) * resolveRateForDay(memberRates, memberId, date),
        ),
        currency: resolveCurrencyForDay(memberRates, memberId, date),
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
      currency: resolveCurrencyForDay(memberRates, entry.memberId, entry.date),
    }));

  return { days, entries };
}
