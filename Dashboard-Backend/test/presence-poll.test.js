// Dashboards behind a web filter that blocks WebSockets poll instead. The event log
// replays what the socket would have pushed, and a polling client counts as an open
// connection until it stops polling.
import test from "node:test";
import assert from "node:assert/strict";
import {
  currentPresenceCursor,
  presenceEventsSince,
  recordPresenceEvent,
  resetPresenceEventLogForTests,
} from "../src/modules/presence/presence-event-log.js";
import { createPollSessions, isValidPollClientId } from "../src/modules/presence/presence-poll-sessions.js";
import { createPresenceManager } from "../src/modules/presence/presence-manager.js";
import { createPresenceService } from "../src/modules/presence/presence-service.js";
import { createMemoryPresenceStore } from "../src/modules/presence/presence-store.js";

test("a poll gets events addressed to it or to everyone, and only ones after its cursor", () => {
  resetPresenceEventLogForTests();
  recordPresenceEvent("m1", { type: "scope-changed", reason: "role" });
  recordPresenceEvent("m2", { type: "scope-changed", reason: "team" });
  recordPresenceEvent("*", { type: "changed", resource: "projects" });

  const first = presenceEventsSince("m1", 0);
  assert.deepEqual(first.events.map((e) => e.type), ["scope-changed", "changed"]);
  assert.equal(first.reset, false);

  const after = presenceEventsSince("m1", first.cursor);
  assert.deepEqual(after.events, []);
  assert.equal(after.cursor, currentPresenceCursor());
});

test("a client that fell behind the retained log is told to refetch", () => {
  resetPresenceEventLogForTests();
  const t0 = 1_000_000;
  recordPresenceEvent("m1", { type: "changed", resource: "tasks" }, t0);
  recordPresenceEvent("m1", { type: "changed", resource: "tasks" }, t0 + 1);
  // Both aged out; the client last saw cursor 0.
  const late = presenceEventsSince("m1", 0, t0 + 6 * 60_000);
  assert.equal(late.reset, true);
  assert.deepEqual(late.events, []);
  // A client that is current is not reset.
  assert.equal(presenceEventsSince("m1", late.cursor, t0 + 6 * 60_000).reset, false);
});

test("a polling client is online while it polls and offline once it stops", () => {
  const presenceService = createPresenceService(createMemoryPresenceStore(), { idleAfterMs: 60_000 });
  const presenceManager = createPresenceManager(presenceService);
  let clock = 0;
  const sessions = createPollSessions({ presenceManager, presenceService, staleMs: 90_000, now: () => clock });

  assert.equal(sessions.touch("m1", "client-aaaaaaaa"), true);
  assert.equal(presenceService.getPresence("m1").status, "online");
  assert.equal(sessions.touch("m1", "client-aaaaaaaa"), false);

  clock = 60_000;
  sessions.touch("m1", "client-aaaaaaaa");
  clock = 120_000;
  sessions.sweep();
  assert.equal(sessions.size(), 1, "still within the stale window of its last poll");

  clock = 200_000;
  sessions.sweep();
  assert.equal(sessions.size(), 0);
  assert.equal(presenceService.getPresence("m1").status, "offline");
});

test("leaving drops the connection immediately", () => {
  const presenceService = createPresenceService(createMemoryPresenceStore(), { idleAfterMs: 60_000 });
  const sessions = createPollSessions({ presenceManager: createPresenceManager(presenceService), presenceService });
  sessions.touch("m1", "client-bbbbbbbb");
  sessions.leave("m1", "client-bbbbbbbb");
  assert.equal(presenceService.getPresence("m1").status, "offline");
});

test("client ids are validated", () => {
  assert.equal(isValidPollClientId("client-aaaaaaaa"), true);
  assert.equal(isValidPollClientId("short"), false);
  assert.equal(isValidPollClientId("has spaces in it!!"), false);
  assert.equal(isValidPollClientId(undefined), false);
});
