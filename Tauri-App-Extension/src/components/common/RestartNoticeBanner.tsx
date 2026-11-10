import type { RestartNotice } from "../../types";

type Props = {
  notice: RestartNotice;
  busy?: boolean;
  onStartAgain: () => void;
  onDismiss: () => void;
};

/** "14:05"-style time in the member's own clock; empty when the agent could not tell when. */
export function formatStoppedAt(stoppedAtMs: number): string {
  if (!Number.isFinite(stoppedAtMs) || stoppedAtMs <= 0) return "";
  return new Date(stoppedAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Said once after the app or the computer restarted while the timer was running. The timer stays
 * stopped on purpose (time between the stop and now is not tracked); this says so, and offers to
 * start the same work again in one click.
 */
export function RestartNoticeBanner({ notice, busy = false, onStartAgain, onDismiss }: Props) {
  const at = formatStoppedAt(notice.stoppedAtMs);
  const canStart = Boolean(notice.taskId || notice.projectId);
  return (
    <div data-help="Your timer was running when the app or computer restarted, so it stopped. Nothing is tracked until you start it again." className="tracker-update-banner state-error restart-notice-banner" role="alert">
      <div>
        <strong>Your timer stopped{at ? ` at ${at}` : ""}</strong>
        <span>The app or computer restarted while it was running. Time since then was not tracked.</span>
      </div>
      <div className="tracker-update-actions">
        {canStart ? (
          <button data-tip="Start the timer again on the same task or project" type="button" disabled={busy} onClick={onStartAgain}>
            {busy ? "Starting…" : "Start again"}
          </button>
        ) : null}
        <button data-tip="Hide this message without starting the timer" type="button" className="ghost" disabled={busy} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
