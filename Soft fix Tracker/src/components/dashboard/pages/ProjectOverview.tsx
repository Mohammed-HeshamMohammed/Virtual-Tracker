import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowSquareOut, CheckCircle, Circle, CurrencyDollar, Folder, HourglassMedium, ListChecks, Pulse, UsersThree } from "@phosphor-icons/react";
import { formatDuration, usePersistentState, useWorkspace } from "../../../workspace";
import { Modal } from "../../ui";
import { PageHeading } from "../DashboardParts";
import { hours, type PageContext } from "./kit";
import { dayKey, useDashboardStores } from "./stores";
import "./pages-extra.css";

type Meta = Record<string, { description: string; budget: number; due: string }>;
type Health = "On track" | "At risk" | "Stalled" | "Done";
type TaskState = "todo" | "review" | "done";

const HEALTH_TONE: Record<Health, string> = { "On track": "good", "At risk": "warn", Stalled: "quiet", Done: "good" };
const STATES: { id: TaskState; label: string; icon: ReactNode }[] = [
  { id: "todo", label: "To do", icon: <Circle /> },
  { id: "review", label: "In review", icon: <HourglassMedium /> },
  { id: "done", label: "Done", icon: <CheckCircle weight="fill" /> },
];
const WEEK = 7 * 86_400_000;

/** A thin bar for hours used against a budget; it turns amber near the limit and red past it. */
function BudgetBar({ used, total }: { used: number; total: number }) {
  if (total <= 0) return <span className="db-muted">No budget</span>;
  const percent = Math.round((used / total) * 100);
  const tone = percent >= 100 ? "over" : percent >= 80 ? "near" : "";
  return (
    <span className={`po-budget ${tone}`} title={`${used}h of ${total}h`}>
      <span className="db-progress">
        <span style={{ width: `${Math.min(100, percent)}%` }} />
      </span>
      <b>{percent}%</b>
    </span>
  );
}

/** Projects > Overview. The layout is the real Dashboard's (Dashboard-Web's project overview): four
 *  headline figures that open the page they summarise, the health of every project in one table, then
 *  the tasks (by status, and per project) and, for people who may see them, each client's budget. */
export function PmOverviewPage({ ctx }: { ctx: PageContext }) {
  const { members } = useWorkspace();
  const stores = useDashboardStores();
  const [meta] = usePersistentState<Meta>("dashboard.project-meta", {});
  const [state, setState] = useState<TaskState | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      ctx.projects.map((project) => {
        const sessions = ctx.allSessions.filter((session) => session.projectId === project.id);
        const seconds = sessions.reduce((sum, session) => sum + session.seconds, 0);
        const done = project.tasks.filter((task) => task.done).length;
        const total = project.tasks.length;
        // A project made with no budget has 0: it is not measured against one (older projects default to 80h).
        const budget = meta[project.id]?.budget ?? 80;
        const due = meta[project.id]?.due ?? "";
        const progress = total ? Math.round((done / total) * 100) : 0;
        const last = sessions.reduce((latest, session) => Math.max(latest, new Date(session.startedAt).getTime()), 0);
        const health: Health =
          total > 0 && done === total ? "Done" : (budget > 0 && hours(seconds) > budget) || (due && due < dayKey(0)) ? "At risk" : !last || Date.now() - last > WEEK ? "Stalled" : "On track";
        const people = new Set(sessions.map((session) => session.memberId));
        const review = project.tasks.filter((task) => task.done && !stores.taskReviews[task.id]).length;
        return { id: project.id, name: project.name, color: project.color, done, review, total, seconds, budget, due, progress, health, people: people.size };
      }),
    [ctx.projects, ctx.allSessions, meta, stores.taskReviews],
  );

  const tasks = useMemo(
    () =>
      ctx.projects.flatMap((project) =>
        project.tasks.map((task) => ({
          ...task,
          projectId: project.id,
          projectName: project.name,
          color: project.color,
          state: (task.done ? (stores.taskReviews[task.id] ? "done" : "review") : "todo") as TaskState,
        })),
      ),
    [ctx.projects, stores.taskReviews],
  );
  const count = (id: TaskState) => tasks.filter((task) => task.state === id).length;
  const shown = tasks.filter((task) => !state || task.state === state).slice(0, 8);
  const picked = tasks.find((task) => task.id === openTask);

  const tasksDone = tasks.filter((task) => task.done).length;
  const usedHours = rows.reduce((sum, row) => sum + hours(row.seconds), 0);
  const budgetHours = rows.reduce((sum, row) => sum + row.budget, 0);
  const team = new Set(ctx.allSessions.map((session) => session.memberId)).size || members.filter((member) => member.role !== "Client").length;
  const active = rows.filter((row) => row.health !== "Done");

  const stats = [
    { icon: <Folder weight="fill" />, tone: "violet", label: "Active projects", value: String(active.length), sub: `${rows.filter((row) => row.health === "On track").length} on track`, page: "pm-projects" },
    { icon: <CheckCircle weight="fill" />, tone: "green", label: "Tasks completed", value: `${tasksDone} / ${tasks.length}`, sub: `${tasks.length ? Math.round((tasksDone / tasks.length) * 100) : 0}% completion`, page: "pm-tasks" },
    { icon: <CurrencyDollar weight="bold" />, tone: "gold", label: "Budget used", value: `${Math.round(usedHours * 10) / 10}h`, sub: `of ${budgetHours}h planned`, page: "pm-projects" },
    { icon: <UsersThree weight="fill" />, tone: "cyan", label: "Team members", value: String(team), sub: `across ${rows.length} ${rows.length === 1 ? "project" : "projects"}`, page: "people-members" },
  ];

  const clients = stores.clients
    .map((client) => {
      const own = rows.filter((row) => client.projectIds.includes(row.id));
      return { ...client, used: Math.round(own.reduce((sum, row) => sum + hours(row.seconds), 0) * 10) / 10, total: own.reduce((sum, row) => sum + row.budget, 0), projects: own.length };
    })
    .slice(0, 6);

  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="GOOD THINGS, IN PROGRESS" title="Project overview" description="Where every project stands, at a glance." />

      <div className="po-stats">
        {stats.map((stat) => (
          <button key={stat.label} className="sf-card po-stat" onClick={() => ctx.go(stat.page)} title={`Open ${stat.label.toLowerCase()}`}>
            <span className={`po-stat-icon ${stat.tone}`}>{stat.icon}</span>
            <strong data-count>{stat.value}</strong>
            <span>{stat.label}</span>
            <small>{stat.sub}</small>
          </button>
        ))}
      </div>

      <section className="sf-card po-panel">
        <header className="po-head">
          <div>
            <Folder size={17} />
            <h2>Projects overview</h2>
            <span className="po-count">{rows.length}</span>
          </div>
          <button className="po-link" onClick={() => ctx.go("pm-projects")}>
            All projects <ArrowSquareOut size={13} />
          </button>
        </header>
        {rows.length ? (
          <div className="db-table-scroll">
            <table className="sf-table po-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Health</th>
                  <th>Progress</th>
                  <th>Budget</th>
                  <th>Tracked</th>
                  <th>Members</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} onClick={() => ctx.go("pm-project", row.id)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && ctx.go("pm-project", row.id)}>
                    <td>
                      <span className="po-name">
                        <i className={`db-color-dot ${row.color}`} />
                        {row.name}
                      </span>
                    </td>
                    <td>
                      <span className={`po-pill ${HEALTH_TONE[row.health]}`}>{row.health}</span>
                    </td>
                    <td>
                      <span className="db-share">
                        <i style={{ width: `${row.progress}%` }} />
                        <b>{row.progress}%</b>
                      </span>
                    </td>
                    <td>
                      <BudgetBar used={hours(row.seconds)} total={row.budget} />
                    </td>
                    <td>{formatDuration(row.seconds)}</td>
                    <td>{row.people}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="sf-empty">
            <Folder size={30} />
            <h3>No projects yet</h3>
            <button className="sf-button" onClick={() => ctx.go("pm-projects")}>
              Create a project
            </button>
          </div>
        )}
      </section>

      <div className="po-split">
        <section className="sf-card po-panel">
          <header className="po-head">
            <div>
              <ListChecks size={17} />
              <h2>Tasks breakdown</h2>
              <span className="po-count">{tasks.length}</span>
            </div>
            <div>
              {STATES.filter((entry) => count(entry.id) > 0).map((entry) => (
                <button key={entry.id} className={`po-chip ${entry.id} ${state === entry.id ? "active" : ""}`} aria-pressed={state === entry.id} title={entry.label} onClick={() => setState(state === entry.id ? null : entry.id)}>
                  {entry.icon}
                  {count(entry.id)}
                </button>
              ))}
              <button className="po-link" onClick={() => ctx.go("pm-tasks")}>
                View all <ArrowSquareOut size={13} />
              </button>
            </div>
          </header>
          {shown.length ? (
            <div className="po-tasks">
              {shown.map((task) => (
                <button key={task.id} className="po-task" onClick={() => setOpenTask(task.id)}>
                  <span className={`po-task-mark ${task.state}`}>{STATES.find((entry) => entry.id === task.state)?.icon}</span>
                  <span className="po-task-copy">
                    <strong className={task.state === "done" ? "struck" : ""}>{task.title}</strong>
                    <small>
                      {task.projectName} · <em className={`prio-${(task.priority ?? "Medium").toLowerCase()}`}>{task.priority ?? "Medium"}</em>
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="sf-empty">
              <CheckCircle size={30} />
              <h3>{state ? "No tasks with that status" : "No tasks yet"}</h3>
              <p>{state ? "Try another status." : "Tasks are made on the Tasks page."}</p>
            </div>
          )}
        </section>

        <section className="sf-card po-panel">
          <header className="po-head">
            <div>
              <Pulse size={17} />
              <h2>Tasks per project</h2>
            </div>
          </header>
          <div className="po-activity">
            {rows.map((row) => (
              <div key={row.id} className="po-activity-row">
                <div>
                  <span className="po-name">
                    <i className={`db-color-dot ${row.color}`} />
                    {row.name}
                  </span>
                  <small>
                    <b>{row.done} done</b> · {row.total} total
                  </small>
                </div>
                <div className="po-stack" role="img" aria-label={`${row.done - row.review} done, ${row.review} in review, ${row.total - row.done} to do`}>
                  {row.total > 0 && (
                    <>
                      <i className="done" style={{ "--w": (row.done - row.review) / row.total } as CSSProperties} />
                      <i className="review" style={{ "--w": row.review / row.total } as CSSProperties} />
                    </>
                  )}
                </div>
              </div>
            ))}
            {!rows.length && <p className="db-muted">Projects with tasks appear here.</p>}
          </div>
          <footer className="po-legend">
            <span>
              <i className="done" /> Done
            </span>
            <span>
              <i className="review" /> In review
            </span>
            <span>
              <i /> To do
            </span>
          </footer>
        </section>
      </div>

      {ctx.canManage && (
        <section className="sf-card po-panel">
          <header className="po-head">
            <div>
              <CurrencyDollar size={17} />
              <h2>Client budgets</h2>
            </div>
            <button className="po-link" onClick={() => ctx.go("pm-clients")}>
              Manage <ArrowSquareOut size={13} />
            </button>
          </header>
          {clients.length ? (
            <div className="po-clients">
              {clients.map((client) => {
                const percent = client.total > 0 ? Math.min(100, Math.round((client.used / client.total) * 100)) : 0;
                return (
                  <div key={client.id} className="po-client">
                    <div>
                      <span>
                        <strong>{client.name}</strong>
                        <small>
                          {client.projects} {client.projects === 1 ? "project" : "projects"} · {client.email || "No email"}
                        </small>
                      </span>
                      {client.total > 0 && (
                        <span className="po-client-figure">
                          <strong>{client.used}h</strong>
                          <small>of {client.total}h</small>
                        </span>
                      )}
                    </div>
                    {client.total > 0 && (
                      <>
                        <div className={`db-progress ${percent >= 100 ? "over" : percent >= 80 ? "near" : ""}`}>
                          <span style={{ width: `${percent}%` }} />
                        </div>
                        <small className="po-client-foot">
                          <span>{percent}% used</span>
                          <span>{Math.max(0, Math.round((client.total - client.used) * 10) / 10)}h remaining</span>
                        </small>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="sf-empty">
              <CurrencyDollar size={30} />
              <h3>No clients yet</h3>
              <p>Add clients to follow their budgets.</p>
            </div>
          )}
        </section>
      )}

      {picked && (
        <Modal title="Task details" description={picked.projectName} onClose={() => setOpenTask(null)}>
          <dl className="po-details">
            <div>
              <dt>Title</dt>
              <dd>{picked.title}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span className={`po-pill ${picked.state === "done" ? "good" : picked.state === "review" ? "warn" : "quiet"}`}>{STATES.find((entry) => entry.id === picked.state)?.label}</span>
              </dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{picked.priority ?? "Medium"}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{picked.due || "No date"}</dd>
            </div>
            {picked.description && (
              <div>
                <dt>Notes</dt>
                <dd>{picked.description}</dd>
              </div>
            )}
          </dl>
          <div className="db-modal-actions">
            <button className="sf-button" onClick={() => setOpenTask(null)}>
              Close
            </button>
            <button className="sf-button primary" onClick={() => ctx.go("pm-tasks", picked.id)}>
              View in Tasks
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
