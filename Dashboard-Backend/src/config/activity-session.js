import { getEnv } from "./env.js";

/** Max age of `activity_sessions.updated_at` before a member is considered offline. */
export function getActivitySessionStaleMs() {
  return getEnv().activity.sessionStaleMs;
}
