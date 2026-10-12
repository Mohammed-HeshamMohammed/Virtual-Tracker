import { useEffect, useState, type FormEvent } from "react";
import { PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { formatDuration, usePersistentState, useWorkspace } from "../../../workspace";
import { Modal } from "../../ui";
import { Badge, FilterSelect, PageHeading } from "../DashboardParts";
import { DataTable, Decide, Kpis, Person, dateLabel, hours, money, type PageContext } from "./kit";
import { dayKey, logAudit, newId, noonOf, useDashboardStores, type Client, type TimeOff } from "./stores";

export { PmOverviewPage } from "./ProjectOverview";

type TaskDraft = { id?: string; projectId: string; title: string; description: string; priority: "Low" | "Medium" | "High"; due: string };

/** Tasks: where tasks are made and kept. Work only lists your own as a checklist, so creating, editing,
 *  deleting and the board all live here. Anyone but a client can add and change tasks. */
export function TasksPage({ ctx }: { ctx: PageContext }) {
  const stores = useDashboardStores();
  const { setProjects, timer, setTimer, notify, route, profile } = useWorkspace();
  const [tab, setTab] = useState<"Open" | "Done" | "All">("Open");
  const [project, setProject] = useState("all");
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [removing, setRemoving] = useState<{ id: string; title: string } | null>(null);
  const [error, setError] = useState("");
  const canEdit = ctx.role !== "Client";
  const everything = ctx.projects.flatMap((item) => item.tasks.map((task) => ({ ...task, projectId: item.id, projectName: item.name, color: item.color })));
  type Row = (typeof everything)[number];
  const timing = timer.startedAt !== null;
  const running = timing || timer.elapsed > 0;
  const rows = everything.filter((task) => (tab === "All" || (tab === "Done") === Boolean(task.done)) && (project === "all" || task.projectId === project));

  const startDraft = (task?: Row) => {
    setError("");
    setDraft(
      task
        ? { id: task.id, projectId: task.projectId, title: task.title, description: task.description ?? "", priority: task.priority ?? "Medium", due: task.due ?? "" }
        : { projectId: (project !== "all" && ctx.projects.some((item) => item.id === project) ? project : ctx.projects[0]?.id) ?? "", title: "", description: "", priority: "Medium", due: "" },
    );
  };
  // Links from Work: "new" opens the form, a task id opens that task, a project id filters to it.
  useEffect(() => {
    if (route.mode !== "dashboard" || route.dashboardSection !== "pm-tasks" || !route.target) return;
    if (route.target === "new") startDraft();
    else if (ctx.projects.some((item) => item.id === route.target)) setProject(route.target);
    else {
      const task = everything.find((item) => item.id === route.target);
      if (task && canEdit) startDraft(task);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.revision]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    const title = draft.title.trim();
    if (!title) return setError("Give the task a name.");
    if (!draft.projectId) return setError("Choose a project for it.");
    const existing = everything.find((item) => item.id === draft.id);
    const task = { id: draft.id ?? newId("task"), title, description: draft.description.trim(), priority: draft.priority, due: draft.due, done: existing?.done ?? false };
    setProjects((old) =>
      old.map((item) =>
        item.id === draft.projectId
          ? { ...item, tasks: item.tasks.some((entry) => entry.id === task.id) ? item.tasks.map((entry) => (entry.id === task.id ? task : entry)) : [...item.tasks, task] }
          : { ...item, tasks: item.tasks.filter((entry) => entry.id !== task.id) },
      ),
    );
    logAudit(stores, profile.name, `${draft.id ? "Updated" : "Added"} the task "${title}".`);
    notify(draft.id ? "Task updated." : "Task added.");
    setDraft(null);
  };
  const toggle = (projectId: string, taskId: string) => {
    if (running && timer.taskId === taskId) return notify("Finish the focus session on this task first.");
    setProjects((old) => old.map((item) => (item.id === projectId ? { ...item, tasks: item.tasks.map((task) => (task.id === taskId ? { ...task, done: !task.done } : task)) } : item)));
  };
  const remove = () => {
    if (!removing) return;
    if (running && timer.taskId === removing.id) {
      setRemoving(null);
      return notify("Finish the focus session on this task first.");
    }
    setProjects((old) => old.map((item) => ({ ...item, tasks: item.tasks.filter((task) => task.id !== removing.id) })));
    if (timer.taskId === removing.id) setTimer((old) => ({ ...old, taskId: null }));
    logAudit(stores, profile.name, `Deleted the task "${removing.title}".`);
    notify("Task deleted.");
    setRemoving(null);
    setDraft(null);
  };

  const statusOf = (task: Row) => (task.done ? "Completed" : timing && timer.taskId === task.id ? "In progress" : "To do");
  const due = (task: Row) => (task.due ? dateLabel(task.due) : "No date");
  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="GOOD THINGS, IN PROGRESS" title="Tasks" description={canEdit ? "Make, change and finish tasks. Work shows your own as a checklist." : "Every task you can see."}>
        <FilterSelect label="View" value={layout} onChange={(value) => setLayout(value as typeof layout)} options={[{ value: "list", text: "List" }, { value: "board", text: "Board" }]} />
        {canEdit && (
          <button className="sf-button primary" disabled={!ctx.projects.length} onClick={() => startDraft()}>
            <Plus size={17} /> New task
          </button>
        )}
      </PageHeading>
      <Kpis items={[{ label: "Open", value: everything.filter((task) => !task.done).length }, { label: "Done", value: everything.filter((task) => task.done).length, tone: "good" }, { label: "High priority", value: everything.filter((task) => !task.done && task.priority === "High").length }]} />
      {layout === "board" ? (
        <div className="db-taskboard">
          {(["To do", "In progress", "Completed"] as const).map((column) => {
            const items = everything.filter((task) => statusOf(task) === column);
            return (
              <section className="db-taskcol" key={column}>
                <header>
                  <h2>{column}</h2>
                  <small>{items.length}</small>
                </header>
                {items.map((task) => (
                  <article className="db-taskcard" key={task.id}>
                    <span className={`db-priority ${(task.priority ?? "Medium").toLowerCase()}`}>{task.priority ?? "Medium"}</span>
                    {canEdit ? (
                      <button className="db-taskcard-title" onClick={() => startDraft(task)}>
                        {task.title}
                      </button>
                    ) : (
                      <strong>{task.title}</strong>
                    )}
                    <small>
                      <i className={`db-scope-dot ${task.color}`} />
                      {task.projectName} · {due(task)}
                    </small>
                    {task.description && <p>{task.description}</p>}
                    {canEdit && (
                      <button className="db-text-button" disabled={running && timer.taskId === task.id} onClick={() => toggle(task.projectId, task.id)}>
                        {task.done ? "Reopen" : "Complete"}
                      </button>
                    )}
                  </article>
                ))}
                {!items.length && <p className="db-taskcol-empty">Nothing here.</p>}
              </section>
            );
          })}
        </div>
      ) : (
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          searchText={(row) => `${row.title} ${row.projectName}`}
          searchPlaceholder="Search tasks"
          exportName="tasks"
          toolbar={
            <>
              <FilterSelect label="Show" value={tab} onChange={(value) => setTab(value as typeof tab)} options={[{ value: "Open", text: "Open", count: everything.filter((task) => !task.done).length }, { value: "Done", text: "Done", count: everything.filter((task) => task.done).length }, { value: "All", text: "All tasks" }]} />
              {ctx.projects.length > 1 && (
                <label className="db-select-wrap">
                  <select aria-label="Filter by project" value={project} onChange={(event) => setProject(event.target.value)}>
                    <option value="all">All projects</option>
                    {ctx.projects.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          }
          emptyTitle="No tasks here"
          emptyHint={canEdit ? "Try another filter, or add a task." : "Try another filter."}
          columns={[
            {
              header: "Task",
              cell: (row) => (
                <div className="db-task-cell">
                  {canEdit && <input type="checkbox" aria-label={`${row.done ? "Reopen" : "Complete"} ${row.title}`} checked={Boolean(row.done)} onChange={() => toggle(row.projectId, row.id)} />}
                  <div className="db-person-cell">
                    <div>
                      {canEdit ? (
                        <button className="db-task-title" onClick={() => startDraft(row)}>
                          {row.title}
                        </button>
                      ) : (
                        <strong>{row.title}</strong>
                      )}
                      <small>{row.projectName}</small>
                    </div>
                  </div>
                </div>
              ),
              csv: (row) => row.title,
            },
            { header: "Priority", cell: (row) => <span className={`db-priority ${(row.priority ?? "Medium").toLowerCase()}`}>{row.priority ?? "Medium"}</span>, csv: (row) => row.priority ?? "Medium" },
            { header: "Due", cell: due, csv: (row) => row.due ?? "" },
            { header: "Status", cell: (row) => <Badge text={statusOf(row)} />, csv: statusOf },
            ...(canEdit
              ? [
                  {
                    header: "",
                    cell: (row: Row) => (
                      <div className="db-row-actions">
                        <button className="sf-icon-button" aria-label={`Edit ${row.title}`} title="Edit" onClick={() => startDraft(row)}>
                          <PencilSimple size={16} />
                        </button>
                        <button className="sf-icon-button" aria-label={`Delete ${row.title}`} title="Delete" disabled={running && timer.taskId === row.id} onClick={() => setRemoving({ id: row.id, title: row.title })}>
                          <Trash size={16} />
                        </button>
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
      {draft && (
        <Modal title={draft.id ? "Edit task" : "New task"} description="Keep it specific. A clear next step is easier to finish." onClose={() => setDraft(null)}>
          <form onSubmit={save}>
            <label className="db-field">
              Task
              <input autoFocus required maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
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
                <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as TaskDraft["priority"] })}>
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                </select>
              </label>
            </div>
            <label className="db-field">
              Due date (optional)
              <input type="date" value={draft.due} onChange={(event) => setDraft({ ...draft, due: event.target.value })} />
            </label>
            <label className="db-field">
              Notes (optional)
              <textarea rows={3} maxLength={300} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            </label>
            {error && (
              <p className="db-form-error" role="alert">
                {error}
              </p>
            )}
            <div className="db-modal-actions">
              {draft.id && (
                <button className="sf-button danger" type="button" onClick={() => setRemoving({ id: draft.id!, title: draft.title })}>
                  Delete
                </button>
              )}
              <button className="sf-button" type="button" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button className="sf-button primary" type="submit">
                {draft.id ? "Save task" : "Add task"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal title="Delete this task?" description={`"${removing.title}" will be removed from every project view. Time already tracked on it stays in the timesheets.`} onClose={() => setRemoving(null)}>
          <div className="db-modal-actions">
            <button className="sf-button" onClick={() => setRemoving(null)}>
              Keep it
            </button>
            <button className="sf-button danger" onClick={remove}>
              Delete task
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Clients: the companies the projects are for, with what they have been billed. */
export function ClientsPage({ ctx }: { ctx: PageContext }) {
  const stores = useDashboardStores();
  const { projects, profile, notify } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", contact: "", email: "", projectIds: [] as string[] });
  const rows = stores.clients.map((client) => {
    const invoices = stores.invoices.filter((invoice) => invoice.client === client.name);
    return {
      ...client,
      invoiced: invoices.reduce((sum, invoice) => sum + invoice.amount, 0),
      owed: invoices.filter((invoice) => invoice.status === "Sent" || invoice.status === "Overdue").reduce((sum, invoice) => sum + invoice.amount, 0),
    };
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    const client: Client = { id: newId("cl"), name: form.name.trim(), contact: form.contact.trim() || "-", email: form.email.trim() || "-", projectIds: form.projectIds };
    stores.setClients((old) => [...old, client]);
    logAudit(stores, profile.name, `Added the client ${client.name}.`);
    setOpen(false);
    setForm({ name: "", contact: "", email: "", projectIds: [] });
    notify("Client added.");
  };
  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="GOOD THINGS, IN PROGRESS" title="Clients" description="Who the work is for, and what they owe.">
        {ctx.canManage && (
          <button className="sf-button primary" onClick={() => setOpen(true)}>
            <Plus size={17} /> Add client
          </button>
        )}
      </PageHeading>
      <Kpis items={[{ label: "Clients", value: rows.length }, { label: "Invoiced", value: money(rows.reduce((sum, row) => sum + row.invoiced, 0)) }, { label: "Outstanding", value: money(rows.reduce((sum, row) => sum + row.owed, 0)), tone: rows.some((row) => row.owed) ? undefined : "good" }]} />
      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        searchText={(row) => `${row.name} ${row.contact} ${row.email}`}
        searchPlaceholder="Search clients"
        exportName="clients"
        emptyTitle="No clients yet"
        emptyHint="Add the companies you do work for."
        columns={[
          { header: "Client", cell: (row) => <div className="db-person-cell"><div><strong>{row.name}</strong><small>{row.contact} · {row.email}</small></div></div>, csv: (row) => row.name },
          { header: "Projects", cell: (row) => row.projectIds.map((id) => projects.find((project) => project.id === id)?.name).filter(Boolean).join(", ") || "None yet", csv: (row) => row.projectIds.join("; ") },
          { header: "Invoiced", numeric: true, cell: (row) => money(row.invoiced), csv: (row) => row.invoiced },
          { header: "Outstanding", numeric: true, cell: (row) => money(row.owed), csv: (row) => row.owed },
        ]}
      />
      {open && (
        <Modal title="Add a client" description="Link the projects they are billed for." onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <label className="db-field">
              Company
              <input autoFocus required maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <div className="db-form-grid">
              <label className="db-field">
                Contact person
                <input maxLength={80} value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} />
              </label>
              <label className="db-field">
                Email
                <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
              </label>
            </div>
            <fieldset className="db-checks">
              <legend>Projects</legend>
              {projects.map((project) => (
                <label key={project.id}>
                  <input type="checkbox" checked={form.projectIds.includes(project.id)} onChange={(event) => setForm({ ...form, projectIds: event.target.checked ? [...form.projectIds, project.id] : form.projectIds.filter((id) => id !== project.id) })} />
                  {project.name}
                </label>
              ))}
            </fieldset>
            <div className="db-modal-actions">
              <button className="sf-button" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="sf-button primary" type="submit">
                Add client
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

const KINDS: TimeOff["kind"][] = ["Vacation", "Sick leave", "Personal"];
const spanDays = (from: string, to: string) => Math.max(1, Math.round((noonOf(to).getTime() - noonOf(from).getTime()) / 86_400_000) + 1);

/** Time off requests: ask for a day or a stretch off, and see how the team is placed. */
export function TimeOffPage({ ctx }: { ctx: PageContext }) {
  const stores = useDashboardStores();
  const { profile, notify } = useWorkspace();
  const [tab, setTab] = useState<"Pending" | "Approved" | "Rejected" | "All">("Pending");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: "Vacation" as TimeOff["kind"], from: dayKey(7), to: dayKey(7), note: "" });
  const [error, setError] = useState("");
  const mine = ctx.canManage ? stores.timeOff : stores.timeOff.filter((request) => request.memberId === "me");
  const rows = mine.filter((request) => tab === "All" || request.status === tab);
  const count = (status: string) => mine.filter((request) => request.status === status).length;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (form.to < form.from) return setError("The last day can't be before the first.");
    stores.setTimeOff((old) => [{ id: newId("to"), memberId: "me", kind: form.kind, from: form.from, to: form.to, days: spanDays(form.from, form.to), note: form.note.trim(), status: "Pending" }, ...old]);
    logAudit(stores, profile.name, `Asked for ${spanDays(form.from, form.to)} day(s) of ${form.kind.toLowerCase()}.`);
    setOpen(false);
    setError("");
    setTab("Pending");
    notify("Request sent for review.");
  };
  const decide = (request: TimeOff, status: "Approved" | "Rejected") => {
    stores.setTimeOff((old) => old.map((item) => (item.id === request.id ? { ...item, status } : item)));
    logAudit(stores, profile.name, `${status === "Approved" ? "Approved" : "Declined"} ${request.days} day(s) of ${request.kind.toLowerCase()}.`);
    notify(status === "Approved" ? "Time off approved." : "Request declined.");
  };

  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="GOOD THINGS, IN PROGRESS" title="Time off requests" description="Plan time away without surprising the team.">
        <button className="sf-button primary" onClick={() => setOpen(true)}>
          <Plus size={17} /> Request time off
        </button>
      </PageHeading>
      <Kpis items={[{ label: "Waiting for review", value: count("Pending"), tone: count("Pending") ? undefined : "good" }, { label: "Approved days", value: mine.filter((request) => request.status === "Approved").reduce((sum, request) => sum + request.days, 0) }, { label: "Requests", value: mine.length }]} />
      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        toolbar={
          <FilterSelect label="Show" value={tab} onChange={(value) => setTab(value as typeof tab)} options={[{ value: "Pending", text: "Waiting", count: count("Pending") }, { value: "Approved", text: "Approved", count: count("Approved") }, { value: "Rejected", text: "Declined", count: count("Rejected") }, { value: "All", text: "All requests" }]} />
        }
        searchText={(row) => `${row.kind} ${row.note}`}
        searchPlaceholder="Search requests"
        exportName="time-off-requests"
        emptyTitle="No requests here"
        emptyHint="Use Request time off to ask for a day away."
        columns={[
          { header: "Member", cell: (row) => <Person id={row.memberId} detail={row.note || undefined} /> },
          { header: "Type", cell: (row) => row.kind, csv: (row) => row.kind },
          { header: "Dates", cell: (row) => (row.from === row.to ? dateLabel(row.from) : `${dateLabel(row.from)} - ${dateLabel(row.to)}`), csv: (row) => `${row.from} to ${row.to}` },
          { header: "Days", numeric: true, cell: (row) => row.days, csv: (row) => row.days },
          { header: "Status", cell: (row) => <Badge text={row.status} />, csv: (row) => row.status },
          { header: "", cell: (row) => (ctx.canManage && row.status === "Pending" ? <Decide approve="Approve" reject="Decline" onApprove={() => decide(row, "Approved")} onReject={() => decide(row, "Rejected")} /> : null) },
        ]}
      />
      {open && (
        <Modal title="Request time off" description="A manager reviews it before it is confirmed." onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <label className="db-field">
              Type
              <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as TimeOff["kind"] })}>
                {KINDS.map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <div className="db-form-grid">
              <label className="db-field">
                First day
                <input type="date" required value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value, to: form.to < event.target.value ? event.target.value : form.to })} />
              </label>
              <label className="db-field">
                Last day
                <input type="date" required min={form.from} value={form.to} onChange={(event) => setForm({ ...form, to: event.target.value })} />
              </label>
            </div>
            <label className="db-field">
              Note (optional)
              <input maxLength={160} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
            </label>
            {error && (
              <p className="db-form-error" role="alert">
                {error}
              </p>
            )}
            <div className="db-modal-actions">
              <button className="sf-button" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="sf-button primary" type="submit">
                Send request
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
