import { usePersistentState, type Member } from "../../../workspace";
import { initialInvoices, type Invoice } from "../../../data/dashboard";
import { isSampleOrg } from "../../../organizations";

/** Everything the extra Dashboard pages keep. It lives in the same local storage as the rest of the
 *  app (keys start with `dashboard.`), so nothing leaves the machine. */

export const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
/** A calendar day `offset` days from today, as YYYY-MM-DD. */
export const dayKey = (offset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString("en-CA");
};
export const noonOf = (day: string) => new Date(`${day}T12:00:00`);

export type Decision = "Pending" | "Approved" | "Rejected";

export type ManualRequest = {
  id: string;
  memberId: string;
  projectId: string;
  date: string;
  minutes: number;
  reason: string;
  status: Decision;
};
export type TimeOff = {
  id: string;
  memberId: string;
  kind: "Vacation" | "Sick leave" | "Personal";
  from: string;
  to: string;
  days: number;
  note: string;
  status: Decision;
};
export type RemovalRequest = {
  id: string;
  memberId: string;
  kind: "Screenshot" | "App" | "URL";
  item: string;
  reason: string;
  status: Decision;
};
export type Payment = {
  id: string;
  memberId: string;
  amount: number;
  date: string;
  method: "Bank transfer" | "PayPal" | "Wise";
  note: string;
  status: "Paid" | "Scheduled";
};
export type Expense = {
  id: string;
  memberId: string;
  projectId: string;
  category: "Software" | "Travel" | "Meals" | "Equipment";
  amount: number;
  date: string;
  note: string;
  status: "Pending" | "Approved" | "Reimbursed" | "Rejected";
};
export type Client = {
  id: string;
  name: string;
  contact: string;
  email: string;
  projectIds: string[];
};
export type AuditEvent = { id: string; at: string; actor: string; text: string };

const seed = {
  manual: [
    { id: "mr1", memberId: "mariam", projectId: "internal", date: dayKey(-1), minutes: 90, reason: "Forgot to start the timer during the planning workshop.", status: "Pending" },
    { id: "mr2", memberId: "omar", projectId: "rws", date: dayKey(-2), minutes: 45, reason: "Offline call with the client.", status: "Pending" },
    { id: "mr3", memberId: "sara", projectId: "nova-vanguard", date: dayKey(-3), minutes: 120, reason: "Pairing session held away from the tracker.", status: "Approved" },
  ] as ManualRequest[],
  timeOff: [
    { id: "to1", memberId: "mariam", kind: "Vacation", from: dayKey(7), to: dayKey(11), days: 5, note: "Family trip.", status: "Pending" },
    { id: "to2", memberId: "omar", kind: "Sick leave", from: dayKey(-3), to: dayKey(-3), days: 1, note: "Feeling unwell.", status: "Approved" },
    { id: "to3", memberId: "sara", kind: "Personal", from: dayKey(14), to: dayKey(14), days: 1, note: "Appointment.", status: "Pending" },
  ] as TimeOff[],
  removals: [
    { id: "rm1", memberId: "omar", kind: "Screenshot", item: "Screenshot taken at 2:14 PM", reason: "It showed a private message.", status: "Pending" },
    { id: "rm2", memberId: "mariam", kind: "URL", item: "bank.example.com", reason: "Personal banking, not work.", status: "Approved" },
  ] as RemovalRequest[],
  payments: [
    { id: "pay1", memberId: "youssef", amount: 480, date: dayKey(-6), method: "Bank transfer", note: "Weekly payroll", status: "Paid" },
    { id: "pay2", memberId: "sara", amount: 360, date: dayKey(-6), method: "Wise", note: "Weekly payroll", status: "Paid" },
    { id: "pay3", memberId: "omar", amount: 225, date: dayKey(2), method: "PayPal", note: "Scheduled payroll", status: "Scheduled" },
  ] as Payment[],
  expenses: [
    { id: "ex1", memberId: "me", projectId: "nova-vanguard", category: "Software", amount: 49, date: dayKey(-4), note: "Design tool seat", status: "Approved" },
    { id: "ex2", memberId: "youssef", projectId: "buffalo-campaign", category: "Travel", amount: 120, date: dayKey(-2), note: "Taxi to the client visit", status: "Pending" },
    { id: "ex3", memberId: "mariam", projectId: "internal", category: "Equipment", amount: 85, date: dayKey(-1), note: "Keyboard", status: "Pending" },
  ] as Expense[],
  clients: [
    { id: "cl1", name: "Buffalo Studio", contact: "Nour Hany", email: "nour@example.com", projectIds: ["buffalo-campaign"] },
    { id: "cl2", name: "Nova Labs", contact: "Daniel Reed", email: "daniel@novalabs.example", projectIds: ["nova-vanguard"] },
    { id: "cl3", name: "RWS Group", contact: "Laila Samir", email: "laila@rws.example", projectIds: ["rws"] },
  ] as Client[],
  audit: [
    { id: "au1", at: new Date(Date.now() - 86_400_000 * 2).toISOString(), actor: "Sara Ahmed", text: "Approved a manual time request (2h)." },
    { id: "au2", at: new Date(Date.now() - 86_400_000).toISOString(), actor: "Aria Morgan", text: "Paid Youssef Khaled $480 for weekly payroll." },
    { id: "au3", at: new Date(Date.now() - 3_600_000 * 5).toISOString(), actor: "Aria Morgan", text: "Marked invoice INV-2026-021 as paid." },
  ] as AuditEvent[],
};

/** Every store the extra Dashboard pages use. Each page reads what it needs. */
export function useDashboardStores() {
  // Only the first organization starts with sample records.
  const sample = isSampleOrg();
  const [manual, setManual] = usePersistentState<ManualRequest[]>("dashboard.manual-requests", sample ? seed.manual : []);
  const [timeOff, setTimeOff] = usePersistentState<TimeOff[]>("dashboard.time-off", sample ? seed.timeOff : []);
  const [removals, setRemovals] = usePersistentState<RemovalRequest[]>("dashboard.removals", sample ? seed.removals : []);
  const [payments, setPayments] = usePersistentState<Payment[]>("dashboard.payments", sample ? seed.payments : []);
  const [expenses, setExpenses] = usePersistentState<Expense[]>("dashboard.expenses", sample ? seed.expenses : []);
  const [clients, setClients] = usePersistentState<Client[]>("dashboard.clients", sample ? seed.clients : []);
  const [audit, setAudit] = usePersistentState<AuditEvent[]>("dashboard.audit", sample ? seed.audit : []);
  const [banned, setBanned] = usePersistentState<Record<string, { reason: string; date: string }>>("dashboard.banned", {});
  const [rates, setRates] = usePersistentState<Record<string, number>>("dashboard.rates", {});
  const [taskReviews, setTaskReviews] = usePersistentState<Record<string, string>>("dashboard.task-reviews", {});
  /** Approved sessions that a payment has already covered (session id -> payment id). */
  const [paidSessions, setPaidSessions] = usePersistentState<Record<string, string>>("dashboard.paid-sessions", {});
  const [invoices] = usePersistentState<Invoice[]>("dashboard.invoices", sample ? initialInvoices : []);
  return {
    manual, setManual,
    timeOff, setTimeOff,
    removals, setRemovals,
    payments, setPayments,
    expenses, setExpenses,
    clients, setClients,
    audit, setAudit,
    banned, setBanned,
    rates, setRates,
    taskReviews, setTaskReviews,
    paidSessions, setPaidSessions,
    invoices,
  };
}
export type DashboardStores = ReturnType<typeof useDashboardStores>;

/** Writes one line to the audit log (newest first, capped). */
export const logAudit = (stores: DashboardStores, actor: string, text: string) =>
  stores.setAudit((old) => [{ id: newId("au"), at: new Date().toISOString(), actor, text }, ...old].slice(0, 200));

/** What a member is paid per hour: their own rate if one was set, otherwise by role. */
const ROLE_RATES: Record<string, number> = { Owner: 85, Admin: 70, Manager: 60, Member: 45, Client: 0 };
export const rateOf = (member: Member, rates: Record<string, number>) => rates[member.id] ?? ROLE_RATES[member.role] ?? 45;
