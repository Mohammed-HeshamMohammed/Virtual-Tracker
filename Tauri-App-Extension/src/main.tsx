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

  const [{ default: App }, { AppErrorBoundary, installGlobalErrorLogging }, { TooltipLayer }, { TourLayer }] =
    await Promise.all([
      import("./App"),
      import("./components/common/AppErrorBoundary"),
      import("./components/common/TooltipLayer"),
      import("./components/common/TourLayer"),
    ]);
  installGlobalErrorLogging();
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
