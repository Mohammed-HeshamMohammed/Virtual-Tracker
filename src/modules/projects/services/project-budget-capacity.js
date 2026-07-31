// Minimum feasible project duration for a per_person budget (scope='per_person'
// on project_budgets - see project-modal.tsx / ensure-lookup-schema.js). Every
// project member must independently log `hoursPerPerson` hours; each member's
// own daily/weekly hour cap (set on the Members page, not this project - see
// task-workload-validation.js) throttles how fast they can get there. The
// slowest capped member sets the floor for the project's End Date - members
// with no cap, or on shift-based limits, impose no floor at all.

import { listProjectMembersPg } from "../../../lib/postgres/projects-postgres.service.js";
import { memberUsesShiftsForLimits, getMemberLimitHours } from "../../tasks/task-workload-validation.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Daily cap takes precedence over weekly, mirroring timer-limit.service.js's
 * own "weekly only applies when no daily is set" rule - a weekly-only cap is
 * spread evenly across the 7-day reset window for this estimate. */
function effectiveDailyCapHours(dailyLimitHours, weeklyLimitHours) {
  if (dailyLimitHours > 0) return dailyLimitHours;
  if (weeklyLimitHours > 0) return weeklyLimitHours / 7;
  return 0;
}

/**
 * Pure: worst-case days needed for every capped member to independently reach
 * `hoursPerPerson`. Uncapped members (cap <= 0) impose no floor.
 * @param {number[]} effectiveDailyCapsHours
 * @param {number} hoursPerPerson
 */
export function computeMinimumProjectDays(effectiveDailyCapsHours, hoursPerPerson) {
  if (!(hoursPerPerson > 0)) return 0;
  let maxDays = 0;
  for (const cap of effectiveDailyCapsHours) {
    if (!(cap > 0)) continue;
    maxDays = Math.max(maxDays, Math.ceil(hoursPerPerson / cap));
  }
  return maxDays;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} projectId
 * @param {number} hoursPerPerson
 * @returns {Promise<{ minDays: number, governingMemberId: string|null }>}
 */
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

/**
 * The earliest an End Date can be set given `minDays`, anchored to the
 * project's own start reference. No `projects.start_date` column exists by
 * design (item 5 of the budget fixes plan - `created_at` already answers
 * "when did this start"), so `createdAt` is that anchor.
 * @param {Date|string} createdAt
 * @param {number} minDays
 */
export function computeMinimumEndDate(createdAt, minDays) {
  const start = createdAt instanceof Date ? createdAt : new Date(createdAt);
  // Calendar-day arithmetic anchored to the start day's UTC midnight, not the
  // exact creation timestamp - "N days after the day it started", not N x
  // 24h from whatever time of day it was created.
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  return new Date(startDay + minDays * MS_PER_DAY);
}
