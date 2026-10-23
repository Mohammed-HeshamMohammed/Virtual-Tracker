// PLAN-customer-accounts-and-tenancy.md §0.1 blocker 7 / §0.2 step 6: the management page had a
// create flow and renew/seats/remove actions but no way to look at a customer's data. This renders
// the page in jsdom against a stand-in backend and checks the read-only View it now has: one per
// row, separate from the unlock-gated actions, covering exactly the three allowlisted surfaces,
// and telling the viewer the open is audited.
import test, { after } from "node:test"
import assert from "node:assert/strict"
import { installDom, createLoader, framerMotionStub, mount, click, waitFor, React, Nothing, signedInStubs, fakeBackend } from "./helpers/render.mjs"

const env = installDom()
after(() => env.restore())

const loader = createLoader({
  stubs: {
    ...signedInStubs,
    "framer-motion": framerMotionStub,
    "@/shared/ui/layout": { NotifyToastHost: Nothing },
  },
})
const { CustomerAccountsPage } = loader.load("features/customer-accounts/pages/customer-accounts-page.tsx")
const api = loader.load("features/customer-accounts/api/customer-accounts-api.ts")

const account = (id, email) => ({
  id, email, granted_role: "Enterprise Manager", seat_limit: 10, seats_used: 3, lifecycle: "live", active: true,
  period_start: "2026-01-01T00:00:00Z", period_end: "2027-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z",
})
const VIEW = {
  "activity-summary": { active_members: 4, active_projects: 2, active_seconds_7d: 7200 },
  projects: [{ id: "p-1", name: "Website", status: "active" }],
  employees: [{ id: "e-1", first_name: "Eve", last_name: "Lee", work_email: "eve@acme.test", status: "active" }],
}
const answer = (call) => {
  if (call.path === "/api/customer-accounts") return { body: { success: true, data: [account("acc-1", "one@acme.test"), account("acc-2", "two@acme.test")] } }
  const view = /\/api\/customer-accounts\/([^/]+)\/view\/([^/]+)$/.exec(call.path)
  if (view) return { body: { success: true, data: VIEW[view[2]] } }
  return { status: 404, body: { success: false, error: "not here" } }
}
const viewCalls = (calls) => calls.filter((c) => c.path.includes("/view/"))

test("the API client reads each of the three surfaces from /view/<surface>, without the unlock token", async () => {
  const calls = fakeBackend(answer)
  assert.deepEqual(await api.getCustomerAccountActivitySummary("acc-1"), { activeMembers: 4, activeProjects: 2, activeSeconds7d: 7200 })
  assert.deepEqual((await api.getCustomerAccountProjects("acc-1")).map((p) => p.name), ["Website"])
  assert.deepEqual((await api.getCustomerAccountEmployees("acc-1")).map((e) => e.firstName), ["Eve"])
  assert.deepEqual(calls.map((c) => c.path), [
    "/api/customer-accounts/acc-1/view/activity-summary",
    "/api/customer-accounts/acc-1/view/projects",
    "/api/customer-accounts/acc-1/view/employees",
  ])
  for (const c of calls) assert.equal(c.headers["x-customer-accounts-unlock"], undefined)
})

test("each row has its own View, beside Renew, Seats and Remove, and viewing asks for no unlock code", async () => {
  const calls = fakeBackend(answer)
  const view = await mount(React.createElement(CustomerAccountsPage))
  await waitFor(() => view.container.textContent.includes("two@acme.test"))
  const rows = [...view.container.querySelectorAll("tbody tr")]
  assert.equal(rows.length, 2)
  for (const row of rows) {
    assert.deepEqual([...row.querySelectorAll("button")].map((b) => b.textContent.trim()), ["View", "Renew", "Seats", "Remove"])
  }
  await click([...rows[1].querySelectorAll("button")][0])
  await waitFor(() => viewCalls(calls).length === 1)
  assert.equal(viewCalls(calls)[0].path, "/api/customer-accounts/acc-2/view/activity-summary")
  assert.equal(calls.some((c) => c.path.includes("/unlock")), false)
  await view.unmount()
})

test("the view opens on the summary, covers exactly the three surfaces, and says the open is audited", async () => {
  const calls = fakeBackend(answer)
  const view = await mount(React.createElement(CustomerAccountsPage))
  await waitFor(() => view.container.textContent.includes("one@acme.test"))
  await click(view.container.querySelector("tbody tr button"))
  await waitFor(() => view.container.textContent.includes("4 active member(s)"))
  const text = view.container.textContent
  assert.match(text, /recorded in the account's audit trail/)
  const tabs = [...view.container.querySelectorAll("button")].filter((b) => ["Summary", "projects", "employees"].includes(b.textContent.trim()))
  assert.deepEqual(tabs.map((t) => t.textContent.trim()), ["Summary", "projects", "employees"])
  await click(tabs[1])
  await waitFor(() => view.container.textContent.includes("Website"))
  await click(tabs[2])
  await waitFor(() => view.container.textContent.includes("Eve"))
  assert.deepEqual(viewCalls(calls).map((c) => c.path.split("/view/")[1]), ["activity-summary", "projects", "employees"])
  await view.unmount()
})
