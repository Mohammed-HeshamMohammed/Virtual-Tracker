import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { CaretLeft, CaretRight, Plus } from "@phosphor-icons/react";
import { formatDuration, useWorkspace, type Session } from "../../../workspace";
import { Modal } from "../../ui";
import { Badge, FilterSelect, PageHeading } from "../DashboardParts";
import { activityLevel } from "./activity-data";
import { DataTable, Decide, Kpis, Person, dateLabel, hours, type PageContext } from "./kit";
import { dayKey, logAudit, newId, noonOf, useDashboardStores, type ManualRequest } from "./stores";

const TABS = ["Pending", "Approved", "Rejected", "All"] as const;

/** Time & Activity: who tracked what on each day of a week, with how active they were. */
export function TimeActivityPage({ ctx }: { ctx: PageContext }) {
  const { members, preferences } = useWorkspace();
  const [offset, setOffset] = useState(0);
  const first = preferences.weekStart === "Sunday" ? 0 : preferences.weekStart === "Saturday" ? 6 : 1;
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() - first + 7) % 7) + offset * 7);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { key: date.toLocaleDateString("en-CA"), label: date.toLocaleDateString("en", { weekday: "short", day: "numeric" }) };
  });
  const people = ctx.canManage
    ? members.filter((member) => member.role !== "Client").map((member) => member.id)
    : [...new Set(ctx.allSessions.map((session) => session.memberId))];
  const rows = people.map((id) => {
    const byDay = days.map((day) =>
      ctx.allSessions.filter((session) => session.memberId === id && new Date(session.startedAt).toLocaleDateString("en-CA") === day.key).reduce((sum, session) => sum + session.seconds, 0),
    );
    const worked = days.filter((_, index) => byDay[index] > 0);
    const activity = worked.length ? Math.round(worked.reduce((sum, day) => sum + activityLevel(id, day.key), 0) / worked.length) : 0;
    return { id, byDay, total: byDay.reduce((sum, value) => sum + value, 0), activity };
  });
  const peak = Math.max(1, ...rows.flatMap((row) => row.byDay));
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const active = rows.filter((row) => row.total > 0);
  const average = active.length ? Math.round(active.reduce((sum, row) => sum + row.activity, 0) / active.length) : 0;
  const busiest = days.reduce((best, _day, index) => (rows.reduce((sum, row) => sum + row.byDay[index], 0) > rows.reduce((sum, row) => sum + row.byDay[best], 0) ? index : best), 0);
  const range = `${dateLabel(days[0].key)} - ${dateLabel(days[6].key)}`;

  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="TIME, WELL SPENT" title="Time & Activity" description="Tracked time and activity for each person, day by day.">
        <div className="db-week-nav" role="group" aria-label="Week">
          <button className="sf-icon-button" aria-label="Previous week" onClick={() => setOffset(offset - 1)}>
            <CaretLeft size={16} />
          </button>
          <strong>{offset === 0 ? "This week" : range}</strong>
          <button className="sf-icon-button" aria-label="Next week" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>
            <CaretRight size={16} />
          </button>
        </div>
      </PageHeading>
      <Kpis
        items={[
          { label: range, value: formatDuration(total) },
          { label: "Average activity", value: `${average}%`, tone: average >= 75 ? "good" : undefined },
          { label: "People who tracked", value: active.length, unit: `of ${rows.length}` },
          { label: "Busiest day", value: total ? days[busiest].label : "-" },
        ]}
      />
      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        searchText={(row) => members.find((member) => member.id === row.id)?.name ?? ""}
        searchPlaceholder="Search people"
        exportName="time-and-activity"
        emptyTitle="No one to show"
        emptyHint="Time tracked in Work appears here."
        columns={[
          { header: "Member", cell: (row) => <Person id={row.id} detail={`${row.activity}% activity`} />, csv: (row) => members.find((member) => member.id === row.id)?.name ?? "" },
          ...days.map((day, index) => ({
            header: day.label,
            numeric: true,
            cell: (row: (typeof rows)[number]) => (
              <span className="db-heat" style={{ "--heat": row.byDay[index] / peak } as CSSProperties}>
                {row.byDay[index] ? `${hours(row.byDay[index])}h` : "-"}
              </span>
            ),
            csv: (row: (typeof rows)[number]) => hours(row.byDay[index]),
          })),
          { header: "Total", numeric: true, cell: (row) => <strong>{formatDuration(row.total)}</strong>, csv: (row) => hours(row.total) },
          { header: "Activity", numeric: true, cell: (row) => (row.total ? `${row.activity}%` : "-"), csv: (row) => row.activity },
        ]}
      />
    </div>
  );
}

/** Task Approvals: tasks marked done wait here for a manager to sign them off, or send them back. */
export function TaskApprovalsPage({ ctx }: { ctx: PageContext }) {
  const stores = useDashboardStores();
  const { setProjects, profile, notify } = useWorkspace();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Pending");
  const done = ctx.projects.flatMap((project) =>
    project.tasks.filter((task) => task.done).map((task) => ({ ...task, projectId: project.id, projectName: project.name, color: project.color, review: stores.taskReviews[task.id] ? "Approved" : "Pending" })),
  );
  const rows = done.filter((row) => tab === "All" || (tab !== "Rejected" && row.review === tab));
  const pending = done.filter((row) => row.review === "Pending").length;

  const approve = (taskId: string, title: string) => {
    stores.setTaskReviews((old) => ({ ...old, [taskId]: "Approved" }));
    logAudit(stores, profile.name, `Approved the task "${title}".`);
    notify("Task approved.");
  };
  const reject = (projectId: string, taskId: string, title: string) => {
    setProjects((old) => old.map((project) => (project.id === projectId ? { ...project, tasks: project.tasks.map((task) => (task.id === taskId ? { ...task, done: false } : task)) } : project)));
    stores.setTaskReviews((old) => {
      const next = { ...old };
      delete next[taskId];
      return next;
    });
    logAudit(stores, profile.name, `Sent the task "${title}" back to be reopened.`);
    notify("Task sent back and reopened.");
  };

  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="TIME, WELL SPENT" title="Task Approvals" description={ctx.canManage ? "Check finished tasks before they count as complete." : "Your finished tasks and whether they were signed off."} />
      <Kpis
        items={[
          { label: "Waiting for review", value: pending, tone: pending ? undefined : "good" },
          { label: "Approved", value: done.length - pending },
          { label: "Finished tasks", value: done.length },
        ]}
      />
      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        toolbar={
          <FilterSelect label="Show" value={tab} onChange={(value) => setTab(value as typeof tab)} options={[{ value: "Pending", text: "Waiting for review", count: pending }, { value: "Approved", text: "Approved", count: done.length - pending }, { value: "All", text: "All finished tasks" }]} />
        }
        searchText={(row) => `${row.title} ${row.projectName}`}
        searchPlaceholder="Search tasks or projects"
        exportName="task-approvals"
        emptyTitle={tab === "Pending" ? "Nothing waiting" : "No tasks here"}
        emptyHint={tab === "Pending" ? "Finished tasks show up here for review." : "Try another tab."}
        columns={[
          { header: "Task", cell: (row) => (<div className="db-person-cell"><div><strong>{row.title}</strong><small>{row.projectName}</small></div></div>), csv: (row) => row.title },
          { header: "Priority", cell: (row) => row.priority ?? "Medium", csv: (row) => row.priority ?? "Medium" },
          { header: "Status", cell: (row) => <Badge text={row.review} />, csv: (row) => row.review },
          {
            header: "",
            cell: (row) =>
              ctx.canManage && row.review === "Pending" ? (
                <Decide approve="Approve" reject="Send back" onApprove={() => approve(row.id, row.title)} onReject={() => reject(row.projectId, row.id, row.title)} />
              ) : null,
          },
        ]}
      />
    </div>
  );
}

/** Manual Time Requests: time someone forgot to track, asked for and reviewed here. Approving one adds
 *  it to the timesheets as an approved session. */
export function ManualRequestsPage({ ctx }: { ctx: PageContext }) {
  const stores = useDashboardStores();
  const { projects, setSessions, profile, notify, route } = useWorkspace();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Pending");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ projectId: ctx.projects[0]?.id ?? "", date: dayKey(0), minutes: "60", reason: "" });
  const [error, setError] = useState("");
  // Work's "Request time" lands here with the form open.
  useEffect(() => {
    if (route.mode === "dashboard" && route.dashboardSection === "timesheets-manual-requests" && route.target === "new") setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.revision]);
  const mine = (ctx.canManage ? stores.manual : stores.manual.filter((request) => request.memberId === "me")).filter((request) => ctx.projectScope === "all" || request.projectId === ctx.projectScope);
  const rows = mine.filter((request) => tab === "All" || request.status === tab);
  const count = (status: string) => mine.filter((request) => request.status === status).length;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const minutes = Number(form.minutes);
    if (!form.reason.trim()) return setError("Say why this time wasn't tracked.");
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 720) return setError("Enter between 5 and 720 minutes.");
    const request: ManualRequest = { id: newId("mr"), memberId: "me", projectId: form.projectId, date: form.date, minutes: Math.round(minutes), reason: form.reason.trim(), status: "Pending" };
    stores.setManual((old) => [request, ...old]);
    logAudit(stores, profile.name, `Asked for ${Math.round(minutes)} minutes of manual time.`);
    setOpen(false);
    setError("");
    setForm({ ...form, reason: "" });
    setTab("Pending");
    notify("Request sent for review.");
  };
  const decide = (request: ManualRequest, status: "Approved" | "Rejected") => {
    stores.setManual((old) => old.map((item) => (item.id === request.id ? { ...item, status } : item)));
    if (status === "Approved") {
      const session: Session = {
        id: newId("session"),
        projectId: request.projectId,
        taskTitle: "Manual time",
        startedAt: noonOf(request.date).toISOString(),
        endedAt: new Date(noonOf(request.date).getTime() + request.minutes * 60_000).toISOString(),
        seconds: request.minutes * 60,
        note: request.reason,
        status: "Approved",
        memberId: request.memberId,
      };
      setSessions((old) => [session, ...old]);
    }
    logAudit(stores, profile.name, `${status === "Approved" ? "Approved" : "Rejected"} a manual time request (${formatDuration(request.minutes * 60)}).`);
    notify(status === "Approved" ? "Approved and added to the timesheets." : "Request rejected.");
  };

  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="TIME, WELL SPENT" title="Manual Time Requests" description="Time that wasn't tracked, asked for and reviewed in the open.">
        <button className="sf-button primary" onClick={() => setOpen(true)}>
          <Plus size={17} /> Request time
        </button>
      </PageHeading>
      <Kpis
        items={[
          { label: "Waiting for review", value: count("Pending"), tone: count("Pending") ? undefined : "good" },
          { label: "Approved", value: count("Approved") },
          { label: "Time approved", value: formatDuration(mine.filter((request) => request.status === "Approved").reduce((sum, request) => sum + request.minutes * 60, 0)) },
        ]}
      />
      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        toolbar={
          <FilterSelect label="Show" value={tab} onChange={(value) => setTab(value as typeof tab)} options={[{ value: "Pending", text: "Waiting", count: count("Pending") }, { value: "Approved", text: "Approved", count: count("Approved") }, { value: "Rejected", text: "Rejected", count: count("Rejected") }, { value: "All", text: "All requests" }]} />
        }
        searchText={(row) => `${row.reason} ${projects.find((project) => project.id === row.projectId)?.name ?? ""}`}
        searchPlaceholder="Search requests"
        exportName="manual-time-requests"
        emptyTitle="No requests here"
        emptyHint="Use Request time when you worked without the tracker."
        columns={[
          { header: "Member", cell: (row) => <Person id={row.memberId} detail={row.reason} /> },
          { header: "Project", cell: (row) => projects.find((project) => project.id === row.projectId)?.name ?? "Archived project", csv: (row) => projects.find((project) => project.id === row.projectId)?.name ?? "" },
          { header: "Date", cell: (row) => dateLabel(row.date), csv: (row) => row.date },
          { header: "Time", numeric: true, cell: (row) => formatDuration(row.minutes * 60), csv: (row) => row.minutes },
          { header: "Status", cell: (row) => <Badge text={row.status} />, csv: (row) => row.status },
          {
            header: "",
            cell: (row) => (ctx.canManage && row.status === "Pending" ? <Decide onApprove={() => decide(row, "Approved")} onReject={() => decide(row, "Rejected")} /> : null),
          },
        ]}
      />
      {open && (
        <Modal title="Request manual time" description="A manager reviews it. Once approved it joins your timesheet." onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <div className="db-form-grid">
              <label className="db-field">
                Project
                <select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="db-field">
                Date
                <input type="date" required max={dayKey(0)} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
              </label>
            </div>
            <label className="db-field">
              Minutes
              <input type="number" required min={5} max={720} value={form.minutes} onChange={(event) => setForm({ ...form, minutes: event.target.value })} />
            </label>
            <label className="db-field">
              Reason
              <textarea required rows={3} maxLength={240} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
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
