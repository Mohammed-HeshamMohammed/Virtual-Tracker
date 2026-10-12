import { ArrowRight, ArrowUpRight, CaretDown, Check, CheckCircle, Clock, Flame, Pause, Play, Stop, Target } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { formatDuration, useWorkspace } from "../../workspace";
import { LiveClock } from "../LiveClock";
import { MenuButton, type MenuEntry } from "../MenuButton";
import { Tip } from "../Tip";
import "./work-flow.css";
import { WorkTeamPane } from "./WorkTeamPane";

export function clockDuration(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, "0")).join(":");
}
export function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export type PlanBlock = { id: string; date: string; time: string; minutes: number; title: string; projectId: string; done: boolean };

type Props = { seconds: number; note: string; onNote: (value: string) => void; onStart: () => void; onPause: () => void; onStop: () => void; viewProjectId: string; onFocusTask: (projectId: string, taskId: string) => void; onAddTask: () => void; onToggleTask: (projectId: string, taskId: string) => void; onTrackTask: (projectId: string, taskId: string) => void; plan: PlanBlock[]; onPlanToggle: (id: string) => void };

export function WorkHome({ seconds, note, onNote, onStart, onPause, onStop, viewProjectId, onFocusTask, onAddTask, onToggleTask, onTrackTask, plan, onPlanToggle }: Props) {
  const { projects, timer, sessions, profile, preferences, navigate, members, openChat } = useWorkspace();
  const project = projects.find(item => item.id === timer.projectId);
  const tasks = projects.flatMap(item => item.tasks.map(task => ({ ...task, projectId: item.id, projectName: item.name, color: item.color })));
  const today = dateKey(new Date());
  const weekStartDate = new Date();
  const firstDay = preferences.weekStart === "Sunday" ? 0 : preferences.weekStart === "Saturday" ? 6 : 1;
  weekStartDate.setDate(weekStartDate.getDate() - ((weekStartDate.getDay() - firstDay + 7) % 7));
  weekStartDate.setHours(0, 0, 0, 0);
  const nextWeekDate = new Date(weekStartDate);
  nextWeekDate.setDate(nextWeekDate.getDate() + 7);
  const ownSessions = sessions.filter(session => session.memberId === "me");
  const todaySeconds = ownSessions.filter(session => dateKey(new Date(session.startedAt)) === today).reduce((sum, item) => sum + item.seconds, 0) + seconds;
  const weeklySessions = ownSessions.filter(session => new Date(session.startedAt) >= weekStartDate && new Date(session.startedAt) < nextWeekDate);
  const weekSeconds = weeklySessions.reduce((sum, item) => sum + item.seconds, 0) + seconds;
  const dailyGoal = preferences.dailyGoal * 3600;
  const progress = Math.min(100, todaySeconds / dailyGoal * 100);
  const active = timer.startedAt !== null || timer.elapsed > 0;
  const focusedTask = project?.tasks.find(task => task.id === timer.taskId);
  // Up next shows the open tasks of the project picked in the sidebar.
  const openTasks = tasks.filter(task => !task.done);
  const viewProject = projects.find(item => item.id === viewProjectId) ?? project;
  const upNext = openTasks.filter(task => task.projectId === viewProject?.id).slice(0, 8);
  const trackedOn = (taskId: string) => ownSessions.filter(session => session.taskId === taskId).reduce((sum, session) => sum + session.seconds, 0);
  // The same choice as a menu inside the card: every open task, under its project.
  const taskMenu: MenuEntry[] = projects.flatMap((item): MenuEntry[] => {
    const choices = item.tasks.filter(task => !task.done || task.id === timer.taskId);
    // A project that doesn't need a task (Calling, Support, a retainer...) can be timed as it is.
    const itself: MenuEntry[] = item.requireTask === false ? [{ kind: "item", id: `${item.id}-itself`, label: item.tasks.length ? "The project itself" : "Time this project", detail: "No task needed", active: timer.projectId === item.id && !timer.taskId, onSelect: () => onFocusTask(item.id, "") }] : [];
    return choices.length || itself.length ? [{ kind: "heading", label: item.name }, ...choices.map((task): MenuEntry => ({ kind: "item", id: task.id, label: task.title, active: task.id === timer.taskId, onSelect: () => onFocusTask(item.id, task.id) })), ...itself] : [];
  });
  const todayPlan = plan.filter(block => block.date === today).sort((a, b) => a.time.localeCompare(b.time)).slice(0, 3);
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";
  const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(weekStartDate); date.setDate(date.getDate() + index); return { key: dateKey(date), label: date.toLocaleDateString("en", { weekday: "short" }), hours: ownSessions.filter(session => dateKey(new Date(session.startedAt)) === dateKey(date)).reduce((sum, session) => sum + session.seconds / 3600, 0) + (dateKey(date) === today ? seconds / 3600 : 0) }; });
  return (
    <div className="sf-page wk-overview">
      <header className="sf-page-header"><div><span className="wk-eyebrow">YOUR SPACE TO FOCUS</span><h1>{greeting}, {profile.name.split(" ")[0]}<span className="wk-greeting-dot">.</span></h1><p>A little focus. A little progress. A great day ahead.</p></div><div className="wk-date-pill"><span>{new Date().toLocaleDateString("en", { weekday: "long" })}</span><strong>{new Date().toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}</strong></div></header>
      <div className="wk-metric-grid">
        <div className="sf-card wk-metric"><span><Clock size={18} /> Time today</span><strong>{formatDuration(todaySeconds)}</strong><small><span className="wk-green-text">{Math.round(progress)}%</span> of your {preferences.dailyGoal}h daily goal</small></div>
        <div className="sf-card wk-metric"><span><CheckCircle size={18} /> Tasks completed</span><strong>{tasks.filter(task => task.done).length}<em> / {tasks.length}</em></strong><small>Every small win counts</small></div>
        <div className="sf-card wk-metric"><span><Target size={18} /> This week</span><strong>{formatDuration(weekSeconds)}</strong><small>Across {new Set(weeklySessions.map(item => item.projectId)).size} projects</small></div>
        <div className="sf-card wk-metric"><span><Flame size={18} /> Focus sessions</span><strong>{ownSessions.filter(session => dateKey(new Date(session.startedAt)) === today).length}</strong><small>Completed today</small></div>
      </div>
      <div className="wk-overview-grid">
        <div className="wk-overview-primary">
          <section className={`sf-card wk-focus-card ${timer.startedAt ? "is-running" : ""}`}>
            <div className="wk-card-heading"><div><span className="wk-eyebrow">ONE THING AT A TIME</span><h2>Your focus session</h2></div><span className={`wk-status-pill ${timer.startedAt ? "running" : ""}`}><i />{timer.startedAt ? "Timer running" : timer.elapsed > 0 ? "Session paused" : "Ready when you are"}</span></div>
            <div className="wk-focus-context">
              <span className="wk-focus-label">WORKING ON</span>
              <div className="wk-focus-pick">
                <span className="wk-focus-copy">
                  <small><span className={`wk-project-dot ${project?.color ?? ""}`} />{project?.name ?? "No project"}</small>
                  <strong>{focusedTask?.title ?? (project && project.requireTask === false && !timer.taskId ? project.name : "Choose a task to begin")}</strong>
                </span>
                {!active && taskMenu.length > 0 && <MenuButton label="Choose what to work on" title="Choose what to work on" align="end" className="wk-focus-menu" fixed entries={taskMenu}>Change <CaretDown size={13} weight="bold" /></MenuButton>}
              </div>
              {!focusedTask && !active && <p>Pick a task from Up next, or use Change.</p>}
            </div>
            <div className="wk-timer"><LiveClock startedAt={timer.startedAt} baseSeconds={timer.elapsed} label={`${seconds} seconds elapsed`} /><p>{timer.startedAt ? "You're making space for meaningful work." : timer.elapsed ? "Take a breath. Your progress is saved." : "Your next great idea starts with a little focus."}</p></div>
            <div className="wk-timer-actions">{timer.startedAt !== null ? <button className="sf-button wk-pause-button" onClick={onPause}><Pause weight="fill" size={18} /> Pause session</button> : <button className="sf-button primary wk-start-button" onClick={onStart} disabled={(project?.requireTask ?? true) && (!timer.taskId || !project?.tasks.find(task => task.id === timer.taskId && !task.done))}><Play weight="fill" size={18} />{timer.elapsed ? "Resume session" : "Start focus session"}</button>}{active && <button className="sf-button wk-finish-button" onClick={onStop}><Stop size={17} weight="fill" /> Finish</button>}</div>
            <label className="wk-session-note"><span>SESSION NOTE <small>Optional</small></span><input className="sf-input" value={note} onChange={event => onNote(event.target.value)} placeholder="What are you working towards?" maxLength={300} /></label>
            <div className="wk-focus-footer"><span><span className="wk-green-dot" /> {active ? "Finish this session before switching tasks" : "Choose a task and make it happen"}</span><button className="wk-text-button" onClick={() => navigate("work", "timesheet")}>Session history <ArrowUpRight size={15} /></button></div>
          </section>
          <section className="sf-card wk-next-card">
            <div className="wk-card-heading"><div><span className="wk-eyebrow">KEEP THE MOMENTUM</span><h2>Up next</h2>{viewProject && <span className="wk-next-scope"><span className={`wk-project-dot ${viewProject.color}`} /><span className="wk-ellipsis">{viewProject.name}</span></span>}</div><button className="wk-text-button" onClick={() => navigate("work", "tasks")}>All tasks <ArrowRight size={16} /></button></div>
            <div className="wk-next-list">
              {upNext.map(task => {
                const current = task.id === timer.taskId;
                const tracked = trackedOn(task.id);
                return (
                  <div className={`wk-next-task ${current ? "selected" : ""}`} key={task.id}>
                    <button className="wk-check" aria-label={`Complete ${task.title}`} disabled={active && current} onClick={() => onToggleTask(task.projectId, task.id)}><Check size={13} /></button>
                    <Tip content={<><strong>{task.title}</strong><small><span className="tip-dot" />{task.projectName} · {task.priority ?? "Medium"} priority</small><small>{task.due ? `Due ${new Date(`${task.due}T12:00:00`).toLocaleDateString("en", { month: "short", day: "numeric" })}` : "No due date"} · {tracked ? `${formatDuration(tracked)} tracked` : "Nothing tracked yet"}</small>{task.description && <p>{task.description}</p>}</>}>
                      <button className="wk-next-pick" aria-current={current ? "true" : undefined} disabled={active && !current} onClick={() => onFocusTask(task.projectId, task.id)}>
                        <strong>{task.title}</strong>
                        <small><span className="wk-ellipsis">{task.priority ?? "Medium"} priority{task.due ? ` · due ${new Date(`${task.due}T12:00:00`).toLocaleDateString("en", { month: "short", day: "numeric" })}` : ""}</span>{current && <em>{timer.startedAt ? "Tracking" : "Selected"}</em>}</small>
                      </button>
                    </Tip>
                    <button className="wk-icon-button" title={active ? "Finish the current session first" : "Start this task"} disabled={active} aria-label={`Start ${task.title}`} onClick={() => onTrackTask(task.projectId, task.id)}><Play size={17} /></button>
                  </div>
                );
              })}
              {upNext.length === 0 && <div className="sf-empty"><CheckCircle size={28} /><strong>Nothing open in {viewProject?.name ?? "this project"}.</strong><button className="wk-text-button" onClick={onAddTask}>Add a task in the Dashboard</button></div>}
            </div>
          </section>
          <section className="sf-card wk-chart-card"><div className="wk-card-heading"><div><span className="wk-eyebrow">A LITTLE EVERY DAY</span><h2>Your week in focus</h2></div><strong>{formatDuration(weekSeconds)}</strong></div><div className="wk-week-chart">{days.map(day => <button key={day.key} className={day.key === today ? "today" : ""} onClick={() => navigate("work", "timesheet", day.key)} aria-label={`View ${day.label} timesheet, ${day.hours.toFixed(1)} hours`}><span>{day.hours > 0 ? `${day.hours.toFixed(1)}h` : "—"}</span><div><i style={{ height: `${Math.max(4, day.hours / Math.max(8, ...days.map(item => item.hours)) * 100)}%` }} /></div><small>{day.label}</small></button>)}</div></section>
        </div>
        <div className="wk-overview-secondary">
          <section className="sf-card wk-goal-card"><span className="wk-eyebrow">STEADY PROGRESS</span><div className="wk-goal-ring" style={{ "--sweep": `${progress}%` } as CSSProperties}><div><strong>{Math.round(progress)}<span>%</span></strong><small>daily goal</small></div></div><h2>{progress >= 100 ? "You reached your goal." : "You're finding your flow."}</h2><p>{progress >= 100 ? "Great work. Make some time to recharge." : `${formatDuration(Math.max(0, dailyGoal - todaySeconds))} to your daily goal. One session at a time.`}</p><button className="wk-text-button" onClick={() => navigate("work", "schedule")}>Plan the rest of your day <ArrowRight size={16} /></button></section>
          <section className="sf-card wk-plan-preview"><div className="wk-card-heading"><h2>On your agenda</h2><button className="wk-text-button" onClick={() => navigate("work", "schedule")} aria-label="Open schedule"><ArrowUpRight size={17} /></button></div><div className="wk-agenda-list">{todayPlan.map(block => <div className={`wk-agenda-row ${block.done ? "done" : ""}`} key={block.id}><time>{block.time}</time><div><strong>{block.title}</strong><small>{block.minutes} min · {projects.find(item => item.id === block.projectId)?.name ?? "Personal"}</small></div><button className={`wk-check ${block.done ? "checked" : ""}`} onClick={() => onPlanToggle(block.id)} aria-label={`${block.done ? "Reopen" : "Complete"} ${block.title}`}><Check size={13} /></button></div>)}{todayPlan.length === 0 && <p className="wk-muted">A clear day. Add a focus block to get started.</p>}</div><button className="wk-text-button wk-full-link" onClick={() => navigate("work", "schedule")}>View today's schedule <ArrowRight size={16} /></button></section>
          <WorkTeamPane onMessage={name => name ? openChat(members.find(member => member.name === name)?.id) : navigate("lounge", "home")} />
        </div>
      </div>
    </div>
  );
}

