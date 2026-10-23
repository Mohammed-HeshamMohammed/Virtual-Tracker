// The Projects table's Management column: the Management tab's switches, read back.
// "Only specific managers can clock in" used to change nothing anyone could see in the table.
import test, { after } from "node:test"
import assert from "node:assert/strict"
import {
  buildProjectRules,
  describeProjectRules,
  projectRulesWeight,
} from "../features/projects/utils/project-rules.ts"
import { installDom, createLoader, framerMotionStub, mount, click, React, signedInStubs, fakeBackend } from "./helpers/render.mjs"


const DEFAULTS = {
  allowProjectTracking: true,
  restrictManagerTracking: false,
  managerIds: ["m1", "m2", "m3"],
  trackingAllowedManagerIds: [],
  requireTaskToTrack: true,
  restrictTaskCreation: false,
  requireStopNote: false,
  clientCanManage: false,
  clientCanTrack: false,
}
const chips = (overrides, hasTasks = true) =>
  describeProjectRules(buildProjectRules({ ...DEFAULTS, ...overrides }), { hasTasks })
const labels = (overrides, hasTasks) => chips(overrides, hasTasks).map((c) => c.label)

test("an open project says every manager can clock in", () => {
  assert.deepEqual(labels({}), ["All managers can clock in", "Task required"])
})

test("'Only specific managers can clock in' shows how many of the managers are named", () => {
  const out = chips({ restrictManagerTracking: true, trackingAllowedManagerIds: ["m1", "m3"] })
  assert.equal(out[0].label, "2 of 3 managers can clock in")
  assert.equal(out[0].tone, "info")
})

test("a lone manager reads singular, and an empty allow-list is a warning", () => {
  assert.equal(
    chips({ managerIds: ["m1"], restrictManagerTracking: true, trackingAllowedManagerIds: ["m1"] })[0].label,
    "1 of 1 manager can clock in",
  )
  const none = chips({ restrictManagerTracking: true, trackingAllowedManagerIds: [] })[0]
  assert.equal(none.label, "No manager can clock in")
  assert.equal(none.tone, "warn")
})

test("names in the allow-list who are no longer managers on the project are not counted", () => {
  const out = chips({ restrictManagerTracking: true, trackingAllowedManagerIds: ["m1", "gone"] })
  assert.equal(out[0].label, "1 of 3 managers can clock in")
})

test("turning tracking off for managers overrides the allow-list", () => {
  const out = chips({ allowProjectTracking: false, restrictManagerTracking: true, trackingAllowedManagerIds: ["m1"] })
  assert.equal(out[0].label, "Managers can't clock in")
  assert.equal(out[0].tone, "warn")
  assert.equal(out.filter((c) => c.key === "clock-in").length, 1)
})

test("a project with no managers says nothing about manager clock-in unless it is switched off", () => {
  assert.equal(chips({ managerIds: [] }).some((c) => c.key === "clock-in"), false)
  assert.equal(chips({ managerIds: [], allowProjectTracking: false })[0].label, "Managers can't clock in")
})

test("task rules only apply to projects that have tasks", () => {
  assert.equal(chips({}, false).some((c) => c.key === "task" || c.key === "task-create"), false)
  assert.equal(labels({ requireTaskToTrack: false }).includes("No task needed"), true)
  assert.equal(labels({ restrictTaskCreation: true }).includes("Managers create tasks"), true)
})

test("stop note and the two client switches each get a chip", () => {
  const out = labels({ requireStopNote: true, clientCanManage: true, clientCanTrack: true })
  assert.ok(out.includes("Stop note"))
  assert.ok(out.includes("Client manages"))
  assert.ok(out.includes("Client clocks in"))
})

test("every chip explains itself", () => {
  for (const chip of chips({ requireStopNote: true, clientCanManage: true, restrictTaskCreation: true })) {
    assert.ok(chip.detail.length > 10, chip.key)
  }
})

test("sort weight puts locked-out projects above rule-heavy ones above open ones", () => {
  const w = (o, t = true) => projectRulesWeight(buildProjectRules({ ...DEFAULTS, ...o }), t)
  assert.ok(w({ allowProjectTracking: false }) > w({ requireStopNote: true, clientCanManage: true }))
  assert.ok(w({ requireStopNote: true }) > w({}))
  assert.equal(projectRulesWeight(undefined, true), -1, "a row without rules sorts last")
})


// The Management tab's own switches, as the Projects table shows them.
test("a switched-off budget or member limits shows as such, and locked parts are named", () => {
  assert.deepEqual(labels({ budgetEnabled: false }).filter((l) => l === "No budget"), ["No budget"])
  assert.ok(labels({ memberLimitsEnabled: false }).includes("No member limits"))
  assert.ok(labels({ managersCanEditBudget: false, managersCanEditMembers: false }).includes("Locked: budget, members"))
  // A locked budget that is also switched off is just "No budget" - there is nothing to lock.
  const offAndLocked = labels({ budgetEnabled: false, managersCanEditBudget: false })
  assert.ok(offAndLocked.includes("No budget"))
  assert.ok(!offAndLocked.some((l) => l.startsWith("Locked")))
})

test("projects that predate the switches show none of these chips", () => {
  const plain = labels({})
  assert.ok(!plain.some((l) => l === "No budget" || l === "No member limits" || l.startsWith("Locked")))
})

// ── wired into the Projects table ──────────────────────────────────────────

const env = installDom()
after(() => env.restore())
// A desktop-wide table, so no column is auto-hidden for lack of room (jsdom reports width 0).
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1600 })
const loader = createLoader({ stubs: { ...signedInStubs, "framer-motion": framerMotionStub } })
const { fetchEnrichedProjects } = loader.load("features/projects/api/project-details-api.ts")
const { ProjectsTab } = loader.load("features/projects/components/tables/projects-tab.tsx")
const { ALL_PROJECT_COLS, DEFAULT_ENABLED_PROJECT_COLS } = loader.load("features/projects/constants.tsx")

test("the list loader brings back what the rules are built from: the switches and who of the managers may clock in", async () => {
  fakeBackend((call) => {
    if (call.path === "/api/projects") {
      assert.ok(call.query.fields.split(",").includes("restrict_manager_tracking"))
      return { body: { success: true, data: [{ id: "p-1", name: "Website", status: "active", type: "normal", restrict_manager_tracking: true, require_stop_note: true }] } }
    }
    if (call.path === "/api/project-members") {
      assert.ok(call.query.fields.split(",").includes("manager_can_track"))
      return {
        body: {
          success: true,
          data: [
            { id: "pm-1", project_id: "p-1", member_id: "m1", project_role: "manager", manager_can_track: true },
            { id: "pm-2", project_id: "p-1", member_id: "m2", project_role: "manager", manager_can_track: false },
            { id: "pm-3", project_id: "p-1", member_id: "u1", project_role: "user" },
          ],
        },
      }
    }
    return { body: { success: true, data: [] } }
  })
  const { projects, context } = await fetchEnrichedProjects()
  const p = projects[0]
  const managers = context.managersByProject.get("p-1")
  assert.deepEqual(managers, { managerIds: ["m1", "m2"], allowedIds: ["m1"] })
  const rules = buildProjectRules({
    ...DEFAULTS,
    restrictManagerTracking: p.restrictManagerTracking,
    requireStopNote: p.requireStopNote,
    managerIds: managers.managerIds,
    trackingAllowedManagerIds: managers.allowedIds,
  })
  assert.ok(describeProjectRules(rules, { hasTasks: true }).some((c) => /1 of 2/.test(c.label)), "one of the two managers is named")
})

const item = (id, name, rules) => ({
  id, name, type: "normal", color: "#6366f1", status: "active", teams: [], members: 0, memberLimit: null,
  budget: null, memberIds: [], rules, tasksDone: 0, tasksTotal: 0,
})
const open = buildProjectRules({ ...DEFAULTS, requireTaskToTrack: false })
const ruled = buildProjectRules({ ...DEFAULTS, requireStopNote: true, clientCanTrack: true })
const locked = buildProjectRules({ ...DEFAULTS, allowProjectTracking: false })

async function table(props = {}) {
  const sorts = []
  const view = await mount(
    React.createElement(ProjectsTab, {
      projects: [item("a", "Open", open), item("b", "Ruled", ruled), item("c", "Locked", locked)],
      search: "", enabledCols: new Set(["management"]), selected: new Set(), setSelected: () => {},
      sortCol: null, sortDir: "desc", onSort: (col) => sorts.push(col), colOrder: ["management"], draggedCol: null,
      onDragStart: () => {}, onDragOver: () => {}, onDrop: () => {}, onDragEnd: () => {},
      onEdit: () => {}, onArchive: () => {}, onDelete: () => {}, ...props,
    }),
  )
  const names = () => [...view.container.querySelectorAll("tbody tr")].map((tr) => ["Open", "Ruled", "Locked"].find((n) => tr.textContent.includes(n)))
  return { view, sorts, names }
}

test("the Management column shows each project's rules, and its header sorts by them", async () => {
  assert.ok(ALL_PROJECT_COLS.some((c) => c.key === "management" && c.label === "Management"))
  assert.ok(DEFAULT_ENABLED_PROJECT_COLS.has("management"), "shown unless switched off")
  const { view, sorts } = await table()
  const header = [...view.container.querySelectorAll("th")].find((th) => th.textContent.includes("Management"))
  assert.ok(header, "the column is there")
  const ruledRow = [...view.container.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes("Ruled"))
  for (const chip of describeProjectRules(ruled, { hasTasks: true }).slice(0, 2)) {
    assert.ok(ruledRow.textContent.includes(chip.label), chip.label)
  }
  await click(header.querySelector("[class*='cursor'], button, span") ?? header)
  assert.deepEqual(sorts, ["management"])
  await view.unmount()
})

test("sorting by Management puts locked-out projects first, then rule-heavy ones, then open ones", async () => {
  const { view, names } = await table({ sortCol: "management", sortDir: "desc" })
  assert.deepEqual(names(), ["Locked", "Ruled", "Open"])
  await view.unmount()
})
