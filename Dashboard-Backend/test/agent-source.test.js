// The desktop agent says which app it is ("tauri" today). Everything that
// wasn't "python" used to be stored as "electron", so the only agent in use
// was recorded as one that no longer exists.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const inserts = [];

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      if (/INSERT INTO agent_link_sessions/.test(sql)) inserts.push(params);
      return [];
    },
  },
});
mock.module("../src/modules/activity/agent-devices.service.js", {
  namedExports: {
    newDeviceId: () => "device-1",
    registerAgentDevice: async () => ({ device_id: "device-1" }),
  },
});

const { normalizeAgentSource, createAgentLinkSession } = await import(
  "../src/modules/activity/agent-link-sessions.js"
);

test("the Tauri agent is recorded as tauri, not electron", () => {
  assert.equal(normalizeAgentSource("tauri"), "tauri");
});

test("the other agents keep their own names", () => {
  assert.equal(normalizeAgentSource("python"), "python");
  assert.equal(normalizeAgentSource("electron"), "electron");
});

test("case and padding don't matter", () => {
  assert.equal(normalizeAgentSource("  TAURI "), "tauri");
});

// The Tauri agent is the one talking to this API, so a missing or unknown
// value is it - and only values the column's CHECK allows are ever stored.
test("a missing or unknown source is the Tauri agent", () => {
  for (const value of [undefined, null, "", "web", "something-else"]) {
    assert.equal(normalizeAgentSource(value), "tauri", String(value));
  }
});

test("a new link session stores the source the agent sent", async () => {
  inserts.length = 0;
  await createAgentLinkSession({ agentSource: "tauri" });
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][2], "tauri");
});
