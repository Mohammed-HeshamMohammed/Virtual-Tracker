import crypto from "node:crypto";
import { logSafeWarn } from "../../../http/sanitize-error.js";
import { updateTreeCache } from "../../member-relationships/service.js";
import { dedupeByMemberId } from "./member-dedupe-helpers.js";
import { resolveRoleNameById, syncMemberPrimaryRole } from "./relation-sync.js";

/** Singleton row per member (dedupe key = empty string). */
export const MEMBER_SINGLETON_COLLECTIONS = [
  "employment",
  "pay_rates",
  "time_settings",
  "member_onboarding",
];

/** Collections with `member_id` cleaned on member delete (see deleteMemberProfileData). */
export const MEMBER_SCOPED_DELETE_COLLECTIONS = [
  ...MEMBER_SINGLETON_COLLECTIONS,
  "limits",
  "team_members",
  "project_members",
];

function normalizeRole(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function isOwnerRole(value) {
  return normalizeRole(value) === "owner";
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Record<string, unknown>} memberData
 */
async function canonicalRoleNameForBootstrap(db, memberData) {
  const roleId = typeof memberData?.role_id === "string" ? memberData.role_id.trim() : "";
  if (roleId) {
    const fromId = await resolveRoleNameById(db, roleId);
    if (fromId) return fromId;
  }
  return "Viewer";
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
export async function dedupeAllMemberScopedEntities(db, memberId) {
  let total = 0;
  for (const collection of MEMBER_SINGLETON_COLLECTIONS) {
    total += await dedupeByMemberId(db, collection, memberId);
  }
  total += await dedupeByMemberId(db, "limits", memberId, (data) =>
    typeof data.limit_type === "string" ? data.limit_type : "",
  );
  return total;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} collection
 * @param {string} memberId
 * @param {() => Record<string, unknown>} buildPayload
 */
async function ensureSingleByMemberId(db, collection, memberId, buildPayload) {
  const existing = await db.collection(collection).where("member_id", "==", memberId).limit(1).get();
  if (!existing.empty) return { created: false, id: existing.docs[0].id };
  const id = crypto.randomUUID();
  await db.collection(collection).doc(id).set({ id, member_id: memberId, ...buildPayload() });
  return { created: true, id };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} limitType
 * @param {number} value
 * @param {string} actor
 */
async function ensureLimitByType(db, memberId, limitType, value, actor) {
  const snap = await db
    .collection("limits")
    .where("member_id", "==", memberId)
    .where("limit_type", "==", limitType)
    .limit(1)
    .get();
  if (!snap.empty) return { created: false, id: snap.docs[0].id };
  const id = crypto.randomUUID();
  const now = new Date();
  await db.collection("limits").doc(id).set({
    id,
    member_id: memberId,
    limit_type: limitType,
    value,
    updated_by: actor,
    updated_at: now,
  });
  return { created: true, id };
}

/**
 * Ensures every member-scoped profile entity exists with defaults.
 * Does not create team/project assignments, clients, invites, or activity logs.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string, memberData?: Record<string, unknown>, actor?: string, skipOnboardingForOwner?: boolean }} params
 * @returns {Promise<{ created: string[] }>}
 */
export async function ensureMemberScopedEntities(db, { memberId, memberData = {}, actor = "system", skipOnboardingForOwner = true }) {
  const created = [];
  const now = () => new Date();

  const roleName = await canonicalRoleNameForBootstrap(db, memberData);
  await syncMemberPrimaryRole(db, memberId, roleName, actor);

  if (!(skipOnboardingForOwner && isOwnerRole(roleName))) {
    const onboarding = await ensureSingleByMemberId(db, "member_onboarding", memberId, () => ({
      invite_id: null,
      created_account: true,
      created_account_at: now(),
      downloaded_app: false,
      downloaded_app_at: null,
      tracked_time: false,
      tracked_time_at: null,
      last_reminder_sent_at: null,
      last_reminder_sent_by: "",
      created_at: now(),
      created_by: actor,
      updated_by: actor,
      updated_at: now(),
    }));
    if (onboarding.created) created.push("member_onboarding");
  }

  const employment = await ensureSingleByMemberId(db, "employment", memberId, () => ({
    job_title_id: "",
    department_id: "",
    job_type_id: "",
    tax_type_id: "",
    work_address: "",
    mailing_address: false,
    employment_type: "",
    employed_through: "",
    workplace_model: "",
    pct_in_office: 0,
    pct_remote: 0,
    tax_info: "",
    account_code: "",
    currency: "USD",
    start_date: null,
    end_date: null,
    termination_reason: "",
    employment_comments: "",
    created_by: actor,
    updated_by: actor,
    updated_at: now(),
  }));
  if (employment.created) created.push("employment");

  const payRates = await ensureSingleByMemberId(db, "pay_rates", memberId, () => ({
    type: "hourly",
    rate: 0,
    currency: "USD",
    pay_period: "None",
    require_timesheet_approval: false,
    effective_date: now(),
    status: "active",
    note: "",
    created_by: actor,
    updated_by: actor,
    updated_at: now(),
  }));
  if (payRates.created) created.push("pay_rates");

  const timeSettings = await ensureSingleByMemberId(db, "time_settings", memberId, () => ({
    able_to_track_time: true,
    keep_idle_time: "never",
    idle_timeout: "5 min",
    modify_time: "off",
    require_approval: false,
    work_days: [0, 1, 2, 3, 4],
    disable_tracking_specific_days: false,
    use_shifts_for_limits: false,
    updated_by: actor,
    updated_at: now(),
  }));
  if (timeSettings.created) created.push("time_settings");

  for (const limitType of ["weekly", "daily"]) {
    const limit = await ensureLimitByType(db, memberId, limitType, 0, actor);
    if (limit.created) created.push(`limits:${limitType}`);
  }

  const cache = await db.collection("member_tree_cache").doc(memberId).get();
  if (!cache.exists) {
    try {
      await updateTreeCache(db, memberId);
      created.push("member_tree_cache");
    } catch (err) {
      logSafeWarn("[member-entity-bootstrap] tree cache failed:", err);
    }
  }

  await dedupeAllMemberScopedEntities(db, memberId);

  return { created };
}
