import { useState, type FormEvent } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle,
  DownloadSimple,
  FileText,
  Plus,
  Wallet,
  Clock,
  WarningCircle,
} from "@phosphor-icons/react";
import { useWorkspace, usePersistentState, downloadCsv } from "../../workspace";
import { isSampleOrg } from "../../organizations";
import { initialInvoices, type Invoice } from "../../data/dashboard";
import { EmptyState, Modal, SearchField } from "../ui";
import { Badge, FilterSelect, Money, PageHeading, ShortDate } from "./DashboardParts";
import { Donut } from "./DashboardCharts";

const STATUS_TONES = [
  { status: "Paid", tone: "green" },
  { status: "Sent", tone: "cyan" },
  { status: "Draft", tone: "violet" },
  { status: "Overdue", tone: "gold" },
] as const;
export function FinancialsPage({ canManage }: { canManage: boolean }) {
  const { projects, profile, notify } = useWorkspace();
  const [invoices, setInvoices] = usePersistentState(
    "dashboard.invoices",
    isSampleOrg() ? initialInvoices : initialInvoices.slice(0, 0),
  );
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All invoices");
  const [detail, setDetail] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    client: "",
    project: projects[0]?.name || "",
    amount: "",
    due: "",
  });
  const accessible =
    profile.role === "Client"
      ? invoices.filter((invoice) => invoice.project === "Buffalo Campaign")
      : invoices;
  const filtered = accessible.filter(
    (invoice) =>
      (status === "All invoices" || invoice.status === status) &&
      `${invoice.id} ${invoice.client} ${invoice.project}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const active = accessible.find((invoice) => invoice.id === detail);
  const total = (statuses: string[]) =>
    accessible
      .filter((invoice) => statuses.includes(invoice.status))
      .reduce((sum, invoice) => sum + invoice.amount, 0);
  const exportRows = () => {
    downloadCsv("softfix-invoices.csv", [
      ["Invoice", "Client", "Project", "Amount USD", "Due date", "Status"],
      ...filtered.map((invoice) => [
        invoice.id,
        invoice.client,
        invoice.project,
        invoice.amount,
        invoice.due,
        invoice.status,
      ]),
    ]);
    notify("Invoice export downloaded.");
  };
  const saveInvoice = (event: FormEvent) => {
    event.preventDefault();
    if (!form.client.trim()) {
      notify("Enter a client name to continue.");
      return;
    }
    const year = new Date().getFullYear();
    let number =
      Math.max(
        24,
        ...invoices.map((invoice) => Number(invoice.id.split("-").at(-1)) || 0),
      ) + 1;
    const id = `INV-${year}-${String(number).padStart(3, "0")}`;
    setInvoices((previous) => [
      ...previous,
      {
        id,
        client: form.client.trim(),
        project: form.project,
        amount: Number(form.amount),
        due: form.due,
        status: "Draft",
      },
    ]);
    setFormOpen(false);
    setDetail(id);
    setForm({
      client: "",
      project: projects[0]?.name || "",
      amount: "",
      due: "",
    });
    notify("Invoice draft created.");
  };
  const setInvoiceStatus = (invoice: Invoice, next: Invoice["status"]) => {
    setInvoices((previous) =>
      previous.map((item) =>
        item.id === invoice.id ? { ...item, status: next } : item,
      ),
    );
    notify(`Invoice marked ${next.toLowerCase()} in this workspace.`);
  };
  return (
    <div className="sf-page db-page">
      <PageHeading
        eyebrow="KEEP THE BUSINESS IN BALANCE"
        title="Financials"
        description="A clear view of what's earned, outstanding, and up next."
      >
        <button className="sf-button" onClick={exportRows}>
          <DownloadSimple size={17} />
          Export
        </button>
        {canManage && (
          <button
            className="sf-button primary"
            onClick={() => setFormOpen(true)}
          >
            <Plus size={17} />
            Create invoice
          </button>
        )}
      </PageHeading>
      <div className="db-metrics">
        <div className="sf-card db-metric">
          <span>
            Collected <CheckCircle />
          </span>
          <strong>
            <Money amount={total(["Paid"])} />
          </strong>
          <small className="db-positive">Paid invoices</small>
        </div>
        <div className="sf-card db-metric">
          <span>
            Outstanding <Clock />
          </span>
          <strong>
            <Money amount={total(["Sent", "Overdue"])} />
          </strong>
          <small>Issued and awaiting payment</small>
        </div>
        <div className="sf-card db-metric">
          <span>
            Overdue <WarningCircle />
          </span>
          <strong>
            <Money amount={total(["Overdue"])} />
          </strong>
          <small className="db-warning">
            {
              accessible.filter((invoice) => invoice.status === "Overdue")
                .length
            }{" "}
            invoices need attention
          </small>
        </div>
        <div className="sf-card db-metric">
          <span>
            In draft <FileText />
          </span>
          <strong>
            <Money amount={total(["Draft"])} />
          </strong>
          <small>Ready for your next review</small>
        </div>
      </div>
      <section className="sf-card db-finance-card">
        <div className="db-card-heading">
          <div>
            <h2>Invoice status</h2>
            <p>Where every dollar stands</p>
          </div>
          <Wallet size={20} />
        </div>
        <div className="db-finance-body">
          <Donut
            size={176}
            segments={STATUS_TONES.map(({ status: name, tone }) => ({ label: name, value: total([name]), tone }))}
          >
            <strong>
              <Money amount={total(["Paid", "Sent", "Draft", "Overdue"])} />
            </strong>
            <span>invoiced</span>
          </Donut>
          <ul className="db-legend-list">
            {STATUS_TONES.map(({ status: name, tone }) => (
              <li key={name}>
                <i className={`db-color-dot ${tone}`} />
                <span>
                  {name} · {accessible.filter((invoice) => invoice.status === name).length}
                </span>
                <strong>
                  <Money amount={total([name])} />
                </strong>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="sf-card">
        <div className="db-filter-row">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search invoice, client or project"
          />
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={["All invoices", "Draft", "Sent", "Paid", "Overdue"].map((name) => ({ value: name, text: name }))}
          />
          <span className="db-muted">All amounts in USD</span>
        </div>
        <div className="db-table-scroll">
          <table className="sf-table db-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Client / project</th>
                <th>Amount</th>
                <th>Due date</th>
                <th>Status</th>
                <th>
                  <span className="db-sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <span className="db-invoice-id">
                      <FileText size={19} />
                      {invoice.id}
                    </span>
                  </td>
                  <td>
                    <strong>{invoice.client}</strong>
                    <small className="db-table-subtitle">
                      {invoice.project}
                    </small>
                  </td>
                  <td className="db-number">
                    <Money amount={invoice.amount} />
                  </td>
                  <td>
                    <ShortDate value={invoice.due} />
                  </td>
                  <td>
                    <Badge text={invoice.status} />
                  </td>
                  <td>
                    <button
                      className="db-text-button"
                      onClick={() => setDetail(invoice.id)}
                    >
                      View <ArrowRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <EmptyState
            title="No matching invoices"
            description="Try another search or include all statuses."
            action="Clear filters"
            onAction={() => {
              setQuery("");
              setStatus("All invoices");
            }}
          />
        )}
        <div className="db-table-footer">
          <span>{filtered.length} invoices</span>
          <span>
            Invoice drafts and status changes are saved in this workspace
          </span>
        </div>
      </section>
      <div className="db-finance-note">
        <Wallet size={25} />
        <div>
          <strong>A little organization goes a long way.</strong>
          <p>
            Review your outstanding invoices regularly to keep your projects
            moving.
          </p>
        </div>
        <button
          className="sf-button"
          onClick={() => {
            setStatus("Overdue");
            setQuery("");
          }}
        >
          Review overdue
          <ArrowUpRight size={17} />
        </button>
      </div>
      {formOpen && (
        <Modal
          title="Create an invoice"
          description="Start with a draft. You can review it before marking it issued."
          onClose={() => setFormOpen(false)}
        >
          <form onSubmit={saveInvoice}>
            <label className="db-field">
              Client name
              <input
                autoFocus
                required
                maxLength={100}
                value={form.client}
                placeholder="e.g. Buffalo Studio"
                onChange={(event) =>
                  setForm({ ...form, client: event.target.value })
                }
              />
            </label>
            <label className="db-field">
              Project
              <select
                required
                value={form.project}
                onChange={(event) =>
                  setForm({ ...form, project: event.target.value })
                }
              >
                {projects.map((project) => (
                  <option key={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
            <div className="db-form-grid">
              <label className="db-field">
                Amount (USD)
                <input
                  type="number"
                  min="0.01"
                  max="99999999"
                  step="0.01"
                  required
                  value={form.amount}
                  placeholder="0.00"
                  onChange={(event) =>
                    setForm({ ...form, amount: event.target.value })
                  }
                />
              </label>
              <label className="db-field">
                Due date
                <input
                  type="date"
                  required
                  value={form.due}
                  onChange={(event) =>
                    setForm({ ...form, due: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="db-modal-actions">
              <button
                type="button"
                className="sf-button"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="sf-button primary">
                Save draft
                <ArrowRight size={17} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {active && (
        <Modal
          title={active.id}
          description="Invoice details"
          onClose={() => setDetail(null)}
        >
          <div className="db-invoice-preview">
            <div className="db-invoice-preview-top">
              <div className="db-workspace-mark">S</div>
              <div>
                <strong>Soft Fix studio</strong>
                <small>Creative work. Thoughtfully delivered.</small>
              </div>
              <Badge text={active.status} />
            </div>
            <div className="db-invoice-address">
              <div>
                <span>BILL TO</span>
                <strong>{active.client}</strong>
                <p>{active.project}</p>
              </div>
              <div>
                <span>DUE DATE</span>
                <strong>
                  <ShortDate value={active.due} />
                </strong>
                <p>{active.due.slice(0, 4)}</p>
              </div>
            </div>
            <div className="db-detail-row">
              <span>Project services · {active.project}</span>
              <strong>
                <Money amount={active.amount} />
              </strong>
            </div>
            <div className="db-invoice-total">
              <span>Total due</span>
              <strong>
                <Money amount={active.status === "Paid" ? 0 : active.amount} />
              </strong>
            </div>
            {active.status === "Paid" && (
              <p className="db-paid-message">
                <CheckCircle size={19} />
                Payment recorded · <Money amount={active.amount} />
              </p>
            )}
          </div>
          <div className="db-modal-actions">
            <button
              className="sf-button"
              onClick={() => {
                downloadCsv(`${active.id}.csv`, [
                  [
                    "Invoice",
                    "Client",
                    "Project",
                    "Amount USD",
                    "Due date",
                    "Status",
                  ],
                  [
                    active.id,
                    active.client,
                    active.project,
                    active.amount,
                    active.due,
                    active.status,
                  ],
                ]);
                notify("Invoice downloaded.");
              }}
            >
              <DownloadSimple size={17} />
              Download
            </button>
            {canManage && active.status === "Draft" && (
              <button
                className="sf-button primary"
                onClick={() => setInvoiceStatus(active, "Sent")}
              >
                Mark issued
                <ArrowUpRight size={17} />
              </button>
            )}
            {canManage && ["Sent", "Overdue"].includes(active.status) && (
              <button
                className="sf-button primary"
                onClick={() => setInvoiceStatus(active, "Paid")}
              >
                <Check size={17} />
                Record payment
              </button>
            )}
            {canManage && active.status === "Paid" && (
              <button
                className="sf-button"
                onClick={() => setInvoiceStatus(active, "Sent")}
              >
                Undo payment
              </button>
            )}
          </div>
          <p className="db-form-hint">
            Status changes are local. No invoice or payment request is sent.
          </p>
        </Modal>
      )}
    </div>
  );
}
