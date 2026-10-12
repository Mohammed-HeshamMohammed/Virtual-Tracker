import { useEffect, useState } from "react";
import { formatDuration, usePersistentState, useWorkspace, type Session } from "./workspace";

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * The Work timer: which project and task, how long it has run, and start / pause / stop (stopping
 * saves a draft session to the timesheet). Shared by the full app and the Focus and Easy modes, so
 * a session started in one is the same session in all of them.
 */
export function useWorkTimer() {
  const { projects, setSessions, timer, setTimer, notify } = useWorkspace();
  const [now, setNow] = useState(Date.now());
  const [note, setNote] = usePersistentState("work.sessionNote", "");
  const [beganAt, setBeganAt] = usePersistentState<number | null>("work.sessionBeganAt", null);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const running = timer.startedAt !== null;
  // A project made as Calling, Support and the like has no tasks to choose, so it can be timed as it is.
  const needsTask = projects.find((item) => item.id === timer.projectId)?.requireTask ?? true;
  const canStart = !needsTask || Boolean(timer.taskId);
  // Banked time is kept to the millisecond (so pausing and resuming doesn't lose the fraction);
  // `seconds` is the whole seconds of it.
  const seconds = Math.floor(timer.elapsed + (timer.startedAt === null ? 0 : Math.max(0, (now - timer.startedAt) / 1000)));
  const active = running || timer.elapsed > 0;

  function start() {
    if (!canStart || timer.startedAt !== null) return;
    if (!active) setBeganAt(Date.now());
    setNow(Date.now());
    setTimer((old) => ({ ...old, startedAt: Date.now() }));
  }

  function pause() {
    setTimer((old) => ({
      ...old,
      elapsed: old.elapsed + (old.startedAt === null ? 0 : Math.max(0, (Date.now() - old.startedAt) / 1000)),
      startedAt: null,
    }));
  }

  function stop() {
    const elapsed = timer.elapsed + (timer.startedAt === null ? 0 : Math.max(0, (Date.now() - timer.startedAt) / 1000));
    if (!active) return;
    const task = projects.find((item) => item.id === timer.projectId)?.tasks.find((item) => item.id === timer.taskId);
    const session: Session = {
      id: newId("session"),
      projectId: timer.projectId,
      taskId: timer.taskId ?? undefined,
      taskTitle: task?.title ?? (projects.find((item) => item.id === timer.projectId)?.name ?? "Focus") + " session",
      startedAt: new Date(beganAt ?? Date.now() - elapsed * 1000).toISOString(),
      endedAt: new Date().toISOString(),
      seconds: Math.max(1, Math.round(elapsed)),
      note,
      status: "Draft",
      memberId: "me",
    };
    setSessions((old) => [session, ...old]);
    setTimer((old) => ({ ...old, startedAt: null, elapsed: 0 }));
    setBeganAt(null);
    setNote("");
    notify(`Session saved · ${formatDuration(elapsed)} added to your timesheet`);
  }

  /** Switches project while idle; picks that project's first open task. */
  function selectProject(id: string) {
    if (active) return;
    setTimer((old) => ({
      ...old,
      projectId: id,
      taskId: projects.find((item) => item.id === id)?.tasks.find((task) => !task.done)?.id ?? null,
    }));
  }

  function selectTask(id: string) {
    if (active) return;
    setTimer((old) => ({ ...old, taskId: id || null }));
  }

  /** Chooses what the next session is on, without starting it. Callers check `active` first. */
  function focus(projectId: string, taskId: string | null) {
    if (active) return;
    setTimer((old) => ({ ...old, projectId, taskId }));
  }

  /** Starts a fresh session on a specific task right now. Callers check `active` first. */
  function begin(projectId: string, taskId: string) {
    const timestamp = Date.now();
    setNow(timestamp);
    setTimer({ projectId, taskId, startedAt: timestamp, elapsed: 0 });
    setBeganAt(timestamp);
  }

  return {
    seconds,
    active,
    running,
    /** Whether a session can be started on what is chosen now. */
    canStart,
    needsTask,
    /** When the current run began (ms since the epoch), or null while paused or idle. */
    startedAt: timer.startedAt,
    /** Seconds banked before the current run, to the millisecond. */
    baseSeconds: timer.elapsed,
    projectId: timer.projectId,
    taskId: timer.taskId,
    note,
    setNote,
    start,
    pause,
    stop,
    selectProject,
    selectTask,
    focus,
    begin,
  };
}
