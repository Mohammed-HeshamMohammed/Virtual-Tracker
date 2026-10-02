import { getAuthAdmin, getDb } from "../../config/firebase.js";
import { resolveMemberIdForUid } from "../members/services/member-presence.service.js";
import { readBearerToken } from "../../http/auth-token.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { corsHeaders } from "../../http/cors.js";
import { currentPresenceCursor, presenceEventsSince } from "./presence-event-log.js";
import { createPollSessions, isValidPollClientId } from "./presence-poll-sessions.js";

// HTTP stand-in for the presence WebSocket, for networks whose web filter
// blocks the WebSocket protocol. POST /api/presence/poll
//   { clientId, since: number|null, activity?: boolean, leave?: boolean }
// -> { cursor, reset, events }
// The poll itself is the heartbeat; `since: null` means "first poll, start
// from now" so a fresh client is not replayed history.

let sessions = null;
let sweeper = null;

async function getSessions() {
  if (sessions) return sessions;
  const { getPresenceService, getPresenceManager } = await import("./index.js");
  sessions = createPollSessions({
    presenceManager: getPresenceManager(),
    presenceService: getPresenceService(),
  });
  sweeper = setInterval(() => sessions.sweep(), 30_000);
  if (typeof sweeper.unref === "function") sweeper.unref();
  return sessions;
}

function sendJson(res, origin, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(origin, { credentials: true }),
  });
  res.end(JSON.stringify(payload));
}

export async function routePresencePoll(req, res, url, origin) {
  if (url.pathname !== "/api/presence/poll" && url.pathname !== "/api/v1/presence/poll") return false;
  if (req.method !== "POST") return false;

  const auth = getAuthAdmin();
  const db = getDb();
  if (!auth || !db) {
    sendJson(res, origin, 503, { success: false, error: "Service unavailable." });
    return true;
  }

  const idToken = readBearerToken(req);
  if (!idToken) {
    sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required." });
    return true;
  }

  let memberId = "";
  try {
    const decoded = await auth.verifyIdToken(idToken);
    memberId = await resolveMemberIdForUid(db, decoded.uid);
  } catch (err) {
    sendJson(res, origin, 401, { success: false, error: err instanceof Error ? err.message : "Invalid token" });
    return true;
  }
  if (!memberId) {
    sendJson(res, origin, 404, { success: false, error: "Member profile not found." });
    return true;
  }

  let body = {};
  try {
    const parsed = await readJsonBody(req);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
  } catch {
    sendJson(res, origin, 400, { success: false, error: "Invalid request body." });
    return true;
  }
  if (!isValidPollClientId(body.clientId)) {
    sendJson(res, origin, 400, { success: false, error: "clientId is required." });
    return true;
  }

  const live = await getSessions();
  if (body.leave === true) {
    live.leave(memberId, body.clientId);
    sendJson(res, origin, 200, { success: true });
    return true;
  }

  live.touch(memberId, body.clientId, { activity: body.activity === true });

  const since = Number.isInteger(body.since) && body.since >= 0 ? body.since : null;
  if (since === null) {
    sendJson(res, origin, 200, { success: true, cursor: currentPresenceCursor(), reset: false, events: [] });
    return true;
  }
  sendJson(res, origin, 200, { success: true, ...presenceEventsSince(memberId, since) });
  return true;
}
