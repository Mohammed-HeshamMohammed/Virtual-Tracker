// What the tray menu shows and does for a given session state - pure, so it can be tested
// without a window. TrayMenu.tsx only draws what this returns.

export type TrayState = {
  label: string;
  tracking: boolean;
  paused: boolean;
  sessionOpen: boolean;
  signedIn: boolean;
};

export type TrayAction =
  | "open_app"
  | "open_dashboard"
  | "pause"
  | "resume"
  | "stop"
  | "sign_in"
  | "quit"
  | "close";

export type TrayTone = "signed-out" | "idle" | "live" | "paused";

export type TrayRow = {
  action: TrayAction;
  label: string;
  /** Global shortcut that does the same thing, shown at the row's right edge. */
  hint?: string;
  icon: "pause" | "play" | "stop" | "app" | "dashboard" | "sign-in" | "quit";
  tone?: "primary" | "danger";
};

export type TrayGroup = { title?: string; rows: TrayRow[] };

export const EMPTY_TRAY_STATE: TrayState = {
  label: "Not tracking",
  tracking: false,
  paused: false,
  sessionOpen: false,
  signedIn: false,
};

// Must match pause_resume_shortcut() / stop_shortcut() in src-tauri/src/lib.rs.
export const PAUSE_RESUME_HINT = "Ctrl+Shift+P";
export const STOP_HINT = "Ctrl+Shift+X";

export function trayTone(state: TrayState): TrayTone {
  if (!state.signedIn) return "signed-out";
  if (state.sessionOpen && state.paused) return "paused";
  if (state.sessionOpen) return "live";
  return "idle";
}

export function trayHeadline(state: TrayState): string {
  switch (trayTone(state)) {
    case "signed-out":
      return "Signed out";
    case "paused":
      return "Paused";
    case "live":
      return "Tracking";
    default:
      return "Not tracking";
  }
}

/** The line under the headline: what is being tracked and for how long, or what to do next. */
export function traySubline(state: TrayState): string {
  switch (trayTone(state)) {
    case "signed-out":
      return "Sign in to start tracking";
    case "idle":
      return "No session running";
    default:
      return state.label;
  }
}

/**
 * The menu, top to bottom: controls for the running session first (they are why most people open
 * it), then the two places to go, then the account / quit rows. Signed-out there are no session
 * controls at all - they could only fail.
 */
export function trayGroups(state: TrayState): TrayGroup[] {
  const groups: TrayGroup[] = [];

  if (state.signedIn && state.sessionOpen) {
    groups.push({
      rows: [
        state.paused
          ? { action: "resume", label: "Resume tracking", hint: PAUSE_RESUME_HINT, icon: "play", tone: "primary" }
          : { action: "pause", label: "Pause tracking", hint: PAUSE_RESUME_HINT, icon: "pause" },
        { action: "stop", label: "Stop session", hint: STOP_HINT, icon: "stop" },
      ],
    });
  }

  groups.push({
    rows: [
      {
        action: "open_app",
        label: state.signedIn && !state.sessionOpen ? "Open app to start tracking" : "Open the app",
        icon: "app",
      },
      { action: "open_dashboard", label: "Open the Dashboard", icon: "dashboard" },
    ],
  });

  const last: TrayRow[] = [];
  if (!state.signedIn) last.push({ action: "sign_in", label: "Sign in", icon: "sign-in", tone: "primary" });
  last.push({ action: "quit", label: "Quit My Virtual Tracker", icon: "quit", tone: "danger" });
  groups.push({ rows: last });

  return groups;
}
