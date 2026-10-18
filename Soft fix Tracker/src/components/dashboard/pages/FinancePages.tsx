import { ProjectLabel } from "../../ProjectAvatar";
import { useState, type FormEvent } from "react";
import { Plus } from "@phosphor-icons/react";
import { formatDuration, useWorkspace } from "../../../workspace";
import { Modal } from "../../ui";
import { Badge, PageHeading } from "../DashboardParts";
import { cashFigures, payrollRows } from "./finance-data";
import { DataTable, Decide, Kpis, Person, dateLabel, money, type PageContext } from "./kit";
import { dayKey, logAudit, newId, useDashboardStores, type DashboardStores, type Expense, type Payment } from "./stores";

const METHODS: Payment["method"][] = ["Bank transfer", "PayPal", "Wise"];

/** Pays `row` what they are owed and marks the approved time it covers as paid. */
function payOwed(stores: DashboardStores, row: ReturnType<typeof payrollRows>[number], actor: string, method: Payment["method"] = "Bank transfer") {
  const payment: Payment = { id: newId("pay"), memberId: row.member.id, amount: row.owed, date: dayKey(0), method, note: `Approved time, ${formatDuration(row.seconds)}`, status: "Paid" };
  stores.setPayments((old) => [payment, ...old]);
  stores.setPaidSessions((old) => ({ ...old, ...Object.fromEntries(row.sessionIds.map((id) => [id, payment.id])) }));
  logAudit(stores, actor, `Paid ${row.member.name} ${money(row.owed)} for approved time.`);
}

/** Overview: the money in and out, and what needs doing about it. */
export function FinanceOverviewPage({ ctx }: { ctx: PageContext }) {
  const stores = useDashboardStores();
  const { members } = useWorkspace();
  const cash = cashFigures(stores);
  const owed = payrollRows(members, ctx.allSessions, stores).reduce((sum, row) => sum + row.owed, 0);
  const overdue = stores.invoices.filter((invoice) => invoice.status === "Overdue").length;
  const pendingExpenses = stores.expenses.filter((expense) => expense.status === "Pending").length;
  const scale = Math.max(1, cash.revenue, cash.payroll, cash.expenses, cash.outstanding);
  const bars = [
    { label: "Invoices paid", value: cash.revenue, tone: "in" },
    { label: "Still to collect", value: cash.outstanding, tone: "wait" },
    { label: "Payroll paid", value: cash.payroll, tone: "out" },
    { label: "Expenses", value: cash.expenses, tone: "out" },
  ];
  const todo = [
    { show: overdue > 0, text: `${overdue} overdue ${overdue === 1 ? "invoice" : "invoices"}`, page: "financials-invoices" },
    { show: owed > 0, text: `${money(owed)} of approved time to pay`, page: "financials-payroll" },
    { show: pendingExpenses > 0, text: `${pendingExpenses} ${pendingExpenses === 1 ? "expense" : "expenses"} to review`, page: "financials-expenses" },
    { show: cash.scheduled > 0, text: `${money(cash.scheduled)} of payments scheduled`, page: "financials-records" },
  ].filter((item) => item.show);
  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="KEEP THE BUSINESS IN BALANCE" title="Financial overview" description="What came in, what went out, and what is left." />
      <Kpis
        items={[
          { label: "Net so far", value: money(cash.net), tone: cash.net >= 0 ? "good" : "warn" },
          { label: "Invoices paid", value: money(cash.revenue) },
          { label: "Payroll paid", value: money(cash.payroll) },
          { label: "Expenses", value: money(cash.expenses) },
        ]}
      />
      <div className="db-split">
        <section className="sf-card db-pad">
          <div className="db-card-heading">
            <div>
              <h2>Money in and out</h2>
              <p>Against the largest figure</p>
            </div>
          </div>
          <div className="db-hbars">
            {bars.map((bar) => (
              <div key={bar.label} className={`db-hbar ${bar.tone}`}>
                <span>{bar.label}</span>
                <i>
                  <b style={{ width: `${(bar.value / scale) * 100}%` }} />
                </i>
                <strong>{money(bar.value)}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="sf-card db-pad">
          <div className="db-card-heading">
            <div>
              <h2>Needs your attention</h2>
              <p>The next money jobs</p>
            </div>
          </div>
          {todo.length ? (
            <ul className="db-todo">
              {todo.map((item) => (
                <li key={item.text}>
                  <span>{item.text}</span>
                  <button className="db-text-button" onClick={() => ctx.go(item.page)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="db-muted">Nothing needs doing. The books are in order.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/** Manage payroll: hourly rates, and what each person is owed for approved time. */
export function PayrollPage({ ctx }: { ctx: PageContext }) {
  const stores = useDashboardStores();
  const { members, profile, notify } = useWorkspace();
  const rows = payrollRows(members, ctx.allSessions, stores);
  const total = rows.reduce((sum, row) => sum + row.owed, 0);
  const payable = rows.filter((row) => row.owed > 0);
  const paidWeek = stores.payments.filter((payment) => payment.status === "Paid" && payment.date >= dayKey(-7)).reduce((sum, payment) => sum + payment.amount, 0);

  const payAll = () => {
    payable.forEach((row) => payOwed(stores, row, profile.name));
    notify(`Paid ${payable.length} ${payable.length === 1 ? "person" : "people"}.`);
  };
  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="KEEP THE BUSINESS IN BALANCE" title="Manage payroll" description="Set hourly rates and pay for approved time.">
        <button className="sf-button primary" disabled={!payable.length} onClick={payAll}>
          Pay everyone ({money(total)})
        </button>
      </PageHeading>
      <Kpis items={[{ label: "Owed now", value: money(total), tone: total ? undefined : "good" }, { label: "People to pay", value: payable.length }, { label: "Paid this week", value: money(paidWeek) }]} />
      <DataTable
        rows={rows}
        rowKey={(row) => row.member.id}
        searchText={(row) => row.member.name}
        searchPlaceholder="Search people"
        exportName="payroll"
        columns={[
          { header: "Member", cell: (row) => <Person id={row.member.id} detail={row.member.role} />, csv: (row) => row.member.name },
          {
            header: "Hourly rate",
            numeric: true,
            cell: (row) => (
              <label className="db-rate">
                $
                <input
                  type="number"
                  min={0}
                  max={500}
                  aria-label={`Hourly rate for ${row.member.name}`}
                  value={row.rate}
                  onChange={(event) => {
                    const value = Math.max(0, Math.min(500, Number(event.target.value) || 0));
                    stores.setRates((old) => ({ ...old, [row.member.id]: value }));
                  }}
                />
              </label>
            ),
            csv: (row) => row.rate,
          },
          { header: "Approved, unpaid", numeric: true, cell: (row) => formatDuration(row.seconds), csv: (row) => Math.round(row.seconds / 60) },
          { header: "Owed", numeric: true, cell: (row) => <strong>{money(row.owed)}</strong>, csv: (row) => row.owed },
          {
            header: "",
            cell: (row) =>
              row.owed > 0 ? (
                <button
                  className="sf-button"
                  onClick={() => {
                    payOwed(stores, row, profile.name);
                    notify(`Paid ${row.member.name} ${money(row.owed)}.`);
                  }}
                >
                  Pay now
                </button>
              ) : (
                <Badge text="Paid" />
              ),
          },
        ]}
      />
    </div>
  );
}

/** Create payments: pay someone a one-off amount, now or on a later date. */
export function CreatePaymentPage({ ctx }: { ctx: PageContext }) {
  const stores = useDashboardStores();
  const { members, profile, notify } = useWorkspace();
  const people = payrollRows(members, ctx.allSessions, stores);
  const [form, setForm] = useState({ memberId: people[0]?.member.id ?? "", amount: "", method: METHODS[0], date: dayKey(0), note: "", cover: true });
  const [error, setError] = useState("");
  const row = people.find((item) => item.member.id === form.memberId);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(form.amount || row?.owed || 0);
    if (!row) return setError("Choose who to pay.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return setError("Enter an amount between $1 and $100,000.");
    const future = form.date > dayKey(0);
    const payment: Payment = { id: newId("pay"), memberId: row.member.id, amount, date: form.date, method: form.method, note: form.note.trim() || "Payment", status: future ? "Scheduled" : "Paid" };
    stores.setPayments((old) => [payment, ...old]);
    if (form.cover && !future && Math.abs(amount - row.owed) < 0.005 && row.owed > 0) stores.setPaidSessions((old) => ({ ...old, ...Object.fromEntries(row.sessionIds.map((id) => [id, payment.id])) }));
    logAudit(stores, profile.name, `${future ? "Scheduled" : "Paid"} ${row.member.name} ${money(amount)}.`);
    setError("");
    setForm({ ...form, amount: "", note: "" });
    notify(future ? "Payment scheduled." : "Payment recorded.");
  };
  const recent = stores.payments.slice(0, 5);
  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="KEEP THE BUSINESS IN BALANCE" title="Create payments" description="Record a payment to a team member. Nothing is sent to a bank." />
      <div className="db-split">
        <form className="sf-card db-pad db-form-card" onSubmit={submit}>
          <label className="db-field">
            Pay
            <select value={form.memberId} onChange={(event) => setForm({ ...form, memberId: event.target.value, amount: "" })}>
              {people.map((item) => (
                <option key={item.member.id} value={item.member.id}>
                  {item.member.name} · owed {money(item.owed)}
                </option>
              ))}
            </select>
          </label>
          <div className="db-form-grid">
            <label className="db-field">
              Amount (USD)
              <input type="number" min={1} step="0.01" placeholder={row ? String(row.owed || "") : ""} value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
            </label>
            <label className="db-field">
              Method
              <select value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value as Payment["method"] })}>
                {METHODS.map((method) => (
                  <option key={method}>{method}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="db-form-grid">
            <label className="db-field">
              Pay on
              <input type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
            </label>
            <label className="db-field">
              Note
              <input maxLength={120} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="e.g. Weekly payroll" />
            </label>
          </div>
          <label className="db-check">
            <input type="checkbox" checked={form.cover} onChange={(event) => setForm({ ...form, cover: event.target.checked })} />
            When it matches what they are owed, mark their approved time as paid
          </label>
          {error && (
            <p className="db-form-error" role="alert">
              {error}
            </p>
          )}
          <div className="db-modal-actions">
            <button className="sf-button primary" type="submit">
              {form.date > dayKey(0) ? "Schedule payment" : "Record payment"}
            </button>
          </div>
        </form>
        <section className="sf-card db-pad">
          <div className="db-card-heading">
            <div>
              <h2>Latest payments</h2>
              <p>The five most recent</p>
            </div>
            <button className="db-pill-button" onClick={() => ctx.go("financials-records")}>
              All records
            </button>
          </div>
          <ul className="db-todo">
            {recent.map((payment) => (
              <li key={payment.id}>
                <span>
                  <strong>{members.find((member) => member.id === payment.memberId)?.name ?? "Team member"}</strong>
                  <small>
                    {dateLabel(payment.date)} · {payment.method}
                  </small>
                </span>
                <b>{money(payment.amount)}</b>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/** Payment records: everything paid, and what is scheduled. */
export function PaymentRecordsPage({ ctx }: { ctx: PageContext }) {
  const stores = useDashboardStores();
  const { members, profile, notify } = useWorkspace();
  const rows = stores.payments;
  const paid = rows.filter((payment) => payment.status === "Paid").reduce((sum, payment) => sum + payment.amount, 0);
  const scheduled = rows.filter((payment) => payment.status === "Scheduled").reduce((sum, payment) => sum + payment.amount, 0);
  const markPaid = (payment: Payment) => {
    stores.setPayments((old) => old.map((item) => (item.id === payment.id ? { ...item, status: "Paid" } : item)));
    logAudit(stores, profile.name, `Marked a ${money(payment.amount)} payment as paid.`);
    notify("Marked as paid.");
  };
  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="KEEP THE BUSINESS IN BALANCE" title="Payment records" description="A record of every payment to the team." />
      <Kpis items={[{ label: "Paid", value: money(paid) }, { label: "Scheduled", value: money(scheduled) }, { label: "Payments", value: rows.length }]} />
      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        searchText={(row) => `${members.find((member) => member.id === row.memberId)?.name ?? ""} ${row.note} ${row.method}`}
        searchPlaceholder="Search payments"
        exportName="payment-records"
        emptyTitle="No payments yet"
        emptyHint="Payments you record appear here."
        columns={[
          { header: "Member", cell: (row) => <Person id={row.memberId} detail={row.note} />, csv: (row) => members.find((member) => member.id === row.memberId)?.name ?? "" },
          { header: "Date", cell: (row) => dateLabel(row.date), csv: (row) => row.date },
          { header: "Method", cell: (row) => row.method, csv: (row) => row.method },
          { header: "Amount", numeric: true, cell: (row) => money(row.amount), csv: (row) => row.amount },
          { header: "Status", cell: (row) => <Badge text={row.status} />, csv: (row) => row.status },
          { header: "", cell: (row) => (ctx.isAdmin && row.status === "Scheduled" ? <button className="sf-button" onClick={() => markPaid(row)}>Mark paid</button> : null) },
        ]}
      />
    </div>
  );
}

const CATEGORIES: Expense["category"][] = ["Software", "Travel", "Meals", "Equipment"];

/** Expenses: money people spent for work, to be approved and paid back. */
export function ExpensesPage({ ctx }: { ctx: PageContext }) {
  const stores = useDashboardStores();
  const { members, projects, profile, notify } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ projectId: projects[0]?.id ?? "", category: CATEGORIES[0], amount: "", date: dayKey(0), note: "" });
  const [error, setError] = useState("");
  const rows = (ctx.canManage ? stores.expenses : stores.expenses.filter((expense) => expense.memberId === "me")).filter((expense) => ctx.projectScope === "all" || expense.projectId === ctx.projectScope);
  const sum = (statuses: Expense["status"][]) => rows.filter((expense) => statuses.includes(expense.status)).reduce((total, expense) => total + expense.amount, 0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 50000) return setError("Enter an amount between $1 and $50,000.");
    stores.setExpenses((old) => [{ id: newId("ex"), memberId: "me", projectId: form.projectId, category: form.category, amount, date: form.date, note: form.note.trim() || form.category, status: "Pending" }, ...old]);
    logAudit(stores, profile.name, `Submitted a ${money(amount)} expense.`);
    setOpen(false);
    setError("");
    setForm({ ...form, amount: "", note: "" });
    notify("Expense submitted.");
  };
  const setStatus = (expense: Expense, status: Expense["status"]) => {
    stores.setExpenses((old) => old.map((item) => (item.id === expense.id ? { ...item, status } : item)));
    logAudit(stores, profile.name, `${status} a ${money(expense.amount)} expense.`);
    notify(`Expense ${status.toLowerCase()}.`);
  };
  return (
    <div className="sf-page db-page">
      <PageHeading eyebrow="KEEP THE BUSINESS IN BALANCE" title="Expenses" description="Costs people covered for the work, approved and paid back.">
        <button className="sf-button primary" onClick={() => setOpen(true)}>
          <Plus size={17} /> Add expense
        </button>
      </PageHeading>
      <Kpis items={[{ label: "Waiting for review", value: money(sum(["Pending"])) }, { label: "Approved", value: money(sum(["Approved"])) }, { label: "Reimbursed", value: money(sum(["Reimbursed"])), tone: "good" }]} />
      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        searchText={(row) => `${row.note} ${row.category} ${members.find((member) => member.id === row.memberId)?.name ?? ""}`}
        searchPlaceholder="Search expenses"
        exportName="expenses"
        emptyTitle="No expenses yet"
        emptyHint="Add one when you cover a cost for work."
        columns={[
          { header: "Member", cell: (row) => <Person id={row.memberId} detail={row.note} />, csv: (row) => members.find((member) => member.id === row.memberId)?.name ?? "" },
          { header: "Project", cell: (row) => <ProjectLabel projectId={row.projectId} />, csv: (row) => projects.find((project) => project.id === row.projectId)?.name ?? "" },
          { header: "Category", cell: (row) => row.category, csv: (row) => row.category },
          { header: "Date", cell: (row) => dateLabel(row.date), csv: (row) => row.date },
          { header: "Amount", numeric: true, cell: (row) => money(row.amount), csv: (row) => row.amount },
          { header: "Status", cell: (row) => <Badge text={row.status} />, csv: (row) => row.status },
          {
            header: "",
            cell: (row) =>
              ctx.canManage && row.status === "Pending" ? (
                <Decide onApprove={() => setStatus(row, "Approved")} onReject={() => setStatus(row, "Rejected")} />
              ) : ctx.isAdmin && row.status === "Approved" ? (
                <button className="sf-button" onClick={() => setStatus(row, "Reimbursed")}>
                  Mark reimbursed
                </button>
              ) : null,
          },
        ]}
      />
      {open && (
        <Modal title="Add an expense" description="A manager reviews it before it is paid back." onClose={() => setOpen(false)}>
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
                Category
                <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as Expense["category"] })}>
                  {CATEGORIES.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="db-form-grid">
              <label className="db-field">
                Amount (USD)
                <input type="number" required min={1} step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
              </label>
              <label className="db-field">
                Date
                <input type="date" required max={dayKey(0)} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
              </label>
            </div>
            <label className="db-field">
              What was it for?
              <input maxLength={120} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
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
                Submit expense
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
