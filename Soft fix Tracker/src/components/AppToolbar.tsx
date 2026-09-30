import type { ReactElement } from "react";
import { ChartBar, ChatsCircle, Gear, Timer } from "@phosphor-icons/react";
import type { Mode } from "../App";

const modes: { id: Mode; label: string; icon: ReactElement }[] = [
  { id: "lounge", label: "Lounge", icon: <ChatsCircle weight="fill" /> },
  { id: "work", label: "Work", icon: <Timer weight="fill" /> },
  { id: "dashboard", label: "Dashboard", icon: <ChartBar weight="fill" /> }
];

/** The Lounge / Work / Dashboard switch and Settings, directly under the window's own title
 *  bar. The title bar and its minimize / maximize / close buttons are Windows' - not drawn
 *  here - so they keep everything the system gives them (Snap Layouts on hover, the system
 *  menu, double-click to maximize, drag-to-snap). The shell recolours that bar to match this
 *  one, so the two read as a single header. */
export function AppToolbar({ mode, onModeChange, onOpenSettings }: { mode: Mode; onModeChange: (mode: Mode) => void; onOpenSettings: () => void }) {
  return (
    <header className="app-toolbar">
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
