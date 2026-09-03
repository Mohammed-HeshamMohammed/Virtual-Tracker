import { query as pgQuery } from "../../lib/postgres/client.js";
import { getAuthContext } from "../../http/auth-context.js";
import { assertManagementRole } from "../../http/authorization.js";
import { applyVisibilityFilter } from "../schema/visibility.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { sendJson } from "../../http/response.js";
import { sendPgConstraintError } from "../../http/api-error.js";
import {
  CLIENT_FORM_FIELDS,
  CLIENT_FORM_TABS,
  BUDGET_BASE_OPTIONS,
  BUDGET_RESET_OPTIONS,
  BUDGET_TYPE_OPTIONS,
  INVOICE_AMOUNT_BASIS_OPTIONS,
  INVOICE_FREQUENCY_OPTIONS,
  LINE_ITEM_OPTIONS,
} from "./services/form-config.js";
import {
  createClientWithDetails,
  getClientEditState,
  listClientsEnriched,
  resolveClientInvoicingSettings,
  updateClientWithDetails,
} from "./services/client-service.js";
import { getClientPg, updateClientPg, deleteClientPg } from "../../lib/postgres/clients-postgres.service.js";
import { enrichMembersWithRoleNames } from "../members/services/relation-sync.js";
import { listMembersPg } from "../../lib/postgres/members-postgres.service.js";

function memberLabel(data) {
  const first = typeof data.first_name === "string" ? data.first_name : "";
  const last = typeof data.last_name === "string" ? data.last_name : "";
  const name = `${first} ${last}`.trim() || (typeof data.name === "string" ? data.name : "") || "Unknown";
  const initials =
    name
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "??";
  return { name, initials };
}

function isClientRole(role) {
  return String(role || "")
    .toLowerCase()
    .replace(/\s+/g, "") === "client";
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

export async function routeClients(req, res, url, db, origin) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");

  if (pn === "/api/clients/form-config" && req.method === "GET") {
    if (!assertManagementRole(req, res, origin)) return true;
    try {
      const [rawMembers, projectRows, clientRows] = await Promise.all([
        listMembersPg({ limit: 5000 }),
        pgQuery("SELECT id, name, status FROM projects"),
        pgQuery("SELECT member_id FROM clients"),
      ]);

      const linkedMemberIds = new Set(
        clientRows.map((row) => String(row.member_id ?? "").trim()).filter(Boolean),
      );

      const enrichedMembers = await enrichMembersWithRoleNames(db, rawMembers);

      const clientMembers = enrichedMembers
        .map((m) => {
          const roleName =
            typeof m.role === "string" && m.role.trim()
              ? m.role.trim()
              : typeof m.role_name === "string" && m.role_name.trim()
                ? m.role_name.trim()
                : "";
          if (!isClientRole(roleName)) return null;
          if (linkedMemberIds.has(m.id)) return null;
          const { name, initials } = memberLabel(m);
          return { id: m.id, label: name, initials };
        })
        .filter(Boolean)
        .sort((a, b) => a.label.localeCompare(b.label));

      const projects = projectRows
        .map((row) => {
          const status = String(row.status ?? "active").toLowerCase();
          if (status === "archived" || status === "completed") return null;
          return {
            id: row.id,
            label: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Unnamed project",
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.label.localeCompare(b.label));

      sendJson(res, origin, 200, {
        success: true,
        data: {
          tabs: CLIENT_FORM_TABS,
          fields: CLIENT_FORM_FIELDS,
          options: {
            budgetTypes: BUDGET_TYPE_OPTIONS,
            budgetBases: BUDGET_BASE_OPTIONS,
            budgetResets: BUDGET_RESET_OPTIONS,
            frequencies: INVOICE_FREQUENCY_OPTIONS,
            amountBasis: INVOICE_AMOUNT_BASIS_OPTIONS,
            lineItems: LINE_ITEM_OPTIONS,
            clientMembers,
            projects,
          },
        },
      });
    } catch (e) {
      logSafeError("[clients/form-config]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load client form config",
      });
    }
    return true;
  }

  if (pn === "/api/clients/enriched" && req.method === "GET") {
    try {
      let data = await listClientsEnriched(db);
      data = data.map((row) => ({
        ...row,
        client_member: row.clientMember ?? row.member_id ?? "",
      }));
      data = await applyVisibilityFilter(req, db, "clients", data);
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[clients/enriched]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load clients",
      });
    }
    return true;
  }

  const invoicingMatch = /^\/api\/clients\/([^/]+)\/invoicing$/.exec(pn);
  if (invoicingMatch && req.method === "GET") {
    const clientId = invoicingMatch[1];
    try {
      const client = await getClientPg(clientId);
      if (!client) {
        sendJson(res, origin, 404, { success: false, error: "Client not found" });
        return true;
      }
      const row = { ...client, client_member: client.member_id ?? "" };
      const visible = await applyVisibilityFilter(req, db, "clients", [row]);
      if (!visible.length) {
        sendJson(res, origin, 404, { success: false, error: "Not found" });
        return true;
      }
      const data = await resolveClientInvoicingSettings(db, clientId);
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      const status = e instanceof Error && e.message === "Client not found" ? 404 : 400;
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load client invoicing",
      });
    }
    return true;
  }

  const editStateMatch = /^\/api\/clients\/([^/]+)\/edit-state$/.exec(pn);
  if (editStateMatch && req.method === "GET") {
    const clientId = editStateMatch[1];
    try {
      const client = await getClientPg(clientId);
      if (!client) {
        sendJson(res, origin, 404, { success: false, error: "Client not found" });
        return true;
      }
      const row = { ...client, client_member: client.member_id ?? "" };
      const visible = await applyVisibilityFilter(req, db, "clients", [row]);
      if (!visible.length) {
        sendJson(res, origin, 404, { success: false, error: "Not found" });
        return true;
      }
      const data = await getClientEditState(db, clientId);
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      const status = e instanceof Error && e.message === "Client not found" ? 404 : 400;
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load client for edit",
      });
    }
    return true;
  }

  if (pn === "/api/clients/with-details" && req.method === "POST") {
    if (!assertManagementRole(req, res, origin)) return true;
    try {
      const body = await readJsonBody(req);
      const actorId = getAuthContext(req)?.memberId;
      const data = await createClientWithDetails(db, body, actorId);
      sendJson(res, origin, 201, { success: true, data });
    } catch (e) {
      logSafeError("[clients/with-details POST]", e);
      sendJson(res, origin, 400, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to create client",
      });
    }
    return true;
  }

  const withDetailsMatch = /^\/api\/clients\/([^/]+)\/with-details$/.exec(pn);
  if (withDetailsMatch && req.method === "PUT") {
    if (!assertManagementRole(req, res, origin)) return true;
    const clientId = withDetailsMatch[1];
    try {
      const body = await readJsonBody(req);
      const actorId = getAuthContext(req)?.memberId;
      const data = await updateClientWithDetails(db, clientId, body, actorId);
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[clients/with-details PUT]", e);
      if (sendPgConstraintError(res, origin, e, req)) return true;
      if (e && typeof e === "object" && "staleWrite" in e) {
        sendJson(res, origin, 409, {
          success: false,
          code: "stale_write",
          error: e instanceof Error ? e.message : "Conflict",
          data: e.current,
        });
        return true;
      }
      const status = e instanceof Error && e.message === "Client not found" ? 404 : 400;
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to update client",
      });
    }
    return true;
  }

  const clientIdUpdateMatch = /^\/api\/clients\/([^/]+)$/.exec(pn);
  if (clientIdUpdateMatch && (req.method === "PUT" || req.method === "PATCH")) {
    if (!assertManagementRole(req, res, origin)) return true;
    const clientId = clientIdUpdateMatch[1];
    try {
      const body = await readJsonBody(req);
      const pick = (...keys) => keys.find((key) => body[key] !== undefined);
      const patch = {};
      const assign = (target, ...keys) => {
        const key = pick(...keys);
        if (key !== undefined) patch[target] = body[key];
      };
      assign("name", "name");
      assign("memberId", "member_id", "memberId");
      assign("streetAddress", "street_address", "streetAddress");
      assign("city", "city");
      assign("state", "state");
      assign("zip", "zip");
      assign("country", "country");
      assign("phoneNumber", "phone_number", "phoneNumber");
      assign("emailAddresses", "email_addresses", "emailAddresses");
      assign("status", "status");
      patch.updatedBy = getAuthContext(req)?.memberId ?? null;

      const existing = await getClientPg(clientId);
      if (!existing) {
        sendJson(res, origin, 404, { success: false, error: "Client not found" });
        return true;
      }
      const expectedUpdatedAt = body.expected_updated_at ?? body.expectedUpdatedAt ?? undefined;
      const updated = await updateClientPg(clientId, patch, expectedUpdatedAt);
      if (updated && typeof updated === "object" && "conflict" in updated) {
        sendJson(res, origin, 409, {
          success: false,
          code: "stale_write",
          error: "Someone else changed this client while you were editing. Reload to see their changes.",
          data: updated.current,
        });
        return true;
      }
      sendJson(res, origin, 200, { success: true, data: updated });
    } catch (e) {
      logSafeError("[clients PUT]", e);
      if (sendPgConstraintError(res, origin, e, req)) return true;
      sendJson(res, origin, 400, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to update client",
      });
    }
    return true;
  }

  const clientIdMatch = /^\/api\/clients\/([^/]+)$/.exec(pn);
  if (clientIdMatch && req.method === "DELETE") {
    if (!assertManagementRole(req, res, origin)) return true;
    const clientId = clientIdMatch[1];
    try {
      const client = await getClientPg(clientId);
      if (!client) {
        sendJson(res, origin, 404, { success: false, error: "Not found" });
        return true;
      }
      const visible = await applyVisibilityFilter(req, db, "clients", [client]);
      if (!visible.length) {
        sendJson(res, origin, 404, { success: false, error: "Not found" });
        return true;
      }
      await deleteClientPg(clientId);
      sendJson(res, origin, 200, { success: true, data: { id: clientId, deleted: true } });
    } catch (e) {
      logSafeError("[clients/:id DELETE]", e);
      sendJson(res, origin, 400, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to delete client",
      });
    }
    return true;
  }

  return false;
}
