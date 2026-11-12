import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type BuzzPayload = {
  style: "nudge" | "bluescreen";
  message: string;
  from: string;
  /** The tracker's own notices (a break ending) replace "Buzz from <name>". */
  title?: string | null;
  /** A "Your timer stopped" notice: it stays until the member closes it. */
  sticky?: boolean;
};

const NUDGE_SECONDS = 8;
const BLUESCREEN_SECONDS = 12;

/**
 * The window the Owner's buzz is drawn in (see src-tauri/src/buzz.rs). A joke, so it never
 * traps anyone: any click or key closes it, and it closes itself after a few seconds.
 *
 * A sticky notice (the timer stopped) is the exception: it does not count down and a stray
 * key does not close it - only its Close button does, so someone away from the desk still
 * finds out when they come back.
 */
export function BuzzView({ buzz, onClose }: { buzz: BuzzPayload; onClose: () => void }) {
  const total = buzz.style === "bluescreen" ? BLUESCREEN_SECONDS : NUDGE_SECONDS;
  const [elapsed, setElapsed] = useState(0);
  const sticky = Boolean(buzz.sticky);

  useEffect(() => {
    if (sticky) return;
    const tick = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(tick);
  }, [sticky]);
  useEffect(() => {
    if (!sticky && elapsed >= total) onClose();
  }, [sticky, elapsed, total, onClose]);
  useEffect(() => {
    if (sticky) return;
    const onKey = () => onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sticky, onClose]);

  if (buzz.style === "bluescreen") {
    const percent = Math.min(100, Math.round((elapsed / total) * 100));
    return (
      <div className="buzz-bsod" role="alertdialog" aria-label="Buzz" onClick={onClose}>
        <div className="buzz-bsod-face" aria-hidden="true">
          :(
        </div>
        <p className="buzz-bsod-lead">Your PC ran into a problem and needs you to focus.</p>
        <p className="buzz-bsod-progress">{percent}% complete</p>
        <p className="buzz-bsod-message">{buzz.message}</p>
        <p className="buzz-bsod-foot">
          Just kidding - this is a buzz from {buzz.from}. Click anywhere or press any key to close it.
        </p>
      </div>
    );
  }

  if (sticky) {
    return (
      <div className="buzz-nudge buzz-nudge-sticky" role="alertdialog" aria-label={buzz.title || "Notice"}>
        <span className="buzz-nudge-icon" aria-hidden="true">
          ⏸
        </span>
        <span className="buzz-nudge-body">
          <strong>{buzz.title || "Notice"}</strong>
          <span>{buzz.message}</span>
        </span>
        <button type="button" className="buzz-nudge-close" data-tip="Close this notice" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  return (
    <button type="button" className="buzz-nudge" data-tip="Close this buzz" onClick={onClose} aria-label="Dismiss buzz">
      <span className="buzz-nudge-icon" aria-hidden="true">
        ⚡
      </span>
      <span className="buzz-nudge-body">
        <strong>{buzz.title || `Buzz from ${buzz.from}`}</strong>
        <span>{buzz.message}</span>
      </span>
    </button>
  );
}

export function BuzzScreen() {
  const [buzz, setBuzz] = useState<BuzzPayload | null>(null);
  const close = useCallback(() => {
    void invoke("buzz_dismiss").catch(() => {
      /* running outside Tauri */
    });
  }, []);

  useEffect(() => {
    // The nudge window is transparent; the page behind it must be too.
    document.documentElement.classList.add("buzz-window");
    const take = () =>
      void invoke<BuzzPayload | null>("buzz_take")
        .then((payload) => {
          if (payload) setBuzz(payload);
          else close();
        })
        .catch(() => close());
    take();
    // A newer notice reuses this window instead of opening another (buzz.rs open_window).
    const unlisten = listen("buzz-refresh", take).catch(() => undefined);
    return () => {
      document.documentElement.classList.remove("buzz-window");
      void unlisten.then((stop) => stop?.());
    };
  }, [close]);

  // Keyed on the payload so a replacement restarts its countdown from zero.
  return buzz ? <BuzzView key={JSON.stringify(buzz)} buzz={buzz} onClose={close} /> : null;
}
