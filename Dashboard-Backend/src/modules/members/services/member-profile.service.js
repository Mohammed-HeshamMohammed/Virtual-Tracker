import {
  upsertMemberFormSnapshotPg,
  deleteMemberFormSnapshotPg,
} from "../../../lib/postgres/member-form-snapshot-postgres.service.js";
import { publishChange } from "../../realtime/change-bus.js";
import { ensureMemberScopedEntities } from "./member-entity-bootstrap.js";
import { enrichMemberWithPresence } from "./member-presence.service.js";
import { alignMemberRoleTables, loadRoleNameById, pickCanonicalPrimaryRoleName, syncMemberPrimaryRole } from "./relation-sync.js";
import { getProfilePatchSections, profilePatchNeedsBootstrap } from "./member-role-change.service.js";
import { validateOwnerRoleChange } from "../../../http/role-owner-policy.js";
import { resolveMemberRoleName } from "../../activity/activity-scope.js";
import { isManagementRole } from "../../../http/auth-context.js";
import { isEmployeeL2OrHigherRole } from "../../../http/team-member-assign-policy.js";
import { lookupNameByIdPg, resolveLookupIdByNamePg } from "../../../lib/postgres/lookup-postgres.service.js";
import {
  assertShiftAllowanceAllowed,
  normalizeShiftAllowanceFlag,
  SHIFT_ALLOWANCE_LIMITS_ENABLED,
} from "./shift-allowance-feature.js";
import { validateMemberNamePart } from "./member-display-name.js";
import { assertValidPhone } from "../../../http/validate-body.js";
import { syncUserProfilePhoneForUid } from "../../auth/profile-settings.js";
import { USER_PROFILES_COLLECTION } from "../../auth/profile-collection-name.js";
import { getMemberByIdPg, updateMemberPg } from "../../../lib/postgres/members-postgres.service.js";
import { query as pgQuery } from "../../../lib/postgres/client.js";
import {
  deleteMemberOnboardingByMemberIdPg,
  deletePayRateHistoryByMemberIdPg,
  insertPayRateHistoryRowPg,
  listPayRateHistoryByMemberIdPg,
} from "../../../lib/postgres/member-data-postgres.service.js";
import { isOrgProjectAdminRole } from "../../../http/project-access.js";
import {
  deleteLimitsDoc,
  deleteMemberScopedRows,
  getMemberLimitsDoc,
  getSingleByMemberId,
  updateWorkLimitsConditional,
  upsertLimitField,
  upsertSingleByMemberId,
  upsertSingleByMemberIdConditional,
} from "../../../lib/postgres/member-data-store.js";

const LOOKUP_COLLECTIONS = {
  jobTitle: "job_titles",
  department: "departments",
  jobType: "job_types",
  taxType: "tax_types",
};

async function resolveLookupIdByName(_db, collection, name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return "";
  return resolveLookupIdByNamePg(collection, trimmed);
}

async function lookupNameById(_db, collection, id) {
  if (!id || typeof id !== "string") return "";
  return lookupNameByIdPg(collection, id);
}

export async function upsertMemberWeeklyLimit(db, memberId, weeklyLimit, updatedBy = "") {
  const value = parseLimitValue(weeklyLimit);
  await upsertLimitField(db, memberId, "weekly", value, updatedBy || "system");
}

export async function upsertMemberPayRate(db, memberId, rate, updatedBy = "", currency = "USD") {
  const actor = updatedBy || "system";
  const now = new Date();
  await upsertSingleByMemberId(db, "pay_rates", memberId, {
    type: "hourly",
    rate,
    currency: typeof currency === "string" && currency.trim() ? currency.trim().toUpperCase() : "USD",
    pay_period: "None",
    effective_date: now,
    status: "active",
    updated_by: actor,
    updated_at: now,
  });
}

export async function ensureMemberProfileRecords(db, memberId, updatedBy = "") {
  const memberData = (await getMemberByIdPg(memberId)) || {};
  await ensureMemberScopedEntities(db, {
    memberId,
    memberData,
    actor: updatedBy || "system",
    skipOnboardingForOwner: false,
  });
}

async function getLimitByType(db, memberId, limitType) {
  const limitsData = await getMemberLimitsDoc(db, memberId);
  if (!limitsData) return null;
  return { id: limitsData.id, value: limitsData[limitType] ?? 0 };
}

function parseLimitValue(raw) {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const str = String(raw).trim();
  if (!str || /^no\s/i.test(str)) return 0;
  const n = Number(str.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function limitToInput(value) {
  const n = parseLimitValue(value);
  return n > 0 ? String(n) : "";
}

function toIsoTimestamp(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return "";
}

function buildWorkLimitsToken(limitsIso, timeSettingsIso) {
  return `${limitsIso || ""}|${timeSettingsIso || ""}`;
}

function splitWorkLimitsToken(token) {
  if (typeof token !== "string" || !token.includes("|")) return { limits: undefined, timeSettings: undefined };
  const sep = token.indexOf("|");
  const limits = token.slice(0, sep);
  const timeSettings = token.slice(sep + 1);
  return { limits: limits || undefined, timeSettings: timeSettings || undefined };
}

export function validateWorkLimitsMutualExclusion(weeklyLimitRaw, dailyLimitRaw, useShiftsForLimits = false, workDaysCount = 7) {
  if (useShiftsForLimits) return null;
  const weeklyValue = parseLimitValue(weeklyLimitRaw);
  const dailyValue = parseLimitValue(dailyLimitRaw);
  if (weeklyValue <= 0 || dailyValue <= 0) return null;
  const days = workDaysCount > 0 ? workDaysCount : 7;
  const dailyTotal = dailyValue * days;
  if (dailyTotal > weeklyValue) {
    return `Daily limit x ${days} working day${days === 1 ? "" : "s"} (${dailyTotal}h) can't exceed the weekly limit (${weeklyValue}h).`;
  }
  return null;
}

function idleModeFromDb(raw) {
  const v = typeof raw === "string" ? raw.toLowerCase() : "";
  if (v === "prompt") return "Prompt";
  if (v === "always") return "Always";
  return "Never";
}

function idleModeToDb(raw) {
  const v = typeof raw === "string" ? raw.toLowerCase() : "";
  if (v === "prompt") return "prompt";
  if (v === "always") return "always";
  return "never";
}

function manualTimeFromDb(raw) {
  const v = typeof raw === "string" ? raw.toLowerCase() : "";
  if (v === "allow" || v === "on") return "On";
  return "Off";
}

function manualTimeToDb(raw) {
  const v = typeof raw === "string" ? raw.toLowerCase() : "";
  if (v === "on" || v === "allow") return "allow";
  return "off";
}

function parsePayRate(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toDateOnly(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export const MEMBER_PROFILE_SECTIONS = Object.freeze([
  "info",
  "employment",
  "roles",
  "payBill",
  "workLimits",
  "settings",
]);

export async function getMemberProfileFormSections(db, memberId, sectionsInput) {
  const allSections = MEMBER_PROFILE_SECTIONS;
  const sections =
    Array.isArray(sectionsInput) && sectionsInput.length
      ? [...new Set(sectionsInput.filter((s) => allSections.includes(s)))]
      : [...allSections];

  const want = (s) => sections.includes(s);

  const memberData = await getMemberByIdPg(memberId);
  if (!memberData) throw new Error("Member not found");

  if (want("employment")) {
    await ensureMemberProfileRecords(db, memberId);
  }

  const form = {};

  const pending = [];

  if (want("info")) {
    form.editFirst = typeof memberData.first_name === "string" ? memberData.first_name : "";
    form.editLast = typeof memberData.last_name === "string" ? memberData.last_name : "";
    form.editEmail = typeof memberData.work_email === "string" ? memberData.work_email : "";
    form.editPersonalEmail = typeof memberData.personal_email === "string" ? memberData.personal_email : "";
    form.editPhone =
      (typeof memberData.phone_number === "string" ? memberData.phone_number : "") ||
      (typeof memberData.mobile === "string" ? memberData.mobile : "") ||
      (typeof memberData.phone === "string" ? memberData.phone : "");
    form.phoneVerified = memberData.phone_verified === true;
    form.employeeId = typeof memberData.employee_id === "string" ? memberData.employee_id : "";
    form.lastIp = typeof memberData.ip_address === "string" ? memberData.ip_address.trim() : "";
    form.infoUpdatedAt = toIsoTimestamp(memberData.info_updated_at);
    const firebaseUid = typeof memberData.firebase_uid === "string" ? memberData.firebase_uid.trim() : "";
    if (!form.lastIp && firebaseUid) {
      pending.push(
        db
          .collection(USER_PROFILES_COLLECTION)
          .doc(firebaseUid)
          .get()
          .then((snap) => {
            if (!snap.exists) return;
            const row = snap.data() || {};
            const securityIp =
              typeof row.securityLastLoginIp === "string" ? row.securityLastLoginIp.trim() : "";
            if (securityIp) form.lastIp = securityIp;
          }),
      );
    }
  }

  let employment = {};
  let payRateRow = {};
  let payRateHistoryRows = [];
  let timeSettings = {};
  let limitsRow = {};

  if (want("employment")) {
    pending.push(
      getSingleByMemberId(db, "employment", memberId).then((row) => {
        employment = row || {};
      }),
    );
  }
  if (want("payBill") || want("settings")) {
    pending.push(
      getSingleByMemberId(db, "pay_rates", memberId).then((row) => {
        payRateRow = row || {};
      }),
    );
  }
  if (want("payBill")) {
    pending.push(
      listPayRateHistoryByMemberIdPg(memberId, 50).then((rows) => {
        payRateHistoryRows = rows;
      }),
    );
  }
  if (want("workLimits") || want("settings")) {
    pending.push(
      getSingleByMemberId(db, "time_settings", memberId).then((row) => {
        timeSettings = row || {};
      }),
    );
  }
  if (want("workLimits")) {
    pending.push(
      getMemberLimitsDoc(db, memberId).then((limitsData) => {
        limitsRow = limitsData || {};
      }),
    );
  }

  if (want("roles")) {
    pending.push(
      loadRoleNameById(db).then((roleNameById) => {
        const { name: roleName } = pickCanonicalPrimaryRoleName(memberData, [], roleNameById);
        form.role = roleName;
        form.rolesUpdatedAt = toIsoTimestamp(memberData.roles_updated_at);
      }),
    );
  }

  await Promise.all(pending);

  if (want("employment")) {
    const [jobTitle, department, jobType, taxType] = await Promise.all([
      lookupNameById(db, LOOKUP_COLLECTIONS.jobTitle, employment.job_title_id),
      lookupNameById(db, LOOKUP_COLLECTIONS.department, employment.department_id),
      lookupNameById(db, LOOKUP_COLLECTIONS.jobType, employment.job_type_id),
      lookupNameById(db, LOOKUP_COLLECTIONS.taxType, employment.tax_type_id),
    ]);
    form.empJobTitle = jobTitle || (typeof employment.job_title_label === "string" ? employment.job_title_label : "");
    form.empDepartment = department || (typeof employment.department_label === "string" ? employment.department_label : "");
    form.empJobType = jobType || (typeof employment.job_type_label === "string" ? employment.job_type_label : "");
    form.empWorkAddress = typeof employment.work_address === "string" ? employment.work_address : "";
    form.empMailing = employment.mailing_address === true;
    form.empEmploymentType = typeof employment.employment_type === "string" ? employment.employment_type : "";
    form.empEmployedThrough = typeof employment.employed_through === "string" ? employment.employed_through : "";
    form.empWorkplace = typeof employment.workplace_model === "string" ? employment.workplace_model : "";
    form.empOfficePct = employment.pct_in_office != null ? String(employment.pct_in_office) : "";
    form.empRemotePct = employment.pct_remote != null ? String(employment.pct_remote) : "";
    form.empTaxInfo = typeof employment.tax_info === "string" ? employment.tax_info : "";
    form.empAccountCode = typeof employment.account_code === "string" ? employment.account_code : "";
    form.empTaxType = taxType || (typeof employment.tax_type_label === "string" ? employment.tax_type_label : "");
    form.empStartDate = employment.start_date ? String(employment.start_date).slice(0, 10) : "";
    form.empEndDate = employment.end_date ? String(employment.end_date).slice(0, 10) : "";
    form.empTermination = typeof employment.termination_reason === "string" ? employment.termination_reason : "";
    form.empComments = typeof employment.employment_comments === "string" ? employment.employment_comments : "";
    form.employmentUpdatedAt = toIsoTimestamp(employment.updated_at);
  }

  if (want("payBill")) {
    form.payRate = String(parsePayRate(payRateRow.rate ?? 0) || "");
    form.paySegment = "pay";
    form.payPeriod = typeof payRateRow.pay_period === "string" ? payRateRow.pay_period : "None";
    form.payNote = typeof payRateRow.note === "string" ? payRateRow.note : "";
    form.payEffectiveDate = payRateRow.effective_date ? String(payRateRow.effective_date).slice(0, 10) : "";
    form.payRateHistory = payRateHistoryRows.map((row) => ({
      id: String(row.id ?? ""),
      rate: parsePayRate(row.rate ?? 0),
      currency: typeof row.currency === "string" ? row.currency : "USD",
      payPeriod: typeof row.pay_period === "string" ? row.pay_period : "None",
      effectiveDate: row.effective_date ? String(row.effective_date).slice(0, 10) : "",
      note: typeof row.note === "string" ? row.note : "",
      previousRate: row.previous_rate == null ? null : parsePayRate(row.previous_rate),
      changedByName: typeof row.changed_by_name === "string" ? row.changed_by_name : "",
      createdAt: toIsoTimestamp(row.created_at),
    }));
    form.payBillUpdatedAt = toIsoTimestamp(payRateRow.updated_at);
  }

  if (want("workLimits")) {
    form.weeklyLimit = limitToInput(limitsRow.weekly);
    form.dailyLimit = limitToInput(limitsRow.daily);
    form.disableTrackingSpecificDays = timeSettings.disable_tracking_specific_days === true;
    form.useShiftsForLimits = normalizeShiftAllowanceFlag(timeSettings.use_shifts_for_limits);
    form.workDays = Array.isArray(timeSettings.work_days)
      ? timeSettings.work_days.filter((d) => Number.isInteger(d))
      : [0, 1, 2, 3, 4];
    form.makeupDays = Array.isArray(timeSettings.makeup_days)
      ? timeSettings.makeup_days.filter((d) => Number.isInteger(d))
      : [];
    form.workLimitsUpdatedAt = buildWorkLimitsToken(
      toIsoTimestamp(limitsRow.updated_at),
      toIsoTimestamp(timeSettings.updated_at),
    );
  }

  if (want("settings")) {
    const trackingDisabled = timeSettings.able_to_track_time === false;
    form.ableToTrack = !trackingDisabled;
    form.idleMode = idleModeFromDb(timeSettings.keep_idle_time);
    form.idleTimeout = typeof timeSettings.idle_timeout === "string" ? timeSettings.idle_timeout : "5 min";
    form.manualTime = manualTimeFromDb(timeSettings.modify_time);
    form.requireApproval = payRateRow.require_timesheet_approval === true || timeSettings.require_approval === true;
    const privileges =
      memberData.privileges && typeof memberData.privileges === "object" ? memberData.privileges : {};
    form.manageEmployeeTeams = privileges.manage_employee_teams === true;
    form.settingsUpdatedAt = toIsoTimestamp(timeSettings.updated_at);
  }

  return form;
}

export async function getMemberProfileForm(db, memberId) {
  return getMemberProfileFormSections(db, memberId, null);
}

export async function updateMemberProfile(db, memberId, body, updatedBy = "", options = {}) {
  const memberData = await getMemberByIdPg(memberId);
  if (!memberData) throw new Error("Member not found");

  const hasInfo = body.info && typeof body.info === "object";
  const hasEmployment = body.employment && typeof body.employment === "object";
  const hasRoles = body.roles && typeof body.roles === "object";
  const hasPayBill = body.payBill && typeof body.payBill === "object";
  const hasWorkLimits = body.workLimits && typeof body.workLimits === "object";
  const hasSettings = body.settings && typeof body.settings === "object";

  if (profilePatchNeedsBootstrap(body)) {
    await ensureMemberProfileRecords(db, memberId, updatedBy);
  }

  const info = hasInfo ? body.info : {};
  const employmentIn = hasEmployment ? body.employment : {};
  const rolesIn = hasRoles ? body.roles : {};
  const payBill = hasPayBill ? body.payBill : {};
  const workLimits = hasWorkLimits ? body.workLimits : {};
  const settings = hasSettings ? body.settings : {};

  const actor = updatedBy || "system";
  const now = new Date();

  const memberUpdates = { updated_by: actor, updated_at: now };

  if (hasInfo) {
    const first = typeof info.editFirst === "string" ? info.editFirst.trim() : "";
    const last = typeof info.editLast === "string" ? info.editLast.trim() : "";
    const firstNameValidation = validateMemberNamePart(first, "First name");
    if (firstNameValidation) throw new Error(firstNameValidation);
    const lastNameValidation = validateMemberNamePart(last, "Last name");
    if (lastNameValidation) throw new Error(lastNameValidation);
    if (first || last) {
      memberUpdates.first_name = first;
      memberUpdates.last_name = last;
    }
    if (typeof info.editEmail === "string") memberUpdates.work_email = info.editEmail.trim();
    if (typeof info.editPersonalEmail === "string") memberUpdates.personal_email = info.editPersonalEmail.trim();
    if ("editPhone" in info) {
      const editingSelf = updatedBy === memberId;
      const newPhone = await assertValidPhone(info.editPhone, { required: false, label: "Phone number" });
      memberUpdates.phone_number = newPhone;
      memberUpdates.phone_verified = false;
      if (editingSelf) {
        const firebaseUid = typeof memberData.firebase_uid === "string" ? memberData.firebase_uid.trim() : "";
        if (firebaseUid) {
          await syncUserProfilePhoneForUid(db, firebaseUid, newPhone, { phoneVerified: false });
        }
      }
    }
    if (typeof info.employeeId === "string") memberUpdates.employee_id = info.employeeId.trim();
    memberUpdates.info_updated_at = now;
  }

  const roleName = hasRoles && typeof rolesIn.role === "string" ? rolesIn.role.trim() : "";
  if (hasRoles) {
    memberUpdates.roles_updated_at = now;
  }

  if (hasRoles && roleName && !options.skipRoleSync) {
    const currentRoleName = await resolveMemberRoleName(db, memberId);
    const ownerErr = validateOwnerRoleChange(currentRoleName, roleName);
    if (ownerErr) throw new Error(ownerErr);
  }

  if (hasSettings) {
    if (settings.manageEmployeeTeams !== undefined) {
      const actorRole = updatedBy ? await resolveMemberRoleName(db, updatedBy) : "";
      if (!isManagementRole(actorRole)) {
        throw new Error("Insufficient permissions to change team privileges.");
      }
      const targetRoleName = await resolveMemberRoleName(db, memberId);
      if (!isEmployeeL2OrHigherRole(targetRoleName)) {
        throw new Error("Manage Employee teams is only available for Team Lead and above.");
      }
      const existingPriv =
        memberData.privileges && typeof memberData.privileges === "object"
          ? memberData.privileges
          : {};
      memberUpdates.privileges = {
        ...existingPriv,
        manage_employee_teams: settings.manageEmployeeTeams === true,
      };
    }
  }

  if (hasInfo || hasRoles || hasEmployment || hasPayBill || hasWorkLimits || hasSettings) {
    const guardField = hasInfo && !hasRoles ? "info_updated_at" : hasRoles && !hasInfo ? "roles_updated_at" : null;
    if (guardField && options.expectedUpdatedAt) {
      const fresh = await getMemberByIdPg(memberId);
      const currentIso = toIsoTimestamp(fresh?.[guardField]);
      if (currentIso !== options.expectedUpdatedAt) {
        const err = new Error(
          hasInfo
            ? "Someone else changed this member's info while you were editing."
            : "Someone else changed this member's role while you were editing.",
        );
        err.staleWrite = true;
        throw err;
      }
    }
    if (Object.keys(memberUpdates).length > 0) {
      await updateMemberPg(memberId, memberUpdates);
    }
  }

  if (hasRoles && roleName && !options.skipRoleSync) {
    let actorRoleName = "";
    if (actor) {
      actorRoleName = await resolveMemberRoleName(db, actor);
    }
    await syncMemberPrimaryRole(db, memberId, roleName, actor, actorRoleName);
  } else if (
    hasInfo &&
    (memberUpdates.first_name !== undefined ||
      memberUpdates.last_name !== undefined ||
      memberUpdates.work_email !== undefined)
  ) {
    await alignMemberRoleTables(db, memberId, actor);
  }

  if (hasEmployment) {
    const [jobTitleId, departmentId, jobTypeId, taxTypeId] = await Promise.all([
      resolveLookupIdByName(db, LOOKUP_COLLECTIONS.jobTitle, employmentIn.empJobTitle),
      resolveLookupIdByName(db, LOOKUP_COLLECTIONS.department, employmentIn.empDepartment),
      resolveLookupIdByName(db, LOOKUP_COLLECTIONS.jobType, employmentIn.empJobType),
      resolveLookupIdByName(db, LOOKUP_COLLECTIONS.taxType, employmentIn.empTaxType),
    ]);

    const employmentResult = await upsertSingleByMemberIdConditional(
      db,
      "employment",
      memberId,
      {
        job_title_id: jobTitleId,
        department_id: departmentId,
        job_type_id: jobTypeId,
        tax_type_id: taxTypeId,
        job_title_label: typeof employmentIn.empJobTitle === "string" ? employmentIn.empJobTitle.trim() : "",
        department_label: typeof employmentIn.empDepartment === "string" ? employmentIn.empDepartment.trim() : "",
        job_type_label: typeof employmentIn.empJobType === "string" ? employmentIn.empJobType.trim() : "",
        tax_type_label: typeof employmentIn.empTaxType === "string" ? employmentIn.empTaxType.trim() : "",
        work_address: typeof employmentIn.empWorkAddress === "string" ? employmentIn.empWorkAddress.trim() : "",
        mailing_address: employmentIn.empMailing === true,
        employment_type: typeof employmentIn.empEmploymentType === "string" ? employmentIn.empEmploymentType.trim() : "",
        employed_through: typeof employmentIn.empEmployedThrough === "string" ? employmentIn.empEmployedThrough.trim() : "",
        workplace_model: typeof employmentIn.empWorkplace === "string" ? employmentIn.empWorkplace.trim() : "",
        pct_in_office: parsePayRate(employmentIn.empOfficePct),
        pct_remote: parsePayRate(employmentIn.empRemotePct),
        tax_info: typeof employmentIn.empTaxInfo === "string" ? employmentIn.empTaxInfo.trim() : "",
        account_code: typeof employmentIn.empAccountCode === "string" ? employmentIn.empAccountCode.trim() : "",
        start_date: typeof employmentIn.empStartDate === "string" && employmentIn.empStartDate ? employmentIn.empStartDate : null,
        end_date: typeof employmentIn.empEndDate === "string" && employmentIn.empEndDate ? employmentIn.empEndDate : null,
        termination_reason: typeof employmentIn.empTermination === "string" ? employmentIn.empTermination.trim() : "",
        employment_comments: typeof employmentIn.empComments === "string" ? employmentIn.empComments.trim() : "",
        updated_by: actor,
        updated_at: now,
      },
      options.expectedUpdatedAt,
    );
    if (employmentResult && typeof employmentResult === "object" && "conflict" in employmentResult) {
      const err = new Error("Someone else changed this member's employment info while you were editing.");
      err.staleWrite = true;
      throw err;
    }
  }

  if (hasPayBill) {
    const actorRoleName = actor && actor !== "system" ? await resolveMemberRoleName(db, actor) : "";
    if (!isOrgProjectAdminRole(actorRoleName)) {
      throw new Error("Only Super Manager and above can edit pay rates.");
    }

    const payRate = parsePayRate(payBill.payRate);
    const currency =
      typeof payBill.currency === "string" && payBill.currency.trim() ? payBill.currency.trim().toUpperCase() : "USD";
    const payPeriod = typeof payBill.payPeriod === "string" ? payBill.payPeriod : "None";
    const note = typeof payBill.note === "string" ? payBill.note.trim() : "";
    const existingPayRate = await getSingleByMemberId(db, "pay_rates", memberId);
    const effectiveDate =
      typeof payBill.effectiveDate === "string" && payBill.effectiveDate.trim()
        ? payBill.effectiveDate.trim()
        : (existingPayRate?.effective_date ?? now);

    const payBillResult = await upsertSingleByMemberIdConditional(
      db,
      "pay_rates",
      memberId,
      {
        type: "hourly",
        rate: payRate,
        currency,
        pay_period: payPeriod,
        note,
        ...(hasSettings ? { require_timesheet_approval: settings.requireApproval === true } : {}),
        effective_date: effectiveDate,
        status: "active",
        updated_by: actor,
        updated_at: now,
      },
      options.expectedUpdatedAt,
    );
    if (payBillResult && typeof payBillResult === "object" && "conflict" in payBillResult) {
      const err = new Error("Someone else changed this member's pay/billing info while you were editing.");
      err.staleWrite = true;
      throw err;
    }

    const existingEffectiveDate = toDateOnly(existingPayRate?.effective_date);
    const newEffectiveDate = toDateOnly(effectiveDate);
    const ratesDiffer =
      !existingPayRate ||
      parsePayRate(existingPayRate.rate ?? 0) !== payRate ||
      String(existingPayRate.currency ?? "USD") !== currency ||
      String(existingPayRate.pay_period ?? "None") !== payPeriod ||
      String(existingPayRate.note ?? "") !== note ||
      existingEffectiveDate !== newEffectiveDate;
    if (ratesDiffer) {
      let changedByName = "";
      if (actor === memberId) {
        changedByName = [memberData.first_name, memberData.last_name].filter(Boolean).join(" ").trim();
      } else if (actor && actor !== "system") {
        const actorRow = await getMemberByIdPg(actor);
        if (actorRow) changedByName = [actorRow.first_name, actorRow.last_name].filter(Boolean).join(" ").trim();
      }
      await insertPayRateHistoryRowPg({
        member_id: memberId,
        type: "hourly",
        rate: payRate,
        currency,
        pay_period: payPeriod,
        effective_date: newEffectiveDate,
        note,
        previous_rate: existingPayRate ? parsePayRate(existingPayRate.rate ?? 0) : null,
        previous_currency: existingPayRate ? String(existingPayRate.currency ?? "USD") : null,
        previous_pay_period: existingPayRate ? String(existingPayRate.pay_period ?? "None") : null,
        changed_by_member_id: actor === "system" ? null : actor,
        changed_by_name: changedByName,
        created_at: now,
      });
    }
  }

  if (hasSettings) {
    const ableToTrack = settings.ableToTrack !== false;
    const workDays = hasWorkLimits && Array.isArray(workLimits.workDays)
      ? workLimits.workDays.filter((d) => Number.isInteger(d))
      : undefined;
    const makeupDays = hasWorkLimits && Array.isArray(workLimits.makeupDays)
      ? workLimits.makeupDays.filter((d) => Number.isInteger(d))
      : undefined;

    const settingsResult = await upsertSingleByMemberIdConditional(
      db,
      "time_settings",
      memberId,
      {
        able_to_track_time: ableToTrack,
        keep_idle_time: idleModeToDb(settings.idleMode),
        idle_timeout: typeof settings.idleTimeout === "string" ? settings.idleTimeout : "5 min",
        modify_time: manualTimeToDb(settings.manualTime),
        require_approval: settings.requireApproval === true,
        ...(workDays ? { work_days: workDays } : {}),
        ...(makeupDays ? { makeup_days: makeupDays } : {}),
        ...(hasWorkLimits ? { disable_tracking_specific_days: workLimits.disableTrackingSpecificDays === true } : {}),
        ...(hasWorkLimits
          ? { use_shifts_for_limits: SHIFT_ALLOWANCE_LIMITS_ENABLED && workLimits.useShiftsForLimits === true }
          : {}),
        updated_by: actor,
        updated_at: now,
      },
      hasWorkLimits ? undefined : options.expectedUpdatedAt,
    );
    if (settingsResult && typeof settingsResult === "object" && "conflict" in settingsResult) {
      const err = new Error("Someone else changed this member's settings while you were editing.");
      err.staleWrite = true;
      throw err;
    }
  } else if (hasWorkLimits) {
    assertShiftAllowanceAllowed(workLimits.useShiftsForLimits);

    const workDays = Array.isArray(workLimits.workDays)
      ? workLimits.workDays.filter((d) => Number.isInteger(d))
      : [0, 1, 2, 3, 4];

    const limitsErr = validateWorkLimitsMutualExclusion(workLimits.weeklyLimit, workLimits.dailyLimit, false, workDays.length);
    if (limitsErr) throw new Error(limitsErr);

    const makeupDays = Array.isArray(workLimits.makeupDays)
      ? workLimits.makeupDays.filter((d) => Number.isInteger(d))
      : [];
    const weeklyValue = parseLimitValue(workLimits.weeklyLimit);
    const dailyValue = parseLimitValue(workLimits.dailyLimit);

    const { limits: expectedLimits, timeSettings: expectedTimeSettings } = splitWorkLimitsToken(
      options.expectedUpdatedAt,
    );
    const workLimitsResult = await updateWorkLimitsConditional(
      db,
      memberId,
      {
        weekly: weeklyValue,
        daily: dailyValue,
        workDays,
        makeupDays,
        disableTrackingSpecificDays: workLimits.disableTrackingSpecificDays === true,
        useShiftsForLimits: false,
      },
      actor,
      { limits: expectedLimits, timeSettings: expectedTimeSettings },
    );
    if (workLimitsResult && workLimitsResult.conflict) {
      const err = new Error("Someone else changed this member's work limits while you were editing.");
      err.staleWrite = true;
      throw err;
    }
  }

  if (hasWorkLimits && hasSettings) {
    assertShiftAllowanceAllowed(workLimits.useShiftsForLimits);

    const combinedWorkDaysCount = Array.isArray(workLimits.workDays)
      ? workLimits.workDays.filter((d) => Number.isInteger(d)).length
      : 5;
    const limitsErr = validateWorkLimitsMutualExclusion(
      workLimits.weeklyLimit,
      workLimits.dailyLimit,
      false,
      combinedWorkDaysCount,
    );
    if (limitsErr) throw new Error(limitsErr);

    const weeklyValue = parseLimitValue(workLimits.weeklyLimit);
    const dailyValue = parseLimitValue(workLimits.dailyLimit);
    await upsertLimitField(db, memberId, "weekly", weeklyValue, actor);
    await upsertLimitField(db, memberId, "daily", dailyValue, actor);
  }

  if (hasInfo || hasEmployment || hasRoles || hasPayBill || hasWorkLimits || hasSettings) {
    void publishChange("members", memberId, "updated", actor);
  }

  const reloadSections =
    Array.isArray(options.reloadSections) && options.reloadSections.length
      ? options.reloadSections.filter((s) => MEMBER_PROFILE_SECTIONS.includes(s))
      : getProfilePatchSections(body).length
        ? getProfilePatchSections(body)
        : null;

  if (reloadSections && reloadSections.length) {
    return getMemberProfileFormSections(db, memberId, reloadSections);
  }
  return getMemberProfileForm(db, memberId);
}

export async function deleteMemberProfileData(db, memberId) {
  for (const collection of ["employment", "time_settings", "pay_rates"]) {
    await deleteMemberScopedRows(db, collection, memberId);
  }
  await deletePayRateHistoryByMemberIdPg(memberId);
  await deleteMemberOnboardingByMemberIdPg(memberId);
  for (const table of ["team_members", "project_members"]) {
    await pgQuery(`DELETE FROM ${table} WHERE member_id = $1`, [memberId]);
  }
  await deleteLimitsDoc(db, memberId);
  await deleteMemberFormSnapshotPg(memberId);
}

export async function upsertMemberFormSnapshot(memberId, formData, modifiedBy = "") {
  return upsertMemberFormSnapshotPg(memberId, formData, modifiedBy);
}
