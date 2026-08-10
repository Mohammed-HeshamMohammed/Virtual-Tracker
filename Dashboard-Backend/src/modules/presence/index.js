import { getDb } from "../../config/firebase.js";
import { getAuthAdmin } from "../../config/firebase.js";
import { getEnv } from "../../config/env.js";
import { resolveFirebaseDatabaseUrl, warnIfDatabaseUrlMismatch } from "../../config/firebase.js";
import { isRedisConfigured } from "../../lib/redis/client.js";
import { PRESENCE_ONLINE_MS } from "../../config/presence.js";
import { resolveMemberIdForUid } from "../members/services/member-presence.service.js";
import { attachPresenceGateway } from "./presence-gateway.js";
import { createPresenceManager } from "./presence-manager.js";
import { createPresenceService } from "./presence-service.js";
import { createMemoryPresenceStore } from "./presence-store.js";
import { createRtdbPresenceStore } from "./presence-store-rtdb.js";
import { createRedisPresenceStore } from "./presence-store-redis.js";
import { publishPresenceChange, presenceRecordToChange } from "./presence-pubsub.js";
import { updateMemberPg } from "../../lib/postgres/members-postgres.service.js";

/** @type {{ presenceService: ReturnType<typeof createPresenceService>; presenceManager: ReturnType<typeof createPresenceManager>; store: ReturnType<typeof createMemoryPresenceStore>; rtdbStore: ReturnType<typeof createRtdbPresenceStore> | ReturnType<typeof createRedisPresenceStore> | null } | null} */
let runtime = null;

/**
 * On disconnect, persist last_seen_at to PostgreSQL.
 * @param {string} memberId
 * @param {number} lastSeenAt
 */
async function persistLastSeenAtOnDisconnect(memberId, lastSeenAt) {
  if (!memberId) return;
  try {
    await updateMemberPg(memberId, {
      last_seen_at: new Date(lastSeenAt).toISOString(),
    });
  } catch {
    // Member row may not exist in partial test environments.
  }
}

function createRuntime() {
  const store = createMemoryPresenceStore();

  let rtdbStore = null;
  if (isRedisConfigured()) {
    rtdbStore = createRedisPresenceStore();
    console.info("[presence] Using Redis store (REDIS_URL configured)");
  } else {
    warnIfDatabaseUrlMismatch();
    const { url: dbUrl, source: dbUrlSource } = resolveFirebaseDatabaseUrl();
    rtdbStore = dbUrl ? createRtdbPresenceStore() : null;

    if (rtdbStore) {
      console.info("[presence] Using Firebase Realtime Database store (%s)", dbUrl);
      if (dbUrlSource === "derived") {
        console.info(
          "[presence] FIREBASE_DATABASE_URL was not set; derived from FIREBASE_PROJECT_ID. Add it to Backend/.env to pin the URL.",
        );
      }
    } else {
      console.info(
        "[presence] Using in-memory store (set REDIS_URL or FIREBASE_DATABASE_URL for live sync across instances). Fine for single-instance dev.",
      );
    }
  }

  const presenceService = createPresenceService(store, {
    idleAfterMs: PRESENCE_ONLINE_MS,
    onOffline: (memberId, lastSeenAt) => persistLastSeenAtOnDisconnect(memberId, lastSeenAt),
    persistRecord: rtdbStore ? (record) => rtdbStore.set(record) : undefined,
    loadRecord: rtdbStore ? (userId) => rtdbStore.get(userId) : undefined,
    loadMany: rtdbStore ? (userIds) => rtdbStore.getMany(userIds) : undefined,
    onStateChange: (_userId, _status, record) => {
      void publishPresenceChange(presenceRecordToChange(record));
    },
  });

  const presenceManager = createPresenceManager(presenceService);
  runtime = { presenceService, presenceManager, store, rtdbStore };
  return runtime;
}

function ensureRuntime() {
  if (runtime) return runtime;
  return createRuntime();
}

/** Wire WebSocket presence gateway to the HTTP server (once at startup). */
export function initPresenceGateway(httpServer) {
  const { presenceService, presenceManager } = ensureRuntime();
  const auth = getAuthAdmin();
  if (!auth) return null;

  return attachPresenceGateway(httpServer, {
    presenceService,
    presenceManager,
    heartbeatStaleMs: 120_000,
    verifyIdToken: (token) => auth.verifyIdToken(token),
    resolveMemberId: async (uid) => {
      const db = getDb();
      if (!db) return "";
      return resolveMemberIdForUid(db, uid);
    },
  });
}

/** @returns {ReturnType<typeof createPresenceService>} */
export function getPresenceService() {
  return ensureRuntime().presenceService;
}

/** @returns {ReturnType<typeof createRtdbPresenceStore> | null} */
export function getRtdbStore() {
  return ensureRuntime().rtdbStore;
}

/** Reset runtime (tests only). */
export function resetPresenceRuntimeForTests() {
  if (!runtime) return;
  runtime.presenceService.resetForTests?.();
  runtime = null;
}

export { PRESENCE_WS_PATH, sendToMember, broadcastToAll } from "./presence-gateway.js";
export { PresenceEvents } from "./presence-events.js";
export { routePresenceEvents } from "./presence-events-route.js";
