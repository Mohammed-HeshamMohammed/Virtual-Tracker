import { getEnv } from "./env.js";

/**
 * Activity capture modes:
 * - agent (default): Python / Desktop Agent on the member PC posts screenshots, apps, URLs.
 * - web: in-browser tab capture while the timer runs (legacy fallback).
 */

/** @returns {"agent"|"web"} */
export function getActivityCaptureMode() {
  return getEnv().activity.captureMode;
}

/** Screenshots in feed when web, task, or desktop/python agent capture is enabled. */
export function isActivityScreenshotsEnabled() {
  return (
    isWebActivityCaptureEnabled() ||
    isTaskScreenshotCaptureEnabled() ||
    isDesktopAgentEventIngestEnabled()
  );
}

/** In-browser activity capture while the task timer is active. Off when capture mode is agent. */
export function isWebActivityCaptureEnabled() {
  if (getActivityCaptureMode() === "agent") return false;
  return getEnv().activity.webCaptureEnabled;
}

/** Future: enable when task timer + proof-of-work capture ships. */
export function isTaskScreenshotCaptureEnabled() {
  return getEnv().activity.taskScreenshotsEnabled;
}

/** Desktop-Agent posting to /api/activity/events during task sessions. */
export function isDesktopAgentEventIngestEnabled() {
  return getEnv().activity.desktopAgentIngestEnabled;
}
