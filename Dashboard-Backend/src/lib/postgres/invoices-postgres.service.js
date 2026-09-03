
import { query } from "./client.js";
import { publishChange } from "../../modules/realtime/change-bus.js";

function uuidOrNull(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function toDayString(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function nextInvoiceNumberPg(kind) {
  const prefix = kind === "team" ? "TEAM-" : "INV-";
  const rows = await query(
    `SELECT number FROM invoices WHERE number LIKE $1 ORDER BY number DESC LIMIT 1`,
    [`${prefix}%`],
  );
  const last = rows[0]?.number ?? "";
  const seq = Number.parseInt(String(last).slice(prefix.length), 10);
  const next = Number.isFinite(seq) ? seq + 1 : 1;
  return `${prefix}${String(next).padStart(6, "0")}`;
}

export async function createInvoicePg(data) {
  const rows = await query(
    `INSERT INTO invoices (kind, client_id, member_id, number, issue_date, due_date, status,
                           subtotal, tax, total, currency, notes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',0,$7,0,$8,$9,$10,$10)
     RETURNING *`,
    [
      data.kind,
      uuidOrNull(data.client_id),
      uuidOrNull(data.member_id),
      data.number,
      data.issue_date,
      data.due_date ?? null,
      num(data.tax),
      String(data.currency ?? "USD").toUpperCase().slice(0, 10),
      String(data.notes ?? "").trim(),
      uuidOrNull(data.created_by),
    ],
  );
  const created = rows[0] ?? null;
  if (created) void publishChange("invoices", String(created.id), "created", uuidOrNull(data.created_by) ?? undefined);
  return created;
}

export async function getInvoicePg(id) {
  if (!id) return null;
  const rows = await query("SELECT * FROM invoices WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ?? null;
}

export async function addInvoiceLineItemPg(invoiceId, item) {
  const quantity = num(item.quantity) || 1;
  const unitPrice = num(item.unit_price);
  const rows = await query(
    `INSERT INTO invoice_line_items (invoice_id, project_id, description, quantity, unit_price, amount)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      invoiceId,
      uuidOrNull(item.project_id),
      String(item.description ?? "").trim(),
      quantity,
      unitPrice,
      Math.round(quantity * unitPrice * 100) / 100,
    ],
  );
  return rows[0] ?? null;
}

export async function listInvoiceLineItemsPg(invoiceId) {
  return query("SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY created_at ASC", [invoiceId]);
}

export async function recalcInvoiceTotalsPg(invoiceId, actorId) {
  const rows = await query(
    `UPDATE invoices SET
       subtotal = sub.total,
       total = sub.total + tax,
       updated_by = $2
     FROM (SELECT COALESCE(SUM(amount), 0) AS total FROM invoice_line_items WHERE invoice_id = $1) sub
     WHERE invoices.id = $1
     RETURNING invoices.*`,
    [invoiceId, uuidOrNull(actorId)],
  );
  return rows[0] ?? null;
}

export async function updateInvoiceStatusPg(id, status, actorId) {
  const rows = await query(
    "UPDATE invoices SET status = $2, updated_by = $3 WHERE id = $1 RETURNING *",
    [id, status, uuidOrNull(actorId)],
  );
  const updated = rows[0] ?? null;
  if (updated) void publishChange("invoices", String(id), "updated", uuidOrNull(actorId) ?? undefined);
  return updated;
}

export async function recordInvoicePaymentPg(data) {
  const rows = await query(
    `INSERT INTO invoice_payments (invoice_id, amount, paid_on, method, reference, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      data.invoice_id,
      num(data.amount),
      data.paid_on,
      String(data.method ?? "other").slice(0, 40),
      String(data.reference ?? "").slice(0, 120),
      String(data.note ?? "").trim(),
      uuidOrNull(data.created_by),
    ],
  );
  const created = rows[0] ?? null;

  if (created) {
    await query(
      `UPDATE invoices SET status = 'paid'
       WHERE id = $1
         AND status <> 'void'
         AND total > 0
         AND (SELECT COALESCE(SUM(amount), 0) FROM invoice_payments WHERE invoice_id = $1) >= total`,
      [data.invoice_id],
    );
    void publishChange("invoices", String(data.invoice_id), "updated", uuidOrNull(data.created_by) ?? undefined);
  }
  return created;
}

export async function listInvoicesWithBalancePg({
  kind,
  memberIds = null,
  clientIds = null,
  fromDay = null,
  toDay = null,
  status = null,
  projectIds = null,
}) {
  const rows = await query(
    `SELECT i.*,
            COALESCE(c.name, '') AS client_name,
            COALESCE(pay.paid, 0) AS paid_amount,
            (i.total - COALESCE(pay.paid, 0)) AS due_amount
     FROM invoices i
     LEFT JOIN clients c ON c.id = i.client_id
     LEFT JOIN (
       SELECT invoice_id, SUM(amount) AS paid FROM invoice_payments GROUP BY invoice_id
     ) pay ON pay.invoice_id = i.id
     WHERE i.kind = $1
       AND ($2::uuid[] IS NULL OR i.member_id = ANY($2::uuid[]))
       AND ($3::uuid[] IS NULL OR i.client_id = ANY($3::uuid[]))
       AND ($4::date IS NULL OR i.issue_date >= $4::date)
       AND ($5::date IS NULL OR i.issue_date <= $5::date)
       AND ($6::text IS NULL OR i.status = $6::text)
       AND ($7::uuid[] IS NULL OR EXISTS (
             SELECT 1 FROM invoice_line_items ili
             WHERE ili.invoice_id = i.id AND ili.project_id = ANY($7::uuid[])
           ))
     ORDER BY i.issue_date DESC, i.number DESC
     LIMIT 2000`,
    [kind, memberIds, clientIds, fromDay, toDay, status, projectIds],
  );
  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind,
    number: r.number,
    clientId: r.client_id ? String(r.client_id) : null,
    clientName: r.client_name || "",
    memberId: r.member_id ? String(r.member_id) : null,
    issueDate: toDayString(r.issue_date),
    dueDate: toDayString(r.due_date),
    status: r.status,
    total: num(r.total),
    paidAmount: num(r.paid_amount),
    dueAmount: num(r.due_amount),
    currency: r.currency || "USD",
  }));
}

export async function listInvoiceAgingPg({ kind, memberIds = null, asOf, projectIds = null }) {
  const rows = await query(
    `SELECT i.id, i.number, i.client_id, i.member_id, i.due_date, i.issue_date,
            i.total, i.currency,
            COALESCE(c.name, '') AS client_name,
            COALESCE(pay.paid, 0) AS paid_amount,
            (i.total - COALESCE(pay.paid, 0)) AS due_amount,
            CASE
              WHEN i.due_date IS NULL THEN 0
              ELSE GREATEST(0, ($3::date - i.due_date))
            END AS days_overdue
     FROM invoices i
     LEFT JOIN clients c ON c.id = i.client_id
     LEFT JOIN (
       SELECT invoice_id, SUM(amount) AS paid FROM invoice_payments GROUP BY invoice_id
     ) pay ON pay.invoice_id = i.id
     WHERE i.kind = $1
       AND i.status IN ('sent', 'paid')
       AND (i.total - COALESCE(pay.paid, 0)) > 0
       AND ($2::uuid[] IS NULL OR i.member_id = ANY($2::uuid[]))
       AND ($4::uuid[] IS NULL OR EXISTS (
             SELECT 1 FROM invoice_line_items ili
             WHERE ili.invoice_id = i.id AND ili.project_id = ANY($4::uuid[])
           ))
     ORDER BY days_overdue DESC, i.due_date ASC NULLS LAST
     LIMIT 2000`,
    [kind, memberIds, asOf, projectIds],
  );
  return rows.map((r) => {
    const daysOverdue = Math.max(0, Number(r.days_overdue) || 0);
    const bucket =
      daysOverdue === 0 ? "current" : daysOverdue <= 30 ? "1-30" : daysOverdue <= 60 ? "31-60" : daysOverdue <= 90 ? "61-90" : "90+";
    return {
      id: String(r.id),
      number: r.number,
      clientName: r.client_name || "",
      memberId: r.member_id ? String(r.member_id) : null,
      issueDate: toDayString(r.issue_date),
      dueDate: toDayString(r.due_date),
      total: num(r.total),
      paidAmount: num(r.paid_amount),
      dueAmount: num(r.due_amount),
      currency: r.currency || "USD",
      daysOverdue,
      bucket,
    };
  });
}

export async function listInvoicePaymentsPg({ memberIds = null, fromDay, toDay, projectIds = null }) {
  const rows = await query(
    `SELECT p.id, p.amount, p.paid_on, p.method, p.reference, p.note,
            i.id AS invoice_id, i.number, i.kind, i.currency,
            i.member_id, i.client_id,
            COALESCE(c.name, '') AS client_name
     FROM invoice_payments p
     JOIN invoices i ON i.id = p.invoice_id
     LEFT JOIN clients c ON c.id = i.client_id
     WHERE p.paid_on >= $1 AND p.paid_on <= $2
       AND ($3::uuid[] IS NULL OR i.member_id IS NULL OR i.member_id = ANY($3::uuid[]))
       AND ($4::uuid[] IS NULL OR EXISTS (
             SELECT 1 FROM invoice_line_items ili
             WHERE ili.invoice_id = i.id AND ili.project_id = ANY($4::uuid[])
           ))
     ORDER BY p.paid_on DESC
     LIMIT 2000`,
    [fromDay, toDay, memberIds, projectIds],
  );
  return rows.map((r) => ({
    id: String(r.id),
    invoiceId: String(r.invoice_id),
    invoiceNumber: r.number,
    kind: r.kind,
    memberId: r.member_id ? String(r.member_id) : null,
    clientName: r.client_name || "",
    amount: num(r.amount),
    currency: r.currency || "USD",
    paidOn: toDayString(r.paid_on),
    method: r.method || "other",
    reference: r.reference || "",
  }));
}
