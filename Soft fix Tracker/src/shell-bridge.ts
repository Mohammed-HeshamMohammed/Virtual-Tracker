import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ViewMode } from "./workspace";

/** Whether Soft Fix is running as the desktop app (and so has a window, a tray icon and so on). */
export const inDesktopShell = () => isTauri();

/** Asks the desktop shell to give its window the shape of `mode`. Nothing happens in a browser. */
export function applyViewMode(mode: ViewMode) {
  if (!isTauri()) return;
  invoke("set_view_mode", { mode }).catch(() => undefined);
}

/** Tells the desktop shell the two settings it acts on itself. */
export function syncShellPrefs(keepInTray: boolean, focusOnTop: boolean) {
  if (!isTauri()) return;
  invoke("sync_shell_prefs", { keepInTray, focusOnTop }).catch(() => undefined);
}

/** Calls back when the tray icon's menu picks a mode. Returns the function that stops listening. */
export function onTrayViewMode(callback: (mode: ViewMode) => void): () => void {
  if (!isTauri()) return () => undefined;
  let stop: (() => void) | undefined;
  let gone = false;
  listen<string>("view-mode", (event) => {
    if (event.payload === "full" || event.payload === "focus" || event.payload === "easy") callback(event.payload);
  })
    .then((off) => {
      if (gone) off();
      else stop = off;
    })
    .catch(() => undefined);
  return () => {
    gone = true;
    stop?.();
  };
}
