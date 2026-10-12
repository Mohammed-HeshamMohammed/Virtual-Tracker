import { useMemo, useState, type DragEvent, type FormEvent } from "react";
import { CalendarBlank, CaretLeft, CaretRight, Plus } from "@phosphor-icons/react";
import { usePersistentState, useWorkspace } from "../../../workspace";
import { Modal } from "../../ui";
import type { PlanBlock } from "../../work/WorkHome";
import { Avatar, FilterSelect, PageHeading } from "../DashboardParts";
import type { PageContext } from "./kit";
import { dayKey, logAudit, newId, useDashboardStores } from "./stores";
import "./calendar.css";

const day = (date: Date) => date.toLocaleDateString("en-CA");
const parse = (key: string) => new Date(`${key}T12:00:00`);
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const longDay = (key: string) => parse(key).toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" });
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

type Kind = "planning" | "team" | "review" | "deadline";
const KINDS: { id: Kind; label: string }[] = [
  { id: "planning", label: "Planning" },
  { id: "team", label: "Team" },
  { id: "review", label: "Review" },
  { id: "deadline", label: "Deadline" },
];

/** One thing on the calendar. A task is a deadline (or, once finished, a review waiting for sign-off),
 *  approved time off is the team being away, and a focus block from Work is planning. */
type Event = {
  id: string;
  kind: Kind;
  day: string;
  time: string;
  title: string;
  sub: string;
  taskId?: string;
  done?: boolean;
  people?: string[];
};

type Task = { id: string; title: string; done: boolean; priority: "Low" | "Medium" | "High"; due: string; description: string; projectId: string; projectName: string; color: string };

/** Calendar: deadlines, reviews, time off and planned work, by day. The month is on the left, the
 *  chosen day and what is coming up on the right. Drag a deadline to another day to move its due date
 *  (a task with no date waits in the tray until it is dropped on one). */
export function CalendarPage({ ctx }: { ctx: PageContext }) {
  const { setProjects, members, notify, profile } = useWorkspace();
  const stores = useDashboardStores();
  const [plan] = usePersistentState<PlanBlock[]>("work.plan", []);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1, 12);
  });
  const [picked, setPicked] = useState(() => dayKey(0));
  const [project, setProject] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", projectId: "", priority: "Medium" as Task["priority"] });
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const canEdit = ctx.role !== "Client";
  const today = dayKey(0);
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? "Someone";

  const tasks: Task[] = useMemo(
    () =>
      ctx.projects
        .filter((item) => project === "all" || item.id === project)
        .flatMap((item) =>
          item.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            done: Boolean(task.done),
            priority: task.priority ?? "Medium",
            due: task.due ?? "",
            description: task.description ?? "",
            projectId: item.id,
            projectName: item.name,
            color: item.color,
          })),
        ),
    [ctx.projects, project],
  );
  const unscheduled = tasks.filter((task) => !task.due && !task.done);

  const events: Event[] = useMemo(() => {
    const list: Event[] = [];
    for (const task of tasks) {
      if (!task.due) continue;
      const waiting = task.done && !stores.taskReviews[task.id];
      list.push({ id: `task-${task.id}`, kind: waiting ? "review" : "deadline", day: task.due, time: "", title: task.title, sub: waiting ? `${task.projectName} · waiting for sign-off` : `${task.projectName} · ${task.priority} priority`, taskId: task.id, done: task.done && !waiting });
    }
    for (const entry of stores.timeOff) {
      if (entry.status !== "Approved" || !(ctx.canManage || entry.memberId === "me")) continue;
      for (let at = parse(entry.from); day(at) <= entry.to; at = addDays(at, 1)) list.push({ id: `off-${entry.id}-${day(at)}`, kind: "team", day: day(at), time: "", title: `${nameOf(entry.memberId).split(" ")[0]} is away`, sub: entry.kind, people: [entry.memberId] });
    }
    if (project === "all" || ctx.projects.some((item) => item.id === project)) {
      for (const block of plan) {
        if (project !== "all" && block.projectId !== project) continue;
        list.push({ id: `plan-${block.id}`, kind: "planning", day: block.date, time: block.time, title: block.title, sub: `${block.minutes} min · ${ctx.projects.find((item) => item.id === block.projectId)?.name ?? "Personal"}`, done: block.done });
      }
    }
    return list.sort((a, b) => a.day.localeCompare(b.day) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, stores.timeOff, stores.taskReviews, plan, project, ctx.projects, ctx.canManage, members]);
  const byDay = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const event of events) map.set(event.day, [...(map.get(event.day) ?? []), event]);
    return map;
  }, [events]);

  // The month, from the Sunday on or before the 1st to the Saturday on or after the last day.
  const cells = useMemo(() => {
    const start = addDays(month, -month.getDay());
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12);
    const count = Math.ceil((last.getDate() + month.getDay()) / 7) * 7;
    return Array.from({ length: count }, (_, index) => addDays(start, index));
  }, [month]);
  const step = (direction: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + direction, 1, 12));
  const goToday = () => {
    const now = new Date();
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1, 12));
    setPicked(today);
  };

  const setDue = (id: string, due: string) => {
    const task = tasks.find((item) => item.id === id);
    if (!task || task.due === due) return;
    setProjects((old) => old.map((item) => ({ ...item, tasks: item.tasks.map((entry) => (entry.id === id ? { ...entry, due } : entry)) })));
    logAudit(stores, profile.name, `Moved "${task.title}" to ${due ? longDay(due) : "no date"}.`);
    notify(due ? `Moved to ${longDay(due)}.` : "Moved to the tray: no date.");
  };
  const drop = (event: DragEvent, key: string) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || dragging;
    setOver(null);
    setDragging(null);
    if (id && canEdit) setDue(id, key);
  };
  const target = (key: string) =>
    canEdit
      ? {
          onDragOver: (event: DragEvent) => {
            event.preventDefault();
            if (over !== key) setOver(key);
          },
          onDragLeave: () => setOver((current) => (current === key ? null : current)),
          onDrop: (event: DragEvent) => drop(event, key),
        }
      : {};
  const draggable = (event: Event) =>
    canEdit && event.taskId && event.kind === "deadline"
      ? {
          draggable: true,
          onDragStart: (drag: DragEvent) => {
            drag.dataTransfer.setData("text/plain", event.taskId!);
            drag.dataTransfer.effectAllowed = "move";
            setDragging(event.taskId!);
          },
          onDragEnd: () => {
            setDragging(null);
            setOver(null);
          },
        }
      : {};

  const add = (form: FormEvent) => {
    form.preventDefault();
    const title = draft.title.trim();
    if (!adding || !title || !draft.projectId) return;
    const task = { id: newId("task"), title, description: "", priority: draft.priority, due: adding, done: false };
    setProjects((old) => old.map((item) => (item.id === draft.projectId ? { ...item, tasks: [...item.tasks, task] } : item)));
    logAudit(stores, profile.name, `Added the task "${title}" for ${longDay(adding)}.`);
    notify("Task added.");
    setAdding(null);
  };

  const dayEvents = byDay.get(picked) ?? [];
  const upcoming = events.filter((event) => event.day >= today && !event.done).slice(0, 6);
  const task = tasks.find((item) => item.id === open);
  const pickedDate = parse(picked);

  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="PLAN THE WEEK" title="Calendar" description="Deadlines, reviews, time off and planned work, by day.">
        <FilterSelect label="Project" value={project} onChange={setProject} options={[{ value: "all", text: "All projects" }, ...ctx.projects.map((item) => ({ value: item.id, text: item.name }))]} />
        <button className="sf-button" onClick={goToday}>
          <CalendarBlank size={16} /> Today
        </button>
      </PageHeading>

      <div className="cal-layout">
        <section className="sf-card cal-month">
          <header className="cal-month-head">
            <h2>{month.toLocaleDateString("en", { month: "long", year: "numeric" })}</h2>
            <div>
              <button className="cal-step" onClick={() => step(-1)} aria-label="Previous month">
                <CaretLeft size={14} weight="bold" />
              </button>
              <button className="cal-step" onClick={() => step(1)} aria-label="Next month">
                <CaretRight size={14} weight="bold" />
              </button>
            </div>
          </header>
          <div className="cal-grid">
            {WEEKDAYS.map((name) => (
              <div key={name} className="cal-dow">
                {name}
              </div>
            ))}
            {cells.map((date) => {
              const key = day(date);
              const list = byDay.get(key) ?? [];
              return (
                <div
                  key={key}
                  className={`cal-cell ${key === today ? "today" : ""} ${key === picked ? "picked" : ""} ${date.getMonth() !== month.getMonth() ? "outside" : ""} ${over === key ? "over" : ""}`}
                  onClick={() => setPicked(key)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${longDay(key)}, ${list.length} ${list.length === 1 ? "event" : "events"}`}
                  aria-pressed={key === picked}
                  onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && (event.preventDefault(), setPicked(key))}
                  {...target(key)}
                >
                  <b>{date.getDate()}</b>
                  {list.slice(0, 3).map((event) => (
                    <span key={event.id} className={`cal-chip ${event.kind} ${event.done ? "done" : ""} ${dragging === event.taskId ? "dragging" : ""}`} title={`${event.title} · ${event.sub}`} {...draggable(event)}>
                      {event.title}
                    </span>
                  ))}
                  {list.length > 3 && <small>+{list.length - 3} more</small>}
                </div>
              );
            })}
          </div>
          <footer className="cal-legend">
            {KINDS.map((kind) => (
              <span key={kind.id}>
                <i className={kind.id} /> {kind.label}
              </span>
            ))}
          </footer>
        </section>

        <aside className="cal-side">
          <section className="sf-card cal-panel">
            <header>
              <div>
                <small>{picked === today ? `TODAY · ${pickedDate.toLocaleDateString("en", { weekday: "long" }).toUpperCase()}` : pickedDate.toLocaleDateString("en", { weekday: "long" }).toUpperCase()}</small>
                <h2>{pickedDate.toLocaleDateString("en", { month: "long", day: "numeric" })}</h2>
              </div>
              {canEdit && (
                <button
                  className="cal-step"
                  aria-label={`Add a task on ${longDay(picked)}`}
                  title="Add a task"
                  onClick={() => {
                    setDraft({ title: "", projectId: ctx.projects.find((item) => project === "all" || item.id === project)?.id ?? "", priority: "Medium" });
                    setAdding(picked);
                  }}
                >
                  <Plus size={14} weight="bold" />
                </button>
              )}
            </header>
            <div className="cal-events">
              {dayEvents.map((event) => (
                <button key={event.id} className={`cal-event ${event.kind} ${event.done ? "done" : ""}`} disabled={!event.taskId} onClick={() => event.taskId && setOpen(event.taskId)} title={event.taskId ? "Open this task" : undefined}>
                  <span className="cal-event-time">{event.time || "All day"}</span>
                  <span className="cal-event-copy">
                    <strong>{event.title}</strong>
                    <small>{event.sub}</small>
                  </span>
                  {event.people && (
                    <span className="cal-people">
                      {event.people.map((id) => (
                        <Avatar key={id} name={nameOf(id)} color={members.find((member) => member.id === id)?.color} />
                      ))}
                    </span>
                  )}
                </button>
              ))}
              {!dayEvents.length && <p className="db-muted cal-none">Nothing on this day.</p>}
            </div>
          </section>

          <section className="sf-card cal-panel">
            <header>
              <h2>Coming up</h2>
            </header>
            <div className="cal-upcoming">
              {upcoming.map((event) => (
                <button key={event.id} className="cal-up" onClick={() => { setPicked(event.day); setMonth(new Date(parse(event.day).getFullYear(), parse(event.day).getMonth(), 1, 12)); }}>
                  <span className={`cal-badge ${event.kind}`}>
                    <small>{parse(event.day).toLocaleDateString("en", { month: "short" }).toUpperCase()}</small>
                    <b>{parse(event.day).getDate()}</b>
                  </span>
                  <span className="cal-event-copy">
                    <strong>{event.title}</strong>
                    <small>
                      {parse(event.day).toLocaleDateString("en", { weekday: "short" })} · {event.time || event.sub}
                    </small>
                  </span>
                </button>
              ))}
              {!upcoming.length && <p className="db-muted cal-none">Nothing coming up.</p>}
            </div>
          </section>

          {canEdit && (
            <section className={`sf-card cal-panel cal-tray ${over === "" ? "over" : ""}`} {...target("")} aria-label="Tasks with no date">
              <header>
                <div>
                  <h2>No date</h2>
                  <small className="cal-hint">Drag onto a day to schedule</small>
                </div>
                <span className="cal-count">{unscheduled.length}</span>
              </header>
              <div className="cal-tray-list">
                {unscheduled.map((item) => (
                  <button
                    key={item.id}
                    className="cal-chip deadline"
                    draggable
                    onDragStart={(drag) => {
                      drag.dataTransfer.setData("text/plain", item.id);
                      drag.dataTransfer.effectAllowed = "move";
                      setDragging(item.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    onClick={() => setOpen(item.id)}
                    title={`${item.title} · ${item.projectName}`}
                  >
                    {item.title}
                  </button>
                ))}
                {!unscheduled.length && <p className="db-muted">Everything open has a date.</p>}
              </div>
            </section>
          )}
        </aside>
      </div>

      {task && (
        <Modal title={task.title} description={`${task.projectName} · ${task.priority} priority`} onClose={() => setOpen(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setDue(task.id, (new FormData(event.currentTarget).get("due") as string) ?? "");
              setOpen(null);
            }}
          >
            {task.description && <p className="db-form-hint">{task.description}</p>}
            <label className="db-field">
              Due date
              <input type="date" name="due" defaultValue={task.due} disabled={!canEdit} />
            </label>
            <div className="db-modal-actions">
              {canEdit && (
                <button
                  type="button"
                  className="sf-button"
                  onClick={() => {
                    setProjects((old) => old.map((item) => ({ ...item, tasks: item.tasks.map((entry) => (entry.id === task.id ? { ...entry, done: !entry.done } : entry)) })));
                    setOpen(null);
                  }}
                >
                  {task.done ? "Reopen" : "Mark done"}
                </button>
              )}
              <button type="button" className="sf-button" onClick={() => ctx.go("pm-tasks", task.id)}>
                Open in Tasks
              </button>
              {canEdit && (
                <button type="submit" className="sf-button primary">
                  Save date
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}

      {adding && (
        <Modal title="Add a task" description={longDay(adding)} onClose={() => setAdding(null)}>
          <form onSubmit={add}>
            <label className="db-field">
              Task
              <input required maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="What needs doing?" />
            </label>
            <div className="db-form-grid">
              <label className="db-field">
                Project
                <select value={draft.projectId} onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}>
                  {ctx.projects.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="db-field">
                Priority
                <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Task["priority"] })}>
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                </select>
              </label>
            </div>
            <div className="db-modal-actions">
              <button type="button" className="sf-button" onClick={() => setAdding(null)}>
                Cancel
              </button>
              <button type="submit" className="sf-button primary" disabled={!draft.title.trim() || !draft.projectId}>
                Add task
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
