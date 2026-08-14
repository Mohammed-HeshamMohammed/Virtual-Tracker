// Member profile tables in Postgres (limits, employment, bans, tree cache, system_meta).
// Needs POSTGRES_URL + schema from ensure-lookup-schema.js.

import crypto from "node:crypto";
import { isPostgresMemberDataReady } from "./member-data-availability.js";
import {
  deleteLimitsDocPg,
  deleteMemberScopedRowsPg,
  deleteMemberTreeCachePg,
  ensureLimitsDocPg,
  ensureMemberScopedRowPg,
  findActiveBanByEmailPg,
  findActiveBanByFirebaseUidPg,
  findActiveBanByMemberIdPg,
  getLimitsBatchPg,
  getLimitsPg,
  getMemberBanPg,
  getMemberScopedRowPg,
  getMemberTreeCachePg,
  getSystemMetaPg,
  insertMemberBanPg,
  isDevicePermanentlyBannedPg,
  listActiveMemberBansPg,
  memberUsesShiftsForLimitsPg,
  recordBanIpAndMaybeDeviceBanPg,
  setMemberTreeCachePg,
  setSystemMetaPg,
  updateMemberBanPg,
  updateWorkLimitsConditionalPg,
  upsertLimitFieldPg,
  upsertMemberScopedRowPg,
} from "./member-data-postgres.service.js";

/**
 * The only collections this dispatcher ever routes: employment/time_settings/
 * pay_rates. member_onboarding has its own dedicated Postgres API in
 * member-data-postgres.service.js (findMemberOnboardingByMemberIdPg,
 * setMemberOnboardingRowPg, ensureMemberOnboardingRowPg, ...) instead of
 * going through here - it needs invite_id and no-unique-constraint dedupe
 * semantics this generic single-row-per-member dispatcher doesn't model.
 */
const PG_MEMBER_SCOPED = new Set(["employment", "time_settings", "pay_rates"]);

async function requireMemberDataPostgres() {
  if (!(await isPostgresMemberDataReady())) {
    throw new Error(
      "Member profile data requires PostgreSQL (POSTGRES_URL) with member-domain schema applied.",
    );
  }
}

/**
 * @param {Record<string, unknown> | null} row
 */
function pseudoLimitDoc(row) {
  if (!row) {
    return { exists: false, id: "", data: () => ({}) };
  }
  const memberId = String(row.id ?? row.member_id ?? "");
  return {
    exists: true,
    id: memberId,
    data: () => row,
  };
}

function assertPgMemberScoped(collection) {
  if (!PG_MEMBER_SCOPED.has(collection)) {
    throw new Error(`Unsupported member-scoped collection: ${collection}`);
  }
}

// ---------------------------------------------------------------------------
// limits
// ---------------------------------------------------------------------------

/** @param {import("firebase-admin/firestore").Firestore} _db @param {string} memberId */
export async function getMemberLimitsDoc(_db, memberId) {
  await requireMemberDataPostgres();
  return getLimitsPg(memberId);
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function upsertLimitField(_db, memberId, limitType, value, updatedBy) {
  await requireMemberDataPostgres();
  await upsertLimitFieldPg(memberId, limitType, value, updatedBy);
  return memberId;
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function ensureLimitsDoc(_db, memberId, actor) {
  await requireMemberDataPostgres();
  return ensureLimitsDocPg(memberId, actor);
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function deleteLimitsDoc(_db, memberId) {
  await requireMemberDataPostgres();
  await deleteLimitsDocPg(memberId);
}

/**
 * §6.9 follow-up - atomic combined conditional write for the workLimits tab
 * (see updateWorkLimitsConditionalPg for why it needs its own path).
 * @param {import("firebase-admin/firestore").Firestore} _db
 * @param {string} memberId
 * @param {{ weekly: number, daily: number, workDays: number[], makeupDays: number[], disableTrackingSpecificDays: boolean, useShiftsForLimits: boolean }} payload
 * @param {string} actor
 * @param {{ limits?: string, timeSettings?: string }} [expected]
 */
export async function updateWorkLimitsConditional(_db, memberId, payload, actor, expected) {
  await requireMemberDataPostgres();
  return updateWorkLimitsConditionalPg(memberId, payload, actor, expected);
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function fetchWeeklyLimitsForMembers(_db, memberIds) {
  await requireMemberDataPostgres();
  const unique = [...new Set(memberIds.filter((id) => typeof id === "string" && id))];
  if (!unique.length) return [];
  const rows = await getLimitsBatchPg(unique);
  const byMember = new Map(rows.map((row) => [String(row.member_id ?? row.id), row]));
  return unique.map((memberId) => pseudoLimitDoc(byMember.get(memberId) ?? null));
}

// ---------------------------------------------------------------------------
// employment / time_settings / pay_rates
// ---------------------------------------------------------------------------

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function getSingleByMemberId(_db, collection, memberId) {
  assertPgMemberScoped(collection);
  await requireMemberDataPostgres();
  return getMemberScopedRowPg(collection, memberId);
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function upsertSingleByMemberId(_db, collection, memberId, payload) {
  assertPgMemberScoped(collection);
  await requireMemberDataPostgres();
  const existing = await getMemberScopedRowPg(collection, memberId);
  const id = existing?.id ?? crypto.randomUUID();
  await upsertMemberScopedRowPg(collection, memberId, { id, member_id: memberId, ...payload });
  return id;
}

/**
 * §6.9 - only checked when `expectedUpdatedAt` is provided and a row already
 * exists; a first-time create has nothing to conflict with. Returns
 * `{ conflict: true }` instead of the row id on a stale write.
 * @param {import("firebase-admin/firestore").Firestore} _db
 * @param {string} collection @param {string} memberId
 * @param {Record<string, unknown>} payload @param {string} [expectedUpdatedAt]
 */
export async function upsertSingleByMemberIdConditional(_db, collection, memberId, payload, expectedUpdatedAt) {
  assertPgMemberScoped(collection);
  await requireMemberDataPostgres();
  const existing = await getMemberScopedRowPg(collection, memberId);
  const id = existing?.id ?? crypto.randomUUID();
  const result = await upsertMemberScopedRowPg(collection, memberId, { id, member_id: memberId, ...payload }, expectedUpdatedAt);
  if (result && typeof result === "object" && "conflict" in result) return { conflict: true };
  return id;
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function ensureSingleByMemberId(_db, collection, memberId, buildPayload) {
  assertPgMemberScoped(collection);
  await requireMemberDataPostgres();
  return ensureMemberScopedRowPg(collection, memberId, buildPayload);
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function deleteMemberScopedRows(_db, collection, memberId) {
  assertPgMemberScoped(collection);
  await requireMemberDataPostgres();
  await deleteMemberScopedRowsPg(collection, memberId);
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function memberUsesShiftsForLimits(_db, memberId) {
  await requireMemberDataPostgres();
  return memberUsesShiftsForLimitsPg(memberId);
}

/** @param {import("firebase-admin/firestore").Firestore} db */
export async function getMemberLimitHours(db, memberId, limitType) {
  const limitsData = await getMemberLimitsDoc(db, memberId);
  if (!limitsData) return 0;
  const raw = limitsData[limitType];
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw > 0 ? raw : 0;
  const str = String(raw).trim();
  if (!str || /^no\s/i.test(str)) return 0;
  const n = Number(str.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// bans
// ---------------------------------------------------------------------------

function mapBanRow(data) {
  return {
    id: data.id,
    memberId: data.member_id || "",
    memberName: data.member_name || "Member",
    email: data.email || "",
    reason: data.reason || "",
    ipAddress: data.ip_address || "",
    bannedAt: data.banned_at || null,
    bannedByMemberId: data.banned_by_member_id || "",
    bannedByName: data.banned_by_name || "",
    emailSent: Boolean(data.email_sent),
  };
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function findActiveBanByEmail(_db, emailNorm) {
  await requireMemberDataPostgres();
  const row = await findActiveBanByEmailPg(emailNorm);
  return row ? { id: row.id, ...row } : null;
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function findActiveBanByMemberId(_db, memberId) {
  await requireMemberDataPostgres();
  const row = await findActiveBanByMemberIdPg(memberId);
  return row ? { id: row.id, ...row } : null;
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function findActiveBanByFirebaseUid(_db, firebaseUid) {
  await requireMemberDataPostgres();
  const row = await findActiveBanByFirebaseUidPg(firebaseUid);
  return row ? { id: row.id, ...row } : null;
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function listActiveMemberBans(_db) {
  await requireMemberDataPostgres();
  const rows = await listActiveMemberBansPg();
  return rows.map(mapBanRow);
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function createMemberBanRecord(_db, payload) {
  await requireMemberDataPostgres();
  const id = typeof payload.id === "string" ? payload.id : crypto.randomUUID();
  await insertMemberBanPg({ ...payload, id });
  return { id };
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function patchMemberBanRecord(_db, banId, patch) {
  await requireMemberDataPostgres();
  await updateMemberBanPg(banId, patch);
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function getMemberBanRecord(_db, banId) {
  await requireMemberDataPostgres();
  const row = await getMemberBanPg(banId);
  return row ? { id: row.id, ...row } : null;
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function isDevicePermanentlyBanned(_db, ip) {
  const normalized = typeof ip === "string" ? ip.trim() : "";
  if (!normalized || normalized === "unknown") return false;
  await requireMemberDataPostgres();
  return isDevicePermanentlyBannedPg(normalized);
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function recordBanIpAndMaybeDeviceBan(_db, ip, memberId) {
  const normalized = typeof ip === "string" ? ip.trim() : "";
  if (!normalized || normalized === "unknown") return;
  await requireMemberDataPostgres();
  await recordBanIpAndMaybeDeviceBanPg(normalized, memberId);
}

// ---------------------------------------------------------------------------
// system_meta
// ---------------------------------------------------------------------------

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function getSystemMetaDoc(_db, docKey) {
  await requireMemberDataPostgres();
  return getSystemMetaPg(docKey);
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function setSystemMetaDoc(_db, docKey, payload) {
  await requireMemberDataPostgres();
  await setSystemMetaPg(docKey, payload);
}

// ---------------------------------------------------------------------------
// member_tree_cache
// ---------------------------------------------------------------------------

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function getMemberTreeCache(_db, memberId) {
  await requireMemberDataPostgres();
  return getMemberTreeCachePg(memberId);
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function setMemberTreeCache(_db, memberId, data) {
  await requireMemberDataPostgres();
  await setMemberTreeCachePg(memberId, data);
}

/** @param {import("firebase-admin/firestore").Firestore} _db */
export async function deleteMemberTreeCache(_db, memberId) {
  await requireMemberDataPostgres();
  await deleteMemberTreeCachePg(memberId);
}
