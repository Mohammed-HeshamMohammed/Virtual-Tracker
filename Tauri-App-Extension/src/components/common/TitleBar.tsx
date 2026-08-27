import { invoke } from "@tauri-apps/api/core";
import type { ThemePreference } from "../../types";

/** Cycles system -> light -> dark -> system, so one control covers all three
 *  without opening a menu in a 38px title bar. */
const NEXT_THEME: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const THEME_LABEL: Record<ThemePreference, string> = {
  system: "Theme: follows system",
  light: "Theme: light",
  dark: "Theme: dark",
};

function ThemeGlyph({ theme }: { theme: ThemePreference }) {
  if (theme === "light") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
        </g>
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M20 14.6A8.4 8.4 0 0 1 9.4 4a8.4 8.4 0 1 0 10.6 10.6Z"
        />
      </svg>
    );
  }
  // System: half-filled disc - neither sun nor moon is pinned.
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path fill="currentColor" d="M12 4a8 8 0 0 1 0 16V4Z" />
    </svg>
  );
}

export function TitleBar({
  title,
  showBrand = true,
  onClose,
  onCheckUpdate,
  checkingUpdate,
  theme,
  onCycleTheme,
}: {
  title?: string;
  showBrand?: boolean;
  onClose: () => void;
  onCheckUpdate?: () => void;
  checkingUpdate?: boolean;
  theme?: ThemePreference;
  onCycleTheme?: (next: ThemePreference) => void;
}) {
  return (
    <header className="titlebar">
      <div className="titlebar-drag" data-tauri-drag-region>
        {showBrand ? (
          <>
            <img
              className="titlebar-logo-img"
              src="/app-icon.ico"
              width={16}
              height={16}
              alt=""
              draggable={false}
            />
            {title ? (
              <span className="titlebar-label" data-tauri-drag-region>
                {title}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="titlebar-controls">
        {theme && onCycleTheme ? (
          <button
            className="win-btn"
            type="button"
            title={THEME_LABEL[theme]}
            aria-label={THEME_LABEL[theme]}
            onClick={() => onCycleTheme(NEXT_THEME[theme])}
          >
            <ThemeGlyph theme={theme} />
          </button>
        ) : null}
        {onCheckUpdate ? (
          <button
            className="win-btn"
            type="button"
            title="Check for updates"
            aria-label="Check for updates"
            disabled={checkingUpdate}
            onClick={onCheckUpdate}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1Zm-7 15a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"
              />
            </svg>
          </button>
        ) : null}
        <button
          className="win-btn"
          type="button"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => void invoke("minimize_current")}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="win-btn win-close"
          type="button"
          title="Close"
          aria-label="Close"
          onClick={onClose}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M1.5 1.5l9 9M10.5 1.5l-9 9"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
