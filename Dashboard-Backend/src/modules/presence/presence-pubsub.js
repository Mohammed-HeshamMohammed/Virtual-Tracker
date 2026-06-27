import { EventEmitter } from "node:events";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { resolveFirebaseDatabaseUrl } from "../../config/firebase.js";
import admin from "firebase-admin";

/** @typedef {{ memberId: string; status: import("./presence-events.js").PresenceStatus; lastSeenAt: number; lastActivityAt: number; updatedAt?: number }} PresenceChangeMessage */

const localBus = new EventEmitter();
localBus.setMaxListeners(100);

/** @type {boolean} */
let rtdbSubscribed = false;
const localChanges = new Set();

/**
 * @param {PresenceChangeMessage} message
 */
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
}

/**
 * Subscribe to presence changes (Firebase RTD when configured, always local bus).
 *
 * @param {(message: PresenceChangeMessage) => void} handler
 * @returns {() => void}
 */
export function subscribePresenceChanges(handler) {
  localBus.on("change", handler);

  const { url: dbUrl } = resolveFirebaseDatabaseUrl();
  if (dbUrl) {
    ensureRtdbSubscriber();
  }

  return () => {
    localBus.off("change", handler);
  };
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

/** @param {import("./presence-events.js").PresenceRecord} record */
export function presenceRecordToChange(record) {
  return {
    memberId: record.userId,
    status: record.status,
    lastSeenAt: record.lastSeenAt,
    lastActivityAt: record.lastActivityAt,
    updatedAt: record.updatedAt,
  };
}

/** Tear down subscriber (tests). */
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

  localChanges.clear();
  localBus.removeAllListeners("change");
}
