import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppSettingsView } from "./types";
import { applyTheme, isThemePreference } from "./utils/theme";
import "./App.css";

// The tray icon's right-click menu is a second window running this same bundle (see
// src-tauri/src/tray_menu.rs). It must not start the app - polling, tour, tooltips - so the
// app's own modules are only loaded in the main window.
const TRAY_MENU_LABEL = "tray-menu";
// The Owner's buzz (src-tauri/src/buzz.rs) is a third window on the same bundle.
const BUZZ_LABEL = "buzz";

function currentWindowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main"; // running outside Tauri (plain browser / tests)
  }
}

void invoke<AppSettingsView>("get_app_settings")
  .then((settings) => {
    const theme = settings?.preferences?.theme;
    if (isThemePreference(theme)) applyTheme(theme);
  })
  .catch(() => {
    /* No prefs yet, or running outside Tauri - the OS preference stands. */
  });

// The machine's time zone, for the session calls that say which day the hours belong to.
// The build for Windows 7, 8 and 8.1 cannot ask the OS for it (src-tauri/src/client/api/session.rs).
void invoke("report_local_timezone", { zone: Intl.DateTimeFormat().resolvedOptions().timeZone }).catch(() => {
  /* Running outside Tauri. */
});

async function start() {
  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

  if (currentWindowLabel() === TRAY_MENU_LABEL) {
    const { TrayMenu } = await import("./TrayMenu");
    root.render(
      <React.StrictMode>
        <TrayMenu />
      </React.StrictMode>,
    );
    return;
  }

  if (currentWindowLabel() === BUZZ_LABEL) {
    const { BuzzScreen } = await import("./BuzzScreen");
    root.render(
      <React.StrictMode>
        <BuzzScreen />
      </React.StrictMode>,
    );
    return;
  }

  const [{ default: App }, { AppErrorBoundary, installGlobalErrorLogging }, { TooltipLayer }, { TourLayer }] =
    await Promise.all([
      import("./App"),
      import("./components/common/AppErrorBoundary"),
      import("./components/common/TooltipLayer"),
      import("./components/common/TourLayer"),
    ]);
  installGlobalErrorLogging();
  // The app reloads a window on screen whose page has stopped reporting in
  // (src-tauri/src/ui_watchdog.rs), which is the window that is open but blank.
  const heartbeat = () => void invoke("ui_heartbeat").catch(() => {});
  heartbeat();
  window.setInterval(heartbeat, 15_000);
  root.render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
        <TooltipLayer />
        <TourLayer />
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}

void start();
