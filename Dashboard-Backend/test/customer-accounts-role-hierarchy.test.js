// Enterprise Super Manager / Enterprise Manager (PLAN-customer-accounts-and-
// tenancy.md §16.1): a customer tenant's root holds exactly one of these,
// and it is a GRANT, never an assignable target. These are pure functions
// over the static rank table, so no Postgres mock is needed.
import test from "node:test";
import assert from "node:assert/strict";
import {
  isEnterpriseRole,
  canCreateMembers,
  canAssignRole,
  maxAssignableRank,
  listAssignableRoleNames,
} from "../src/http/role-hierarchy.js";

test("Enterprise roles are recognized, case- and spacing-insensitively", () => {
  assert.equal(isEnterpriseRole("Enterprise Super Manager"), true);
  assert.equal(isEnterpriseRole("enterprise super manager"), true);
  assert.equal(isEnterpriseRole("Enterprise Manager"), true);
  assert.equal(isEnterpriseRole("Manager"), false);
  assert.equal(isEnterpriseRole(""), false);
});

test("a customer root can create members, same as the ordinary ranks it sits beside", () => {
  assert.equal(canCreateMembers("Enterprise Super Manager"), true);
  assert.equal(canCreateMembers("Enterprise Manager"), true);
});

test("Enterprise Super Manager's ceiling is Manager and below - ordinary roles only", () => {
  assert.equal(maxAssignableRank("Enterprise Super Manager"), 60); // Manager's rank
  assert.equal(canAssignRole("Enterprise Super Manager", "Manager"), true);
  assert.equal(canAssignRole("Enterprise Super Manager", "Team Lead"), true);
  assert.equal(canAssignRole("Enterprise Super Manager", "Employee"), true);
});

test("Enterprise Manager's ceiling is Team Lead and below", () => {
  assert.equal(maxAssignableRank("Enterprise Manager"), 50); // Team Lead's rank
  assert.equal(canAssignRole("Enterprise Manager", "Team Lead"), true);
  assert.equal(canAssignRole("Enterprise Manager", "Manager"), false);
});

test("neither Enterprise role can ever reach Admin or above", () => {
  assert.equal(canAssignRole("Enterprise Super Manager", "Admin"), false);
  assert.equal(canAssignRole("Enterprise Super Manager", "Super Admin"), false);
  assert.equal(canAssignRole("Enterprise Manager", "Admin"), false);
  assert.equal(canAssignRole("Enterprise Manager", "Super Admin"), false);
});

test("Enterprise roles can never be an assignment target, from anyone, including Owner", () => {
  assert.equal(canAssignRole("Owner", "Enterprise Super Manager"), false);
  assert.equal(canAssignRole("Owner", "Enterprise Manager"), false);
  assert.equal(canAssignRole("Super Admin", "Enterprise Super Manager"), false);
  assert.equal(canAssignRole("Enterprise Super Manager", "Enterprise Manager"), false);
  assert.equal(canAssignRole("Enterprise Super Manager", "Enterprise Super Manager"), false);
});

test("Enterprise roles never appear in the ordinary assignable-roles dropdown", () => {
  const names = listAssignableRoleNames("Owner");
  assert.equal(names.includes("Enterprise Super Manager"), false);
  assert.equal(names.includes("Enterprise Manager"), false);
});

test("a customer root's assignable list is the ordinary ladder, never Enterprise roles or Admin+", () => {
  const superManagerRoot = listAssignableRoleNames("Enterprise Super Manager");
  assert.deepEqual(superManagerRoot, ["Manager", "Team Lead", "Employee", "Intern", "Client", "Viewer"]);

  const managerRoot = listAssignableRoleNames("Enterprise Manager");
  assert.deepEqual(managerRoot, ["Team Lead", "Employee", "Intern", "Client", "Viewer"]);
});
