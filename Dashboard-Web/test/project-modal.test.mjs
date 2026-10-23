// The project form, rendered in jsdom against a stand-in backend: what it sends when saved, and what
// its settings say about themselves in the guided tour.
//
// Replaces source-text checks in project-timezone-save ("a viewer who may not set a time zone does
// not send one") and help-mode ("the project form's break setting explains itself").
import test, { after } from "node:test"
import assert from "node:assert/strict"
import { installDom, createLoader, framerMotionStub, mount, click, waitFor, React, signedInStubs, fakeBackend } from "./helpers/render.mjs"

const env = installDom()
after(() => env.restore())

let role = "Manager"
const auth = () => ({ memberRole: role, memberId: "aaaaaaaa-0000-4000-8000-000000000001", currentMember: null, user: { uid: "u-1" } })

// The project being edited, as the edit loader returns it.
const loaded = {
  name: "Website", type: "normal", billable: true, disableActivity: false, allowProjectTracking: true,
  restrictManagerTracking: false, requireTaskToTrack: false, restrictTaskCreation: false, requireStopNote: false,
  clientCanManage: false, clientCanTrack: false, disableIdleTime: false, idleTimeSeconds: 600, disableBreakLimit: false,
  breakTimeSeconds: 900, endDate: "", timezone: "Asia/Tokyo", clientHourlyRate: null, clientRateCurrency: null,
  subProjectIds: [], clientIds: [], teamIds: [], managerIds: [], trackingAllowedManagerIds: [], memberTimeZones: {},
  userIds: [], viewerIds: [], memberLimitMemberIds: [], memberLimits: [], memberOwnLimits: {}, budgetStopTimers: false,
  budgetType: "", budgetBasedOn: "", budgetScope: "", budgetTotal: "", budgetResets: "", budgetNotifyAt: "",
  budgetWhoToNotify: "", budgetStopTimersAt: "", budgetStartDate: "", budgetIncludeNonBillable: false,
  budgetNotifyMembers: false, memberLimitNotifyAt: "", memberLimitNotifyMembers: false, memberLimitMembers: "",
  budgetSpent: 0, updatedAt: "2026-09-01T00:00:00Z",
}
// A project with no budget row comes back from /edit-state with this placeholder total.
loaded.budgetTotal = "5000"

const base = createLoader({ stubs: signedInStubs })
const formApi = base.load("features/projects/api/project-form-api.ts")
const loader = createLoader({
  stubs: {
    ...signedInStubs,
    "framer-motion": framerMotionStub,
    "@/shared/providers/auth/auth-context": { useAuth: auth },
    "@/shared/providers/app": { useAuth: auth, useTheme: () => ({ isDark: false }) },
    "@/infrastructure/api": {
      fetchProjectForEdit: async () => ({ ...loaded }),
      getProjectTeams: async () => [],
      getProjectFormConfig: formApi.getProjectFormConfig,
    },
  },
})
const { ProjectModal } = loader.load("features/projects/components/modals/project-modal.tsx")

fakeBackend((call) => {
  if (call.path === "/api/projects/form-config") {
    return { body: { success: true, data: { tabs: [], fields: [], options: { clients: [], members: [] } } } }
  }
  return { body: { success: true, data: [] } }
})

async function openEdit() {
  const saves = []
  const view = await mount(
    React.createElement(ProjectModal, {
      projectId: "p-1",
      user: { uid: "u-1" },
      onClose: () => {},
      onSave: async (id, payloads) => {
        saves.push({ id, payloads })
      },
    }),
  )
  await waitFor(() => [...view.container.querySelectorAll("input")].some((i) => i.value === "Website"))
  const save = () => [...view.container.querySelectorAll('button[type="submit"]')].at(-1)
  await waitFor(() => save() && !save().disabled)
  return { view, saves, save }
}

test("a Manager's save keeps the project's time zone in what is sent", async () => {
  role = "Manager"
  const { view, saves, save } = await openEdit()
  await click(save())
  await waitFor(() => saves.length === 1)
  assert.equal(saves[0].id, "p-1")
  assert.equal(saves[0].payloads[0].timezone, "Asia/Tokyo")
  await view.unmount()
})

test("a viewer who may not set a time zone sends none, so the server keeps the saved one", async () => {
  role = "Employee"
  const { view, saves, save } = await openEdit()
  await click(save())
  await waitFor(() => saves.length === 1)
  assert.equal("timezone" in saves[0].payloads[0] && saves[0].payloads[0].timezone !== undefined, false)
  await view.unmount()
  role = "Manager"
})

test("the idle time and break settings explain themselves in the tour", async () => {
  const { view } = await openEdit()
  const helps = [...view.container.querySelectorAll("[data-help]")].map((el) => el.getAttribute("data-help"))
  assert.ok(helps.some((h) => h.startsWith("Disable idle time:")), "idle time")
  assert.ok(helps.some((h) => h.startsWith("Disable break limit:")), "break limit")
  await view.unmount()
})
