import { estimateAssignmentSeconds } from "./task-assignments.js";
import { SHIFT_ALLOWANCE_LIMITS_ENABLED } from "../members/services/shift-allowance-feature.js";

const TERMINAL_STATUSES = new Set(["done", "cancelled"]);

/**
 * @param {unknown} raw
 */
function parseLimitHours(raw) {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw > 0 ? raw : 0;
  const str = String(raw).trim();
  if (!str || /^no\s/i.test(str)) return 0;
  const n = Number(str.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
export async function memberUsesShiftsForLimits(db, memberId) {
  if (!SHIFT_ALLOWANCE_LIMITS_ENABLED) return false;
  const snap = await db.collection("time_settings").where("member_id", "==", memberId).limit(5).get();
  for (const doc of snap.docs) {
    if (doc.data()?.use_shifts_for_limits === true) return true;
  }
  return false;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} limitType
 */
export async function getMemberLimitHours(db, memberId, limitType) {
  const snap = await db
    .collection("limits")
    .where("member_id", "==", memberId)
    .where("limit_type", "==", limitType)
    .get();
  if (snap.empty) return 0;
  let best = 0;
  for (const doc of snap.docs) {
    const value = parseLimitHours(doc.data()?.value);
    if (value > best) best = value;
  }
  return best;
}

/**
 * Task daily hours = duration per day + allowed overtime per day.
 *
 * @param {Record<string, unknown>} task
 */
export function computeTaskDailyHours(task) {
  const hoursPerDay = Number(task.duration_hours_per_day ?? task.durationHoursPerDay ?? 0);
  const overtimePerDay = Number(task.overtime_hours_per_day ?? task.overtimeHoursPerDay ?? 0);
  const total = hoursPerDay + overtimePerDay;
  return Number.isFinite(total) && total > 0 ? total : 0;
}

/**
 * Most restrictive daily cap when member has a daily limit configured.
 *
 * @param {number} taskDailyHours
 * @param {number} memberDailyLimit 0 = unlimited
 */
export function computeEffectiveDailyCap(taskDailyHours, memberDailyLimit) {
  if (memberDailyLimit <= 0) return taskDailyHours;
  if (taskDailyHours <= 0) return memberDailyLimit;
  return Math.min(taskDailyHours, memberDailyLimit);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} [excludeTaskId]
 */
async function sumActiveAssignmentHours(db, memberId, excludeTaskId) {
  const snap = await db.collection("task_assignments").where("user_id", "==", memberId).limit(200).get();
  let totalSeconds = 0;
  for (const doc of snap.docs) {
    const row = doc.data() || {};
    if (excludeTaskId && row.task_id === excludeTaskId) continue;
    const status = String(row.status ?? "").toLowerCase();
    if (TERMINAL_STATUSES.has(status)) continue;
    totalSeconds += Number(row.expected_seconds ?? 0);
  }
  return totalSeconds / 3600;
}

/**
 * Validates assignees against task daily hours and member daily/weekly limits.
 * Skips manual limits when member uses scheduled shifts for allowance.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Record<string, unknown>} task
 * @param {string[]} assigneeIds
 * @param {{ taskId?: string, memberNames?: Map<string, string> }} [options]
 */
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
