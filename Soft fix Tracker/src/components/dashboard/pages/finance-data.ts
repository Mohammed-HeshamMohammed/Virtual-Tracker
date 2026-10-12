import type { Member, Session } from "../../../workspace";
import { rateOf, type DashboardStores } from "./stores";

export type PayrollRow = {
  member: Member;
  rate: number;
  /** Seconds of approved time no payment has covered yet. */
  seconds: number;
  /** What that time is worth at the member's rate. */
  owed: number;
  sessionIds: string[];
};

/** What each person is owed: their approved sessions that no payment has covered, at their hourly rate. */
export function payrollRows(members: Member[], sessions: Session[], stores: Pick<DashboardStores, "rates" | "paidSessions">): PayrollRow[] {
  return members
    .filter((member) => member.role !== "Client")
    .map((member) => {
      const unpaid = sessions.filter((session) => session.memberId === member.id && session.status === "Approved" && !stores.paidSessions[session.id]);
      const seconds = unpaid.reduce((sum, session) => sum + session.seconds, 0);
      const rate = rateOf(member, stores.rates);
      return { member, rate, seconds, owed: Math.round((seconds / 3600) * rate * 100) / 100, sessionIds: unpaid.map((session) => session.id) };
    });
}

/** Money in and out, from the invoices, payments and expenses the Dashboard keeps. */
export function cashFigures(stores: Pick<DashboardStores, "invoices" | "payments" | "expenses">) {
  const revenue = stores.invoices.filter((invoice) => invoice.status === "Paid").reduce((sum, invoice) => sum + invoice.amount, 0);
  const outstanding = stores.invoices.filter((invoice) => invoice.status === "Sent" || invoice.status === "Overdue").reduce((sum, invoice) => sum + invoice.amount, 0);
  const payroll = stores.payments.filter((payment) => payment.status === "Paid").reduce((sum, payment) => sum + payment.amount, 0);
  const scheduled = stores.payments.filter((payment) => payment.status === "Scheduled").reduce((sum, payment) => sum + payment.amount, 0);
  const expenses = stores.expenses.filter((expense) => expense.status === "Approved" || expense.status === "Reimbursed").reduce((sum, expense) => sum + expense.amount, 0);
  return { revenue, outstanding, payroll, scheduled, expenses, net: revenue - payroll - expenses };
}
