import { getEnv } from "./env.js";


export function getActivityCaptureMode() {
  return getEnv().activity.captureMode;
}

export function isActivityScreenshotsEnabled() {
  return (
    isWebActivityCaptureEnabled() ||
    isTaskScreenshotCaptureEnabled() ||
    isDesktopAgentEventIngestEnabled()
  );
}

export function isWebActivityCaptureEnabled() {
  if (getActivityCaptureMode() === "agent") return false;
  return getEnv().activity.webCaptureEnabled;
}

export function isTaskScreenshotCaptureEnabled() {
  return getEnv().activity.taskScreenshotsEnabled;
}

export function isDesktopAgentEventIngestEnabled() {
  return getEnv().activity.desktopAgentIngestEnabled;
}
