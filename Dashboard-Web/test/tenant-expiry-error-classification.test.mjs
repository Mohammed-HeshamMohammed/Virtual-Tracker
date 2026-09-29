// PLAN-customer-accounts-and-tenancy.md §0.1 blocker 10: Dashboard Web had
// zero references to SUBSCRIPTION_EXPIRED/TENANT_REMOVED, the codes the
// backend's session-bootstrap and per-request expiry gates emit - not even
// a generic unhandled-code fallback for them specifically. Source-level,
// matching bug-fixes-round-1.test.mjs's own convention: this app has no
// component-test setup, so this pins the structural wiring (the codes are
// recognized and routed into the same sign-out flow every other
// account-level gate already uses), not rendered behaviour.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8")

test("SUBSCRIPTION_EXPIRED and TENANT_REMOVED are part of the known auth session error codes", () => {
  const src = read("features/auth/services/auth-session-errors.ts")
  assert.match(src, /"SUBSCRIPTION_EXPIRED"/)
  assert.match(src, /"TENANT_REMOVED"/)
})

test("isTenantExpiryCode recognizes exactly the two tenant-lifecycle codes", () => {
  const src = read("features/auth/services/auth-session-errors.ts")
  const start = src.indexOf("export function isTenantExpiryCode(")
  assert.ok(start > 0, "isTenantExpiryCode must be exported")
  const body = src.slice(start, src.indexOf("\n}", start))
  assert.match(body, /code === "SUBSCRIPTION_EXPIRED"/)
  assert.match(body, /code === "TENANT_REMOVED"/)
})

test("isAccountRestrictionCode routes tenant-expiry codes into the same sign-out flow as a ban/restriction", () => {
  const src = read("features/auth/services/auth-session-errors.ts")
  const start = src.indexOf("export function isAccountRestrictionCode(")
  assert.ok(start > 0)
  const body = src.slice(start, src.indexOf("\n}", start))
  assert.match(body, /isTenantExpiryCode\(code\)/, "must delegate to isTenantExpiryCode, not duplicate the code list")
})

test("session-bootstrap's error code is threaded through verify-session.ts into an AuthGateError the same way every other gate code is", () => {
  const verifySession = read("features/auth/services/verify-session.ts")
  // Both /api/auth/verify and /api/auth/session-bootstrap failures already
  // parse `code` via parseAuthSessionErrorCode and return it on the result -
  // this just confirms session-bootstrap's response is not special-cased
  // to drop the code.
  const bootstrapCallAt = verifySession.indexOf('"/api/auth/session-bootstrap"')
  assert.ok(bootstrapCallAt > 0)
  const afterBootstrapCall = verifySession.slice(bootstrapCallAt)
  assert.match(afterBootstrapCall, /const code = parseAuthSessionErrorCode\(data\)/)
  assert.match(afterBootstrapCall, /\.\.\.\(code \? \{ code \} : \{\}\)/)
})
