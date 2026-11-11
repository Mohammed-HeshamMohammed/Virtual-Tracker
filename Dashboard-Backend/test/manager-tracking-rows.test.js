// The manager allow-list could only ever hold rows whose project role is manager, yet it was
// applied to every organization manager - so one added to a restricted project as an ordinary
// member was refused with no way to be allowed.
import test from "node:test";
import assert from "node:assert/strict";

const { managerRowsAllowTracking } = await import("../src/lib/postgres/projects-postgres.service.js");

test("a project manager tracks only when on the allow-list", () => {
  assert.equal(managerRowsAllowTracking([{ role: "manager", manager_can_track: true }]), true);
  assert.equal(managerRowsAllowTracking([{ role: "manager", manager_can_track: false }]), false);
});

test("an organization manager on the project as an ordinary member is not narrowed by the list", () => {
  assert.equal(managerRowsAllowTracking([{ role: "user", manager_can_track: false }]), true);
});

test("a viewer, or someone not on the project, cannot track", () => {
  assert.equal(managerRowsAllowTracking([{ role: "viewer", manager_can_track: false }]), false);
  assert.equal(managerRowsAllowTracking([]), false);
});
