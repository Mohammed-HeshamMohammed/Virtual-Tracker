import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import type { AppSettingsView } from "./types";
import { applyTheme, isThemePreference } from "./utils/theme";

// Applied before the first render rather than in an effect: the stored theme
// is only a class on <html>, so painting it up front avoids a dark flash on a
// light-themed machine. Deliberately not awaited - the default (no class =
// follow the OS) is already the right answer for "system", which is the
// default preference, so a slow prefs read costs nothing visually.
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
    <App />
  </React.StrictMode>,
);
