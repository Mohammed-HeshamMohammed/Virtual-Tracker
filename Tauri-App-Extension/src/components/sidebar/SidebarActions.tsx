import { Icon } from "../common/Icon";
import type { TaskTimeTracking } from "../../types";

type SidebarActionsProps = {
  /** False in Focus, where the tracking card has its own play/pause and Stop. */
  showSessionButtons?: boolean;
  paused: boolean;
  /** The timer is stopped for a Break rather than a Pause. */
  onBreak?: boolean;
  tracking: boolean;
  busy: boolean;
  taskRequired: boolean;
  selectedTaskId: string;
  selectedProjectId: string;
  taskTracking: TaskTimeTracking | null;
  onResume: () => void;
  onPause: () => void;
  /** Away from everything: the timer stops, nothing is captured, the project's break time ends it. */
  onStartBreak?: () => void;
  onStopClick: () => void;
  onStart: () => void;
  onOpenDashboard: () => void;
  onSignInAgain: () => void;
};

export function SidebarActions({
  showSessionButtons = true,
  paused,
  onBreak = false,
  tracking,
  busy,
  taskRequired,
  selectedTaskId,
  selectedProjectId,
  taskTracking,
  onResume,
  onPause,
  onStartBreak,
  onStopClick,
  onStart,
  onOpenDashboard,
  onSignInAgain,
}: SidebarActionsProps) {
  return (
    <nav className="actions side-panel-swap" style={{ animationDelay: "0.06s" }}>
      {!showSessionButtons ? null : paused ? (
        <div className="action-pair">
          <button
            data-tip={onBreak ? "Come back from your break and start the timer again" : "Start the timer again - you are back to work"}
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={onResume}
          >
            Resume tracking
          </button>
          <button data-tip="Stop the timer and save your time" className="btn btn-danger btn-compact" type="button" disabled={busy} onClick={onStopClick}>
            Stop
          </button>
        </div>
      ) : tracking ? (
        <div className="action-pair">
          <button data-tip="Pause: you are still at your desk but not working on this. The timer stops and your apps and websites are still recorded. It only starts again when you resume" className="btn btn-secondary" type="button" disabled={busy} onClick={onPause}>
            Pause
          </button>
          {onStartBreak ? (
            <button data-tip="Break: you are away from your desk. The timer stops and nothing is captured. It starts again by itself after the project's break time, or when you resume" className="btn btn-secondary" type="button" disabled={busy} onClick={onStartBreak}>
              Break
            </button>
          ) : null}
          <button data-tip="Stop the timer and save your time" className="btn btn-danger btn-compact" type="button" disabled={busy} onClick={onStopClick}>
            Stop
          </button>
        </div>
      ) : (
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy || (taskRequired ? !selectedTaskId : !selectedProjectId) || Boolean(taskTracking?.limitReached)}
          title={taskTracking?.limitReached ? taskTracking.allowanceMessage || "Maximum allowed work time reached." : undefined}
          onClick={onStart}
        >
          Start tracking
        </button>
      )}

      <button data-tip="Open the web dashboard in your browser" className="btn btn-secondary" type="button" onClick={onOpenDashboard}>
        Open dashboard
        <Icon name="external" />
      </button>

      <button data-tip="Open the browser sign-in page to sign in again" className="btn-quiet" type="button" onClick={onSignInAgain}>
        Sign in again
      </button>
    </nav>
  );
}
