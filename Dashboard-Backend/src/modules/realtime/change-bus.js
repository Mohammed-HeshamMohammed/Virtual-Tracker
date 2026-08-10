// Live-sync change bus (PLAN-livesyncandagenttimer.md §3, Option A). A
// near-copy of presence-pubsub.js's Redis-with-local-echo-de-dup pattern,
// minus the RTDB fallback that module has - that fallback exists there for
// presence *persistence*, which has no equivalent need here. Frames carry
// no row data (§4.1) - only enough to tell a client which cache key to
// refetch through the endpoint it is already authorized to call.
import { EventEmitter } from "node:events";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { isRedisConfigured, getRedisClient, getRedisSubscriberClient } from "../../lib/redis/client.js";

/** @typedef {{ resource: string; id: string; action: "created" | "updated" | "deleted"; actor?: string; at: number }} ChangeMessage */

const REDIS_CHANNEL = "data:changes";

const localBus = new EventEmitter();
localBus.setMaxListeners(100);

let redisSubscribed = false;
const localChanges = new Set();

// ponytail: single global throttle window; make it per-member if activity
// fan-out gets noisy. Case 56 - an agent uploading screenshots continuously
// must not turn into a broadcast per upload; every list-page refetch this
// would trigger is wasted since nothing on those pages reads activity data.
const ACTIVITY_THROTTLE_MS = 10_000;
let lastActivityPublishAt = 0;

/**
 * Fire-and-forget on purpose: a failed broadcast must never fail the
 * caller's write. Call from the shared write helpers (§6.1), not from
 * individual route handlers, so a new route cannot forget it.
 * @param {string} resource
 * @param {string} id
 * @param {"created" | "updated" | "deleted"} action
 * @param {string} [actorMemberId]
 */
export async function publishChange(resource, id, action, actorMemberId) {
  if (resource === "activity") {
    const now = Date.now();
    if (now - lastActivityPublishAt < ACTIVITY_THROTTLE_MS) return;
    lastActivityPublishAt = now;
  }

  /** @type {ChangeMessage} */
  const message = { resource, id, action, actor: actorMemberId, at: Date.now() };

  const key = `${resource}:${id}:${action}:${message.at}`;
  localChanges.add(key);
  const timer = setTimeout(() => localChanges.delete(key), 5000);
  if (typeof timer.unref === "function") timer.unref();

  localBus.emit("change", message);

  if (isRedisConfigured()) {
    try {
      await getRedisClient()?.publish(REDIS_CHANNEL, JSON.stringify(message));
    } catch (err) {
      logSafeWarn("[realtime/change-bus] Redis publish failed:", err);
    }
  }
}

/**
 * @param {(message: ChangeMessage) => void} handler
 * @returns {() => void}
 */
export function subscribeChanges(handler) {
  localBus.on("change", handler);
  if (isRedisConfigured()) ensureRedisSubscriber();
  return () => localBus.off("change", handler);
}

function ensureRedisSubscriber() {
  if (redisSubscribed) return;
  const subscriber = getRedisSubscriberClient();
  if (!subscriber) return;
  try {
    subscriber.subscribe(REDIS_CHANNEL).catch((err) => {
      logSafeWarn("[realtime/change-bus] Redis subscribe failed:", err);
    });
    subscriber.on("message", (channel, raw) => {
      if (channel !== REDIS_CHANNEL) return;
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      const key = `${message.resource}:${message.id}:${message.action}:${message.at}`;
      if (localChanges.has(key)) {
        localChanges.delete(key);
        return;
      }
      localBus.emit("change", message);
    });
    redisSubscribed = true;
  } catch (err) {
    logSafeWarn("[realtime/change-bus] Redis subscribe failed:", err);
  }
}

/** Tear down subscriber state (tests). */
export function resetChangeBusForTests() {
  redisSubscribed = false;
  localChanges.clear();
  localBus.removeAllListeners("change");
}
