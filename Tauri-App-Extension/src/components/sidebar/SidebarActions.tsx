import { Icon } from "../common/Icon";
import type { TaskTimeTracking } from "../../types";

type SidebarActionsProps = {
  /** False in Focus, where the tracking card has its own play/pause and Stop. */
  showSessionButtons?: boolean;
  paused: boolean;
  tracking: boolean;
  busy: boolean;
  taskRequired: boolean;
  selectedTaskId: string;
  selectedProjectId: string;
  taskTracking: TaskTimeTracking | null;
  onResume: () => void;
  onPause: () => void;
  onStopClick: () => void;
  onStart: () => void;
  onOpenDashboard: () => void;
  onSignInAgain: () => void;
};

export function SidebarActions({
  showSessionButtons = true,
  paused,
  tracking,
  busy,
  taskRequired,
  selectedTaskId,
  selectedProjectId,
  taskTracking,
  onResume,
  onPause,
  onStopClick,
  onStart,
  onOpenDashboard,
  onSignInAgain,
}: SidebarActionsProps) {
  return (
    <nav className="actions side-panel-swap" style={{ animationDelay: "0.06s" }}>
      {!showSessionButtons ? null : paused ? (
        <div className="action-pair">
          <button data-tip="Resume the timer after your break" className="btn btn-primary" type="button" disabled={busy} onClick={onResume}>
            Resume tracking
          </button>
          <button data-tip="Stop the timer and save your time" className="btn btn-danger btn-compact" type="button" disabled={busy} onClick={onStopClick}>
            Stop
          </button>
        </div>
      ) : tracking ? (
        <div className="action-pair">
          <button data-tip="Pause the timer for a break. It resumes by itself after the project's break time" className="btn btn-secondary" type="button" disabled={busy} onClick={onPause}>
            Pause
          </button>
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
