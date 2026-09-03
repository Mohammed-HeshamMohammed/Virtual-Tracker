import { Icon } from "../common/Icon";
import type { TaskTimeTracking } from "../../types";

type SidebarActionsProps = {
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
      {paused ? (
        <button className="btn btn-primary" type="button" disabled={busy} onClick={onResume}>
          Resume tracking
        </button>
      ) : tracking ? (
        <div className="action-pair">
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={onPause}>
            Pause
          </button>
          <button className="btn btn-danger btn-compact" type="button" disabled={busy} onClick={onStopClick}>
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

      <button className="btn btn-secondary" type="button" onClick={onOpenDashboard}>
        Open dashboard
        <Icon name="external" />
      </button>

      <button className="btn-quiet" type="button" onClick={onSignInAgain}>
        Sign in again
      </button>
    </nav>
  );
}
