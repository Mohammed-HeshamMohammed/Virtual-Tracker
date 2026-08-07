import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { logSafeWarn } from "../../http/sanitize-error.js";

const WS_PATH = "/api/presence/ws";

/** @type {Map<string, Set<import("ws").WebSocket>>} */
const connectionsByMember = new Map();

/**
 * Push WS message to all connections for a member (e.g. remote sign-out).
 * @param {string} memberId
 * @param {Record<string, unknown>} message
 */
export function sendToMember(memberId, message) {
  const sockets = connectionsByMember.get(memberId);
  if (!sockets || sockets.size === 0) return;
  const payload = JSON.stringify(message);
  for (const ws of sockets) {
    try {
      ws.send(payload);
    } catch {
      /* ignore — connection will be cleaned up on close */
    }
  }
}

/**
 * Push a frame to every connected socket, regardless of member. Live-sync
 * "something changed" broadcasts only (PLAN-livesyncandagenttimer.md §3) —
 * signals, never row data, so there is deliberately no per-member filtering
 * here. A send failure on one socket must never stop the rest; it will be
 * cleaned up on its own "close" handler.
 * @param {Record<string, unknown>} message
 */
export function broadcastToAll(message) {
  const payload = JSON.stringify(message);
  for (const sockets of connectionsByMember.values()) {
    for (const ws of sockets) {
      try {
        ws.send(payload);
      } catch {
        /* ignore — connection will be cleaned up on close */
      }
    }
  }
}

/** Auth WS gateway for ephemeral presence. */
export function attachPresenceGateway(httpServer, deps) {
  const wss = new WebSocketServer({ noServer: true });
  const heartbeatStaleMs = deps.heartbeatStaleMs ?? 120_000;

  httpServer.on("upgrade", (req, socket, head) => {
    try {
      const host = req.headers.host ?? "localhost";
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname !== WS_PATH) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, url);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", (ws, _req, url) => {
    /** @type {string | null} */
    let memberId = null;
    const connectionId = randomUUID();
    /** @type {ReturnType<typeof setTimeout> | null} */
    let heartbeatTimer = null;
    let closed = false;

    async function authenticate() {
      const token = url.searchParams.get("token")?.trim();
      if (!token) throw new Error("missing_token");
      const decoded = await deps.verifyIdToken(token);
      memberId = await deps.resolveMemberId(decoded.uid);
      if (!memberId) throw new Error("member_not_found");
    }

    function resetHeartbeatWatch() {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        try {
          ws.close(4408, "heartbeat_timeout");
        } catch {
          /* ignore */
        }
      }, heartbeatStaleMs);
      if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
    }

    function notifyChange() {
      if (memberId) deps.onPresenceChange?.(memberId);
    }

    void (async () => {
      try {
        await authenticate();
      } catch (err) {
        logSafeWarn("[presence/ws] auth failed", err);
        ws.close(4401, "Unauthorized");
        return;
      }

      console.info("[presence/ws] connected — memberId=%s connId=%s", memberId, connectionId.slice(0, 8));
      deps.presenceManager.onConnect(memberId, connectionId);
      if (!connectionsByMember.has(memberId)) connectionsByMember.set(memberId, new Set());
      connectionsByMember.get(memberId).add(ws);
      notifyChange();

      const snapshot = deps.presenceService.getPresence(memberId);
      ws.send(
        JSON.stringify({
          type: "hello",
          status: snapshot.status,
          memberId,
        }),
      );

      resetHeartbeatWatch();

      ws.on("message", (data) => {
        if (!memberId) return;
        let msg;
        try {
          msg = JSON.parse(String(data));
        } catch {
          return;
        }

        const type = typeof msg?.type === "string" ? msg.type.trim().toLowerCase() : "";
        if (type === "ping" || type === "heartbeat") {
          resetHeartbeatWatch();
          deps.presenceService.touchActivity(memberId);
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (type === "activity") {
          resetHeartbeatWatch();
          deps.presenceService.touchActivity(memberId);
          notifyChange();
        }
      });

      ws.on("close", () => {
        if (closed || !memberId) return;
        closed = true;
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        console.info("[presence/ws] disconnected — memberId=%s", memberId);
        deps.presenceManager.onDisconnect(memberId, connectionId);
        const sockets = connectionsByMember.get(memberId);
        if (sockets) {
          sockets.delete(ws);
          if (sockets.size === 0) connectionsByMember.delete(memberId);
        }
        notifyChange();
      });

      ws.on("error", () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });
    })();
  });

  return wss;
}

export const PRESENCE_WS_PATH = WS_PATH;
