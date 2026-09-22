import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who is making the change, carried from the authenticated request down to the
 * database connection the write runs on.
 *
 * `audit_logs.performed_by` existed, was selected by the Audit Log report, and
 * was joined against `members` to render an author - but nothing ever wrote to
 * it. The column is filled by a row-level trigger, and a trigger cannot see the
 * application's idea of "the current user", so every audit row was stored with
 * a null actor and the report rendered "System" for all of them. A report whose
 * whole purpose is "who changed what" could name the what and never the who.
 *
 * The fix is the usual Postgres one: the request's actor is published on the
 * connection as a setting (`app.actor_id`) just before a write, and the trigger
 * reads it back. Async-local storage is what gets the id from the HTTP layer to
 * `client.js` without threading an actor parameter through every service
 * function in the codebase.
 *
 * A null actor is a legitimate answer, not a failure: migrations, the schema
 * bootstrap and the background schedulers all write outside any request, and
 * "System" is the honest author for those.
 */
const storage = new AsyncLocalStorage();

/**
 * The same store also carries the request's tenant id (PLAN-customer-
 * accounts-and-tenancy.md §3.2): both are "who/what this request is",
 * published onto the connection the same way and at the same moment
 * (setAuthContext, the one place a request's viewer becomes known), so one
 * async-local store serves both rather than wrapping every request twice.
 */

/** Wraps one request so writes inside it can be attributed. */
export function runWithAuditActor(fn) {
  return storage.run({ id: null, tenantId: null }, fn);
}

/** Called once the request's viewer is known. */
export function setAuditActor(memberId) {
  const store = storage.getStore();
  if (!store) return;
  const id = typeof memberId === "string" && memberId.trim() ? memberId.trim() : null;
  store.id = id;
}

export function currentAuditActor() {
  return storage.getStore()?.id ?? null;
}

/** Called once the request's tenant is known (setAuthContext). */
export function setRequestTenantId(tenantId) {
  const store = storage.getStore();
  if (!store) return;
  store.tenantId = typeof tenantId === "string" && tenantId.trim() ? tenantId.trim() : null;
}

export function currentTenantId() {
  return storage.getStore()?.tenantId ?? null;
}

/**
 * The background-work equivalent of runWithAuditActor: a sweep or a
 * scheduled-report iteration has no HTTP request to wrap, so it opens its
 * own frame here instead of going through setAuthContext (see client.js's
 * withTenant, and PLAN-customer-accounts-and-tenancy.md §15.2). No actor is
 * published in this frame - "System" is still the honest author for
 * background work, only the tenant scope changes per iteration.
 */
export function runWithTenantId(tenantId, fn) {
  return storage.run({ id: null, tenantId: typeof tenantId === "string" ? tenantId : null }, fn);
}

/**
 * Whether a statement can produce audit rows. Reads never do, and publishing
 * the actor costs a round-trip, so this keeps that cost on the writes that can
 * actually use it.
 */
const WRITE_STATEMENT_RE = /\b(insert|update|delete|merge)\b/i;

export function statementMayAudit(sql) {
  return WRITE_STATEMENT_RE.test(String(sql ?? ""));
}
