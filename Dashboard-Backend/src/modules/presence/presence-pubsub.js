import { EventEmitter } from "node:events";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { resolveFirebaseDatabaseUrl } from "../../config/firebase.js";
import { isRedisConfigured, getRedisClient, getRedisSubscriberClient } from "../../lib/redis/client.js";
import admin from "firebase-admin";


const REDIS_CHANNEL = "presence:changes";

const localBus = new EventEmitter();
localBus.setMaxListeners(100);

let rtdbSubscribed = false;
let redisSubscribed = false;
const localChanges = new Set();

export async function publishPresenceChange(message) {
  if (!message.updatedAt) {
    message.updatedAt = Date.now();
  }

  const key = `${message.memberId}:${message.status}:${message.updatedAt}`;
  localChanges.add(key);
  const timer = setTimeout(() => {
    localChanges.delete(key);
  }, 5000);
  if (typeof timer.unref === "function") timer.unref();

  localBus.emit("change", message);

  if (isRedisConfigured()) {
    try {
      await getRedisClient()?.publish(REDIS_CHANNEL, JSON.stringify(message));
    } catch (err) {
      logSafeWarn("[presence/pubsub] Redis publish failed:", err);
    }
  }
}

export function subscribePresenceChanges(handler) {
  localBus.on("change", handler);

  if (isRedisConfigured()) {
    ensureRedisSubscriber();
  } else {
    const { url: dbUrl } = resolveFirebaseDatabaseUrl();
    if (dbUrl) {
      ensureRtdbSubscriber();
    }
  }

  return () => {
    localBus.off("change", handler);
  };
}

function ensureRedisSubscriber() {
  if (redisSubscribed) return;
  const subscriber = getRedisSubscriberClient();
  if (!subscriber) return;
  try {
    subscriber.subscribe(REDIS_CHANNEL).catch((err) => {
      logSafeWarn("[presence/pubsub] Redis subscribe failed:", err);
    });
    subscriber.on("message", (_channel, raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      const key = `${message.memberId}:${message.status}:${message.updatedAt}`;
      if (localChanges.has(key)) {
        localChanges.delete(key);
        return;
      }
      localBus.emit("change", message);
    });
    redisSubscribed = true;
  } catch (err) {
    logSafeWarn("[presence/pubsub] Redis subscribe failed:", err);
  }
}

function ensureRtdbSubscriber() {
  if (rtdbSubscribed) return;
  try {
    const db = admin.database();
    const ref = db.ref("presence");

    const onUpdate = (snapshot) => {
      const val = snapshot.val();
      if (!val?.userId) return;
      const key = `${val.userId}:${val.status}:${val.updatedAt}`;
      if (localChanges.has(key)) {
        localChanges.delete(key);
        return;
      }
      localBus.emit("change", presenceRecordToChange(val));
    };

    ref.on("child_added", onUpdate);
    ref.on("child_changed", onUpdate);

    rtdbSubscribed = true;
  } catch (err) {
    logSafeWarn("[presence/pubsub] RTD subscribe failed:", err);
  }
}

export function presenceRecordToChange(record) {
  return {
    memberId: record.userId,
    status: record.status,
    lastSeenAt: record.lastSeenAt,
    lastActivityAt: record.lastActivityAt,
    updatedAt: record.updatedAt,
  };
}

export async function resetPresencePubSubForTests() {
  if (rtdbSubscribed) {
    try {
      const db = admin.database();
      db.ref("presence").off();
    } catch {
      /* ignore */
    }
    rtdbSubscribed = false;
  }

  redisSubscribed = false;
  localChanges.clear();
  localBus.removeAllListeners("change");
}
