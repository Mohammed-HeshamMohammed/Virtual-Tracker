import { estimateAssignmentSeconds, computeTaskDailyHours } from "./task-schedule-math.js";
import { SHIFT_ALLOWANCE_LIMITS_ENABLED } from "../members/services/shift-allowance-feature.js";
import {
  getMemberLimitHours as getMemberLimitHoursFromStore,
  memberUsesShiftsForLimits as memberUsesShiftsForLimitsFromStore,
} from "../../lib/postgres/member-data-store.js";
import { sumActiveAssignmentSecondsPg } from "../../lib/postgres/task-assignments-postgres.service.js";

export async function memberUsesShiftsForLimits(db, memberId) {
  if (!SHIFT_ALLOWANCE_LIMITS_ENABLED) return false;
  return memberUsesShiftsForLimitsFromStore(db, memberId);
}

export async function getMemberLimitHours(db, memberId, limitType) {
  return getMemberLimitHoursFromStore(db, memberId, limitType);
}

export { computeTaskDailyHours };

export function computeEffectiveDailyCap(taskDailyHours, memberDailyLimit) {
  if (memberDailyLimit <= 0) return taskDailyHours;
  if (taskDailyHours <= 0) return memberDailyLimit;
  return Math.min(taskDailyHours, memberDailyLimit);
}

async function sumActiveAssignmentHours(db, memberId, excludeTaskId) {
  const totalSeconds = await sumActiveAssignmentSecondsPg(memberId, excludeTaskId);
  return totalSeconds / 3600;
}

export async function validateAssigneeWorkLimits(db, task, assigneeIds, options = {}) {
  const taskId = options.taskId ?? (typeof task.id === "string" ? task.id : "");
  const taskDailyHours = computeTaskDailyHours(task);
  const expectedSeconds = estimateAssignmentSeconds(task);
  const newTaskHours = expectedSeconds != null ? expectedSeconds / 3600 : 0;
  const errors = [];

  for (const memberId of assigneeIds) {
    if (await memberUsesShiftsForLimits(db, memberId)) continue;

    const label = options.memberNames?.get(memberId) ?? memberId;
    const [weeklyLimit, dailyLimit] = await Promise.all([
      getMemberLimitHours(db, memberId, "weekly"),
      getMemberLimitHours(db, memberId, "daily"),
    ]);

    if (dailyLimit > 0 && taskDailyHours > 0 && taskDailyHours > dailyLimit) {
      errors.push(
        `${label}: task requires ${taskDailyHours}h/day but member daily limit is ${dailyLimit}h (max allowed ${computeEffectiveDailyCap(taskDailyHours, dailyLimit)}h/day).`,
      );
    }

    if (weeklyLimit > 0 && dailyLimit <= 0 && newTaskHours > 0) {
      const existingHours = await sumActiveAssignmentHours(db, memberId, taskId);
      if (existingHours + newTaskHours > weeklyLimit) {
        errors.push(
          `${label}: assignment would total ${Math.round((existingHours + newTaskHours) * 10) / 10}h but weekly limit is ${weeklyLimit}h.`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }
}
