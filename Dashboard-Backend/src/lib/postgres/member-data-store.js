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

const PG_MEMBER_SCOPED = new Set(["employment", "time_settings", "pay_rates"]);
const FIRESTORE_MEMBER_SCOPED = new Set(["member_onboarding"]);

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

/**
 * @param {import("firebase-admin/firestore").QueryDocumentSnapshot[]} docs
 */
function pickLatestMemberRow(docs) {
  if (docs.length === 0) return null;
  if (docs.length === 1) return docs[0];
  const toSortMs = (value) => {
    if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
      return value.toDate().getTime();
    }
    if (value instanceof Date) return value.getTime();
    return 0;
  };
  return [...docs].sort((a, b) => toSortMs(b.data()?.updated_at) - toSortMs(a.data()?.updated_at))[0];
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
// employment / time_settings (+ Firestore-only pay_rates / onboarding helpers)
// ---------------------------------------------------------------------------

/** @param {import("firebase-admin/firestore").Firestore} db */
export async function getSingleByMemberId(db, collection, memberId) {
  if (PG_MEMBER_SCOPED.has(collection)) {
    await requireMemberDataPostgres();
    return getMemberScopedRowPg(collection, memberId);
  }
  const snap = await db.collection(collection).where("member_id", "==", memberId).get();
  const doc = pickLatestMemberRow(snap.docs);
  if (!doc) return null;
  return { id: doc.id, ...(doc.data() || {}) };
}

/** @param {import("firebase-admin/firestore").Firestore} db */
export async function upsertSingleByMemberId(db, collection, memberId, payload) {
  if (PG_MEMBER_SCOPED.has(collection)) {
    await requireMemberDataPostgres();
    const existing = await getMemberScopedRowPg(collection, memberId);
    const id = existing?.id ?? crypto.randomUUID();
    await upsertMemberScopedRowPg(collection, memberId, { id, member_id: memberId, ...payload });
    return id;
  }
  const snap = await db.collection(collection).where("member_id", "==", memberId).get();
  if (!snap.empty) {
    const batch = db.batch();
    for (const doc of snap.docs) batch.update(doc.ref, payload);
    await batch.commit();
    return snap.docs[0].id;
  }
  const id = crypto.randomUUID();
  await db.collection(collection).doc(id).set({ id, member_id: memberId, ...payload });
  return id;
}

/**
 * §6.9 - same contract as the Postgres write helpers: only checked when
 * `expectedUpdatedAt` is provided and a row already exists; a first-time
 * create has nothing to conflict with. Returns `{ conflict: true }` instead
 * of the row id on a stale write.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} collection @param {string} memberId
 * @param {Record<string, unknown>} payload @param {string} [expectedUpdatedAt]
 */
export async function upsertSingleByMemberIdConditional(db, collection, memberId, payload, expectedUpdatedAt) {
  if (PG_MEMBER_SCOPED.has(collection)) {
    await requireMemberDataPostgres();
    const existing = await getMemberScopedRowPg(collection, memberId);
    const id = existing?.id ?? crypto.randomUUID();
    const result = await upsertMemberScopedRowPg(collection, memberId, { id, member_id: memberId, ...payload }, expectedUpdatedAt);
    if (result && typeof result === "object" && "conflict" in result) return { conflict: true };
    return id;
  }
  if (!expectedUpdatedAt) {
    return upsertSingleByMemberId(db, collection, memberId, payload);
  }
  const snap = await db.collection(collection).where("member_id", "==", memberId).get();
  if (snap.empty) {
    // Nothing to conflict with yet - same as the Postgres path's first create.
    return upsertSingleByMemberId(db, collection, memberId, payload);
  }
  const target = pickLatestMemberRow(snap.docs);
  return db.runTransaction(async (tx) => {
    const fresh = await tx.get(target.ref);
    const currentUpdatedAt = fresh.data()?.updated_at;
    const currentIso =
      currentUpdatedAt && typeof currentUpdatedAt.toDate === "function"
        ? currentUpdatedAt.toDate().toISOString()
        : currentUpdatedAt instanceof Date
          ? currentUpdatedAt.toISOString()
          : String(currentUpdatedAt ?? "");
    if (currentIso !== expectedUpdatedAt) {
      return { conflict: true };
    }
    tx.update(target.ref, { ...payload, updated_at: new Date() });
    return target.id;
  });
}

/** @param {import("firebase-admin/firestore").Firestore} db */
export async function ensureSingleByMemberId(db, collection, memberId, buildPayload) {
  if (PG_MEMBER_SCOPED.has(collection)) {
    await requireMemberDataPostgres();
    return ensureMemberScopedRowPg(collection, memberId, buildPayload);
  }
  const existing = await db.collection(collection).where("member_id", "==", memberId).limit(1).get();
  if (!existing.empty) return { created: false, id: existing.docs[0].id };
  const id = crypto.randomUUID();
  const payload = buildPayload();
  await db.collection(collection).doc(id).set({ id, member_id: memberId, ...payload });
  return { created: true, id };
}

/** @param {import("firebase-admin/firestore").Firestore} db */
export async function deleteMemberScopedRows(db, collection, memberId) {
  if (PG_MEMBER_SCOPED.has(collection)) {
    await requireMemberDataPostgres();
    await deleteMemberScopedRowsPg(collection, memberId);
    return;
  }
  if (!FIRESTORE_MEMBER_SCOPED.has(collection)) return;
  const snap = await db.collection(collection).where("member_id", "==", memberId).get();
  if (snap.empty) return;
  const batch = db.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
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
