import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

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
    permissionGranted = false;
  }
  return permissionGranted;
}

export async function notify(title: string, body: string): Promise<void> {
  try {
    if (!(await ensurePermission())) return;
    sendNotification({ title, body });
  } catch {
    /* best effort only - never let a notification failure interrupt the caller */
  }
}
