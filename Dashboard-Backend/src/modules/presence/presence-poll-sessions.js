// Presence for clients that cannot hold the WebSocket (see presence-event-log.js).
// Each polling client registers one connection with the presence service, kept
// alive by its polls - the same effect a WebSocket connection plus its pings
// has - and dropped when the polls stop.

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidPollClientId(value) {
  return typeof value === "string" && CLIENT_ID_RE.test(value);
}

export function createPollSessions({ presenceManager, presenceService, staleMs = 90_000, now = () => Date.now() }) {
  const sessions = new Map();

  function connectionId(memberId, clientId) {
    return `http:${memberId}:${clientId}`;
  }

  return {
    /** A poll: register on first sight, keep alive, optionally mark activity. */
    touch(memberId, clientId, { activity = false } = {}) {
      const key = connectionId(memberId, clientId);
      const existing = sessions.get(key);
      if (!existing) presenceManager.onConnect(memberId, key);
      sessions.set(key, { memberId, lastPollAt: now() });
      if (!existing || activity) presenceService.touchActivity(memberId);
      return !existing;
    },

    leave(memberId, clientId) {
      const key = connectionId(memberId, clientId);
      if (!sessions.delete(key)) return;
      presenceManager.onDisconnect(memberId, key);
    },

    /** Drops clients that stopped polling. */
    sweep() {
      const cutoff = now() - staleMs;
      for (const [key, session] of sessions) {
        if (session.lastPollAt >= cutoff) continue;
        sessions.delete(key);
        presenceManager.onDisconnect(session.memberId, key);
      }
    },

    size: () => sessions.size,
  };
}
