import { EventEmitter } from "node:events";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { isRedisConfigured, getRedisClient, getRedisSubscriberClient } from "../../lib/redis/client.js";


const REDIS_CHANNEL = "data:changes";

const localBus = new EventEmitter();
localBus.setMaxListeners(100);

let redisSubscribed = false;
const localChanges = new Set();

const ACTIVITY_THROTTLE_MS = 10_000;
let lastActivityPublishAt = 0;

export async function publishChange(resource, id, action, actorMemberId) {
  if (resource === "activity") {
    const now = Date.now();
    if (now - lastActivityPublishAt < ACTIVITY_THROTTLE_MS) return;
    lastActivityPublishAt = now;
  }

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

export function resetChangeBusForTests() {
  redisSubscribed = false;
  localChanges.clear();
  localBus.removeAllListeners("change");
}
