// Guards which roles get the task-less tracking carve-out.
//
// Owner / Super Admin / Admin can already start a timer on any task in any
// project (isProjectMemberForTimer short-circuits for them), but tasks are
// only ever assigned *to* people and nobody assigns tasks to the owner - so
// on a normal require_task_to_track project they had no task to select and
// the agent's Start button stayed disabled. Both the GET /api/projects
// override and the session-start gate key off isAdminLevelRole, so this
// pins down exactly which roles that is.
//
// No mock.module here on purpose: role-hierarchy.js reaches a wide
// transitive chain, and stubbing it partially is what made this awkward to
// assert from the client_can_track suite.
import test from "node:test";
import assert from "node:assert/strict";
import { isAdminLevelRole } from "../src/http/role-hierarchy.js";

test("Owner, Super Admin and Admin get the carve-out, in display or normalized form", () => {
  for (const role of ["Owner", "Super Admin", "Admin", "owner", "superadmin", "admin", "SUPER ADMIN"]) {
    assert.equal(isAdminLevelRole(role), true, `${role} should be admin-level`);
  }
});

test("Super Manager is deliberately excluded, despite also seeing every project", () => {
  // Super Manager sits in ORG_PROJECT_TASK_ADMIN_ROLES too, so
  // getViewerProjectIds returns null for it as well - which makes it the
  // easy thing to sweep in by reaching for that wider set. Keeping the task
  // requirement for that tier was an explicit product decision, so this
  // asserts the narrower isAdminLevelRole is what the carve-out uses.
  assert.equal(isAdminLevelRole("Super Manager"), false);
  assert.equal(isAdminLevelRole("supermanager"), false);
  // Legacy misspelling normalizeRoleKey folds onto supermanager - it must
  // not slip through a spelling crack either.
  assert.equal(isAdminLevelRole("Super Manger"), false);
});

test("no other role gets the carve-out", () => {
  for (const role of ["Manager", "Team Lead", "Employee", "Intern", "Client", "Viewer", "", "  "]) {
    assert.equal(isAdminLevelRole(role), false, `"${role}" must not be admin-level`);
  }
});

test("a null/undefined role is not admin-level", () => {
  assert.equal(isAdminLevelRole(undefined), false);
  assert.equal(isAdminLevelRole(null), false);
});
