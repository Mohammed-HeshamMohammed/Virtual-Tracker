import admin from "firebase-admin";
import { logSafeWarn } from "../../http/sanitize-error.js";

const RTDB_IO_TIMEOUT_MS = 2_500;
let loggedWriteFailure = false;

function withIoTimeout(promise, ms = RTDB_IO_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("rtdb io timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function logWriteFailureOnce(err) {
  if (loggedWriteFailure) return;
  loggedWriteFailure = true;
  logSafeWarn(
    "[presence/rtdb] write failed — check FIREBASE_DATABASE_URL matches FIREBASE_PROJECT_ID and Realtime Database is enabled:",
    err,
  );
}

export function createRtdbPresenceStore() {
  async function set(record) {
    if (!record?.userId) return false;
    try {
      const db = admin.database();
      const ref = db.ref(`presence/${record.userId}`);
      await withIoTimeout(ref.set(record));

      if (record.status === "online" || record.status === "idle") {
        await withIoTimeout(
          ref.onDisconnect().update({
            status: "offline",
            lastSeenAt: admin.database.ServerValue.TIMESTAMP,
            updatedAt: admin.database.ServerValue.TIMESTAMP,
            connectionCount: 0,
          }),
        );
      } else {
        await ref.onDisconnect().cancel().catch(() => {});
      }
      return true;
    } catch (err) {
      logWriteFailureOnce(err);
      return false;
    }
  }

  async function get(userId) {
    if (!userId) return null;
    try {
      const db = admin.database();
      const snapshot = await withIoTimeout(db.ref(`presence/${userId}`).get());
      return snapshot.exists() ? snapshot.val() : null;
    } catch {
      return null;
    }
  }

  async function getMany(userIds) {
    const out = new Map();
    if (!userIds.length) return out;

    try {
      const db = admin.database();
      const snapshots = await withIoTimeout(
        Promise.all(userIds.map((id) => db.ref(`presence/${id}`).get())),
      );
      userIds.forEach((id, index) => {
        const snap = snapshots[index];
        out.set(id, snap.exists() ? snap.val() : null);
      });
    } catch {
      for (const id of userIds) out.set(id, null);
    }
    return out;
  }

  async function deleteUser(userId) {
    if (!userId) return;
    try {
      const db = admin.database();
      await db.ref(`presence/${userId}`).remove();
      await db.ref(`presence/${userId}`).onDisconnect().cancel().catch(() => {});
    } catch {
      /* ignore */
    }
  }

  async function listOnlineUserIds() {
    try {
      const db = admin.database();
      const snapshot = await withIoTimeout(db.ref("presence").get());
      const ids = [];
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          const val = child.val();
          if (val?.status === "online" || val?.status === "idle") {
            ids.push(child.key);
          }
        });
      }
      return ids;
    } catch {
      return [];
    }
  }

  return { set, get, getMany, delete: deleteUser, listOnlineUserIds };
}
