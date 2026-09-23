// Which agents are frozen (PLAN-notifications-and-owner-messaging.md C3).
//
// Landing-Backend refuses to serve an update to an agent below the threshold,
// because the copy on the machine is what performs the update and, before the
// fix, it exited the process before the installer ran. Those machines stay on
// their version forever. This flag is what turns that silent freeze into a
// list an admin can act on - without it, nobody can tell why those agents
// never move.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let minSelfUpdateVersion = "1.0.27";

mock.module("../src/config/env.js", {
  namedExports: {
    getEnv: () => ({ agent: { inboxMinVersion: "1.0.24", minSelfUpdateVersion } }),
  },
});
mock.module("../src/lib/postgres/client.js", { namedExports: { query: async () => [] } });

const { needsManualReinstall } = await import("../src/modules/agent-versions/service.js");

test("agents below the self-update floor are flagged", () => {
  for (const version of ["1.0.0", "1.0.22", "1.0.25", "1.0.26"]) {
    assert.equal(needsManualReinstall(version), true, `${version} is frozen and must be flagged`);
  }
});

test("agents at or above it are not", () => {
  for (const version of ["1.0.27", "1.0.28", "1.1.0", "2.0.0"]) {
    assert.equal(needsManualReinstall(version), false, `${version} updates itself normally`);
  }
});

test("an unknown version claims nothing", () => {
  // A member who has never opened the tracker has no version. Calling that
  // "needs reinstall" would send an admin chasing a machine that may not
  // even have the agent yet.
  for (const version of ["", null, undefined, "not-a-version"]) {
    assert.equal(needsManualReinstall(version), false, `${String(version)} must not be flagged`);
  }
});

test("the floor follows the env var, so it can move with Landing-Backend's", () => {
  minSelfUpdateVersion = "1.1.0";
  assert.equal(needsManualReinstall("1.0.30"), true, "raising the floor widens the frozen set");
  assert.equal(needsManualReinstall("1.1.0"), false);
  minSelfUpdateVersion = "1.0.27";
});
