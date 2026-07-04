import { isManagementRole } from "./auth-context.js";

/** Fields that must never be returned unless the viewer is authorized. */
const COMPENSATION_FIELDS = [
  "pay_rate",
  "payRate",
  "payment",
  "pay_period",
  "payPeriod",
  "weekly_limit",
  "weeklyLimit",
  "limits",
  "rate",
  "currency",
];

/** Pay/limits: self always; managers+ for others in scope. */
export function canViewCompensation(viewer, targetMemberId) {
  if (!viewer?.memberId) return false;
  if (targetMemberId && viewer.memberId === targetMemberId) return true;
  return isManagementRole(viewer.roleName);
}

/**
 * @param {Record<string, unknown>} row
 * @param {import("./auth-context.js").AuthContext | null} viewer
 * @param {string} [targetMemberId]
 */
export function redactCompensationFields(row, viewer, targetMemberId) {
  const memberId =
    targetMemberId ||
    (typeof row.id === "string" ? row.id : "") ||
    (typeof row.member_id === "string" ? row.member_id : "") ||
    (typeof row.memberId === "string" ? row.memberId : "");

  if (canViewCompensation(viewer, memberId)) return row;

  const out = { ...row };
  for (const field of COMPENSATION_FIELDS) {
    delete out[field];
  }
  return out;
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {import("./auth-context.js").AuthContext | null} viewer
 */
export function applyMemberFieldPolicy(rows, viewer) {
  if (!viewer) return [];
  return rows.map((row) => redactCompensationFields(row, viewer));
}

/**
 * @param {Record<string, unknown>} form
 * @param {import("./auth-context.js").AuthContext | null} viewer
 * @param {string} [targetMemberId]
 */
export function redactProfileFormCompensation(form, viewer, targetMemberId) {
  if (!form || typeof form !== "object") return form;
  if (canViewCompensation(viewer, targetMemberId)) return form;
  return {
    ...form,
    payRate: "",
    payPeriod: "None",
    weeklyLimit: "",
    dailyLimit: "",
  };
}

/** Hide invite pay_rate from non-management viewers. */
export function applyInviteFieldPolicy(rows, viewer) {
  if (!viewer) return [];
  if (isManagementRole(viewer.roleName)) return rows;
  return rows.map((row) => redactCompensationFields(row, viewer));
}
