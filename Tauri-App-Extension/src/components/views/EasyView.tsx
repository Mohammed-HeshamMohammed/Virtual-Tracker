import { useState } from "react";
import { Icon } from "../common/Icon";
import { fmtClock, fmtHours } from "../../utils/formatters";
import type { AgentTask, ConnectionState, ProjectInfo } from "../../types";

/** Text sizes the member can step through, as a multiple of the layout's own large base. */
export const EASY_TEXT_SCALES = [1, 1.25, 1.5, 1.75] as const;
const SCALE_KEY = "vt-easy-text-scale";

function readScaleIndex(): number {
  try {
    const stored = Number(localStorage.getItem(SCALE_KEY));
    const index = EASY_TEXT_SCALES.findIndex((s) => s === stored);
    return index === -1 ? 0 : index;
  } catch {
    return 0;
  }
}

type EasyViewProps = {
  projects: ProjectInfo[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  /** Open tasks of the selected project. */
  tasks: AgentTask[];
  selectedTaskId: string;
  onSelectTask: (taskId: string) => void;
  taskRequired: boolean;
  tracking: boolean;
  paused: boolean;
  busy: boolean;
  /** Time worked today, live. */
  seconds: number;
  dailyLimitHours: number;
  workedTodaySeconds: number | null;
  /** Why Start is unavailable right now; empty when it is available. */
  startBlockedReason: string;
  connection: ConnectionState;
  reconnecting: boolean;
  onReconnect: () => void;
  wallClock: string;
  wallDate: string;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
  onOpenDashboard: () => void;
};

/**
 * The "Easy read" layout, for people who cannot see small text well: only what is
 * needed to track - what you are working on, the time, and Start / Pause / Stop -
 * in large type with high contrast, in one column. Everything else the other layouts
 * show (stats, apps, screenshots, team) is left out on purpose; it is all still in
 * the other layouts and the web dashboard.
 *
 * It uses plain labelled <select>s and buttons so screen readers and the OS's own
 * text scaling work as they do everywhere else.
 */
export function EasyView(props: EasyViewProps) {
  const {
    projects,
    selectedProjectId,
    tasks,
    selectedTaskId,
    taskRequired,
    tracking,
    paused,
    busy,
    startBlockedReason,
  } = props;
  const [scaleIndex, setScaleIndex] = useState(readScaleIndex);
  const scale = EASY_TEXT_SCALES[scaleIndex];
  const sessionOpen = tracking || paused;

  function changeScale(next: number) {
    const index = Math.min(EASY_TEXT_SCALES.length - 1, Math.max(0, next));
    setScaleIndex(index);
    try {
      localStorage.setItem(SCALE_KEY, String(EASY_TEXT_SCALES[index]));
    } catch {
      /* Storage can be unavailable - the size still applies for this run. */
    }
  }

  const status = tracking ? "Tracking" : paused ? "On a break" : "Not tracking";
  const showTaskPicker = tasks.length > 0 || taskRequired;
  const limitLeft =
    props.dailyLimitHours > 0 && props.workedTodaySeconds != null
      ? Math.max(0, props.dailyLimitHours * 3600 - props.workedTodaySeconds)
      : null;
  const selectionLocked = busy || sessionOpen;

  return (
    <div className="easy-view" style={{ ["--easy-scale" as string]: scale }}>
      <header className="easy-top">
        <div className="easy-clock" data-help="The current time and date.">
          <strong>{props.wallClock}</strong>
          <span>{props.wallDate}</span>
        </div>
        <p className={`easy-status ${tracking ? "is-tracking" : paused ? "is-paused" : "is-idle"}`} role="status" aria-live="polite">
          <span className="easy-status-dot" aria-hidden="true" />
          {status}
        </p>
      </header>

      {props.connection === "disconnected" ? (
        <div className="easy-alert" role="alert">
          <span>Connection lost. Your time is still being counted here.</span>
          <button data-tip="Try to reconnect to the server. Your time is still being counted here" type="button" className="easy-btn easy-btn-secondary" disabled={props.reconnecting} onClick={props.onReconnect}>
            {props.reconnecting ? "Reconnecting…" : "Reconnect"}
          </button>
        </div>
      ) : null}

      <section className="easy-card" aria-label="What you are working on">
        <label className="easy-field">
          <span className="easy-label">Project</span>
          <select
            data-help="The project you are working on. You can change it when the timer is stopped."
            value={selectedProjectId}
            disabled={selectionLocked || projects.length === 0}
            onChange={(e) => props.onSelectProject(e.target.value)}
          >
            {selectedProjectId === "" ? <option value="">Choose a project</option> : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id} disabled={project.budgetExhausted && project.id !== selectedProjectId}>
                {project.name}
                {project.budgetExhausted ? " (budget used up)" : ""}
              </option>
            ))}
          </select>
        </label>

        {showTaskPicker ? (
          <label className="easy-field">
            <span className="easy-label">Task</span>
            <select
              data-help="The task you are working on. You can change it when the timer is stopped."
              value={selectedTaskId}
              disabled={selectionLocked || tasks.length === 0}
              onChange={(e) => props.onSelectTask(e.target.value)}
            >
              {selectedTaskId === "" ? <option value="">{taskRequired ? "Choose a task" : "No task"}</option> : null}
              {!taskRequired && selectedTaskId !== "" ? <option value="">No task</option> : null}
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {sessionOpen ? <p className="easy-note">Stop the timer to change the project or task.</p> : null}
      </section>

      <section className="easy-timer" aria-label="Time worked today">
        <span className="easy-timer-value" aria-live="off">
          {fmtClock(props.seconds)}
        </span>
        <span className="easy-timer-label">Worked today</span>
        {limitLeft != null ? (
          <span className="easy-timer-limit">
            {limitLeft > 0 ? `${fmtHours(limitLeft)} left of your ${props.dailyLimitHours}h daily limit` : "Daily limit reached"}
          </span>
        ) : null}
      </section>

      <div className="easy-actions">
        {paused ? (
          <>
            <button data-tip="Resume the timer after your break" type="button" className="easy-btn easy-btn-primary" disabled={busy} onClick={props.onResume}>
              Resume
            </button>
            <button data-tip="Stop the timer and save your time" type="button" className="easy-btn easy-btn-danger" disabled={busy} onClick={props.onStop}>
              Stop
            </button>
          </>
        ) : tracking ? (
          <>
            <button data-tip="Pause the timer for a break" type="button" className="easy-btn easy-btn-secondary" disabled={busy} onClick={props.onPause}>
              Pause
            </button>
            <button data-tip="Stop the timer and save your time" type="button" className="easy-btn easy-btn-danger" disabled={busy} onClick={props.onStop}>
              Stop
            </button>
          </>
        ) : (
          <button
            data-tip={startBlockedReason || "Start the timer"}
            type="button"
            className="easy-btn easy-btn-primary easy-btn-wide"
            disabled={busy || Boolean(startBlockedReason)}
            onClick={props.onStart}
          >
            Start
          </button>
        )}
      </div>
      {!sessionOpen && startBlockedReason ? (
        <p className="easy-blocked" role="status">
          {startBlockedReason}
        </p>
      ) : null}

      <nav className="easy-footer" aria-label="More">
        <button data-tip="Open your settings, including the window layout" type="button" className="easy-btn easy-btn-quiet" onClick={props.onOpenSettings}>
          <Icon name="gear" />
          Settings
        </button>
        <button data-tip="Open your profile" type="button" className="easy-btn easy-btn-quiet" onClick={props.onOpenProfile}>
          Profile
        </button>
        <button data-tip="Open the web dashboard in your browser" type="button" className="easy-btn easy-btn-quiet" onClick={props.onOpenDashboard}>
          Dashboard
          <Icon name="external" />
        </button>
        <span className="easy-size" role="group" aria-label="Text size">
          <button
            data-tip="Make the text smaller"
            type="button"
            className="easy-btn easy-btn-quiet"
            aria-label="Smaller text"
            disabled={scaleIndex === 0}
            onClick={() => changeScale(scaleIndex - 1)}
          >
            A−
          </button>
          <button
            data-tip="Make the text larger"
            type="button"
            className="easy-btn easy-btn-quiet"
            aria-label="Larger text"
            disabled={scaleIndex === EASY_TEXT_SCALES.length - 1}
            onClick={() => changeScale(scaleIndex + 1)}
          >
            A+
          </button>
        </span>
      </nav>
    </div>
  );
}
