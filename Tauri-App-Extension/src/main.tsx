import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import type { AppSettingsView } from "./types";
import { applyTheme, isThemePreference } from "./utils/theme";
import { AppErrorBoundary, installGlobalErrorLogging } from "./components/common/AppErrorBoundary";

installGlobalErrorLogging();

void invoke<AppSettingsView>("get_app_settings")
  .then((settings) => {
    const theme = settings?.preferences?.theme;
    if (isThemePreference(theme)) applyTheme(theme);
  })
  .catch(() => {
    /* No prefs yet, or running outside Tauri - the OS preference stands. */
  });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
