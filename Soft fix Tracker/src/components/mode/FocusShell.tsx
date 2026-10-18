import { ProjectAvatar, ProjectLabel } from "../ProjectAvatar";
import { ArrowsOutSimple, Pause, Play, PushPin, Stop, TextAa } from "@phosphor-icons/react";
import { formatDuration, useWorkspace } from "../../workspace";
import { useWorkTimer } from "../../useWorkTimer";
import { LiveClock } from "../LiveClock";
import { ModeBar } from "./ModeBar";
import { useTodayStats } from "./useTodayStats";

/** Focus mode: a small window, in front of everything by default, that is only the timer. Pick what
 *  you are working on, start, and get on with it; the full app is one click away. */
export function FocusShell() {
  const { projects, preferences, setPreferences, setViewMode } = useWorkspace();
  const timer = useWorkTimer();
  const { todaySeconds, goalHours, progress, openTasks } = useTodayStats(timer.seconds);
  const project = projects.find((item) => item.id === timer.projectId);
  const choices = project?.tasks.filter((task) => !task.done || task.id === timer.taskId) ?? [];
  const state = timer.running ? "Tracking" : timer.active ? "Paused" : "Ready";
  const upNext = openTasks.filter((task) => task.id !== timer.taskId).slice(0, 2);

  return (
    <div className="mode-shell mode-focus">
      <ModeBar title="Focus">
        <button
          type="button"
          className={`mode-icon-button ${preferences.focusOnTop ? "on" : ""}`}
          aria-pressed={preferences.focusOnTop}
          title={preferences.focusOnTop ? "Stays in front of other windows" : "Keep in front of other windows"}
          aria-label="Keep in front of other windows"
          onClick={() => setPreferences((old) => ({ ...old, focusOnTop: !old.focusOnTop }))}
        >
          <PushPin weight={preferences.focusOnTop ? "fill" : "regular"} />
        </button>
        <button type="button" className="mode-icon-button" title="Open the full app" aria-label="Open the full app" onClick={() => setViewMode("full")}>
          <ArrowsOutSimple />
        </button>
      </ModeBar>

      <main className="mode-body">
        <section className="mode-card mode-timer-card" aria-label="Timer">
          <div className="mode-pickers">
            <label>
              <span>Project</span>
              <div className="mode-project-select"><ProjectAvatar projectId={timer.projectId} size="sm" /><select value={timer.projectId} disabled={timer.active} onChange={(event) => timer.selectProject(event.target.value)}>
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select></div>
            </label>
            <label>
              <span>Task</span>
              <select value={timer.taskId ?? ""} disabled={timer.active} onChange={(event) => timer.selectTask(event.target.value)}>
                {!choices.length && <option value="">No open tasks</option>}
                {choices.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <LiveClock className="mode-clock" startedAt={timer.startedAt} baseSeconds={timer.baseSeconds} label={`${state}, ${formatDuration(timer.seconds)}`} />
          <p className={`mode-state ${timer.running ? "running" : ""}`}>
            <i /> {state}
          </p>

          <div className="mode-actions">
            {timer.running ? (
              <button type="button" className="mode-button" onClick={timer.pause}>
                <Pause weight="fill" /> Pause
              </button>
            ) : (
              <button type="button" className="mode-button primary" disabled={!timer.canStart} onClick={timer.start}>
                <Play weight="fill" /> {timer.active ? "Resume" : "Start"}
              </button>
            )}
            <button type="button" className="mode-button" disabled={!timer.active} onClick={timer.stop} title="Stop and save to your timesheet">
              <Stop weight="fill" /> Stop
            </button>
          </div>

          <input
            className="mode-input"
            value={timer.note}
            onChange={(event) => timer.setNote(event.target.value)}
            placeholder="What are you working on?"
            aria-label="Session note"
          />
        </section>

        <section className="mode-card mode-today" aria-label="Today">
          <div className="mode-row">
            <span>Today</span>
            <strong>
              {formatDuration(todaySeconds)} <small>of {goalHours}h</small>
            </strong>
          </div>
          <div className="mode-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="Progress toward your daily goal">
            <i style={{ width: `${progress}%` }} />
          </div>
        </section>

        {upNext.length > 0 && (
          <section className="mode-card mode-next" aria-label="Up next">
            <h2>Up next</h2>
            <ul>
              {upNext.map((task) => (
                <li key={task.id}>
                  <span>
                    <strong>{task.title}</strong>
                    <small><ProjectLabel projectId={task.projectId} /></small>
                  </span>
                  <button
                    type="button"
                    className="mode-icon-button"
                    disabled={timer.active}
                    title={timer.active ? "Stop the current session first" : "Start this task"}
                    aria-label={`Start ${task.title}`}
                    onClick={() => timer.begin(task.projectId, task.id)}
                  >
                    <Play weight="fill" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="mode-foot">
        <button type="button" className="mode-link" onClick={() => setViewMode("easy")}>
          <TextAa /> Easy mode
        </button>
        <button type="button" className="mode-link" onClick={() => setViewMode("full")}>
          Open Soft Fix <ArrowsOutSimple />
        </button>
      </footer>
    </div>
  );
}
