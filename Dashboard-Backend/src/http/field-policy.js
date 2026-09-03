import { isManagementRole } from "./auth-context.js";
import { isOwnerOrSuperAdminRole } from "./role-hierarchy.js";

const COMPENSATION_FIELDS = [
  "pay_rate",
  "payRate",
  "payment",
  "pay_period",
  "payPeriod",
  "weekly_limit",
  "weeklyLimit",
  "daily_limit",
  "dailyLimit",
  "limits",
  "rate",
  "currency",
];

const EMAIL_FIELDS = ["email", "work_email", "personalEmail", "personal_email"];

export function canViewEmail(viewer, targetMemberId) {
  if (!viewer?.memberId) return false;
  if (targetMemberId && viewer.memberId === targetMemberId) return true;
  return isOwnerOrSuperAdminRole(viewer.roleName);
}

export function redactEmailFields(row, viewer, targetMemberId) {
  const memberId =
    targetMemberId ||
    (typeof row.id === "string" ? row.id : "") ||
    (typeof row.member_id === "string" ? row.member_id : "") ||
    (typeof row.memberId === "string" ? row.memberId : "");

  if (canViewEmail(viewer, memberId)) return row;

  const out = { ...row };
  for (const field of EMAIL_FIELDS) {
    delete out[field];
  }
  return out;
}

export function canViewCompensation(viewer, targetMemberId) {
  if (!viewer?.memberId) return false;
  if (targetMemberId && viewer.memberId === targetMemberId) return true;
  return isManagementRole(viewer.roleName);
}

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

export function applyMemberFieldPolicy(rows, viewer) {
  if (!viewer) return [];
  return rows.map((row) => redactEmailFields(redactCompensationFields(row, viewer), viewer));
}

export function redactProfileFormCompensation(form, viewer, targetMemberId) {
  if (!form || typeof form !== "object") return form;
  if (canViewCompensation(viewer, targetMemberId)) return form;
  return {
    ...form,
    payRate: "",
    payPeriod: "None",
    weeklyLimit: "",
    dailyLimit: "",
    payNote: "",
    payEffectiveDate: "",
    payRateHistory: [],
  };
}

export function applyInviteFieldPolicy(rows, viewer) {
  if (!viewer) return [];
  if (isManagementRole(viewer.roleName)) return rows;
  return rows.map((row) => redactCompensationFields(row, viewer));
}
