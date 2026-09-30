// A member who is tracking is online on the People page even when their tracker's presence
// socket is down - logging hours and reading Offline at the same time was the bug.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const stub = { presence: new Map(), sessions: new Map(), sessionReads: 0 };

mock.module("../src/modules/presence/index.js", {
  namedExports: {
    getPresenceService: () => ({
      getPresence: (id) => stub.presence.get(id) ?? { status: "offline", lastSeenAt: null, lastActivityAt: null, connectionCount: 0 },
      getPresenceMany: async (ids) =>
        new Map(ids.map((id) => [id, stub.presence.get(id) ?? { status: "offline", lastSeenAt: null, lastActivityAt: null, connectionCount: 0 }])),
    }),
  },
});
mock.module("../src/lib/postgres/members-postgres.service.js", {
  namedExports: { getMemberByFirebaseUidPg: async () => null, getMemberByIdPg: async () => null },
});
mock.module("../src/modules/activity/activity-session-status.js", {
  namedExports: {
    buildOpenSessionIndex: async () => {
      stub.sessionReads += 1;
      if (stub.sessions === "throw") throw new Error("db down");
      return stub.sessions;
    },
    // The real rule: ended or stale is offline, otherwise the session's own status.
    effectiveTrackingStatusFromSession: (s) => (s && s.fresh ? s.status : "offline"),
  },
});

const { enrichMembersWithPresenceBatch } = await import("../src/modules/members/services/member-presence.service.js");
const { presenceWithOpenSession } = await import("../src/modules/members/services/presence-status.js");

function reset() {
  stub.presence = new Map();
  stub.sessions = new Map();
  stub.sessionReads = 0;
}
const live = (status) => ({ status, lastSeenAt: 1, lastActivityAt: 1, connectionCount: 1 });
const statusOf = (rows, id) => rows.find((m) => m.id === id).trackingStatus;

test("presenceWithOpenSession: an active session lifts offline to online, an idle one to idle", () => {
  assert.equal(presenceWithOpenSession({ status: "offline" }, "active", "2026-10-01T10:00:00Z").status, "online");
  assert.equal(presenceWithOpenSession(null, "active", "2026-10-01T10:00:00Z").status, "online");
  assert.equal(presenceWithOpenSession({ status: "offline" }, "idle", "2026-10-01T10:00:00Z").status, "idle");
});

test("presenceWithOpenSession: it never lowers a live socket and ignores an ended or stale session", () => {
  const online = live("online");
  assert.equal(presenceWithOpenSession(online, "offline", null), online);
  assert.equal(presenceWithOpenSession(live("idle"), "active", "2026-10-01T10:00:00Z").status, "idle");
  assert.deepEqual(presenceWithOpenSession({ status: "offline" }, "offline", null), { status: "offline" });
  assert.equal(presenceWithOpenSession(null, "offline", null), null);
});

test("a member tracking with no presence socket reads online in the People payload", async () => {
  reset();
  stub.sessions.set("tracking", { status: "active", fresh: true, updated_at: new Date().toISOString() });
  const rows = await enrichMembersWithPresenceBatch(null, [{ id: "tracking" }, { id: "nobody" }]);
  assert.equal(statusOf(rows, "tracking"), "online");
  assert.equal(statusOf(rows, "nobody"), "offline");
});

test("an ended or stale session does not keep someone online", async () => {
  reset();
  stub.sessions.set("stale", { status: "active", fresh: false, updated_at: "2026-09-01T00:00:00Z" });
  const rows = await enrichMembersWithPresenceBatch(null, [{ id: "stale" }]);
  assert.equal(statusOf(rows, "stale"), "offline");
});

test("a live socket is left alone and the sessions are not even read when everyone is connected", async () => {
  reset();
  stub.presence.set("a", live("online"));
  stub.presence.set("b", live("idle"));
  stub.sessions.set("a", { status: "idle", fresh: true, updated_at: new Date().toISOString() });
  const rows = await enrichMembersWithPresenceBatch(null, [{ id: "a" }, { id: "b" }]);
  assert.equal(statusOf(rows, "a"), "online");
  assert.equal(statusOf(rows, "b"), "idle");
  assert.equal(stub.sessionReads, 0);
});

test("if the session read fails the list still returns, by presence alone", async () => {
  reset();
  stub.presence.set("a", live("online"));
  stub.sessions = "throw";
  const rows = await enrichMembersWithPresenceBatch(null, [{ id: "a" }, { id: "b" }]);
  assert.equal(statusOf(rows, "a"), "online");
  assert.equal(statusOf(rows, "b"), "offline");
});
