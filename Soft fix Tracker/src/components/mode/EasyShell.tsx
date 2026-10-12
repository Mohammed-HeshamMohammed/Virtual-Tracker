import type { CSSProperties } from "react";
import { ArrowsOutSimple, ChatsCircle, Check, Clock, ListChecks, Minus, Pause, Play, Plus, Stop, Target } from "@phosphor-icons/react";
import { formatDuration, useWorkspace, type Mode } from "../../workspace";
import { useWorkTimer } from "../../useWorkTimer";
import { LiveClock } from "../LiveClock";
import { ModeBar } from "./ModeBar";
import { useTodayStats } from "./useTodayStats";

/** Text sizes Easy mode steps through, as multiples of its base size. */
export const easyScales = [1, 1.25, 1.5, 1.75];

const nearestScale = (value: number) =>
  easyScales.reduce((best, step, index) => (Math.abs(step - value) < Math.abs(easyScales[best] - value) ? index : best), 0);

/** Easy mode: the same timer and tasks as the full app with large text, big buttons and only what
 *  a day's work needs. Everything else is one tap away, and opens in the full app. */
export function EasyShell() {
  const { projects, profile, preferences, setPreferences, setProjects, setViewMode, navigate, notify } = useWorkspace();
  const timer = useWorkTimer();
  const { todaySeconds, goalHours, progress, openTasks } = useTodayStats(timer.seconds);
  const project = projects.find((item) => item.id === timer.projectId);
  const choices = project?.tasks.filter((task) => !task.done || task.id === timer.taskId) ?? [];
  const state = timer.running ? "Working" : timer.active ? "Paused" : "Ready when you are";
  const step = nearestScale(preferences.easyScale);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const resize = (to: number) => setPreferences((old) => ({ ...old, easyScale: easyScales[Math.min(easyScales.length - 1, Math.max(0, to))] }));

  function toggleTask(projectId: string, taskId: string) {
    if (timer.active && timer.taskId === taskId) {
      notify("Finish your focus session before completing this task.");
      return;
    }
    setProjects((old) =>
      old.map((item) =>
        item.id === projectId ? { ...item, tasks: item.tasks.map((task) => (task.id === taskId ? { ...task, done: !task.done } : task)) } : item,
      ),
    );
  }

  function openInFullApp(mode?: Mode, section?: string) {
    if (mode) navigate(mode, section);
    setViewMode("full");
  }

  const tiles = [
    { label: "Messages", hint: "Chat with your team", icon: ChatsCircle, open: () => openInFullApp("lounge", "messages") },
    { label: "My timesheet", hint: "Review the hours you logged", icon: Clock, open: () => openInFullApp("work", "timesheet") },
    { label: "All my tasks", hint: "Plan and tick things off", icon: ListChecks, open: () => openInFullApp("work", "tasks") },
    { label: "Everything else", hint: "Open the full Soft Fix", icon: ArrowsOutSimple, open: () => openInFullApp() },
  ];

  return (
    <div className="mode-shell mode-easy" style={{ "--easy-scale": preferences.easyScale } as CSSProperties}>
      <ModeBar title="Easy mode">
        <div className="mode-size" role="group" aria-label="Text size">
          <button type="button" className="mode-icon-button" disabled={step === 0} title="Smaller text" aria-label="Smaller text" onClick={() => resize(step - 1)}>
            <Minus />
          </button>
          <span aria-hidden="true">Aa</span>
          <button type="button" className="mode-icon-button" disabled={step === easyScales.length - 1} title="Larger text" aria-label="Larger text" onClick={() => resize(step + 1)}>
            <Plus />
          </button>
        </div>
      </ModeBar>

      <main className="mode-body">

        <div className="easy-top">
          <header className="easy-hello">
            <h1>
              {greeting}, {profile.name.split(" ")[0]}
            </h1>
            <p>{new Date().toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}</p>
          </header>
          <section className="mode-card mode-today" aria-label="Today">
            <div className="mode-row">
              <span>
                <Target weight="fill" /> Today
              </span>
              <strong>
                {formatDuration(todaySeconds)} <small>of {goalHours}h</small>
              </strong>
            </div>
            <div className="mode-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="Progress toward your daily goal">
              <i style={{ width: `${progress}%` }} />
            </div>
            <p className="mode-hint">{progress >= 100 ? "Daily goal reached. Nicely done." : `${Math.round(progress)}% of your daily goal`}</p>
          </section>
        </div>

        <section className="mode-card mode-timer-card" aria-label="Timer">
          <div className="mode-pickers">
            <label>
              <span>Project</span>
              <select value={timer.projectId} disabled={timer.active} onChange={(event) => timer.selectProject(event.target.value)}>
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
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
                <Play weight="fill" /> {timer.active ? "Resume" : "Start working"}
              </button>
            )}
            <button type="button" className="mode-button" disabled={!timer.active} onClick={timer.stop}>
              <Stop weight="fill" /> Finish and save
            </button>
          </div>

          <input className="mode-input" value={timer.note} onChange={(event) => timer.setNote(event.target.value)} placeholder="Add a note about this session (optional)" aria-label="Session note" />
        </section>


        <section className="mode-card mode-tasks" aria-label="Your next tasks">
          <h2>Your next tasks</h2>
          {openTasks.length === 0 ? (
            <p className="mode-hint">Nothing left to do. Enjoy the quiet.</p>
          ) : (
            <ul>
              {openTasks.slice(0, 5).map((task) => (
                <li key={task.id} className={task.id === timer.taskId && timer.active ? "current" : ""}>
                  <button type="button" className="mode-check" aria-label={`Mark ${task.title} as done`} onClick={() => toggleTask(task.projectId, task.id)}>
                    <Check weight="bold" />
                  </button>
                  <span>
                    <strong>{task.title}</strong>
                    <small>{task.projectName}</small>
                  </span>
                  <button
                    type="button"
                    className="mode-button small"
                    disabled={timer.active}
                    title={timer.active ? "Finish the current session first" : undefined}
                    onClick={() => timer.begin(task.projectId, task.id)}
                  >
                    <Play weight="fill" /> Start
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <nav className="easy-tiles" aria-label="Open in the full app">
          {tiles.map((tile) => (
            <button key={tile.label} type="button" className="easy-tile" onClick={tile.open}>
              <tile.icon weight="duotone" />
              <strong>{tile.label}</strong>
              <small>{tile.hint}</small>
            </button>
          ))}
        </nav>
      </main>

      <footer className="mode-foot">
        <button type="button" className="mode-link" onClick={() => setViewMode("focus")}>
          Switch to Focus mode
        </button>
      </footer>
    </div>
  );
}
