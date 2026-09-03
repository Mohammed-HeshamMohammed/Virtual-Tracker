import { query } from "../../lib/postgres/client.js";
import { getMemberLimitHours, memberUsesShiftsForLimits } from "./task-workload-validation.js";
import {
  getProjectMemberLimitPg,
  getProjectTrackedSecondsPg,
  resolveMemberHourlyRatePg,
} from "../../lib/postgres/projects-postgres.service.js";

function formatHours(totalSeconds) {
  return `${(Math.max(0, totalSeconds) / 3600).toFixed(1)}h`;
}

function addDays(dayKey, days) {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOfWeek(dayKey) {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  const dow = d.getUTCDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return addDays(dayKey, mondayOffset);
}

function toDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function projectLimitWindowFor(limit, entryDate) {
  const startDate = limit.start_date ? toDayKey(limit.start_date) : null;
  if (startDate && startDate > entryDate) return { notStarted: true, fromDay: null };

  const resets = String(limit.resets || "Never").toLowerCase();
  let periodStart = null;
  if (resets === "weekly") {
    periodStart = mondayOfWeek(entryDate);
  } else if (resets === "monthly") {
    periodStart = `${entryDate.slice(0, 7)}-01`;
  }
  if (periodStart && startDate) return { notStarted: false, fromDay: periodStart > startDate ? periodStart : startDate };
  return { notStarted: false, fromDay: periodStart ?? startDate };
}

async function sumMemberTrackedAndManualSecondsPg(memberId, fromDay, toDay, excludeEntryId) {
  const params = [memberId, fromDay, toDay];
  let entryWhere = "member_id = $1 AND date >= $2::date AND date <= $3::date AND status != 'rejected'";
  if (excludeEntryId) {
    params.push(excludeEntryId);
    entryWhere += ` AND id != $${params.length}`;
  }
  const rows = await query(
    `SELECT COALESCE(SUM(secs), 0) AS total_seconds FROM (
       SELECT active_seconds AS secs FROM activity_sessions
       WHERE member_id = $1 AND started_at::date >= $2::date AND started_at::date <= $3::date
       UNION ALL
       SELECT duration AS secs FROM time_entries WHERE ${entryWhere}
     ) tracked`,
    params,
  );
  return Math.max(0, Math.floor(Number(rows[0]?.total_seconds ?? 0)));
}

export async function assertManualTimeEntryWithinLimits(db, { memberId, projectId, date, durationSeconds, excludeEntryId }) {
  if (!memberId || !date || !(durationSeconds > 0)) return;

  const usesShifts = await memberUsesShiftsForLimits(db, memberId);
  if (!usesShifts) {
    const [dailyLimitHours, weeklyLimitHours] = await Promise.all([
      getMemberLimitHours(db, memberId, "daily"),
      getMemberLimitHours(db, memberId, "weekly"),
    ]);

    if (dailyLimitHours > 0) {
      const capSeconds = Math.floor(dailyLimitHours * 3600);
      const workedSeconds = await sumMemberTrackedAndManualSecondsPg(memberId, date, date, excludeEntryId);
      const totalSeconds = workedSeconds + durationSeconds;
      if (totalSeconds > capSeconds) {
        const err = new Error(
          `This entry would put ${formatHours(totalSeconds)} on ${date}, over this member's ${dailyLimitHours}h daily limit.`,
        );
        err.code = "MEMBER_DAILY_LIMIT_REACHED";
        throw err;
      }
    }

    if (weeklyLimitHours > 0) {
      const weekStart = mondayOfWeek(date);
      const weekEnd = addDays(weekStart, 6);
      const capSeconds = Math.floor(weeklyLimitHours * 3600);
      const workedSeconds = await sumMemberTrackedAndManualSecondsPg(memberId, weekStart, weekEnd, excludeEntryId);
      const totalSeconds = workedSeconds + durationSeconds;
      if (totalSeconds > capSeconds) {
        const err = new Error(
          `This entry would put ${formatHours(totalSeconds)} on the week of ${weekStart}, over this member's ${weeklyLimitHours}h weekly limit.`,
        );
        err.code = "MEMBER_WEEKLY_LIMIT_REACHED";
        throw err;
      }
    }
  }

  if (!projectId) return;
  const limit = await getProjectMemberLimitPg(projectId, memberId);
  if (!limit) return;
  const cap = Number(limit.cost ?? 0);
  if (!(cap > 0)) return;

  const { notStarted, fromDay } = projectLimitWindowFor(limit, date);
  if (notStarted) return;

  const isHoursLimit = String(limit.type || "").toLowerCase().includes("hour");
  let capSeconds;
  if (isHoursLimit) {
    capSeconds = Math.floor(cap * 3600);
  } else {
    const rate = await resolveMemberHourlyRatePg(db, projectId, memberId, limit.based_on ?? limit.basedOn);
    if (!(rate > 0)) return;
    capSeconds = Math.floor((cap / rate) * 3600);
  }
  if (!(capSeconds > 0)) return;

  const spentSeconds = await getProjectTrackedSecondsPg(projectId, {
    memberId,
    ...(fromDay ? { fromDate: fromDay } : {}),
  });
  const totalSeconds = spentSeconds + durationSeconds;
  if (totalSeconds > capSeconds) {
    const totalInLimitUnit = (totalSeconds / capSeconds) * cap;
    const err = new Error(
      `This entry would put this member's time on this project at ${isHoursLimit ? formatHours(totalSeconds) : `$${totalInLimitUnit.toFixed(2)}`}, over its ${isHoursLimit ? `${cap}h` : `$${cap}`} limit for this member.`,
    );
    err.code = "PROJECT_MEMBER_LIMIT_REACHED";
    throw err;
  }
}
