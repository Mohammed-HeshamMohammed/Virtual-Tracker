import { invoke } from "@tauri-apps/api/core";

/** A desktop notification. It goes through the app's own command rather than the
 *  notification plugin's JS API, because the build for Windows 7, 8 and 8.1 has no
 *  notification plugin (its toasts need WinRT) and shows notifications itself. */
export async function notify(title: string, body: string): Promise<void> {
  try {
    await invoke("show_notification", { title, body });
  } catch {
    /* best effort only - never let a notification failure interrupt the caller */
  }
}
