import { getEnv } from "./env.js";

export function getActivitySessionStaleMs() {
  return getEnv().activity.sessionStaleMs;
}
