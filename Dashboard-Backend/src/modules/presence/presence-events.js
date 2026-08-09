/** @typedef {"online"|"idle"|"offline"} PresenceStatus */

/** @typedef {{ userId: string; status: PresenceStatus; lastActivityAt: number; lastSeenAt: number; updatedAt: number; connectionCount: number }} PresenceRecord */

export const PresenceEvents = Object.freeze({
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  ACTIVITY: "activity",
  HEARTBEAT: "heartbeat",
  IDLE_TIMEOUT: "idle_timeout",
  STATE_CHANGE: "state_change",
});
