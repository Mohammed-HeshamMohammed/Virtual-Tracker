import { logSafeWarn } from "../../../http/sanitize-error.js";
import { updateTreeCache } from "../../member-relationships/service.js";
import { resolveRoleNameById, syncMemberPrimaryRole } from "./relation-sync.js";
import {
  dedupeMemberOnboardingByMemberIdPg,
  ensureMemberOnboardingRowPg,
} from "../../../lib/postgres/member-data-postgres.service.js";
import { normalizeRoleKey } from "../../../http/role-key.js";
import {
  ensureLimitsDoc,
  ensureSingleByMemberId,
  getMemberTreeCache,
} from "../../../lib/postgres/member-data-store.js";

/** Singleton per-member rows still worth deduping. pay_rates isn't listed -
 * its Postgres member_id column is UNIQUE, so a duplicate can't exist. */
export const MEMBER_SINGLETON_COLLECTIONS = [
  "member_onboarding",
];

/** Collections with `member_id` cleaned on member delete (see deleteMemberProfileData). */
export const MEMBER_SCOPED_DELETE_COLLECTIONS = [
  ...MEMBER_SINGLETON_COLLECTIONS,
  "team_members",
  "project_members",
];

function normalizeRole(value) {
  // Delegates to the canonical normalizer - a local copy here would
  // drop the legacy-misspelling fold and silently mis-rank "Super Manger".
  return normalizeRoleKey(value);
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
  // limits, employment, time_settings, pay_rates: one row per member_id in
  // Postgres (UNIQUE constraint), nothing to dedupe.
  return dedupeMemberOnboardingByMemberIdPg(memberId);
}

/**
 * Create default profile rows for a member (not teams, projects, or invites).
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
    const onboarding = await ensureMemberOnboardingRowPg(memberId, () => ({
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

  const limits = await ensureLimitsDoc(db, memberId, actor);
  if (limits.created) created.push("limits");

  const cache = await getMemberTreeCache(db, memberId);
  if (!cache) {
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
