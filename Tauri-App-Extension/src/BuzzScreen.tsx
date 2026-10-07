import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type BuzzPayload = { style: "nudge" | "bluescreen"; message: string; from: string };

const NUDGE_SECONDS = 8;
const BLUESCREEN_SECONDS = 12;

/**
 * The window the Owner's buzz is drawn in (see src-tauri/src/buzz.rs). A joke, so it never
 * traps anyone: any click or key closes it, and it closes itself after a few seconds.
 */
export function BuzzView({ buzz, onClose }: { buzz: BuzzPayload; onClose: () => void }) {
  const total = buzz.style === "bluescreen" ? BLUESCREEN_SECONDS : NUDGE_SECONDS;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const tick = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(tick);
  }, []);
  useEffect(() => {
    if (elapsed >= total) onClose();
  }, [elapsed, total, onClose]);
  useEffect(() => {
    const onKey = () => onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  return (
    <button type="button" className="buzz-nudge" data-tip="Close this buzz" onClick={onClose} aria-label="Dismiss buzz">
      <span className="buzz-nudge-icon" aria-hidden="true">
        ⚡
      </span>
      <span className="buzz-nudge-body">
        <strong>Buzz from {buzz.from}</strong>
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
    void invoke<BuzzPayload | null>("buzz_take")
      .then((payload) => {
        if (payload) setBuzz(payload);
        else close();
      })
      .catch(() => close());
    return () => document.documentElement.classList.remove("buzz-window");
  }, [close]);

  return buzz ? <BuzzView buzz={buzz} onClose={close} /> : null;
}
