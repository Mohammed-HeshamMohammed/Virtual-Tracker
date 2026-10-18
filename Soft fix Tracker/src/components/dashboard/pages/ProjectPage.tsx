import { useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Kanban, ListBullets } from "@phosphor-icons/react";
import { formatDuration, usePersistentState, useWorkspace } from "../../../workspace";
import { EmptyState } from "../../ui";
import { Avatar } from "../DashboardParts";
import { Kpis, dateLabel, type PageContext } from "./kit";
import { ProjectAvatar, StatusPill, hoursText, projectFacts, refillText } from "./project-facts";
import { useDashboardStores } from "./stores";

const RANGE_TEXT: Record<string, string> = { week: "this week", month: "this month", all: "all time" };

/** One project, as a page of its own (it used to be a dialog over the list): what it is and where it
 *  stands at the top, its tasks in the main column, and its budget, people, set-up and latest time
 *  beside them. The route's target is the project's id. */
export function ProjectPage({ ctx }: { ctx: PageContext }) {
  const { members, route, setProjects, notify } = useWorkspace();
  const stores = useDashboardStores();
  const { projectMeta: meta } = useWorkspace();
  const [taskView, setTaskView] = usePersistentState<string>("dashboard.project-task-view", "list");
  const [task, setTask] = useState("");
  const [dragOver, setDragOver] = useState<string | null>(null);

  const project = ctx.visibleProjects.find((item) => item.id === route.target);
  const sessions = useMemo(() => ctx.unscopedSessions.filter((session) => session.projectId === project?.id), [ctx.unscopedSessions, project?.id]);
  const facts = useMemo(() => (project ? projectFacts(project, sessions, meta, stores.clients) : null), [project, sessions, meta, stores.clients]);

  if (!project || !facts)
    return (
      <div className="sf-page db-page">
        <EmptyState title="That project isn't here" description="It may have been removed, or it isn't shared with you." action="All projects" onAction={() => ctx.go("pm-projects")} />
      </div>
    );

  const { def } = facts;
  const canManage = ctx.canManage;
  const inRange = ctx.sessions.filter((session) => session.projectId === project.id).reduce((sum, session) => sum + session.seconds, 0);
  const percent = facts.budget > 0 ? Math.round((facts.used / facts.budget) * 100) : 0;
  const budgetTone = percent >= 100 ? "over" : percent >= facts.notifyAt ? "near" : "";
  const left = Math.round((facts.budget - facts.used) * 10) / 10;

  /** Everyone on it (or, when it is open to all, everyone who has tracked on it), with their time. */
  const people = facts.peopleIds
    .map((id) => ({ member: members.find((member) => member.id === id), seconds: sessions.filter((session) => session.memberId === id).reduce((sum, session) => sum + session.seconds, 0) }))
    .filter((entry) => entry.member)
    .sort((a, b) => b.seconds - a.seconds);
  const recent = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 5);

  const setTaskDone = (taskId: string, done: boolean) =>
    setProjects((previous) => previous.map((item) => (item.id === project.id ? { ...item, tasks: item.tasks.map((entry) => (entry.id === taskId ? { ...entry, done } : entry)) } : item)));
  const addTask = (event: FormEvent) => {
    event.preventDefault();
    if (!task.trim()) return;
    setProjects((previous) => previous.map((item) => (item.id === project.id ? { ...item, tasks: [...item.tasks, { id: crypto.randomUUID(), title: task.trim(), done: false }] } : item)));
    setTask("");
    notify("Task added to this project and Work.");
  };

  const details: [string, string][] = [
    ["Type", def.label],
    ["Billing", (project.billable ?? def.billable) ? "Billable" : "Not billable"],
    ["Tracking", def.hasTasks ? ((project.requireTask ?? def.requiresTask) ? "A task is required" : "Task optional") : "No tasks: the timer runs on the project"],
    ["Client", facts.client?.name ?? "No client"],
    ["End date", facts.due ? dateLabel(facts.due) : "None"],
    ...(facts.avatarCredit ? [["Picture", facts.avatarCredit] as [string, string]] : []),
  ];

  return (
    <div className="sf-page db-page pj-page">
      <button className="pj-back" onClick={() => ctx.go("pm-projects")}>
        <ArrowLeft size={15} /> All projects
      </button>
      <div className="sf-page-header db-page-heading pj-heading">
        <div className="pj-title">
          <ProjectAvatar projectId={project.id} size="lg" />
          <div>
            <div className="db-eyebrow">
              {def.label.toUpperCase()}
              {facts.client ? ` · ${facts.client.name.toUpperCase()}` : ""}
            </div>
            <h1>
              {project.name}
              <StatusPill status={facts.status} />
            </h1>
            <p>{facts.description || (def.hasTasks ? "Its tasks, time and budget in one place." : "Members time themselves on this project. Its time and budget are below.")}</p>
          </div>
        </div>
        <div className="db-heading-actions">
          <button className="sf-button" onClick={() => ctx.go("timesheets-submissions", project.id)}>
            Timesheets
          </button>
          {canManage && (
            <button className="sf-button primary" onClick={() => ctx.go("pm-new", project.id)}>
              Edit project
            </button>
          )}
        </div>
      </div>

      <Kpis
        items={[
          { label: "Tracked in all", value: formatDuration(facts.seconds) },
          { label: `Tracked ${RANGE_TEXT[ctx.range] ?? ""}`, value: formatDuration(inRange) },
          ...(def.hasTasks ? [{ label: "Tasks done", value: `${facts.done} / ${facts.total}`, unit: facts.total ? `${facts.progress}%` : undefined }] : []),
          ...(facts.budget > 0 ? [{ label: "Budget used", value: `${percent}%`, unit: `of ${facts.budget}h`, tone: budgetTone ? ("warn" as const) : undefined }] : []),
          { label: "People", value: people.length, unit: facts.open ? "open to everyone" : undefined },
        ]}
      />

      <div className="pj-layout">
        <div className="pj-main">
        <section className="sf-card po-panel pj-tasks">
          <header className="po-head">
            <div>
              <h2>{def.hasTasks ? "Tasks" : "How it is tracked"}</h2>
              {def.hasTasks && <span className="po-count">{facts.total}</span>}
            </div>
            {def.hasTasks && (
              <div>
                <div className="db-view-switch" role="group" aria-label="Task view">
                  <button className={taskView !== "board" ? "active" : ""} aria-pressed={taskView !== "board"} title="List" aria-label="List" onClick={() => setTaskView("list")}>
                    <ListBullets size={16} />
                  </button>
                  <button className={taskView === "board" ? "active" : ""} aria-pressed={taskView === "board"} title="Board" aria-label="Board" onClick={() => setTaskView("board")}>
                    <Kanban size={16} />
                  </button>
                </div>
                <button className="po-link" onClick={() => ctx.go("pm-tasks", project.id)}>
                  Open in Tasks
                </button>
              </div>
            )}
          </header>
          <div className="pj-panel-body">
            {!def.hasTasks ? (
              <p className="db-muted pj-quiet">
                A {def.label.toLowerCase()} project has no tasks. Each person starts their own timer on the project, and the hours show up in its timesheets.
              </p>
            ) : taskView !== "board" ? (
              <div className="db-task-list pj-task-list">
                {project.tasks.map((item) => (
                  <label key={item.id} className={item.done ? "done" : ""}>
                    <input type="checkbox" checked={!!item.done} disabled={!canManage} onChange={() => setTaskDone(item.id, !item.done)} />
                    <span>{item.title}</span>
                    {!item.done && item.due && <small>{dateLabel(item.due)}</small>}
                    {!item.done && item.priority && <em className={`prio-${item.priority.toLowerCase()}`}>{item.priority}</em>}
                  </label>
                ))}
                {!project.tasks.length && <p className="db-muted">No tasks yet.{canManage ? " Add the first one below." : ""}</p>}
              </div>
            ) : (
              <div className="db-board">
                {(
                  [
                    ["To do", false],
                    ["Done", true],
                  ] as const
                ).map(([title, isDone]) => {
                  const items = project.tasks.filter((item) => !!item.done === isDone);
                  return (
                    <div
                      key={title}
                      className={`db-board-col ${dragOver === title ? "over" : ""}`}
                      onDragOver={(event) => {
                        if (!canManage) return;
                        event.preventDefault();
                        setDragOver(title);
                      }}
                      onDragLeave={() => setDragOver(null)}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDragOver(null);
                        const id = event.dataTransfer.getData("text/plain");
                        if (id && canManage) setTaskDone(id, isDone);
                      }}
                    >
                      <header>
                        <i className={isDone ? "done" : "todo"} />
                        {title}
                        <span>{items.length}</span>
                      </header>
                      {items.map((item) => (
                        <article key={item.id} className="db-board-card" draggable={canManage} onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)}>
                          <strong>{item.title}</strong>
                          {canManage && (
                            <button className="db-board-move" onClick={() => setTaskDone(item.id, !isDone)}>
                              {isDone ? "Reopen" : "Mark done"}
                            </button>
                          )}
                        </article>
                      ))}
                      {!items.length && <p className="db-board-empty">{isDone ? "Nothing finished yet." : "All clear."}</p>}
                    </div>
                  );
                })}
              </div>
            )}
            {canManage && def.hasTasks && (
              <form className="db-add-task" onSubmit={addTask}>
                <input aria-label="New task" placeholder="Add a task to this project" value={task} maxLength={160} onChange={(event) => setTask(event.target.value)} />
                <button className="sf-button" type="submit" disabled={!task.trim()}>
                  Add task
                </button>
              </form>
            )}
          </div>
        </section>
        <section className="sf-card po-panel">
          <header className="po-head">
            <div>
              <h2>Latest time</h2>
            </div>
            <button className="po-link" onClick={() => ctx.go("timesheets-submissions", project.id)}>
              All timesheets
            </button>
          </header>
          {recent.length ? (
            <ul className="pj-recent">
              {recent.map((session) => {
                const member = members.find((item) => item.id === session.memberId);
                return (
                  <li key={session.id}>
                    <Avatar name={member?.name ?? "Team member"} color={member?.color} />
                    <span>
                      <strong>{session.taskTitle || "No task"}</strong>
                      <small>
                        {member?.name ?? "Team member"} · {dateLabel(session.startedAt)}
                      </small>
                    </span>
                    <span className={`pj-pill ${session.status === "Approved" ? "done" : session.status === "Submitted" ? "live" : "quiet"}`}>{session.status}</span>
                    <b>{formatDuration(session.seconds)}</b>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="db-muted pj-quiet pj-panel-body">Nothing has been tracked on this project yet.</p>
          )}
        </section>
        </div>

        <div className="pj-side">
          <section className="sf-card po-panel">
            <header className="po-head">
              <div>
                <h2>Budget</h2>
              </div>
              {facts.budget > 0 && facts.resets !== "Never" && <span className="po-count">Refills {facts.resets === "Weekly" ? "weekly" : "monthly"}</span>}
            </header>
            <div className="pj-panel-body">
              {facts.budget > 0 ? (
                <>
                  <div className="pj-budget-figure">
                    <strong data-count>{hoursText(facts.used)}</strong>
                    <span>
                      of {facts.budget}h{facts.resets === "Never" ? "" : ` ${refillText(facts.resets)}`}
                    </span>
                  </div>
                  <div className={`db-progress ${budgetTone}`}>
                    <span style={{ width: `${Math.min(100, percent)}%` }} />
                  </div>
                  <p className={`pj-budget-note ${budgetTone}`}>
                    {left >= 0 ? `${hoursText(left)} left` : `${hoursText(-left)} over`} · warns at {facts.notifyAt}% ({hoursText((facts.budget * facts.notifyAt) / 100)})
                  </p>
                </>
              ) : (
                <p className="db-muted pj-quiet">No time budget. The project is not measured against a limit.</p>
              )}
            </div>
          </section>

          <section className="sf-card po-panel">
            <header className="po-head">
              <div>
                <h2>People</h2>
                <span className="po-count">{people.length}</span>
              </div>
            </header>
            <div className="pj-panel-body">
              {facts.open && <p className="db-muted pj-quiet">Open to everyone in the workspace.{people.length ? " These people have tracked on it:" : ""}</p>}
              <ul className="pj-person-list">
                {people.map(({ member, seconds }) => (
                  <li key={member!.id}>
                    <Avatar name={member!.name} color={member!.color} />
                    <span>
                      <strong>{member!.name}</strong>
                      <small>{(project.managerIds ?? []).includes(member!.id) ? "Manages this project" : member!.role}</small>
                    </span>
                    <b>{formatDuration(seconds)}</b>
                  </li>
                ))}
              </ul>
              {!people.length && !facts.open && <p className="db-muted pj-quiet">Nobody is on it yet.</p>}
            </div>
          </section>

          <section className="sf-card po-panel">
            <header className="po-head">
              <div>
                <h2>Set-up</h2>
              </div>
            </header>
            <dl className="pj-details">
              {details.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>

    </div>
  );
}
