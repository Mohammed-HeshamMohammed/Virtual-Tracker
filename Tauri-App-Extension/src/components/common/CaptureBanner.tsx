import { useEffect, useState } from "react";
import type { CaptureStatus } from "../../types";
import { formatRemaining, isOnBreak } from "../../utils/privacy";

type Props = {
  status: CaptureStatus;
  busy?: boolean;
  onEndBreak: () => void;
  onOpenPrivacy: () => void;
};

/**
 * Says so when nothing is being captured. Without it a member on a break, or past
 * the end of their hours, has no way to tell "not tracking" from "tracking and
 * broken" - and that ambiguity is the worst thing this app can leave someone with.
 */
export function CaptureBanner({ status, busy = false, onEndBreak, onOpenPrivacy }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!status.blocked) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [status.blocked]);

  // A fault is shown only when capture is otherwise meant to be running - while it is
  // blocked on purpose the screen is not being tried, so it would be the wrong reason.
  if (!status.blocked) {
    if (!status.issue) return null;
    return (
      <div data-help="Tells you when nothing is being captured and why: a private break, time outside your work hours, or screenshots failing on this device." className="tracker-update-banner state-error capture-banner" role="alert">
        <div>
          <strong>Screenshots are failing</strong>
          <span>{status.issue}</span>
        </div>
      </div>
    );
  }

  const onBreak = isOnBreak(status, now);
  const remaining = onBreak ? formatRemaining(status.breakUntilMs, now) : "";

  return (
    <div data-help="Tells you when nothing is being captured and why: a private break, time outside your work hours, or screenshots failing on this device." className="tracker-update-banner capture-banner" role="status">
      <div>
        <strong>{onBreak ? "Private break" : "Not capturing"}</strong>
        <span>
          {status.reason}
          {remaining ? ` ${remaining}.` : ""}
        </span>
      </div>
      <div className="tracker-update-actions">
        {onBreak ? (
          <button data-tip="End your private break. The timer resumes and capture starts again" type="button" disabled={busy} onClick={onEndBreak}>
            End break
          </button>
        ) : (
          <button data-tip="Open Privacy to see what is collected and to manage breaks" type="button" className="ghost" onClick={onOpenPrivacy}>
            Privacy
          </button>
        )}
      </div>
    </div>
  );
}
