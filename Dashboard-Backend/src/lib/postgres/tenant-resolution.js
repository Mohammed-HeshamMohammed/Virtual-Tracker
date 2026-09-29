import { queryAsAdmin, withTenant } from "./client.js";
import { currentTenantId, setRequestTenantId } from "./audit-actor.js";
import { MAIN_TENANT_ID } from "./ensure-tenancy-schema.js";

/**
 * Which tenant a person belongs to, answered before any tenant is published.
 *
 * Every entry point that starts from an identity rather than a request
 * context - auth-middleware verifying a Firebase token, the presence
 * websocket, the session-cookie and presence-events routes, the presence
 * last-seen flush - has to look the member up to learn their tenant, and
 * under RLS a vt_app query with no tenant published sees nothing. These
 * lookups are the narrow exception: one admin-scoped read of exactly the
 * tenant_id column, after which everything runs tenant-scoped on vt_app.
 *
 * Only hits are cached: a miss is usually a person who is about to exist
 * (first sign-in, invite registration), and caching "not found" would pin
 * them to the main tenant for the TTL. A member's tenant never changes after
 * creation, so a stale hit is not a correctness risk.
 */

const TTL_MS = 60_000;
const byUid = new Map();
const byMemberId = new Map();

function cached(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    map.delete(key);
    return null;
  }
  return hit.tenantId;
}

function remember(map, key, tenantId) {
  map.set(key, { tenantId, expiresAt: Date.now() + TTL_MS });
}

function asTenantId(value) {
  return typeof value === "string" && value ? value : null;
}

/** Falls back to the main tenant when the person has no row yet, matching
 *  how every other main-org default in this codebase resolves. */
export async function resolveTenantIdForFirebaseUid(firebaseUid) {
  if (!firebaseUid) return MAIN_TENANT_ID;
  const hit = cached(byUid, firebaseUid);
  if (hit) return hit;
  const rows = await queryAsAdmin(
    `SELECT tenant_id FROM members WHERE firebase_uid = $1
     UNION ALL
     SELECT tenant_id FROM pending_auth_members WHERE firebase_uid = $1
     LIMIT 1`,
    [firebaseUid],
  );
  const tenantId = asTenantId(rows[0]?.tenant_id);
  if (!tenantId) return MAIN_TENANT_ID;
  remember(byUid, firebaseUid, tenantId);
  return tenantId;
}

export async function resolveTenantIdForMemberId(memberId) {
  if (!memberId) return MAIN_TENANT_ID;
  const hit = cached(byMemberId, memberId);
  if (hit) return hit;
  const rows = await queryAsAdmin(`SELECT tenant_id FROM members WHERE id = $1 LIMIT 1`, [memberId]);
  const tenantId = asTenantId(rows[0]?.tenant_id);
  if (!tenantId) return MAIN_TENANT_ID;
  remember(byMemberId, memberId, tenantId);
  return tenantId;
}

/** Every by-token/by-key lookup below reads one tenant_id column from an
 *  allowlisted table - never a caller-supplied table or column name. */
async function tenantIdWhere(sql, value) {
  if (!value) return MAIN_TENANT_ID;
  const rows = await queryAsAdmin(sql, [value]);
  return asTenantId(rows[0]?.tenant_id) ?? MAIN_TENANT_ID;
}

export function resolveTenantIdForEmail(email) {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  return tenantIdWhere(
    `SELECT tenant_id FROM members WHERE lower(work_email) = $1 OR lower(personal_email) = $1
     UNION ALL
     SELECT tenant_id FROM pending_auth_members WHERE lower(email) = $1
     LIMIT 1`,
    normalized,
  );
}

export function resolveTenantIdForAgentDevice(deviceId) {
  return tenantIdWhere(`SELECT tenant_id FROM agent_devices WHERE device_id::text = $1 LIMIT 1`, deviceId);
}

export function resolveTenantIdForTransferToken(token) {
  return tenantIdWhere(`SELECT tenant_id FROM member_transfer_requests WHERE token = $1 LIMIT 1`, token);
}

/**
 * For request handlers that learn who the caller is part-way through (a
 * public route verifying an ID token, or keyed by email/device/token):
 * scopes the REST OF THE CURRENT REQUEST to that tenant. Each HTTP request
 * already runs in its own async-local frame (create-server.js), so this
 * affects this request only. Never overrides a tenant already published.
 */
export function publishTenant(tenantId) {
  if (currentTenantId()) return;
  setRequestTenantId(tenantId || MAIN_TENANT_ID);
}

export async function publishTenantForFirebaseUid(firebaseUid) {
  if (currentTenantId()) return;
  publishTenant(await resolveTenantIdForFirebaseUid(firebaseUid));
}

/** Runs fn scoped to that person's tenant - unless a tenant is already
 *  published, in which case the caller's scope stands (no extra lookup, and
 *  no way for an identity lookup to widen a request's scope). */
export async function withTenantForFirebaseUid(firebaseUid, fn) {
  if (currentTenantId()) return fn();
  return withTenant(await resolveTenantIdForFirebaseUid(firebaseUid), fn);
}

export async function withTenantForMemberId(memberId, fn) {
  if (currentTenantId()) return fn();
  return withTenant(await resolveTenantIdForMemberId(memberId), fn);
}

export function __clearTenantResolutionCacheForTests() {
  byUid.clear();
  byMemberId.clear();
}
