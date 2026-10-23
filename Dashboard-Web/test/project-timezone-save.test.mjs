// The project time zone is chosen in the modal but used to be left out of the save request, so it
// never reached the server and changing it did nothing for anyone tracking on the project. These
// run the real save functions against a stand-in backend and check the requests they send. That a
// viewer who may not set a time zone does not send one is checked on the rendered modal in
// project-modal.test.mjs.
import test, { after } from "node:test"
import assert from "node:assert/strict"
import { installDom, createLoader, signedInStubs, fakeBackend } from "./helpers/render.mjs"

const env = installDom()
after(() => env.restore())

const loader = createLoader({ stubs: signedInStubs })
const details = loader.load("features/projects/api/project-details-api.ts")

const ACTOR = { memberId: "aaaaaaaa-0000-4000-8000-000000000001" }
const payload = (over = {}) => ({
  name: "Website", type: "normal", billable: true, disableActivity: false, allowProjectTracking: true,
  restrictManagerTracking: false, requireTaskToTrack: false, restrictTaskCreation: false, requireStopNote: false,
  clientCanManage: false, clientCanTrack: false, disableIdleTime: false, idleTimeSeconds: 600, disableBreakLimit: false,
  breakTimeSeconds: 900, endDate: "", subProjectIds: [], clientIds: [], teamIds: [], managerIds: [],
  trackingAllowedManagerIds: [], memberTimeZones: {}, userIds: [], viewerIds: [], memberLimitMemberIds: [],
  memberLimits: [], memberOwnLimits: {}, budgetStopTimers: false, budgetType: "", budgetBasedOn: "", budgetScope: "",
  budgetTotal: "", budgetResets: "", budgetNotifyAt: "", budgetWhoToNotify: "", budgetStopTimersAt: "",
  budgetStartDate: "", budgetIncludeNonBillable: false, budgetNotifyMembers: false, memberLimitNotifyAt: "",
  memberLimitNotifyMembers: false, memberLimitMembers: "", budgetSpent: 0,
  skip: { budget: true, memberLimits: true, members: true },
  ...over,
})
const backend = () =>
  fakeBackend((call) => {
    if (call.path === "/api/projects" && call.method === "POST") return { body: { success: true, data: { id: "p-new", name: call.body.name } } }
    if (/^\/api\/projects\/[^/]+$/.test(call.path) && call.method === "PATCH") return { body: { success: true, data: { id: call.path.split("/").pop() } } }
    return { body: { success: true, data: [] } }
  })
const projectWrite = (calls) => calls.find((c) => /^\/api\/projects(\/[^/]+)?$/.test(c.path) && (c.method === "POST" || c.method === "PATCH"))

test("creating a project sends the chosen time zone", async () => {
  const calls = backend()
  await details.createProjectWithDetails(payload({ timezone: "Asia/Tokyo" }), ACTOR)
  const write = projectWrite(calls)
  assert.equal(write.method, "POST")
  assert.equal(write.body.timezone, "Asia/Tokyo")
})

test("updating a project sends the chosen time zone", async () => {
  const calls = backend()
  await details.updateProjectWithDetails("p-1", payload({ timezone: "Europe/Paris" }), ACTOR)
  const write = projectWrite(calls)
  assert.equal(write.path, "/api/projects/p-1")
  assert.equal(write.body.timezone, "Europe/Paris")
})

test("clearing the time zone sends null, and leaving it unset sends nothing at all", async () => {
  let calls = backend()
  await details.updateProjectWithDetails("p-1", payload({ timezone: "" }), ACTOR)
  assert.equal(projectWrite(calls).body.timezone, null)

  calls = backend()
  await details.updateProjectWithDetails("p-1", payload({ timezone: undefined }), ACTOR)
  assert.equal("timezone" in projectWrite(calls).body, false, "the saved zone is left alone")
})
