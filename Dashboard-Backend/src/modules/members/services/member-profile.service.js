import crypto from "node:crypto";
import { ensureMemberScopedEntities } from "./member-entity-bootstrap.js";
import { enrichMemberWithPresence } from "./member-presence.service.js";
import { alignMemberRoleTables, pickCanonicalPrimaryRoleName, syncMemberPrimaryRole } from "./relation-sync.js";
import { getProfilePatchSections, profilePatchNeedsBootstrap } from "./member-role-change.service.js";
import { validateOwnerRoleChange } from "../../../http/role-owner-policy.js";
import { resolveMemberRoleName } from "../../activity/activity-scope.js";
import { isManagementRole } from "../../../http/auth-context.js";
import { isEmployeeL2OrHigherRole } from "../../../http/team-member-assign-policy.js";
import { isPostgresLookupReady } from "../../../lib/postgres/lookup-availability.js";
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
import {
  deleteLimitsDoc,
  deleteMemberScopedRows,
  getMemberLimitsDoc,
  getSingleByMemberId,
  upsertLimitField,
  upsertSingleByMemberId,
} from "../../../lib/postgres/member-data-store.js";

const LOOKUP_COLLECTIONS = {
  jobTitle: "job_titles",
  department: "departments",
  jobType: "job_types",
  taxType: "tax_types",
};

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} collection
 * @param {string} name
 */
async function resolveLookupIdByName(db, collection, name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return "";
  if (await isPostgresLookupReady()) return resolveLookupIdByNamePg(collection, trimmed);
  const exact = await db.collection(collection).where("name", "==", trimmed).limit(1).get();
  if (!exact.empty) return exact.docs[0].id;
  const id = crypto.randomUUID();
  await db.collection(collection).doc(id).set({
    id,
    name: trimmed,
    list_ranking: "",
    created_at: new Date(),
    created_by: "",
    updated_by: "",
  });
  return id;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} collection
 * @param {string} id
 */
async function lookupNameById(db, collection, id) {
  if (!id || typeof id !== "string") return "";
  if (await isPostgresLookupReady()) return lookupNameByIdPg(collection, id);
  const doc = await db.collection(collection).doc(id).get();
  if (!doc.exists) return "";
  const name = doc.data()?.name;
  return typeof name === "string" ? name : "";
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {number} rate
 * @param {string} [updatedBy]
 */
export async function upsertMemberWeeklyLimit(db, memberId, weeklyLimit, updatedBy = "") {
  const value = parseLimitValue(weeklyLimit);
  await upsertLimitField(db, memberId, "weekly", value, updatedBy || "system");
}

export async function upsertMemberPayRate(db, memberId, rate, updatedBy = "") {
  const actor = updatedBy || "system";
  const now = new Date();
  await upsertSingleByMemberId(db, "pay_rates", memberId, {
    type: "hourly",
    rate,
    currency: "USD",
    pay_period: "None",
    effective_date: now,
    status: "active",
    updated_by: actor,
    updated_at: now,
  });
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} [updatedBy]
 */
export async function ensureMemberProfileRecords(db, memberId, updatedBy = "") {
  const memberDoc = await db.collection("members").doc(memberId).get();
  const memberData = memberDoc.exists ? memberDoc.data() || {} : {};
  await ensureMemberScopedEntities(db, {
    memberId,
    memberData,
    actor: updatedBy || "system",
    skipOnboardingForOwner: false,
  });
}

/**
 * Read a single limit type value from the consolidated limits doc.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} limitType  e.g. "weekly" or "daily"
 */
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

export function validateWorkLimitsMutualExclusion(weeklyLimitRaw, dailyLimitRaw, useShiftsForLimits = false) {
  if (useShiftsForLimits) return null;
  const weeklyValue = parseLimitValue(weeklyLimitRaw);
  const dailyValue = parseLimitValue(dailyLimitRaw);
  if (weeklyValue > 0 && dailyValue > 0) {
    return "Choose either a weekly limit or a daily limit, not both.";
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

export const MEMBER_PROFILE_SECTIONS = Object.freeze([
  "info",
  "employment",
  "roles",
  "payBill",
  "workLimits",
  "settings",
]);

/**
 * Load only the requested manage-modal sections (smaller/faster than full profile).
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string[] | null | undefined} sectionsInput
 */
export async function getMemberProfileFormSections(db, memberId, sectionsInput) {
  const allSections = MEMBER_PROFILE_SECTIONS;
  const sections =
    Array.isArray(sectionsInput) && sectionsInput.length
      ? [...new Set(sectionsInput.filter((s) => allSections.includes(s)))]
      : [...allSections];

  const want = (s) => sections.includes(s);

  const memberDoc = await db.collection("members").doc(memberId).get();
  if (!memberDoc.exists) throw new Error("Member not found");
  const memberData = memberDoc.data() || {};

  if (want("employment")) {
    await ensureMemberProfileRecords(db, memberId);
  }

  /** @type {Record<string, unknown>} */
  const form = {};

  /** @type {Promise<unknown>[]} */
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

  /** @type {Record<string, unknown>} */
  let employment = {};
  /** @type {Record<string, unknown>} */
  let payRateRow = {};
  /** @type {Record<string, unknown>} */
  let timeSettings = {};
  /** @type {Record<string, unknown>} */
  let weeklyLimitRow = {};
  /** @type {Record<string, unknown>} */
  let dailyLimitRow = {};

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
        const data = limitsData || {};
        weeklyLimitRow = { value: data.weekly ?? 0 };
        dailyLimitRow = { value: data.daily ?? 0 };
      }),
    );
  }

  if (want("roles")) {
    pending.push(
      db
        .collection("roles")
        .limit(100)
        .get()
        .then((rolesSnap) => {
          const roleNameById = new Map(
            rolesSnap.docs.map((doc) => {
              const row = doc.data() || {};
              return [doc.id, typeof row.name === "string" ? row.name.trim() : ""];
            }),
          );
          const { name: roleName } = pickCanonicalPrimaryRoleName(memberData, [], roleNameById);
          form.role = roleName;
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
  }

  if (want("payBill")) {
    form.payRate = String(parsePayRate(payRateRow.rate ?? 0) || "");
    form.paySegment = "pay";
    form.payPeriod = typeof payRateRow.pay_period === "string" ? payRateRow.pay_period : "None";
  }

  if (want("workLimits")) {
    form.weeklyLimit = limitToInput(weeklyLimitRow.value);
    form.dailyLimit = limitToInput(dailyLimitRow.value);
    form.disableTrackingSpecificDays = timeSettings.disable_tracking_specific_days === true;
    form.useShiftsForLimits = normalizeShiftAllowanceFlag(timeSettings.use_shifts_for_limits);
    form.workDays = Array.isArray(timeSettings.work_days)
      ? timeSettings.work_days.filter((d) => Number.isInteger(d))
      : [0, 1, 2, 3, 4];
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
  }

  return form;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
export async function getMemberProfileForm(db, memberId) {
  return getMemberProfileFormSections(db, memberId, null);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {Record<string, unknown>} body
 * @param {string} [updatedBy]
 * @param {{ actorIsManager?: boolean, actorUid?: string, skipRoleSync?: boolean, reloadSections?: string[] | null }} [options]
 */
export async function updateMemberProfile(db, memberId, body, updatedBy = "", options = {}) {
  const memberRef = db.collection("members").doc(memberId);
  const memberDoc = await memberRef.get();
  if (!memberDoc.exists) throw new Error("Member not found");
  const memberData = memberDoc.data() || {};

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
  }

  const roleName = hasRoles && typeof rolesIn.role === "string" ? rolesIn.role.trim() : "";

  if (hasRoles && roleName && !options.skipRoleSync) {
    const currentRoleName = await resolveMemberRoleName(db, memberId);
    const ownerErr = validateOwnerRoleChange(currentRoleName, roleName);
    if (ownerErr) throw new Error(ownerErr);
  }

  if (hasSettings) {
    // ableToTrack is a product setting — not persisted as presence state.
    void settings.ableToTrack;

    if (settings.manageEmployeeTeams !== undefined) {
      const actorRole = updatedBy ? await resolveMemberRoleName(db, updatedBy) : "";
      if (!isManagementRole(actorRole)) {
        throw new Error("Insufficient permissions to change team privileges.");
      }
      const targetRoleName = await resolveMemberRoleName(db, memberId);
      if (!isEmployeeL2OrHigherRole(targetRoleName)) {
        throw new Error("Manage Employee teams is only available for Employee L2 and above.");
      }
      const existingPriv =
        memberDoc.data()?.privileges && typeof memberDoc.data().privileges === "object"
          ? memberDoc.data().privileges
          : {};
      memberUpdates.privileges = {
        ...existingPriv,
        manage_employee_teams: settings.manageEmployeeTeams === true,
      };
    }
  }

  if (hasInfo || hasRoles || hasEmployment || hasPayBill || hasWorkLimits || hasSettings) {
    await memberRef.update(memberUpdates);
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

    await upsertSingleByMemberId(db, "employment", memberId, {
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
    });
  }

  if (hasPayBill) {
    const payRate = parsePayRate(payBill.payRate);
    await upsertSingleByMemberId(db, "pay_rates", memberId, {
      type: "hourly",
      rate: payRate,
      currency: "USD",
      pay_period: typeof payBill.payPeriod === "string" ? payBill.payPeriod : "None",
      ...(hasSettings ? { require_timesheet_approval: settings.requireApproval === true } : {}),
      effective_date: now,
      status: "active",
      updated_by: actor,
      updated_at: now,
    });
  }

  if (hasSettings) {
    const ableToTrack = settings.ableToTrack !== false;
    const workDays = hasWorkLimits && Array.isArray(workLimits.workDays)
      ? workLimits.workDays.filter((d) => Number.isInteger(d))
      : undefined;

    await upsertSingleByMemberId(db, "time_settings", memberId, {
      able_to_track_time: ableToTrack,
      keep_idle_time: idleModeToDb(settings.idleMode),
      idle_timeout: typeof settings.idleTimeout === "string" ? settings.idleTimeout : "5 min",
      modify_time: manualTimeToDb(settings.manualTime),
      require_approval: settings.requireApproval === true,
      ...(workDays ? { work_days: workDays } : {}),
      ...(hasWorkLimits ? { disable_tracking_specific_days: workLimits.disableTrackingSpecificDays === true } : {}),
      ...(hasWorkLimits
        ? { use_shifts_for_limits: SHIFT_ALLOWANCE_LIMITS_ENABLED && workLimits.useShiftsForLimits === true }
        : {}),
      updated_by: actor,
      updated_at: now,
    });
  } else if (hasWorkLimits) {
    assertShiftAllowanceAllowed(workLimits.useShiftsForLimits);

    const workDays = Array.isArray(workLimits.workDays)
      ? workLimits.workDays.filter((d) => Number.isInteger(d))
      : [0, 1, 2, 3, 4];

    await upsertSingleByMemberId(db, "time_settings", memberId, {
      work_days: workDays,
      disable_tracking_specific_days: workLimits.disableTrackingSpecificDays === true,
      use_shifts_for_limits: false,
      updated_by: actor,
      updated_at: now,
    });
  }

  if (hasWorkLimits) {
    assertShiftAllowanceAllowed(workLimits.useShiftsForLimits);

    const limitsErr = validateWorkLimitsMutualExclusion(
      workLimits.weeklyLimit,
      workLimits.dailyLimit,
      false,
    );
    if (limitsErr) throw new Error(limitsErr);

    const weeklyValue = parseLimitValue(workLimits.weeklyLimit);
    const dailyValue = parseLimitValue(workLimits.dailyLimit);
    await upsertLimitField(db, memberId, "weekly", weeklyValue, actor);
    await upsertLimitField(db, memberId, "daily", dailyValue, actor);
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

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
export async function deleteMemberProfileData(db, memberId) {
  for (const collection of ["employment", "time_settings"]) {
    await deleteMemberScopedRows(db, collection, memberId);
  }
  const fkCollections = ["pay_rates", "team_members", "project_members", "member_onboarding"];
  for (const collection of fkCollections) {
    const snap = await db.collection(collection).where("member_id", "==", memberId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
  await deleteLimitsDoc(db, memberId);
  const snapshotSnap = await db
    .collection("members_field_data")
    .where("type", "==", "memberFormSnapshot")
    .where("memberDocId", "==", memberId)
    .get();
  if (!snapshotSnap.empty) {
    const batch = db.batch();
    for (const doc of snapshotSnap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {Record<string, unknown>} formData
 * @param {string} [modifiedBy]
 */
export async function upsertMemberFormSnapshot(db, memberId, formData, modifiedBy = "") {
  const existing = await db
    .collection("members_field_data")
    .where("type", "==", "memberFormSnapshot")
    .where("memberDocId", "==", memberId)
    .limit(1)
    .get();

  const payload = {
    type: "memberFormSnapshot",
    recordType: "memberFormSnapshot",
    memberDocId: memberId,
    modifiedBy,
    formData,
    updated_at: new Date(),
  };

  if (!existing.empty) {
    const ref = existing.docs[0].ref;
    await ref.set({ ...payload, created_at: existing.docs[0].data()?.created_at ?? new Date() }, { merge: true });
    return ref.id;
  }

  const ref = db.collection("members_field_data").doc();
  await ref.set({ ...payload, created_at: new Date(), position: 0, label: "" });
  return ref.id;
}
