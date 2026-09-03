import { getEnv } from "./env.js";


export const PRESENCE_ONLINE_MS = getEnv().presence.onlineMs;
export const PRESENCE_IDLE_MS = getEnv().presence.idleMs;
export const PRESENCE_ACTIVITY_WINDOW_MS = getEnv().presence.activityWindowMs;
export const PRESENCE_SIGNAL_MIN_INTERVAL_MS = getEnv().presence.signalMinIntervalMs;
