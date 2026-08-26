// Invoices: create, add line items, issue, and record payments.
//
// Invoicing is a financial record, so every write here is management-only.
// A member can read team invoices raised against their own work (that is
// their own pay record), which the list route scopes for them.

import { getAuthContext, requireManagementRole } from "../../http/auth-context.js";
import { getVisibleMemberIds } from "../member-relationships/service.js";
import { sendJson } from "../../http/response.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { rejectUnknownFields } from "../../http/validate-body.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { buildMemberMetaMap } from "../activity/activity-scope.js";
import {
  addInvoiceLineItemPg,
  createInvoicePg,
  getInvoicePg,
  listInvoiceLineItemsPg,
  listInvoicesWithBalancePg,
  nextInvoiceNumberPg,
  recalcInvoiceTotalsPg,
  recordInvoicePaymentPg,
  updateInvoiceStatusPg,
} from "../../lib/postgres/invoices-postgres.service.js";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = new Set(["client", "team"]);
const STATUSES = new Set(["draft", "sent", "paid", "void"]);

function parseDay(value) {
  const day = typeof value === "string" ? value.trim() : "";
  return DAY_RE.test(day) ? day : "";
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeInvoices(req, res, url, db, origin) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");
  if (!pn.startsWith("/api/invoices")) return false;

  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return true;
  }

  // GET /api/invoices?kind=client|team&status=&from=&to=
  if (pn === "/api/invoices" && req.method === "GET") {
    const kind = (url.searchParams.get("kind") || "client").trim();
    if (!KINDS.has(kind)) {
      sendJson(res, origin, 400, { success: false, error: "kind must be client or team." });
      return true;
    }
    try {
      // Client invoices are org financials - management only. Team invoices
      // are scoped to the members the viewer can see, which for a non-manager
      // is just themselves.
      let memberIds = null;
      if (kind === "client") {
        if (!requireManagementRole(viewer)) {
          sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to view client invoices." });
          return true;
        }
      } else {
        memberIds = await getVisibleMemberIds(db, viewer.memberId, viewer.roleName);
      }
      const status = (url.searchParams.get("status") || "").trim();
      const rows = await listInvoicesWithBalancePg({
        kind,
        memberIds,
        fromDay: parseDay(url.searchParams.get("from")) || null,
        toDay: parseDay(url.searchParams.get("to")) || null,
        status: STATUSES.has(status) ? status : null,
      });
      const nameMap = await buildMemberMetaMap(
        db,
        [...new Set(rows.map((r) => r.memberId).filter(Boolean))],
      );
      sendJson(res, origin, 200, {
        success: true,
        data: rows.map((r) => ({
          ...r,
          memberName: r.memberId ? (nameMap.get(r.memberId)?.name ?? "Unknown") : "",
        })),
      });
    } catch (e) {
      logSafeError("[invoices GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load invoices." });
    }
    return true;
  }

  // Everything below writes financial records.
  if (!requireManagementRole(viewer)) {
    sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to manage invoices." });
    return true;
  }

  // POST /api/invoices
  if (pn === "/api/invoices" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["kind", "clientId", "memberId", "issueDate", "dueDate", "tax", "currency", "notes", "lineItems"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const kind = String(body.kind ?? "").trim();
    if (!KINDS.has(kind)) {
      sendJson(res, origin, 400, { success: false, error: "kind must be client or team." });
      return true;
    }
    const clientId = String(body.clientId ?? "").trim();
    const memberId = String(body.memberId ?? "").trim();
    if (kind === "client" && !clientId) {
      sendJson(res, origin, 400, { success: false, error: "A client invoice needs a client." });
      return true;
    }
    if (kind === "team" && !memberId) {
      sendJson(res, origin, 400, { success: false, error: "A team invoice needs a member." });
      return true;
    }

    try {
      const created = await createInvoicePg({
        kind,
        client_id: kind === "client" ? clientId : null,
        member_id: kind === "team" ? memberId : null,
        number: await nextInvoiceNumberPg(kind),
        issue_date: parseDay(body.issueDate) || new Date().toISOString().slice(0, 10),
        due_date: parseDay(body.dueDate) || null,
        tax: body.tax,
        currency: body.currency,
        notes: body.notes,
        created_by: viewer.memberId,
      });

      const items = Array.isArray(body.lineItems) ? body.lineItems : [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        await addInvoiceLineItemPg(String(created.id), {
          project_id: item.projectId ?? item.project_id ?? null,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unitPrice ?? item.unit_price,
        });
      }
      const withTotals = items.length > 0 ? await recalcInvoiceTotalsPg(String(created.id), viewer.memberId) : created;
      sendJson(res, origin, 201, { success: true, data: withTotals });
    } catch (e) {
      logSafeError("[invoices POST]", e);
      sendJson(res, origin, 400, { success: false, error: "Failed to create invoice." });
    }
    return true;
  }

  const idMatch = /^\/api\/invoices\/([^/]+)$/.exec(pn);
  const itemsMatch = /^\/api\/invoices\/([^/]+)\/line-items$/.exec(pn);
  const statusMatch = /^\/api\/invoices\/([^/]+)\/status$/.exec(pn);
  const paymentsMatch = /^\/api\/invoices\/([^/]+)\/payments$/.exec(pn);

  if (idMatch && req.method === "GET") {
    try {
      const invoice = await getInvoicePg(idMatch[1]);
      if (!invoice) {
        sendJson(res, origin, 404, { success: false, error: "Invoice not found." });
        return true;
      }
      const lineItems = await listInvoiceLineItemsPg(idMatch[1]);
      sendJson(res, origin, 200, { success: true, data: { ...invoice, lineItems } });
    } catch (e) {
      logSafeError("[invoices GET one]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load invoice." });
    }
    return true;
  }

  if (itemsMatch && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["description", "quantity", "unitPrice", "unit_price", "projectId", "project_id"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const invoice = await getInvoicePg(itemsMatch[1]);
      if (!invoice) {
        sendJson(res, origin, 404, { success: false, error: "Invoice not found." });
        return true;
      }
      // An issued invoice is what was billed; editing it after the fact would
      // change history rather than correct it. Raise a credit/new invoice.
      if (invoice.status !== "draft") {
        sendJson(res, origin, 409, { success: false, error: "Only a draft invoice can be edited." });
        return true;
      }
      await addInvoiceLineItemPg(itemsMatch[1], {
        project_id: body.projectId ?? body.project_id ?? null,
        description: body.description,
        quantity: body.quantity,
        unit_price: body.unitPrice ?? body.unit_price,
      });
      sendJson(res, origin, 201, {
        success: true,
        data: await recalcInvoiceTotalsPg(itemsMatch[1], viewer.memberId),
      });
    } catch (e) {
      logSafeError("[invoices line-items POST]", e);
      sendJson(res, origin, 400, { success: false, error: "Failed to add line item." });
    }
    return true;
  }

  if (statusMatch && req.method === "PATCH") {
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["status"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const status = String(body.status ?? "").trim();
    if (!STATUSES.has(status)) {
      sendJson(res, origin, 400, { success: false, error: "Unrecognized invoice status." });
      return true;
    }
    try {
      const updated = await updateInvoiceStatusPg(statusMatch[1], status, viewer.memberId);
      if (!updated) {
        sendJson(res, origin, 404, { success: false, error: "Invoice not found." });
        return true;
      }
      sendJson(res, origin, 200, { success: true, data: updated });
    } catch (e) {
      logSafeError("[invoices status PATCH]", e);
      sendJson(res, origin, 400, { success: false, error: "Failed to update invoice." });
    }
    return true;
  }

  if (paymentsMatch && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["amount", "paidOn", "method", "reference", "note"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      sendJson(res, origin, 400, { success: false, error: "Enter a payment amount greater than zero." });
      return true;
    }
    try {
      const invoice = await getInvoicePg(paymentsMatch[1]);
      if (!invoice) {
        sendJson(res, origin, 404, { success: false, error: "Invoice not found." });
        return true;
      }
      if (invoice.status === "draft" || invoice.status === "void") {
        sendJson(res, origin, 409, {
          success: false,
          error: "Only an issued invoice can be paid.",
        });
        return true;
      }
      const created = await recordInvoicePaymentPg({
        invoice_id: paymentsMatch[1],
        amount,
        paid_on: parseDay(body.paidOn) || new Date().toISOString().slice(0, 10),
        method: body.method,
        reference: body.reference,
        note: body.note,
        created_by: viewer.memberId,
      });
      sendJson(res, origin, 201, { success: true, data: created });
    } catch (e) {
      logSafeError("[invoices payments POST]", e);
      sendJson(res, origin, 400, { success: false, error: "Failed to record payment." });
    }
    return true;
  }

  return false;
}
