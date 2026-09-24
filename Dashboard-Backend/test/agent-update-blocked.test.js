// An agent that cannot write to its own install directory downloads every
// update and installs none, while continuing to report a current version on
// every open. Before this was recorded it was indistinguishable from a
// healthy agent - the version column said 1.0.27 either way.
//
// The distinction that matters here is false vs null: "checked, and it can
// install" against "too old to have been asked". Collapsing them would mark
// every pre-1.0.28 agent as fine for a reason nobody had checked.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let captured = null;

mock.module("../src/config/env.js", {
  namedExports: {
    getEnv: () => ({ agent: { inboxMinVersion: "1.0.24", minSelfUpdateVersion: "1.0.27" } }),
  },
});
mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      captured = { sql, params };
      return sql.includes("UPDATE members") ? [{ id: "m1" }] : [];
    },
  },
});

const { reportAgentOpen, listAgentVersionMembers } = await import("../src/modules/agent-versions/service.js");

test("a blocked agent stores true", async () => {
  const result = await reportAgentOpen("m1", "1.0.28", "windows", true, "C:\\Program Files\\My Virtual Tracker");
  assert.equal(result.updateBlocked, true);
  assert.equal(captured.params[3], true);
  assert.equal(captured.params[4], "C:\\Program Files\\My Virtual Tracker");
});

test("an agent that can install stores false, not null", async () => {
  const result = await reportAgentOpen("m1", "1.0.28", "windows", false, "C:\\Program Files\\My Virtual Tracker");
  assert.equal(result.updateBlocked, false);
  assert.equal(captured.params[3], false);
});

test("an agent too old to report the field stores null rather than false", async () => {
  // The whole point of the tri-state. A pre-1.0.28 agent sends no field at
  // all, and recording that as "not blocked" would be a claim nobody made.
  const result = await reportAgentOpen("m1", "1.0.27", "windows", undefined, undefined);
  assert.equal(result.updateBlocked, null);
  assert.equal(captured.params[3], null);
});

test("a junk value is treated as no answer, not as a truthy one", async () => {
  await reportAgentOpen("m1", "1.0.28", "windows", "yes", 42);
  assert.equal(captured.params[3], null, "only a real boolean counts");
  assert.equal(captured.params[4], null, "only a real string counts as a path");
});

test("an absent install dir never overwrites a known one", async () => {
  // COALESCE, so an older agent checking in after a newer one does not erase
  // the directory the newer one reported.
  await reportAgentOpen("m1", "1.0.27", "windows", undefined, undefined);
  assert.match(captured.sql, /agent_install_dir = COALESCE\(\$5, agent_install_dir\)/);
});

test("an over-long install path is truncated rather than rejected", async () => {
  // The path comes from a machine the server does not control; storing it is
  // a convenience, so it is bounded rather than allowed to fail the check-in.
  await reportAgentOpen("m1", "1.0.28", "windows", true, "C:\\" + "a".repeat(900));
  assert.equal(captured.params[4].length, 512);
});

test("a bad version is still rejected before anything is written", async () => {
  captured = null;
  const result = await reportAgentOpen("m1", "1.0", "windows", true, "C:\\x");
  assert.ok(result.error, "an unparseable version must not reach the database");
  assert.equal(captured, null);
});

test("the list query selects and exposes the blocked state", async () => {
  mock.restoreAll();
  const rows = [
    { id: "a", display_name: "A", agent_version: "1.0.28", agent_update_blocked: true, agent_install_dir: "C:\\PF\\VT" },
    { id: "b", display_name: "B", agent_version: "1.0.28", agent_update_blocked: false, agent_install_dir: null },
    { id: "c", display_name: "C", agent_version: "1.0.27", agent_update_blocked: null, agent_install_dir: null },
  ];
  mock.module("../src/lib/postgres/client.js", { namedExports: { query: async () => rows } });
  const fresh = await import(`../src/modules/agent-versions/service.js?t=${Date.now()}`);
  const listed = await fresh.listAgentVersionMembers("1.0.28");

  assert.equal(listed[0].updateBlocked, true);
  assert.equal(listed[0].agentInstallDir, "C:\\PF\\VT");
  assert.equal(listed[1].updateBlocked, false);
  assert.equal(listed[2].updateBlocked, null, "an unreported agent stays unknown");
});

test("listAgentVersionMembers is exported", () => {
  assert.equal(typeof listAgentVersionMembers, "function");
});
