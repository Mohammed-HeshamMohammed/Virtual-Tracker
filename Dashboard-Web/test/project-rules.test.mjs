// The Projects table's Management column: the Management tab's switches, read back.
// "Only specific managers can clock in" used to change nothing anyone could see in the table.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildProjectRules,
  describeProjectRules,
  projectRulesWeight,
} from "../features/projects/utils/project-rules.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replaceAll("\r\n", "\n")

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

test("the table is wired to it: column, cell, sort, data", () => {
  assert.match(read("features/projects/constants.tsx"), /key: "management", label: "Management"/)
  const tab = read("features/projects/components/tables/projects-tab.tsx")
  assert.match(tab, /case "management":[\s\S]*ProjectRulesCell/)
  assert.match(tab, /projectRulesWeight/)
  assert.match(read("features/projects/pages/projects-page.tsx"), /rules: buildProjectRules/)
  assert.match(read("features/projects/hooks/use-project-mutations.ts"), /rules: buildProjectRules/)
  const api = read("features/projects/api/project-details-api.ts")
  assert.match(api, /"manager_can_track"/)
  assert.match(api, /"restrict_manager_tracking"/)
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
