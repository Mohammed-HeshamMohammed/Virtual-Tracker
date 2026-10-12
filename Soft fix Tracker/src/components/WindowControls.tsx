import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Minimize / maximize-restore / close, drawn by the app so they take the header's height and
 *  colours. Only rendered inside the desktop shell, where the window has no native title bar.
 *
 *  On Windows 11 the host lays an invisible native window over the maximize button so Windows
 *  shows its Snap Layouts flyout there. That window takes the pointer, so it tells us
 *  (`snap-button`) when the button is hovered or pressed and does the maximize / restore itself.
 *
 *  `compact` leaves the maximize button out, for the small Focus and Easy windows. */
export function WindowControls({ compact = false }: { compact?: boolean }) {
  const [maximized, setMaximized] = useState(false);
  const [snap, setSnap] = useState({ hover: false, pressed: false });
  const maximizeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const win = getCurrentWindow();
    let stops: (() => void)[] = [];
    let gone = false;
    const keep = (off: () => void) => {
      if (gone) off();
      else stops.push(off);
    };

    const syncMaximized = () =>
      win
        .isMaximized()
        .then((value) => {
          if (!gone) setMaximized(value);
        })
        .catch(() => undefined);
    const reportButton = () => {
      const box = maximizeRef.current?.getBoundingClientRect();
      if (!box) return;
      invoke("snap_button_rect", {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      }).catch(() => undefined);
    };
    const onResize = () => {
      void syncMaximized();
      requestAnimationFrame(reportButton);
    };

    onResize();
    window.addEventListener("resize", onResize);
    win.onResized(onResize).then(keep).catch(() => undefined);
    listen<[boolean, boolean]>("snap-button", (event) =>
      setSnap({ hover: event.payload[0], pressed: event.payload[1] }),
    )
      .then(keep)
      .catch(() => undefined);
    return () => {
      gone = true;
      window.removeEventListener("resize", onResize);
      stops.forEach((off) => off());
      stops = [];
      // The maximize button is going away: collapse the native overlay that sat over it.
      invoke("snap_button_rect", { x: 0, y: 0, width: 0, height: 0 }).catch(() => undefined);
    };
  }, [compact]);

  const run = (action: "minimize" | "toggleMaximize" | "close") => () => {
    void getCurrentWindow()[action]().catch(() => undefined);
  };

  return (
    <div className="window-controls" role="group" aria-label="Window controls">
      <button
        type="button"
        className="window-control"
        title="Minimize"
        aria-label="Minimize"
        onClick={run("minimize")}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      {!compact && (
        <button
          ref={maximizeRef}
          type="button"
          className={`window-control ${snap.hover ? "snap-hover" : ""} ${snap.pressed ? "snap-pressed" : ""}`}
          title={maximized ? "Restore" : "Maximize"}
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={run("toggleMaximize")}
        >
          <svg
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {maximized ? (
              <>
                <path d="M3.75 3.75V2.6a.85.85 0 0 1 .85-.85h4.8a.85.85 0 0 1 .85.85v4.8a.85.85 0 0 1-.85.85H8.25" />
                <rect x="1.75" y="3.75" width="6.5" height="6.5" rx="1.25" />
              </>
            ) : (
              <rect x="1.75" y="1.75" width="8.5" height="8.5" rx="1.5" />
            )}
          </svg>
        </button>
      )}
      <button
        type="button"
        className="window-control close"
        title="Close"
        aria-label="Close"
        onClick={run("close")}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
