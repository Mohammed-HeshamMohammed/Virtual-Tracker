import { getAuthAdmin } from "../../config/firebase.js";
import { getDb } from "../../config/firebase.js";
import { resolveMemberIdForUid } from "../members/services/member-presence.service.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { getVisibleMemberIds } from "../member-relationships/service.js";
import { subscribePresenceChanges } from "./presence-pubsub.js";

/**
 * SSE stream of presence deltas for visible members (replaces polling).
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string} origin
 */
export async function routePresenceEvents(req, res, url, origin) {
  if (url.pathname !== "/api/presence/events" && url.pathname !== "/api/v1/presence/events") {
    return false;
  }
  if (req.method !== "GET") return false;

  const auth = getAuthAdmin();
  const db = getDb();
  if (!auth || !db) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Service unavailable." }));
    return true;
  }

  const idToken = url.searchParams.get("token")?.trim();
  if (!idToken) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "token query parameter is required." }));
    return true;
  }

  let viewerMemberId = "";
  let viewerRole = "";
  try {
    const decoded = await auth.verifyIdToken(idToken);
    viewerMemberId = await resolveMemberIdForUid(db, decoded.uid);
    if (!viewerMemberId) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Member profile not found." }));
      return true;
    }
    const memberSnap = await db.collection("members").doc(viewerMemberId).get();
    viewerRole = memberSnap.exists ? await resolveMemberRoleName(db, viewerMemberId) : "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid token";
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: msg }));
    return true;
  }

  const visibleIds = await getVisibleMemberIds(db, viewerMemberId, viewerRole);
  const visibleSet = visibleIds === null ? null : new Set(visibleIds);

  res.writeHead(200, {
    "Access-Control-Allow-Origin": origin || "*",
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "ready" })}\n\n`);

  try {
    const { getPresenceService, getRtdbStore } = await import("./index.js");
    const presenceService = getPresenceService();
    const persistentStore = getRtdbStore();

    let onlineUsers = [];
    if (persistentStore) {
      const onlineIds = await persistentStore.listOnlineUserIds();
      if (onlineIds.length > 0) {
        const presenceMap = await presenceService.getPresenceMany(onlineIds);
        for (const [userId, record] of presenceMap.entries()) {
          if (record && (record.status === "online" || record.status === "idle")) {
            onlineUsers.push({
              userId,
              status: record.status,
              lastSeenAt: record.lastSeenAt,
              lastActivityAt: record.lastActivityAt,
            });
          }
        }
      }
    } else {
      onlineUsers = presenceService.getOnlineUsers();
    }

    for (const user of onlineUsers) {
      if (visibleSet && !visibleSet.has(user.userId)) continue;
      res.write(
        `data: ${JSON.stringify({
          type: "presence",
          memberId: user.userId,
          status: user.status,
          lastSeenAt: user.lastSeenAt,
          lastActivityAt: user.lastActivityAt,
        })}\n\n`,
      );
    }
  } catch {
    /* ignore bootstrap errors */
  }

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 25_000);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  const unsubscribe = subscribePresenceChanges((message) => {
    if (visibleSet && !visibleSet.has(message.memberId)) return;
    try {
      res.write(`data: ${JSON.stringify({ type: "presence", ...message })}\n\n`);
    } catch {
      /* stream closed */
    }
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });

  return true;
}
