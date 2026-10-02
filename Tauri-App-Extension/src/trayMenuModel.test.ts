/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import libRs from "../src-tauri/src/lib.rs?raw";
import trayRs from "../src-tauri/src/tray_menu.rs?raw";
import {
  EMPTY_TRAY_STATE,
  PAUSE_RESUME_HINT,
  STOP_HINT,
  trayGroups,
  trayHeadline,
  traySubline,
  trayTone,
  type TrayState,
} from "./trayMenuModel";

const state = (patch: Partial<TrayState>): TrayState => ({ ...EMPTY_TRAY_STATE, signedIn: true, ...patch });
const actions = (s: TrayState) => trayGroups(s).flatMap((g) => g.rows.map((r) => r.action));

describe("tray menu", () => {
  it("running: pause and stop first, then the app and the Dashboard as two separate rows, then quit", () => {
    expect(actions(state({ sessionOpen: true, tracking: true, label: "Test — 7m 27s" }))).toEqual([
      "pause",
      "stop",
      "open_app",
      "open_dashboard",
      "quit",
    ]);
  });

  it("paused: the pause row becomes resume", () => {
    const list = actions(state({ sessionOpen: true, paused: true }));
    expect(list).toContain("resume");
    expect(list).not.toContain("pause");
  });

  it("signed in with nothing running: no session controls, the app row invites starting", () => {
    const s = state({});
    expect(actions(s)).toEqual(["open_app", "open_dashboard", "quit"]);
    expect(trayGroups(s)[0].rows[0].label).toMatch(/start tracking/i);
  });

  it("signed out: no session controls (they could only fail), sign in is offered before quit", () => {
    const list = actions({ ...EMPTY_TRAY_STATE, signedIn: false });
    expect(list).toEqual(["open_app", "open_dashboard", "sign_in", "quit"]);
  });

  it("the app and the Dashboard are always two different actions", () => {
    for (const s of [state({}), state({ sessionOpen: true }), { ...EMPTY_TRAY_STATE, signedIn: false }]) {
      expect(actions(s)).toEqual(expect.arrayContaining(["open_app", "open_dashboard"]));
    }
  });

  it("the headline and subline say what is happening", () => {
    expect(trayTone(state({ sessionOpen: true }))).toBe("live");
    expect(trayHeadline(state({ sessionOpen: true }))).toBe("Tracking");
    expect(traySubline(state({ sessionOpen: true, label: "Test — 7m 27s" }))).toBe("Test — 7m 27s");
    expect(trayHeadline(state({ sessionOpen: true, paused: true }))).toBe("Paused");
    expect(trayHeadline(state({}))).toBe("Not tracking");
    expect(trayHeadline({ ...EMPTY_TRAY_STATE, signedIn: false })).toBe("Signed out");
  });

  it("shortcut hints match the global shortcuts registered by the backend", () => {
    const rust = libRs;
    const pause = rust.slice(rust.indexOf("fn pause_resume_shortcut"), rust.indexOf("fn stop_shortcut"));
    expect(pause).toMatch(/SHIFT \| .*CONTROL/);
    expect(pause).toMatch(/KeyP/);
    expect(PAUSE_RESUME_HINT).toBe("Ctrl+Shift+P");
    expect(rust.slice(rust.indexOf("fn stop_shortcut"))).toMatch(/KeyX/);
    expect(STOP_HINT).toBe("Ctrl+Shift+X");
  });

  it("wiring: right-click opens our window, not an OS menu; every action the menu sends exists in Rust", () => {
    const lib = libRs;
    expect(lib).toMatch(/MouseButton::Right => tray_menu::open_at/);
    expect(lib).not.toMatch(/Menu::with_items/);
    const rust = trayRs;
    for (const group of [state({}), state({ sessionOpen: true }), state({ sessionOpen: true, paused: true }), { ...EMPTY_TRAY_STATE, signedIn: false }]) {
      for (const action of actions(group)) expect(rust).toContain(`"${action}"`);
    }
  });
});
