import type { ComponentProps } from "react";
import { fmtClock } from "../../utils/formatters";
import { SessionControls } from "./SessionControls";

type MiniTimerProps = {
  seconds: number;
  label: string;
  controls: ComponentProps<typeof SessionControls>;
  onExit: () => void;
};

/**
 * The whole window while the mini timer is on: the clock and the session buttons only,
 * kept above other windows (src-tauri/src/mini_mode.rs). Dragging anywhere but a button
 * moves it; the corner button goes back to the full tracker.
 */
export function MiniTimer({ seconds, label, controls, onExit }: MiniTimerProps) {
  return (
    <main className="mini-timer" data-tauri-drag-region>
      <span className="mini-timer-value" data-tauri-drag-region>
        {fmtClock(seconds)}
      </span>
      <span className="mini-timer-label" data-tauri-drag-region>
        {label}
      </span>
      <SessionControls {...controls} />
      <button
        type="button"
        className="mini-timer-exit"
        title="Back to the full tracker"
        aria-label="Back to the full tracker"
        onClick={onExit}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 4h6v6h-2V7.41l-4.29 4.3-1.42-1.42L16.59 6H14V4ZM4 14h2v2.59l4.29-4.3 1.42 1.42L7.41 18H10v2H4v-6Z" />
        </svg>
      </button>
    </main>
  );
}
