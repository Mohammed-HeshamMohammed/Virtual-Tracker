// PLAN-customer-accounts-and-tenancy.md §0.1 blocker 7 / §0.2 step 6: the
// management page had a create flow and renew/seats/remove actions but no
// way to actually look at a customer's data - the audited read-only view
// this pins is the UI entry point for the backend surface built in
// Dashboard-Backend's readonly-view.service.js. Source-level, matching this
// app's established convention (see bug-fixes-round-1.test.mjs): no
// component-test setup here, so these are structural checks, not rendered
// behaviour.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8")

const api = read("features/customer-accounts/api/customer-accounts-api.ts")
const page = read("features/customer-accounts/pages/customer-accounts-page.tsx")

test("the API client exposes all three allowlisted view surfaces, hitting /view/<surface>", () => {
  assert.match(api, /export async function getCustomerAccountProjects/)
  assert.match(api, /export async function getCustomerAccountEmployees/)
  assert.match(api, /export async function getCustomerAccountActivitySummary/)
  assert.match(api, /`\$\{BASE\}\/\$\{encodeURIComponent\(id\)\}\/view\/\$\{surface\}`/)
})

test("view requests are not gated by the unlock token, same as list/detail", () => {
  const start = api.indexOf("async function fetchCustomerAccountView(")
  assert.ok(start > 0)
  const body = api.slice(start, api.indexOf("\n}", start))
  assert.doesNotMatch(body, /unlockHeaders|X-Customer-Accounts-Unlock/)
})

test("the management page has a View action per row, separate from renew/seats/remove", () => {
  assert.match(page, /onClick=\{\(\) => openView\(row\)\}/)
  assert.match(page, />\s*View\s*</)
})

test("opening the view modal tells the viewer the open is audited", () => {
  const start = page.indexOf("{viewingRow ? (")
  assert.ok(start > 0)
  const modal = page.slice(start, page.indexOf("\n      ) : null}", start))
  assert.match(modal, /recorded in the account's audit trail/i)
})

test("the view modal covers exactly the three allowlisted surfaces", () => {
  assert.match(page, /\["activity-summary", "projects", "employees"\]/)
})
