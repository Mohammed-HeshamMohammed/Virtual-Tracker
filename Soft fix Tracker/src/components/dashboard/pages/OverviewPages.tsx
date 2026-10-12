import { ArrowRight, BellRinging, CheckCircle } from "@phosphor-icons/react";
import { formatDuration, useWorkspace } from "../../../workspace";
import { PageHeading } from "../DashboardParts";
import { payrollRows } from "./finance-data";
import { money, type PageContext } from "./kit";
import { useDashboardStores } from "./stores";

export type Attention = { id: string; title: string; detail: string; page: string; action: string };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The things that want this person's attention, for their role: a manager reviews what others
 *  asked for, a member finishes and tracks what is theirs, a client hears what happened. */
export function useAttention(ctx: PageContext): Attention[] {
  const stores = useDashboardStores();
  const { members } = useWorkspace();
  const items: Attention[] = [];
  const add = (count: number, id: string, title: string, detail: string, page: string, action: string) => count > 0 && items.push({ id, title, detail, page, action });

  if (ctx.canManage) {
    const submitted = ctx.allSessions.filter((session) => session.status === "Submitted");
    add(submitted.length, "timesheets", `${plural(submitted.length, "timesheet", "timesheets")} to review`, `${formatDuration(submitted.reduce((sum, session) => sum + session.seconds, 0))} waiting for approval.`, "timesheets-submissions", "Review");
    const tasks = ctx.projects.flatMap((project) => project.tasks).filter((task) => task.done && !stores.taskReviews[task.id]);
    add(tasks.length, "tasks", `${plural(tasks.length, "finished task", "finished tasks")} to sign off`, "Check the work before it counts as complete.", "timesheets-view", "Review");
    const manual = stores.manual.filter((request) => request.status === "Pending");
    add(manual.length, "manual", `${plural(manual.length, "manual time request", "manual time requests")}`, "Time that was added by hand.", "timesheets-manual-requests", "Review");
    const off = stores.timeOff.filter((request) => request.status === "Pending");
    add(off.length, "off", `${plural(off.length, "time off request", "time off requests")}`, "Someone is asking for time away.", "calendar-timeoff", "Review");
    const removals = stores.removals.filter((request) => request.status === "Pending");
    add(removals.length, "removals", `${plural(removals.length, "removal request", "removal requests")}`, "Captured items people want taken out.", "activity-removal-requests", "Review");
    const expenses = stores.expenses.filter((expense) => expense.status === "Pending");
    add(ctx.canManage ? expenses.length : 0, "expenses", `${plural(expenses.length, "expense", "expenses")} to approve`, `${money(expenses.reduce((sum, expense) => sum + expense.amount, 0))} waiting.`, "financials-expenses", "Review");
    const overdue = stores.invoices.filter((invoice) => invoice.status === "Overdue");
    add(overdue.length, "overdue", `${plural(overdue.length, "overdue invoice", "overdue invoices")}`, `${money(overdue.reduce((sum, invoice) => sum + invoice.amount, 0))} is late.`, "financials-invoices", "Open");
    const owed = ctx.isAdmin ? payrollRows(members, ctx.allSessions, stores).reduce((sum, row) => sum + row.owed, 0) : 0;
    add(owed > 0 ? 1 : 0, "payroll", `${money(owed)} of approved time to pay`, "Approved hours nobody has been paid for yet.", "financials-payroll", "Pay");
  } else if (ctx.role === "Member") {
    const drafts = ctx.allSessions.filter((session) => session.status === "Draft");
    add(drafts.length, "drafts", `${plural(drafts.length, "draft entry", "draft entries")} to submit`, `${formatDuration(drafts.reduce((sum, session) => sum + session.seconds, 0))} is waiting on you.`, "timesheets-submissions", "Submit");
    const highTasks = ctx.projects.flatMap((project) => project.tasks).filter((task) => !task.done && task.priority === "High");
    add(highTasks.length, "high", `${plural(highTasks.length, "high priority task", "high priority tasks")}`, "Worth doing first.", "pm-tasks", "Open");
    const mine = {
      manual: stores.manual.filter((request) => request.memberId === "me" && request.status === "Pending").length,
      off: stores.timeOff.filter((request) => request.memberId === "me" && request.status === "Pending").length,
    };
    add(mine.manual, "my-manual", `${plural(mine.manual, "manual time request", "manual time requests")} awaiting a decision`, "You will hear back here.", "timesheets-manual-requests", "Open");
    add(mine.off, "my-off", `${plural(mine.off, "time off request", "time off requests")} awaiting a decision`, "Your manager has not answered yet.", "calendar-timeoff", "Open");
  } else {
    const weekAgo = Date.now() - 7 * 86_400_000;
    const recent = ctx.allSessions.filter((session) => new Date(session.startedAt).getTime() >= weekAgo);
    add(recent.length, "recent", `${plural(recent.length, "work session", "work sessions")} this week`, `${formatDuration(recent.reduce((sum, session) => sum + session.seconds, 0))} logged on your projects.`, "timesheets-time-activity", "See time");
  }
  return items;
}

/** Notifications: everything that wants attention, in one list. */
export function NotificationsPage({ ctx }: { ctx: PageContext }) {
  const items = useAttention(ctx);
  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="THE BIG PICTURE" title="Notifications" description="Everything waiting on you, in one place." />
      <section className="sf-card db-table-card">
        {items.length ? (
          <ul className="db-notices">
            {items.map((item) => (
              <li key={item.id}>
                <span className="db-notice-icon">
                  <BellRinging weight="fill" />
                </span>
                <span className="db-notice-copy">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <button className="sf-button" onClick={() => ctx.go(item.page)}>
                  {item.action} <ArrowRight size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="sf-empty">
            <CheckCircle size={32} weight="fill" />
            <h3>You&apos;re all caught up</h3>
            <p>Nothing is waiting on you right now.</p>
          </div>
        )}
        <div className="db-table-footer">
          <span>{items.length} waiting</span>
          <span>Worked out from your workspace</span>
        </div>
      </section>
    </div>
  );
}
