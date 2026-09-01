import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

// Cached across calls so a denied/unavailable permission is only ever
// checked once per app run, not once per notification.
let permissionChecked = false;
let permissionGranted = false;

async function ensurePermission(): Promise<boolean> {
  if (permissionChecked) return permissionGranted;
  permissionChecked = true;
  try {
    permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      permissionGranted = (await requestPermission()) === "granted";
    }
  } catch {
    // No OS notification backend, or the request itself failed - the
    // in-app toast at every call site is still the primary signal.
    permissionGranted = false;
  }
  return permissionGranted;
}

/**
 * Native OS notification - the one thing that actually reaches someone
 * while the agent is minimized to the tray, which is its normal resting
 * state (see App.tsx's "Keep running in tray" setting and every idle-stage/
 * task-limit/connection effect this backs). An in-app toast in a hidden
 * window reaches nobody, which every one of those effects used to assume
 * otherwise.
 *
 * Always call this alongside the existing toast, never instead of it - the
 * toast is what shows if the window is visible or notifications are denied,
 * and this call is silently a no-op in both of those cases.
 */
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (!(await ensurePermission())) return;
    sendNotification({ title, body });
  } catch {
    /* best effort only - never let a notification failure interrupt the caller */
  }
}
