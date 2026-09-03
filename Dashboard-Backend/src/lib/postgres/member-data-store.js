
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

async function requireMemberDataPostgres() {
  if (!(await isPostgresMemberDataReady())) {
    throw new Error(
      "Member profile data requires PostgreSQL (POSTGRES_URL) with member-domain schema applied.",
    );
  }
}

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


export async function getMemberLimitsDoc(_db, memberId) {
  await requireMemberDataPostgres();
  return getLimitsPg(memberId);
}

export async function upsertLimitField(_db, memberId, limitType, value, updatedBy) {
  await requireMemberDataPostgres();
  await upsertLimitFieldPg(memberId, limitType, value, updatedBy);
  return memberId;
}

export async function ensureLimitsDoc(_db, memberId, actor) {
  await requireMemberDataPostgres();
  return ensureLimitsDocPg(memberId, actor);
}

export async function deleteLimitsDoc(_db, memberId) {
  await requireMemberDataPostgres();
  await deleteLimitsDocPg(memberId);
}

export async function updateWorkLimitsConditional(_db, memberId, payload, actor, expected) {
  await requireMemberDataPostgres();
  return updateWorkLimitsConditionalPg(memberId, payload, actor, expected);
}

export async function fetchWeeklyLimitsForMembers(_db, memberIds) {
  await requireMemberDataPostgres();
  const unique = [...new Set(memberIds.filter((id) => typeof id === "string" && id))];
  if (!unique.length) return [];
  const rows = await getLimitsBatchPg(unique);
  const byMember = new Map(rows.map((row) => [String(row.member_id ?? row.id), row]));
  return unique.map((memberId) => pseudoLimitDoc(byMember.get(memberId) ?? null));
}


export async function getSingleByMemberId(_db, collection, memberId) {
  assertPgMemberScoped(collection);
  await requireMemberDataPostgres();
  return getMemberScopedRowPg(collection, memberId);
}

export async function upsertSingleByMemberId(_db, collection, memberId, payload) {
  assertPgMemberScoped(collection);
  await requireMemberDataPostgres();
  const existing = await getMemberScopedRowPg(collection, memberId);
  const id = existing?.id ?? crypto.randomUUID();
  await upsertMemberScopedRowPg(collection, memberId, { id, member_id: memberId, ...payload });
  return id;
}

export async function upsertSingleByMemberIdConditional(_db, collection, memberId, payload, expectedUpdatedAt) {
  assertPgMemberScoped(collection);
  await requireMemberDataPostgres();
  const existing = await getMemberScopedRowPg(collection, memberId);
  const id = existing?.id ?? crypto.randomUUID();
  const result = await upsertMemberScopedRowPg(collection, memberId, { id, member_id: memberId, ...payload }, expectedUpdatedAt);
  if (result && typeof result === "object" && "conflict" in result) return { conflict: true };
  return id;
}

export async function ensureSingleByMemberId(_db, collection, memberId, buildPayload) {
  assertPgMemberScoped(collection);
  await requireMemberDataPostgres();
  return ensureMemberScopedRowPg(collection, memberId, buildPayload);
}

export async function deleteMemberScopedRows(_db, collection, memberId) {
  assertPgMemberScoped(collection);
  await requireMemberDataPostgres();
  await deleteMemberScopedRowsPg(collection, memberId);
}

export async function memberUsesShiftsForLimits(_db, memberId) {
  await requireMemberDataPostgres();
  return memberUsesShiftsForLimitsPg(memberId);
}

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

export async function findActiveBanByEmail(_db, emailNorm) {
  await requireMemberDataPostgres();
  const row = await findActiveBanByEmailPg(emailNorm);
  return row ? { id: row.id, ...row } : null;
}

export async function findActiveBanByMemberId(_db, memberId) {
  await requireMemberDataPostgres();
  const row = await findActiveBanByMemberIdPg(memberId);
  return row ? { id: row.id, ...row } : null;
}

export async function findActiveBanByFirebaseUid(_db, firebaseUid) {
  await requireMemberDataPostgres();
  const row = await findActiveBanByFirebaseUidPg(firebaseUid);
  return row ? { id: row.id, ...row } : null;
}

export async function listActiveMemberBans(_db) {
  await requireMemberDataPostgres();
  const rows = await listActiveMemberBansPg();
  return rows.map(mapBanRow);
}

export async function createMemberBanRecord(_db, payload) {
  await requireMemberDataPostgres();
  const id = typeof payload.id === "string" ? payload.id : crypto.randomUUID();
  await insertMemberBanPg({ ...payload, id });
  return { id };
}

export async function patchMemberBanRecord(_db, banId, patch) {
  await requireMemberDataPostgres();
  await updateMemberBanPg(banId, patch);
}

export async function getMemberBanRecord(_db, banId) {
  await requireMemberDataPostgres();
  const row = await getMemberBanPg(banId);
  return row ? { id: row.id, ...row } : null;
}

export async function isDevicePermanentlyBanned(_db, ip) {
  const normalized = typeof ip === "string" ? ip.trim() : "";
  if (!normalized || normalized === "unknown") return false;
  await requireMemberDataPostgres();
  return isDevicePermanentlyBannedPg(normalized);
}

export async function recordBanIpAndMaybeDeviceBan(_db, ip, memberId) {
  const normalized = typeof ip === "string" ? ip.trim() : "";
  if (!normalized || normalized === "unknown") return;
  await requireMemberDataPostgres();
  await recordBanIpAndMaybeDeviceBanPg(normalized, memberId);
}


export async function getSystemMetaDoc(_db, docKey) {
  await requireMemberDataPostgres();
  return getSystemMetaPg(docKey);
}

export async function setSystemMetaDoc(_db, docKey, payload) {
  await requireMemberDataPostgres();
  await setSystemMetaPg(docKey, payload);
}


export async function getMemberTreeCache(_db, memberId) {
  await requireMemberDataPostgres();
  return getMemberTreeCachePg(memberId);
}

export async function setMemberTreeCache(_db, memberId, data) {
  await requireMemberDataPostgres();
  await setMemberTreeCachePg(memberId, data);
}

export async function deleteMemberTreeCache(_db, memberId) {
  await requireMemberDataPostgres();
  await deleteMemberTreeCachePg(memberId);
}
