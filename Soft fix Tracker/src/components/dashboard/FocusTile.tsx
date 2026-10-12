import { ArrowRight, CaretDown, Pause, Play, Stop } from "@phosphor-icons/react";
import { formatDuration, useWorkspace } from "../../workspace";
import { useWorkTimer } from "../../useWorkTimer";
import { LiveClock } from "../LiveClock";
import { MenuButton, type MenuEntry } from "../MenuButton";
import "./focus-tile.css";

/** The Overview's focus timer. It is the Work timer itself (`useWorkTimer`), so you can start, pause and
 *  stop a session without leaving the Dashboard, and a session started here carries on in Work, Focus
 *  and Easy mode. A client can't track time, so they only see today's total. */
export function FocusTile({
  todaySeconds,
  todaySessions,
  note,
  canTrack,
  onActivity,
}: {
  /** Finished time today, for whoever this Overview is about. */
  todaySeconds: number;
  todaySessions: number;
  /** Whose time that is: "across your team", "from you". */
  note: string;
  canTrack: boolean;
  onActivity: () => void;
}) {
  const { projects } = useWorkspace();
  const timer = useWorkTimer();
  const project = projects.find((item) => item.id === timer.projectId);
  const task = project?.tasks.find((item) => item.id === timer.taskId);
  const state = timer.running ? "Tracking" : timer.active ? "Paused" : "Ready";

  const choices: MenuEntry[] = projects.flatMap((item): MenuEntry[] => {
    const open = item.tasks.filter((entry) => !entry.done);
    const itself: MenuEntry[] = item.requireTask === false ? [{ kind: "item", id: `${item.id}-itself`, label: item.tasks.length ? "The project itself" : "Time this project", detail: "No task needed", active: item.id === timer.projectId && !timer.taskId, onSelect: () => timer.focus(item.id, null) }] : [];
    if (!open.length && !itself.length) return [];
    return [
      { kind: "heading", label: item.name },
      ...open.map(
        (entry): MenuEntry => ({
          kind: "item",
          id: `${item.id}:${entry.id}`,
          label: entry.title,
          active: item.id === timer.projectId && entry.id === timer.taskId,
          onSelect: () => timer.focus(item.id, entry.id),
        }),
      ),
      ...itself,
    ];
  });

  const working = (
    <>
      <i className={`db-color-dot ${project?.color ?? ""}`} />
      <span className="db-focus-task">
        <strong>{task?.title ?? (project?.requireTask === false ? project.name : "Choose a task")}</strong>
        <small>{project?.name ?? "No project"}</small>
      </span>
    </>
  );

  return (
    <section className="sf-card db-focus-tile" aria-label="Focus timer">
      <div className="db-card-heading">
        <div>
          <h2>Focus timer</h2>
          <p>{canTrack ? "Track time without leaving the Dashboard" : "Time tracked on your projects today"}</p>
        </div>
        <span className={`db-focus-state ${timer.running ? "running" : timer.active ? "paused" : ""}`}>
          <i /> {canTrack ? state : "Today"}
        </span>
      </div>

      {canTrack && (
        <div className="db-focus-body">
          {timer.active || !choices.length ? (
            <div className="db-focus-working" title={timer.active ? "Stop the session to switch task" : undefined}>
              {working}
            </div>
          ) : (
            <MenuButton label="Choose what to work on" title="Choose what to work on" className="db-focus-picker" fixed entries={choices}>
              {working}
              <CaretDown size={14} weight="bold" />
            </MenuButton>
          )}

          <LiveClock className="db-focus-clock" ruler={false} startedAt={timer.startedAt} baseSeconds={timer.baseSeconds} label={`${state}, ${formatDuration(timer.seconds)}`} />

          <div className="db-focus-actions">
            {timer.running ? (
              <button type="button" className="sf-button" onClick={timer.pause}>
                <Pause size={16} weight="fill" /> Pause
              </button>
            ) : (
              <button type="button" className="sf-button primary" disabled={!timer.canStart} onClick={timer.start}>
                <Play size={16} weight="fill" /> {timer.active ? "Resume" : "Start"}
              </button>
            )}
            <button type="button" className="sf-button" disabled={!timer.active} onClick={timer.stop} title="Stop and save to your timesheet">
              <Stop size={16} weight="fill" /> Stop
            </button>
          </div>
        </div>
      )}

      <div className="db-focus-foot">
        <div className="db-gauge-facts">
          <div>
            <strong>{formatDuration(todaySeconds)}</strong>
            <span>Today {note}</span>
          </div>
          <div>
            <strong>{todaySessions}</strong>
            <span>{todaySessions === 1 ? "Session" : "Sessions"} today</span>
          </div>
        </div>
        <button type="button" className="db-pill-button" onClick={onActivity}>
          See activity <ArrowRight size={14} weight="bold" />
        </button>
      </div>
    </section>
  );
}
