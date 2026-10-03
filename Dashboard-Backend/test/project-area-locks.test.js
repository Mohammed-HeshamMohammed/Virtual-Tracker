// The project modal's Management tab: who may change an area, enforced server-side.
import test from "node:test";
import assert from "node:assert/strict";
import {
  canManageProjectRules,
  isProjectAreaLocked,
  projectAreaLockedMessage,
  readProjectRuleFields,
} from "../src/modules/projects/project-area-locks.js";

const locked = {
  managers_can_edit_budget: false,
  managers_can_edit_member_limits: false,
  managers_can_edit_members: false,
};
const open = { managers_can_edit_budget: true, managers_can_edit_member_limits: true, managers_can_edit_members: true };

test("the people who see the Management tab can always change everything", () => {
  for (const role of ["Owner", "Super Admin", "Admin", "Super Manager"]) {
    assert.equal(canManageProjectRules(role), true, role);
    for (const area of ["budget", "memberLimits", "members"]) {
      assert.equal(isProjectAreaLocked(locked, area, role), false, `${role} ${area}`);
    }
  }
});

test("a plain manager is kept out of exactly the areas that are locked", () => {
  assert.equal(canManageProjectRules("Manager"), false);
  assert.equal(isProjectAreaLocked(locked, "budget", "Manager"), true);
  assert.equal(isProjectAreaLocked(locked, "memberLimits", "Manager"), true);
  assert.equal(isProjectAreaLocked(locked, "members", "Manager"), true);
  assert.equal(isProjectAreaLocked({ ...open, managers_can_edit_budget: false }, "members", "Manager"), false);
  assert.equal(isProjectAreaLocked({ ...open, managers_can_edit_budget: false }, "budget", "Manager"), true);
});

test("nothing is locked on a project that predates the switches", () => {
  for (const area of ["budget", "memberLimits", "members"]) {
    assert.equal(isProjectAreaLocked({}, area, "Manager"), false);
    assert.equal(isProjectAreaLocked(null, area, "Manager"), false);
  }
});

test("each area explains itself", () => {
  assert.match(projectAreaLockedMessage("budget"), /budget/);
  assert.match(projectAreaLockedMessage("memberLimits"), /member limits/);
  assert.match(projectAreaLockedMessage("members"), /members and teams/);
});

test("rule fields are read in either casing, and absent ones stay absent", () => {
  assert.deepEqual(readProjectRuleFields({}), {});
  assert.deepEqual(readProjectRuleFields({ budget_enabled: false, managersCanEditMembers: true }), {
    budgetEnabled: false,
    managersCanEditMembers: true,
  });
  assert.deepEqual(readProjectRuleFields({ memberLimitsEnabled: null }), {});
});
