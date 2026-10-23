// PLAN-customer-accounts-and-tenancy.md §0.1 blocker 10: the backend's session-bootstrap and
// per-request expiry gates answer SUBSCRIPTION_EXPIRED / TENANT_REMOVED when a customer account's
// paid period lapses or the account is removed. The web app has to recognise them and route them
// into the same sign-out flow as a ban. These run the real classifiers, and the real sign-in
// verification against a stand-in for the backend's answers.
import test from "node:test"
import assert from "node:assert/strict"
import { createLoader } from "./helpers/render.mjs"

const errors = createLoader().load("features/auth/services/auth-session-errors.ts")

const responses = []
const respond = (status, body) => responses.push({ status, body })
const loader = createLoader({
  stubs: {
    "@/infrastructure/api/http": {
      apiFetch: async () => {
        const { status, body } = responses.shift()
        return { ok: status < 400, status, json: async () => body }
      },
    },
    "@/features/auth/services/browser-state-hygiene": { isSuspiciousAuthError: () => false, handleSuspiciousAuthFailure: async () => {} },
  },
})
const { verifyIdTokenWithBackend } = loader.load("features/auth/services/verify-session.ts")

test("the two tenant-lifecycle codes are recognised as tenant expiry, and nothing else is", () => {
  assert.equal(errors.isTenantExpiryCode("SUBSCRIPTION_EXPIRED"), true)
  assert.equal(errors.isTenantExpiryCode("TENANT_REMOVED"), true)
  for (const other of ["ACCOUNT_BANNED", "EMAIL_NOT_VERIFIED", "subscription_expired", "", undefined]) {
    assert.equal(errors.isTenantExpiryCode(other), false, String(other))
  }
})

test("tenant expiry goes down the same sign-out path as a ban or a disabled account", () => {
  for (const code of ["SUBSCRIPTION_EXPIRED", "TENANT_REMOVED", "ACCOUNT_BANNED", "ACCOUNT_DISABLED", "DEVICE_BANNED", "SESSION_REVOKED"]) {
    assert.equal(errors.isAccountRestrictionCode(code), true, code)
  }
  for (const code of ["EMAIL_NOT_VERIFIED", "NO_MEMBER_PROFILE", undefined]) {
    assert.equal(errors.isAccountRestrictionCode(code), false, String(code))
  }
})

test("the code is read off the backend's error body", () => {
  assert.equal(errors.parseAuthSessionErrorCode({ code: " TENANT_REMOVED " }), "TENANT_REMOVED")
  assert.equal(errors.parseAuthSessionErrorCode({ error: "nope" }), undefined)
  assert.equal(errors.parseAuthSessionErrorCode(null), undefined)
})

test("a sign-in refused at session-bootstrap for an expired account reports that code", async () => {
  respond(200, { success: true })
  respond(403, { success: false, error: "This account's subscription has expired.", code: "SUBSCRIPTION_EXPIRED" })
  const result = await verifyIdTokenWithBackend({ uid: "u-1" })
  assert.deepEqual(result, { success: false, error: "This account's subscription has expired.", code: "SUBSCRIPTION_EXPIRED" })
  assert.equal(errors.isAccountRestrictionCode(result.code), true)
})

test("the same holds when the per-request gate refuses at verify", async () => {
  respond(403, { success: false, error: "This account was removed.", code: "TENANT_REMOVED" })
  const result = await verifyIdTokenWithBackend({ uid: "u-2" })
  assert.equal(result.code, "TENANT_REMOVED")
  assert.equal(responses.length, 0, "bootstrap is not attempted after a refused verify")
})
