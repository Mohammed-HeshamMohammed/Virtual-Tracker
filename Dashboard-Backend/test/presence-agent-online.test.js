// An open tracker is "online" on the People page whether or not a session is running.
// The agent holds the presence WebSocket (Bearer header, no cookie) and pings it; that
// connection alone - no activity session anywhere - has to flip the member to online,
// survive on pings, and go offline when the agent closes.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { attachPresenceGateway } from "../src/modules/presence/presence-gateway.js";
import { createPresenceManager } from "../src/modules/presence/presence-manager.js";
import { createPresenceService } from "../src/modules/presence/presence-service.js";
import { createMemoryPresenceStore } from "../src/modules/presence/presence-store.js";
import { flattenPresenceForApi } from "../src/modules/members/services/presence-status.js";

const MEMBER_ID = "member-1";

async function startGateway() {
  const store = createMemoryPresenceStore();
  const presenceService = createPresenceService(store, { idleAfterMs: 60_000 });
  const presenceManager = createPresenceManager(presenceService);
  const server = http.createServer();
  attachPresenceGateway(server, {
    presenceService,
    presenceManager,
    heartbeatStaleMs: 120_000,
    verifyIdToken: async (token) => {
      if (token !== "good-token") throw new Error("bad token");
      return { uid: "uid-1" };
    },
    verifySessionCookie: async () => {
      throw new Error("no cookie");
    },
    resolveMemberId: async (uid) => (uid === "uid-1" ? MEMBER_ID : ""),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { presenceService, server, url: `ws://127.0.0.1:${port}/api/presence/ws` };
}

function connectAsAgent(url, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    const timer = setTimeout(() => reject(new Error("no hello")), 3000);
    ws.on("message", (raw) => {
      if (JSON.parse(String(raw)).type === "hello") {
        clearTimeout(timer);
        resolve(ws);
      }
    });
    ws.on("close", (code) => {
      clearTimeout(timer);
      reject(new Error(`closed ${code}`));
    });
  });
}

const untilClosed = (ws) => new Promise((resolve) => ws.once("close", resolve));
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

test("an agent connection alone marks the member online on the People page, with no session running", async () => {
  const { presenceService, server, url } = await startGateway();
  try {
    assert.equal(flattenPresenceForApi({}, presenceService.getPresence(MEMBER_ID)).trackingStatus, "offline");

    const agent = await connectAsAgent(url, "good-token");
    const row = flattenPresenceForApi({}, presenceService.getPresence(MEMBER_ID));
    assert.equal(row.trackingStatus, "online", "connected agent reads online in the People row payload");

    agent.send(JSON.stringify({ type: "ping" }));
    await tick();
    assert.equal(presenceService.getPresence(MEMBER_ID).status, "online", "a ping keeps it online");

    const closed = untilClosed(agent);
    agent.close();
    await closed;
    await tick();
    assert.equal(presenceService.getPresence(MEMBER_ID).status, "offline", "closing the agent takes the member offline");
  } finally {
    server.close();
  }
});

test("an expired or invalid token is refused - the agent must present a fresh one", async () => {
  const { presenceService, server, url } = await startGateway();
  try {
    await assert.rejects(connectAsAgent(url, "expired-token"), /closed 4401/);
    assert.equal(presenceService.getPresence(MEMBER_ID).status, "offline");
  } finally {
    server.close();
  }
});

test("a web dashboard tab and the agent together: closing one keeps the member online", async () => {
  const { presenceService, server, url } = await startGateway();
  try {
    const agent = await connectAsAgent(url, "good-token");
    const other = await connectAsAgent(url, "good-token");
    assert.equal(presenceService.getPresence(MEMBER_ID).connectionCount, 2);

    const closed = untilClosed(other);
    other.close();
    await closed;
    await tick();
    assert.equal(presenceService.getPresence(MEMBER_ID).status, "online");

    const agentClosed = untilClosed(agent);
    agent.close();
    await agentClosed;
    await tick();
    assert.equal(presenceService.getPresence(MEMBER_ID).status, "offline");
  } finally {
    server.close();
  }
});
