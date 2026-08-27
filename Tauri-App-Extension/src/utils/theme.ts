import type { ThemePreference } from "../types";

/**
 * Applies a theme preference to <html>.
 *
 * "system" deliberately removes both classes rather than resolving the OS
 * preference here: App.css's `@media (prefers-color-scheme: light)` block is
 * scoped to `:root:not(.theme-dark):not(.theme-light)`, so with no class
 * present the OS drives it and keeps driving it when the user changes their
 * Windows setting mid-session - no listener needed on this side.
 */
export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-dark");
  if (theme === "light") root.classList.add("theme-light");
  else if (theme === "dark") root.classList.add("theme-dark");
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}
