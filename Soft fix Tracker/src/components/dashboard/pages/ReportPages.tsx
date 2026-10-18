import { ProjectLabel } from "../../ProjectAvatar";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { formatDuration, useWorkspace, type Session } from "../../../workspace";
import { pageAllowed, reportGroups, reportLabel } from "../../../data/dashboard";
import { Badge, PageHeading } from "../DashboardParts";
import { activityLevel, appUsage, siteUsage } from "./activity-data";
import { payrollRows } from "./finance-data";
import { DataTable, Kpis, Person, dateLabel, hours, money, type Column, type PageContext } from "./kit";
import { dayKey, useDashboardStores } from "./stores";

const ABOUT: Record<string, string> = {
  "reports-time": "Hours and activity for each person.",
  "reports-work-sessions": "Every tracked session, one row each.",
  "reports-apps-urls": "The apps and sites used most.",
  "reports-manual-edits": "Time added by request instead of the tracker.",
  "reports-timesheet-approvals": "How much time is submitted, approved and waiting.",
  "reports-expenses": "Spending by category.",
  "reports-work-breaks": "The gaps between sessions in a day.",
  "reports-audit": "Who changed what, and when.",
  "reports-amounts": "What each person is owed for approved time.",
  "reports-payments": "Every payment made or scheduled.",
  "reports-weekly-limits": "Weekly hours against the limit.",
  "reports-daily-limits": "Daily hours against the goal.",
  "reports-project-budgets": "Hours used against each project's budget.",
  "reports-client-budgets": "Hours and billing for each client.",
  "reports-time-off-balances": "Days of leave used and left.",
  "reports-time-off-transactions": "Every time off request.",
  "reports-client-invoices": "Invoices sent to clients.",
  "reports-team-invoices": "What the team has billed, from payments.",
  "reports-client-invoices-aging": "Unpaid client invoices by how late they are.",
  "reports-team-invoices-aging": "Scheduled payments by how soon they fall due.",
  "reports-shift-attendance": "Start times against the workday start.",
};

/** All reports: the real Dashboard's report list, grouped, for the reports this role may open. */
export function ReportsHubPage({ ctx }: { ctx: PageContext }) {
  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="MAKE THE NUMBERS MEAN SOMETHING" title="All reports" description="Pick a report. Each one can be exported." />
      <div className="db-report-groups">
        {reportGroups
          .map((group) => ({ ...group, reports: group.reports.filter((report) => pageAllowed(ctx.role, report.id)) }))
          .filter((group) => group.reports.length)
          .map((group) => (
            <section key={group.label} className="sf-card db-report-group">
              <h2>{group.label}</h2>
              <div>
                {group.reports.map((report) => (
                  <button key={report.id} className="db-report-link" onClick={() => ctx.go(report.id)}>
                    <span>
                      <strong>{report.label}</strong>
                      <small>{ABOUT[report.id]}</small>
                    </span>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </div>
            </section>
          ))}
      </div>
    </div>
  );
}

type Shell<T> = {
  kpis: { label: string; value: ReactNode; unit?: string; tone?: "good" | "warn" }[];
  rows: T[];
  columns: Column<T>[];
  key: (row: T) => string;
  search?: (row: T) => string;
  emptyHint?: string;
};
const shell = <T,>(value: Shell<T>) => value;

const startOfWeek = (weekStart: string) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  const first = weekStart === "Sunday" ? 0 : weekStart === "Saturday" ? 6 : 1;
  date.setDate(date.getDate() - ((date.getDay() - first + 7) % 7));
  return date;
};
const dayOf = (session: Session) => new Date(session.startedAt).toLocaleDateString("en-CA");
const bucket = (days: number) => (days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : 3);
const BUCKETS = ["Not yet due", "1-30 days", "31-60 days", "Over 60 days"];

/** One report from the list. They are all worked out from the same local data the other pages use. */
export function ReportPage({ id, ctx }: { id: string; ctx: PageContext }) {
  const stores = useDashboardStores();
  const { members, projects, preferences } = useWorkspace();
  const { projectMeta: meta } = useWorkspace();
  const sessions = ctx.sessions;
  const all = ctx.allSessions;
  const name = (memberId: string) => members.find((member) => member.id === memberId)?.name ?? "Team member";
  const projectName = (projectId: string) => projects.find((project) => project.id === projectId)?.name ?? "Archived project";
  const people = [...new Set(sessions.map((session) => session.memberId))];
  const week = startOfWeek(preferences.weekStart);
  const weekSessions = all.filter((session) => new Date(session.startedAt) >= week);
  const today = dayKey(0);
  const weeklyLimit = preferences.dailyGoal * 5;

  const built = (() => {
    switch (id) {
      case "reports-time":
        return shell({
          kpis: [{ label: "Tracked", value: formatDuration(sessions.reduce((sum, session) => sum + session.seconds, 0)) }, { label: "Sessions", value: sessions.length }, { label: "People", value: people.length }],
          rows: people.map((memberId) => {
            const own = sessions.filter((session) => session.memberId === memberId);
            const seconds = own.reduce((sum, session) => sum + session.seconds, 0);
            const days = [...new Set(own.map(dayOf))];
            return { memberId, seconds, count: own.length, approved: own.filter((session) => session.status === "Approved").length, activity: days.length ? Math.round(days.reduce((sum, day) => sum + activityLevel(memberId, day), 0) / days.length) : 0 };
          }),
          key: (row) => row.memberId,
          search: (row) => name(row.memberId),
          columns: [
            { header: "Member", cell: (row) => <Person id={row.memberId} />, csv: (row) => name(row.memberId) },
            { header: "Tracked", numeric: true, cell: (row) => formatDuration(row.seconds), csv: (row) => hours(row.seconds) },
            { header: "Sessions", numeric: true, cell: (row) => row.count, csv: (row) => row.count },
            { header: "Average session", numeric: true, cell: (row) => formatDuration(row.count ? row.seconds / row.count : 0), csv: (row) => hours(row.count ? row.seconds / row.count : 0) },
            { header: "Approved", numeric: true, cell: (row) => `${row.approved} of ${row.count}`, csv: (row) => row.approved },
            { header: "Activity", numeric: true, cell: (row) => `${row.activity}%`, csv: (row) => row.activity },
          ],
        });
      case "reports-work-sessions":
        return shell({
          kpis: [{ label: "Sessions", value: sessions.length }, { label: "Tracked", value: formatDuration(sessions.reduce((sum, session) => sum + session.seconds, 0)) }],
          rows: sessions,
          key: (row) => row.id,
          search: (row) => `${name(row.memberId)} ${row.taskTitle} ${projectName(row.projectId)}`,
          columns: [
            { header: "Member", cell: (row) => <Person id={row.memberId} detail={row.taskTitle} />, csv: (row) => name(row.memberId) },
            { header: "Project", cell: (row) => <ProjectLabel projectId={row.projectId} />, csv: (row) => projectName(row.projectId) },
            { header: "Date", cell: (row) => dateLabel(row.startedAt), csv: (row) => dayOf(row) },
            { header: "Duration", numeric: true, cell: (row) => formatDuration(row.seconds), csv: (row) => hours(row.seconds) },
            { header: "Status", cell: (row) => <Badge text={row.status} />, csv: (row) => row.status },
          ],
        });
      case "reports-apps-urls": {
        const apps = preferences.trackAppsUrls ? appUsage(sessions) : [];
        const sites = preferences.trackAppsUrls ? siteUsage(sessions) : [];
        const total = apps.reduce((sum, app) => sum + app.seconds, 0) || 1;
        const rows = [
          ...apps.slice(0, 8).map((app) => ({ key: `app-${app.app}`, kind: "App", name: app.app, seconds: app.seconds })),
          ...sites.slice(0, 8).map((site) => ({ key: `url-${site.domain}`, kind: "Site", name: site.domain, seconds: site.seconds })),
        ];
        return shell({
          kpis: [{ label: "Apps", value: apps.length }, { label: "Sites", value: sites.length }],
          rows,
          key: (row) => row.key,
          search: (row) => row.name,
          columns: [
            { header: "Name", cell: (row) => <strong>{row.name}</strong>, csv: (row) => row.name },
            { header: "Type", cell: (row) => row.kind, csv: (row) => row.kind },
            { header: "Time", numeric: true, cell: (row) => formatDuration(row.seconds), csv: (row) => hours(row.seconds) },
            { header: "Share of app time", numeric: true, cell: (row) => `${Math.round((row.seconds / total) * 100)}%`, csv: (row) => Math.round((row.seconds / total) * 100) },
          ],
        });
      }
      case "reports-manual-edits": {
        const rows = (ctx.canManage ? stores.manual : stores.manual.filter((request) => request.memberId === "me")).filter((request) => ctx.projectScope === "all" || request.projectId === ctx.projectScope);
        return shell({
          kpis: [{ label: "Requests", value: rows.length }, { label: "Time added", value: formatDuration(rows.filter((request) => request.status === "Approved").reduce((sum, request) => sum + request.minutes * 60, 0)) }],
          rows,
          key: (row) => row.id,
          search: (row) => `${name(row.memberId)} ${row.reason}`,
          columns: [
            { header: "Member", cell: (row) => <Person id={row.memberId} detail={row.reason} />, csv: (row) => name(row.memberId) },
            { header: "Project", cell: (row) => <ProjectLabel projectId={row.projectId} />, csv: (row) => projectName(row.projectId) },
            { header: "Date", cell: (row) => dateLabel(row.date), csv: (row) => row.date },
            { header: "Minutes", numeric: true, cell: (row) => row.minutes, csv: (row) => row.minutes },
            { header: "Status", cell: (row) => <Badge text={row.status} />, csv: (row) => row.status },
          ],
        });
      }
      case "reports-timesheet-approvals": {
        const rows = people.map((memberId) => {
          const own = sessions.filter((session) => session.memberId === memberId);
          const by = (status: Session["status"]) => own.filter((session) => session.status === status).reduce((sum, session) => sum + session.seconds, 0);
          const total = own.reduce((sum, session) => sum + session.seconds, 0);
          return { memberId, draft: by("Draft"), waiting: by("Submitted"), approved: by("Approved"), rate: total ? Math.round((by("Approved") / total) * 100) : 0 };
        });
        return shell({
          kpis: [{ label: "Waiting", value: formatDuration(rows.reduce((sum, row) => sum + row.waiting, 0)), tone: rows.some((row) => row.waiting) ? undefined : "good" }, { label: "Approved", value: formatDuration(rows.reduce((sum, row) => sum + row.approved, 0)) }],
          rows,
          key: (row) => row.memberId,
          search: (row) => name(row.memberId),
          columns: [
            { header: "Member", cell: (row) => <Person id={row.memberId} />, csv: (row) => name(row.memberId) },
            { header: "Draft", numeric: true, cell: (row) => formatDuration(row.draft), csv: (row) => hours(row.draft) },
            { header: "Waiting", numeric: true, cell: (row) => formatDuration(row.waiting), csv: (row) => hours(row.waiting) },
            { header: "Approved", numeric: true, cell: (row) => formatDuration(row.approved), csv: (row) => hours(row.approved) },
            { header: "Approved share", numeric: true, cell: (row) => `${row.rate}%`, csv: (row) => row.rate },
          ],
        });
      }
      case "reports-expenses": {
        const list = (ctx.canManage ? stores.expenses : stores.expenses.filter((expense) => expense.memberId === "me")).filter((expense) => ctx.projectScope === "all" || expense.projectId === ctx.projectScope);
        const rows = [...new Set(list.map((expense) => expense.category))].map((category) => {
          const own = list.filter((expense) => expense.category === category);
          return { category, count: own.length, total: own.reduce((sum, expense) => sum + expense.amount, 0), pending: own.filter((expense) => expense.status === "Pending").reduce((sum, expense) => sum + expense.amount, 0) };
        });
        return shell({
          kpis: [{ label: "Total", value: money(rows.reduce((sum, row) => sum + row.total, 0)) }, { label: "Waiting for review", value: money(rows.reduce((sum, row) => sum + row.pending, 0)) }],
          rows,
          key: (row) => row.category,
          columns: [
            { header: "Category", cell: (row) => <strong>{row.category}</strong>, csv: (row) => row.category },
            { header: "Expenses", numeric: true, cell: (row) => row.count, csv: (row) => row.count },
            { header: "Total", numeric: true, cell: (row) => money(row.total), csv: (row) => row.total },
            { header: "Waiting", numeric: true, cell: (row) => money(row.pending), csv: (row) => row.pending },
          ],
        });
      }
      case "reports-work-breaks": {
        const rows: { key: string; memberId: string; day: string; from: string; to: string; minutes: number }[] = [];
        for (const memberId of people) {
          const byDay = new Map<string, Session[]>();
          sessions.filter((session) => session.memberId === memberId).forEach((session) => byDay.set(dayOf(session), [...(byDay.get(dayOf(session)) ?? []), session]));
          byDay.forEach((list, day) => {
            const ordered = [...list].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
            ordered.slice(1).forEach((session, index) => {
              const gap = (new Date(session.startedAt).getTime() - new Date(ordered[index].endedAt).getTime()) / 60000;
              if (gap >= 5 && gap <= 180) rows.push({ key: `${session.id}-gap`, memberId, day, from: ordered[index].endedAt, to: session.startedAt, minutes: Math.round(gap) });
            });
          });
        }
        return shell({
          kpis: [{ label: "Breaks", value: rows.length }, { label: "Average break", value: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.minutes, 0) / rows.length) : "-", unit: "min" }],
          rows,
          key: (row) => row.key,
          search: (row) => name(row.memberId),
          emptyHint: "Breaks show where two sessions on the same day have a gap between them.",
          columns: [
            { header: "Member", cell: (row) => <Person id={row.memberId} />, csv: (row) => name(row.memberId) },
            { header: "Date", cell: (row) => dateLabel(row.day), csv: (row) => row.day },
            { header: "From", cell: (row) => new Date(row.from).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" }), csv: (row) => row.from },
            { header: "To", cell: (row) => new Date(row.to).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" }), csv: (row) => row.to },
            { header: "Length", numeric: true, cell: (row) => `${row.minutes} min`, csv: (row) => row.minutes },
          ],
        });
      }
      case "reports-audit":
        return shell({
          kpis: [{ label: "Events", value: stores.audit.length }],
          rows: stores.audit,
          key: (row) => row.id,
          search: (row) => `${row.actor} ${row.text}`,
          columns: [
            { header: "When", cell: (row) => new Date(row.at).toLocaleString("en", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }), csv: (row) => row.at },
            { header: "Who", cell: (row) => row.actor, csv: (row) => row.actor },
            { header: "What", cell: (row) => row.text, csv: (row) => row.text },
          ],
        });
      case "reports-amounts": {
        const rows = payrollRows(members, all, stores);
        return shell({
          kpis: [{ label: "Owed", value: money(rows.reduce((sum, row) => sum + row.owed, 0)) }, { label: "People owed", value: rows.filter((row) => row.owed > 0).length }],
          rows,
          key: (row) => row.member.id,
          search: (row) => row.member.name,
          columns: [
            { header: "Member", cell: (row) => <Person id={row.member.id} detail={row.member.role} />, csv: (row) => row.member.name },
            { header: "Rate", numeric: true, cell: (row) => `${money(row.rate)}/h`, csv: (row) => row.rate },
            { header: "Approved, unpaid", numeric: true, cell: (row) => formatDuration(row.seconds), csv: (row) => hours(row.seconds) },
            { header: "Owed", numeric: true, cell: (row) => <strong>{money(row.owed)}</strong>, csv: (row) => row.owed },
          ],
        });
      }
      case "reports-payments":
        return shell({
          kpis: [{ label: "Paid", value: money(stores.payments.filter((payment) => payment.status === "Paid").reduce((sum, payment) => sum + payment.amount, 0)) }, { label: "Payments", value: stores.payments.length }],
          rows: stores.payments,
          key: (row) => row.id,
          search: (row) => `${name(row.memberId)} ${row.note}`,
          columns: [
            { header: "Member", cell: (row) => <Person id={row.memberId} detail={row.note} />, csv: (row) => name(row.memberId) },
            { header: "Date", cell: (row) => dateLabel(row.date), csv: (row) => row.date },
            { header: "Method", cell: (row) => row.method, csv: (row) => row.method },
            { header: "Amount", numeric: true, cell: (row) => money(row.amount), csv: (row) => row.amount },
            { header: "Status", cell: (row) => <Badge text={row.status} />, csv: (row) => row.status },
          ],
        });
      case "reports-weekly-limits": {
        const rows = [...new Set(weekSessions.map((session) => session.memberId))].map((memberId) => {
          const used = hours(weekSessions.filter((session) => session.memberId === memberId).reduce((sum, session) => sum + session.seconds, 0));
          return { memberId, used, left: Math.max(0, Math.round((weeklyLimit - used) * 100) / 100), status: used > weeklyLimit ? "Over" : used >= weeklyLimit * 0.85 ? "Near" : "Within" };
        });
        return shell({
          kpis: [{ label: "Weekly limit", value: weeklyLimit, unit: "hours" }, { label: "Over the limit", value: rows.filter((row) => row.status === "Over").length, tone: rows.some((row) => row.status === "Over") ? "warn" : "good" }],
          rows,
          key: (row) => row.memberId,
          search: (row) => name(row.memberId),
          columns: [
            { header: "Member", cell: (row) => <Person id={row.memberId} />, csv: (row) => name(row.memberId) },
            { header: "This week", numeric: true, cell: (row) => `${row.used}h`, csv: (row) => row.used },
            { header: "Limit", numeric: true, cell: () => `${weeklyLimit}h`, csv: () => weeklyLimit },
            { header: "Left", numeric: true, cell: (row) => `${row.left}h`, csv: (row) => row.left },
            { header: "Status", cell: (row) => <Badge text={row.status === "Over" ? "Overdue" : row.status === "Near" ? "In progress" : "Approved"} />, csv: (row) => row.status },
          ],
        });
      }
      case "reports-daily-limits": {
        const rows = [...new Set(weekSessions.map((session) => session.memberId))].map((memberId) => {
          const own = weekSessions.filter((session) => session.memberId === memberId);
          const perDay = new Map<string, number>();
          own.forEach((session) => perDay.set(dayOf(session), (perDay.get(dayOf(session)) ?? 0) + session.seconds));
          const counts = [...perDay.values()].map(hours);
          return { memberId, today: hours(perDay.get(today) ?? 0), busiest: Math.max(0, ...counts), over: counts.filter((value) => value > preferences.dailyGoal).length };
        });
        return shell({
          kpis: [{ label: "Daily goal", value: preferences.dailyGoal, unit: "hours" }, { label: "Days over goal", value: rows.reduce((sum, row) => sum + row.over, 0) }],
          rows,
          key: (row) => row.memberId,
          search: (row) => name(row.memberId),
          columns: [
            { header: "Member", cell: (row) => <Person id={row.memberId} />, csv: (row) => name(row.memberId) },
            { header: "Today", numeric: true, cell: (row) => `${row.today}h`, csv: (row) => row.today },
            { header: "Busiest day this week", numeric: true, cell: (row) => `${row.busiest}h`, csv: (row) => row.busiest },
            { header: "Days over goal", numeric: true, cell: (row) => row.over, csv: (row) => row.over },
          ],
        });
      }
      case "reports-project-budgets": {
        const rows = ctx.projects.map((project) => {
          const used = hours(all.filter((session) => session.projectId === project.id).reduce((sum, session) => sum + session.seconds, 0));
          const budget = meta[project.id]?.budget ?? 80;
          return { id: project.id, name: project.name, budget, used, percent: budget > 0 ? Math.round((used / budget) * 100) : 0 };
        });
        return shell({
          kpis: [{ label: "Budgeted hours", value: rows.reduce((sum, row) => sum + row.budget, 0) }, { label: "Used", value: rows.reduce((sum, row) => sum + row.used, 0), unit: "hours" }],
          rows,
          key: (row) => row.id,
          search: (row) => row.name,
          columns: [
            { header: "Project", cell: (row) => <ProjectLabel projectId={row.id} />, csv: (row) => row.name },
            { header: "Budget", numeric: true, cell: (row) => `${row.budget}h`, csv: (row) => row.budget },
            { header: "Used", numeric: true, cell: (row) => `${row.used}h`, csv: (row) => row.used },
            { header: "Used share", cell: (row) => <span className="db-share"><i style={{ width: `${Math.min(100, row.percent)}%` }} /><b>{row.percent}%</b></span>, csv: (row) => row.percent },
          ],
        });
      }
      case "reports-client-budgets": {
        const rows = stores.clients.map((client) => {
          const budget = client.projectIds.reduce((sum, projectId) => sum + (meta[projectId]?.budget ?? 80), 0);
          const used = hours(all.filter((session) => client.projectIds.includes(session.projectId)).reduce((sum, session) => sum + session.seconds, 0));
          const billed = stores.invoices.filter((invoice) => invoice.client === client.name).reduce((sum, invoice) => sum + invoice.amount, 0);
          return { id: client.id, name: client.name, budget, used, billed };
        });
        return shell({
          kpis: [{ label: "Clients", value: rows.length }, { label: "Billed", value: money(rows.reduce((sum, row) => sum + row.billed, 0)) }],
          rows,
          key: (row) => row.id,
          search: (row) => row.name,
          columns: [
            { header: "Client", cell: (row) => <strong>{row.name}</strong>, csv: (row) => row.name },
            { header: "Hours budget", numeric: true, cell: (row) => `${row.budget}h`, csv: (row) => row.budget },
            { header: "Hours used", numeric: true, cell: (row) => `${row.used}h`, csv: (row) => row.used },
            { header: "Billed", numeric: true, cell: (row) => money(row.billed), csv: (row) => row.billed },
          ],
        });
      }
      case "reports-time-off-balances": {
        const ALLOWANCE = 24;
        const rows = members.filter((member) => member.role !== "Client").map((member) => {
          const own = stores.timeOff.filter((request) => request.memberId === member.id);
          const taken = own.filter((request) => request.status === "Approved").reduce((sum, request) => sum + request.days, 0);
          const pending = own.filter((request) => request.status === "Pending").reduce((sum, request) => sum + request.days, 0);
          return { memberId: member.id, taken, pending, left: ALLOWANCE - taken };
        });
        return shell({
          kpis: [{ label: "Yearly allowance", value: ALLOWANCE, unit: "days" }, { label: "Days taken", value: rows.reduce((sum, row) => sum + row.taken, 0) }],
          rows,
          key: (row) => row.memberId,
          search: (row) => name(row.memberId),
          columns: [
            { header: "Member", cell: (row) => <Person id={row.memberId} />, csv: (row) => name(row.memberId) },
            { header: "Allowance", numeric: true, cell: () => ALLOWANCE, csv: () => ALLOWANCE },
            { header: "Taken", numeric: true, cell: (row) => row.taken, csv: (row) => row.taken },
            { header: "Waiting", numeric: true, cell: (row) => row.pending, csv: (row) => row.pending },
            { header: "Left", numeric: true, cell: (row) => <strong>{row.left}</strong>, csv: (row) => row.left },
          ],
        });
      }
      case "reports-time-off-transactions":
        return shell({
          kpis: [{ label: "Requests", value: stores.timeOff.length }, { label: "Approved days", value: stores.timeOff.filter((request) => request.status === "Approved").reduce((sum, request) => sum + request.days, 0) }],
          rows: stores.timeOff,
          key: (row) => row.id,
          search: (row) => `${name(row.memberId)} ${row.kind}`,
          columns: [
            { header: "Member", cell: (row) => <Person id={row.memberId} detail={row.note || undefined} />, csv: (row) => name(row.memberId) },
            { header: "Type", cell: (row) => row.kind, csv: (row) => row.kind },
            { header: "From", cell: (row) => dateLabel(row.from), csv: (row) => row.from },
            { header: "To", cell: (row) => dateLabel(row.to), csv: (row) => row.to },
            { header: "Days", numeric: true, cell: (row) => row.days, csv: (row) => row.days },
            { header: "Status", cell: (row) => <Badge text={row.status} />, csv: (row) => row.status },
          ],
        });
      case "reports-client-invoices":
        return shell({
          kpis: [{ label: "Invoiced", value: money(stores.invoices.reduce((sum, invoice) => sum + invoice.amount, 0)) }, { label: "Paid", value: money(stores.invoices.filter((invoice) => invoice.status === "Paid").reduce((sum, invoice) => sum + invoice.amount, 0)) }],
          rows: stores.invoices,
          key: (row) => row.id,
          search: (row) => `${row.id} ${row.client} ${row.project}`,
          columns: [
            { header: "Invoice", cell: (row) => <strong>{row.id}</strong>, csv: (row) => row.id },
            { header: "Client", cell: (row) => row.client, csv: (row) => row.client },
            { header: "Project", cell: (row) => row.project, csv: (row) => row.project },
            { header: "Due", cell: (row) => dateLabel(row.due), csv: (row) => row.due },
            { header: "Amount", numeric: true, cell: (row) => money(row.amount), csv: (row) => row.amount },
            { header: "Status", cell: (row) => <Badge text={row.status} />, csv: (row) => row.status },
          ],
        });
      case "reports-team-invoices": {
        const rows = [...stores.payments].reverse().map((payment, index) => ({ ...payment, number: `TEAM-${String(index + 1).padStart(3, "0")}` }));
        return shell({
          kpis: [{ label: "Billed by the team", value: money(rows.reduce((sum, row) => sum + row.amount, 0)) }, { label: "Invoices", value: rows.length }],
          rows,
          key: (row) => row.id,
          search: (row) => `${row.number} ${name(row.memberId)}`,
          columns: [
            { header: "Invoice", cell: (row) => <strong>{row.number}</strong>, csv: (row) => row.number },
            { header: "Member", cell: (row) => <Person id={row.memberId} detail={row.note} />, csv: (row) => name(row.memberId) },
            { header: "Date", cell: (row) => dateLabel(row.date), csv: (row) => row.date },
            { header: "Amount", numeric: true, cell: (row) => money(row.amount), csv: (row) => row.amount },
            { header: "Status", cell: (row) => <Badge text={row.status} />, csv: (row) => row.status },
          ],
        });
      }
      case "reports-client-invoices-aging": {
        const open = stores.invoices.filter((invoice) => invoice.status === "Sent" || invoice.status === "Overdue");
        const rows = [...new Set(open.map((invoice) => invoice.client))].map((client) => {
          const totals = [0, 0, 0, 0];
          open.filter((invoice) => invoice.client === client).forEach((invoice) => {
            totals[bucket(Math.round((new Date(`${today}T12:00:00`).getTime() - new Date(`${invoice.due}T12:00:00`).getTime()) / 86_400_000))] += invoice.amount;
          });
          return { client, totals };
        });
        return shell({
          kpis: [{ label: "Unpaid", value: money(open.reduce((sum, invoice) => sum + invoice.amount, 0)) }, { label: "Past due", value: money(rows.reduce((sum, row) => sum + row.totals[1] + row.totals[2] + row.totals[3], 0)), tone: "warn" }],
          rows,
          key: (row) => row.client,
          search: (row) => row.client,
          emptyHint: "No unpaid invoices. Everything is settled.",
          columns: [
            { header: "Client", cell: (row) => <strong>{row.client}</strong>, csv: (row) => row.client },
            ...BUCKETS.map((label, index) => ({ header: label, numeric: true, cell: (row: { totals: number[] }) => money(row.totals[index]), csv: (row: { totals: number[] }) => row.totals[index] })),
          ],
        });
      }
      case "reports-team-invoices-aging": {
        const waiting = stores.payments.filter((payment) => payment.status === "Scheduled");
        const rows = [...new Set(waiting.map((payment) => payment.memberId))].map((memberId) => {
          const totals = [0, 0, 0];
          waiting.filter((payment) => payment.memberId === memberId).forEach((payment) => {
            const days = Math.round((new Date(`${payment.date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);
            totals[days <= 7 ? 0 : days <= 30 ? 1 : 2] += payment.amount;
          });
          return { memberId, totals };
        });
        return shell({
          kpis: [{ label: "Scheduled", value: money(waiting.reduce((sum, payment) => sum + payment.amount, 0)) }],
          rows,
          key: (row) => row.memberId,
          search: (row) => name(row.memberId),
          emptyHint: "No scheduled payments.",
          columns: [
            { header: "Member", cell: (row) => <Person id={row.memberId} />, csv: (row) => name(row.memberId) },
            ...["Within 7 days", "8-30 days", "Later"].map((label, index) => ({ header: label, numeric: true, cell: (row: { totals: number[] }) => money(row.totals[index]), csv: (row: { totals: number[] }) => row.totals[index] })),
          ],
        });
      }
      case "reports-shift-attendance": {
        const [hh, mm] = preferences.startOfDay.split(":").map(Number);
        const rows: { key: string; memberId: string; day: string; first: string; late: number; seconds: number }[] = [];
        for (const memberId of people) {
          const byDay = new Map<string, Session[]>();
          sessions.filter((session) => session.memberId === memberId).forEach((session) => byDay.set(dayOf(session), [...(byDay.get(dayOf(session)) ?? []), session]));
          byDay.forEach((list, day) => {
            const first = [...list].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
            const start = new Date(first.startedAt);
            const late = Math.max(0, start.getHours() * 60 + start.getMinutes() - (hh * 60 + mm));
            rows.push({ key: `${memberId}-${day}`, memberId, day, first: first.startedAt, late, seconds: list.reduce((sum, session) => sum + session.seconds, 0) });
          });
        }
        rows.sort((a, b) => b.day.localeCompare(a.day));
        return shell({
          kpis: [{ label: "Workday starts", value: preferences.startOfDay }, { label: "On time", value: rows.length ? `${Math.round((rows.filter((row) => row.late <= 5).length / rows.length) * 100)}%` : "-", tone: "good" }],
          rows,
          key: (row) => row.key,
          search: (row) => name(row.memberId),
          columns: [
            { header: "Member", cell: (row) => <Person id={row.memberId} />, csv: (row) => name(row.memberId) },
            { header: "Date", cell: (row) => dateLabel(row.day), csv: (row) => row.day },
            { header: "Started", cell: (row) => new Date(row.first).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" }), csv: (row) => row.first },
            { header: "Worked", numeric: true, cell: (row) => formatDuration(row.seconds), csv: (row) => hours(row.seconds) },
            { header: "Attendance", cell: (row) => (row.late <= 5 ? <Badge text="On time" /> : <Badge text={`${row.late} min late`} />), csv: (row) => (row.late <= 5 ? "On time" : `${row.late} min late`) },
          ],
        });
      }
      default:
        return null;
    }
  })();

  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="MAKE THE NUMBERS MEAN SOMETHING" title={reportLabel(id)} description={ABOUT[id] ?? ""}>
        <button className="sf-button" onClick={() => ctx.go("reports-all")}>
          <ArrowLeft size={16} /> All reports
        </button>
      </PageHeading>
      {built ? (
        <>
          <Kpis items={built.kpis} />
          <DataTable rows={built.rows as never[]} columns={built.columns as Column<never>[]} rowKey={built.key as (row: never) => string} searchText={built.search as ((row: never) => string) | undefined} searchPlaceholder="Search this report" exportName={id.replace("reports-", "report-")} emptyTitle="Nothing to report yet" emptyHint={built.emptyHint ?? "Records appear here as work is tracked."} />
        </>
      ) : (
        <section className="sf-card db-table-card">
          <div className="sf-empty">
            <h3>That report isn&apos;t available</h3>
            <button className="sf-button" onClick={() => ctx.go("reports-all")}>
              Back to all reports
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
