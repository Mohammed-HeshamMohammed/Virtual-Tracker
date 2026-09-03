import { PresenceEvents } from "./presence-events.js";

export function createPresenceService(store, options) {
  const { idleAfterMs, onStateChange, onOffline, persistRecord, loadRecord, loadMany } = options;
  const idleTimers = new Map();
  const connections = new Map();

  function clearIdleTimer(userId) {
    const timer = idleTimers.get(userId);
    if (timer) clearTimeout(timer);
    idleTimers.delete(userId);
  }

  function connectionCount(userId) {
    return connections.get(userId)?.size ?? 0;
  }

  function emitChange(userId, status, record) {
    onStateChange?.(userId, status, record);
  }

  function persist(record) {
    if (persistRecord) void Promise.resolve(persistRecord(record)).catch(() => {});
  }

  function writeRecord(userId, status) {
    const now = Date.now();
    const prev = store.get(userId);
    const record = {
      userId,
      status,
      lastActivityAt: status === "online" ? now : (prev?.lastActivityAt ?? now),
      lastSeenAt: now,
      updatedAt: now,
      connectionCount: connectionCount(userId),
    };
    store.set(userId, record);
    persist(record);
    if (!prev || prev.status !== status) {
      emitChange(userId, status, record);
    }
    return record;
  }

  function scheduleIdle(userId) {
    clearIdleTimer(userId);
    const timer = setTimeout(() => {
      const current = store.get(userId);
      if (!current || current.status !== "online") return;
      markIdle(userId);
    }, idleAfterMs);
    if (typeof timer.unref === "function") timer.unref();
    idleTimers.set(userId, timer);
  }

  function markOnline(userId) {
    const prev = store.get(userId);
    const record = writeRecord(userId, "online");
    if (connectionCount(userId) > 0 || !prev) {
      scheduleIdle(userId);
    }
    return record;
  }

  function markIdle(userId) {
    clearIdleTimer(userId);
    const current = store.get(userId);
    if (!current || current.status === "offline") {
      return current ?? null;
    }
    return writeRecord(userId, "idle");
  }

  function markOffline(userId) {
    clearIdleTimer(userId);
    const prev = store.get(userId);
    const now = Date.now();
    const record = {
      userId,
      status: "offline",
      lastActivityAt: prev?.lastActivityAt ?? now,
      lastSeenAt: now,
      updatedAt: now,
      connectionCount: 0,
    };
    store.set(userId, record);
    connections.delete(userId);
    persist(record);
    if (!prev || prev.status !== "offline") {
      emitChange(userId, "offline", record);
    }
    void onOffline?.(userId, now);
    return record;
  }

  function formatPresence(record) {
    if (!record) {
      return {
        status: "offline",
        lastSeenAt: null,
        lastActivityAt: null,
        connectionCount: 0,
      };
    }
    return {
      status: record.status,
      lastSeenAt: record.lastSeenAt,
      lastActivityAt: record.lastActivityAt,
      connectionCount: record.connectionCount,
    };
  }

  function getPresence(userId) {
    return formatPresence(store.get(userId));
  }

  async function getPresenceAsync(userId) {
    const local = store.get(userId);
    if (local) return formatPresence(local);
    if (!loadRecord) return formatPresence(null);
    const remote = await loadRecord(userId);
    if (remote) store.set(userId, remote);
    return formatPresence(remote);
  }

  async function getPresenceMany(userIds) {
    const out = new Map();
    const missing = [];
    for (const userId of userIds) {
      const local = store.get(userId);
      if (local) {
        out.set(userId, formatPresence(local));
      } else {
        missing.push(userId);
      }
    }

    if (missing.length && loadMany) {
      const remote = await loadMany(missing);
      for (const userId of missing) {
        const record = remote.get(userId) ?? null;
        if (record) store.set(userId, record);
        out.set(userId, formatPresence(record));
      }
    }

    for (const userId of userIds) {
      if (!out.has(userId)) out.set(userId, formatPresence(null));
    }
    return out;
  }

  function getOnlineUsers() {
    return store
      .entries()
      .filter(([, record]) => record.status === "online" || record.status === "idle")
      .map(([userId, record]) => ({
        userId,
        status: record.status,
        lastSeenAt: record.lastSeenAt,
        lastActivityAt: record.lastActivityAt,
        connectionCount: record.connectionCount,
      }));
  }

  function registerConnection(userId, connectionId) {
    if (!connections.has(userId)) connections.set(userId, new Set());
    connections.get(userId).add(connectionId);
    const record = markOnline(userId);
    store.set(userId, { ...record, connectionCount: connectionCount(userId) });
    persist(store.get(userId));
    return store.get(userId);
  }

  function unregisterConnection(userId, connectionId) {
    const set = connections.get(userId);
    if (!set) return markOffline(userId);
    set.delete(connectionId);
    if (set.size === 0) {
      connections.delete(userId);
      return markOffline(userId);
    }
    const record = store.get(userId);
    if (record) {
      const next = { ...record, connectionCount: set.size };
      store.set(userId, next);
      persist(next);
    }
    return store.get(userId);
  }

  function touchActivity(userId) {
    return markOnline(userId);
  }

  function resetForTests() {
    for (const userId of [...idleTimers.keys()]) clearIdleTimer(userId);
    connections.clear();
    for (const [userId] of store.entries()) store.delete(userId);
  }

  return {
    markOnline,
    markIdle,
    markOffline,
    getPresence,
    getPresenceAsync,
    getPresenceMany,
    getOnlineUsers,
    registerConnection,
    unregisterConnection,
    touchActivity,
    resetForTests,
    _events: PresenceEvents,
  };
}
