import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChartBar, ChatsCircle, Gear, Timer } from "@phosphor-icons/react";
import type { Mode } from "../App";

const modes: { id: Mode; label: string; icon: ReactElement }[] = [
  { id: "lounge", label: "Lounge", icon: <ChatsCircle weight="fill" /> },
  { id: "work", label: "Work", icon: <Timer weight="fill" /> },
  { id: "dashboard", label: "Dashboard", icon: <ChartBar weight="fill" /> }
];

/** Room the native minimize / maximize / close buttons take at the top-right, in CSS px. */
type CaptionInset = { width: number; height: number };

/** `null` in a browser, on another OS, or while Windows still draws its ordinary title bar. */
function useCaptionInset(): CaptionInset | null {
  const [inset, setInset] = useState<CaptionInset | null>(null);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    invoke<CaptionInset | null>("caption_inset").then(value => { if (!gone) setInset(value); }).catch(() => undefined);
    listen<CaptionInset>("caption-inset", event => setInset(event.payload)).then(off => { if (gone) off(); else stop = off; }).catch(() => undefined);
    return () => { gone = true; stop?.(); };
  }, []);
  return inset;
}

/** The app's header: the Lounge / Work / Dashboard switch and Settings.
 *
 *  On Windows it is the window's whole top row. Windows still draws and runs the minimize /
 *  maximize / close buttons at the right (so Snap Layouts on hover, the system menu,
 *  double-click to maximize and drag-to-snap all stay), and this header simply stops short of
 *  them - `padding-right` is their width - while its empty space drags the window. Where the
 *  buttons can't be moved up it sits under the normal title bar instead. */
export function AppToolbar({ mode, onModeChange, onOpenSettings }: { mode: Mode; onModeChange: (mode: Mode) => void; onOpenSettings: () => void }) {
  const inset = useCaptionInset();
  return (
    <header
      className={`app-toolbar ${inset ? "in-title-bar" : ""}`}
      data-tauri-drag-region
      style={inset ? { paddingRight: inset.width + 8, ["--caption-h" as string]: `${inset.height}px` } : undefined}
    >
      <nav className="app-toolbar-modes" aria-label="Modes">
        {modes.map(entry => (
          <button
            key={entry.id}
            className={`app-toolbar-mode ${mode === entry.id ? "active" : ""}`}
            aria-pressed={mode === entry.id}
            onClick={() => onModeChange(entry.id)}
          >
            {entry.icon}<span>{entry.label}</span>
          </button>
        ))}
      </nav>
      <button className="toolbar-btn" title="Settings" onClick={onOpenSettings}><Gear /></button>
    </header>
  );
}
