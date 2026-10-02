// A per-person budget counts the people who can clock in, as the project's Management rules decide it.
import test from "node:test";
import assert from "node:assert/strict";
import { isProjectTrackerRow } from "../src/modules/projects/project-trackers.js";

const open = { allow_project_tracking: true, restrict_manager_tracking: false };

test("viewers never count", () => {
  assert.equal(isProjectTrackerRow({ ...open, project_role: "viewer" }), false);
  assert.equal(isProjectTrackerRow({ ...open, project_role: "Viewer" }), false);
});

test("users and rows with no role always count", () => {
  assert.equal(isProjectTrackerRow({ ...open, project_role: "user" }), true);
  assert.equal(isProjectTrackerRow({ ...open, project_role: null }), true);
  assert.equal(isProjectTrackerRow({ project_role: "user", allow_project_tracking: false }), true);
});

test("managers count unless the project keeps them from clocking in", () => {
  assert.equal(isProjectTrackerRow({ ...open, project_role: "manager" }), true);
  assert.equal(isProjectTrackerRow({ project_role: "manager", allow_project_tracking: false, restrict_manager_tracking: false }), false);
});

test("with 'only specific managers' on, only ticked managers count", () => {
  const restricted = { allow_project_tracking: true, restrict_manager_tracking: true, project_role: "manager" };
  assert.equal(isProjectTrackerRow({ ...restricted, manager_can_track: true }), true);
  assert.equal(isProjectTrackerRow({ ...restricted, manager_can_track: false }), false);
  assert.equal(isProjectTrackerRow({ ...restricted }), false);
});
