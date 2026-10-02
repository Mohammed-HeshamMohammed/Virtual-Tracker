// Budget and member limits count who can clock in, as the Management tab decides it.
import test from "node:test"
import assert from "node:assert/strict"
import { nonTrackerIds, projectTrackerIds, trackingManagerIds } from "../features/projects/utils/project-trackers.ts"

const BASE = {
  managers: ["m1", "m2"],
  users: ["u1", "u2"],
  viewers: ["v1"],
  allowProjectTracking: true,
  restrictManagerTracking: false,
  trackingAllowedManagerIds: [],
}

test("by default every manager and user can clock in, viewers cannot", () => {
  assert.deepEqual(projectTrackerIds(BASE).sort(), ["m1", "m2", "u1", "u2"])
  assert.deepEqual(nonTrackerIds(BASE), ["v1"])
})

test("turning off manager clock-in leaves only users", () => {
  const rules = { ...BASE, allowProjectTracking: false }
  assert.deepEqual(trackingManagerIds(rules), [])
  assert.deepEqual(projectTrackerIds(rules).sort(), ["u1", "u2"])
  assert.deepEqual(nonTrackerIds(rules).sort(), ["m1", "m2", "v1"])
})

test("'only specific managers' keeps just the ticked ones", () => {
  const rules = { ...BASE, restrictManagerTracking: true, trackingAllowedManagerIds: ["m2"] }
  assert.deepEqual(trackingManagerIds(rules), ["m2"])
  assert.deepEqual(projectTrackerIds(rules).sort(), ["m2", "u1", "u2"])
  assert.deepEqual(nonTrackerIds(rules).sort(), ["m1", "v1"])
})

test("a restricted list with nobody ticked means no manager tracks", () => {
  const rules = { ...BASE, restrictManagerTracking: true, trackingAllowedManagerIds: [] }
  assert.deepEqual(trackingManagerIds(rules), [])
})

test("a ticked id that is no longer a manager is ignored, and duplicates collapse", () => {
  const rules = { ...BASE, managers: ["m1", "m1"], restrictManagerTracking: true, trackingAllowedManagerIds: ["m1", "gone"] }
  assert.deepEqual(trackingManagerIds(rules), ["m1"])
})

test("the allow-list is ignored while manager clock-in is off", () => {
  const rules = { ...BASE, allowProjectTracking: false, restrictManagerTracking: true, trackingAllowedManagerIds: ["m1"] }
  assert.deepEqual(trackingManagerIds(rules), [])
})
