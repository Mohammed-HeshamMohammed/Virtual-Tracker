
import { listProjectMembersPg } from "../../../lib/postgres/projects-postgres.service.js";
import { memberUsesShiftsForLimits, getMemberLimitHours } from "../../tasks/task-workload-validation.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function effectiveDailyCapHours(dailyLimitHours, weeklyLimitHours) {
  if (dailyLimitHours > 0) return dailyLimitHours;
  if (weeklyLimitHours > 0) return weeklyLimitHours / 7;
  return 0;
}

export function computeMinimumProjectDays(effectiveDailyCapsHours, hoursPerPerson) {
  if (!(hoursPerPerson > 0)) return 0;
  let maxDays = 0;
  for (const cap of effectiveDailyCapsHours) {
    if (!(cap > 0)) continue;
    maxDays = Math.max(maxDays, Math.ceil(hoursPerPerson / cap));
  }
  return maxDays;
}

export async function computeMinimumProjectDaysPg(db, projectId, hoursPerPerson) {
  if (!(hoursPerPerson > 0)) return { minDays: 0, governingMemberId: null };

  const members = await listProjectMembersPg(projectId);
  const caps = await Promise.all(
    members.map(async (m) => {
      if (await memberUsesShiftsForLimits(db, m.member_id)) {
        return { memberId: m.member_id, cap: 0 };
      }
      const [daily, weekly] = await Promise.all([
        getMemberLimitHours(db, m.member_id, "daily"),
        getMemberLimitHours(db, m.member_id, "weekly"),
      ]);
      return { memberId: m.member_id, cap: effectiveDailyCapHours(daily, weekly) };
    }),
  );

  let minDays = 0;
  let governingMemberId = null;
  for (const { memberId, cap } of caps) {
    if (!(cap > 0)) continue;
    const days = Math.ceil(hoursPerPerson / cap);
    if (days > minDays) {
      minDays = days;
      governingMemberId = memberId;
    }
  }
  return { minDays, governingMemberId };
}

export function computeMinimumEndDate(createdAt, minDays) {
  const start = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  return new Date(startDay + minDays * MS_PER_DAY);
}
