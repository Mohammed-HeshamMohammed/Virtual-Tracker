import {
  getProjectPg,
  linkClientProjectPg,
  listProjectIdsForClientPg,
  unlinkClientProjectPg,
} from "../../../lib/postgres/projects-postgres.service.js";
import { query as pgQuery } from "../../../lib/postgres/client.js";
import {
  getClientPg,
  createClientPg,
  updateClientPg,
  getClientBudgetPg,
  upsertClientBudgetPg,
  deleteClientBudgetPg,
  getClientInvoicingPg,
  upsertClientInvoicingPg,
} from "../../../lib/postgres/clients-postgres.service.js";
import {
  evaluateAndNotifyClientBudget,
  syncClientBudgetAutomationState,
} from "./client-budget-notify.js";
import { normalizeDoc } from "../../schema/services/schema-crud.service.js";
import {
  BUDGET_BASE_OPTIONS,
  BUDGET_RESET_OPTIONS,
  BUDGET_TYPE_OPTIONS,
  INVOICE_AMOUNT_BASIS_OPTIONS,
  INVOICE_FREQUENCY_OPTIONS,
  LINE_ITEM_OPTIONS,
} from "./form-config.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BUDGET_TYPES = new Set(BUDGET_TYPE_OPTIONS.map((o) => o.value));
const BUDGET_BASES = new Set(BUDGET_BASE_OPTIONS.map((o) => o.value));
const BUDGET_RESETS = new Set(BUDGET_RESET_OPTIONS.map((o) => o.value));
const FREQUENCIES = new Set(INVOICE_FREQUENCY_OPTIONS.map((o) => o.value));
const AMOUNT_BASIS = new Set(INVOICE_AMOUNT_BASIS_OPTIONS.map((o) => o.value));
const LINE_ITEMS = new Set(LINE_ITEM_OPTIONS.map((o) => o.value));

const pick = (body, camel, snake) => {
  if (body[camel] !== undefined) return body[camel];
  if (body[snake] !== undefined) return body[snake];
  return undefined;
};

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function defaultInvoicing() {
  return {
    custom: false,
    notes: "",
    netTerms: 30,
    taxRate: 0,
    autoInvoicing: false,
    autoAmountBasis: "hourly",
    autoFixedAmount: 0,
    autoFrequency: "monthly",
    autoDelaySending: 0,
    autoReminderDays: 7,
    autoLineItems: "detailed_project_user_date",
    autoIncludeNonBillable: false,
    autoIncludeExpenses: false,
  };
}

/** Parses request body from frontend ClientFormData shape. */
export function parseClientDetailsBody(body = {}) {
  const budgetRaw = body.budget ?? null;
  const invoicingRaw = body.invoicing ?? {};

  return {
    name: String(pick(body, "name", "name") ?? "").trim(),
    clientMember: String(pick(body, "clientMember", "member_id") ?? "").trim(),
    address: String(pick(body, "address", "street_address") ?? "").trim(),
    city: String(pick(body, "city", "city") ?? "").trim(),
    state: String(pick(body, "state", "state") ?? "").trim(),
    zip: String(pick(body, "zip", "zip") ?? "").trim(),
    country: String(pick(body, "country", "country") ?? "").trim(),
    phone: String(pick(body, "phone", "phone_number") ?? "").trim(),
    email: String(pick(body, "email", "email_addresses") ?? "").trim(),
    status: pick(body, "status", "status"),
    projects: Array.isArray(body.projects)
      ? body.projects.map((id) => String(id).trim()).filter(isUuid)
      : [],
    budgetId: pick(body, "budgetId", "budget_id"),
    invoicingId: pick(body, "invoicingId", "invoicing_id"),
    budget: budgetRaw
      ? {
          type: String(budgetRaw.type ?? "none").toLowerCase(),
          basedOn: String(budgetRaw.basedOn ?? budgetRaw.based_on ?? "per_project").toLowerCase(),
          cost: toNumber(budgetRaw.cost, 0),
          notifyAt: toNumber(budgetRaw.notifyAt ?? budgetRaw.notify_at_pct, 0),
          resets: String(budgetRaw.resets ?? "never").toLowerCase(),
        }
      : null,
    invoicing: {
      custom: Boolean(invoicingRaw.custom ?? invoicingRaw.custom_for_client),
      notes: String(invoicingRaw.notes ?? ""),
      netTerms: Math.max(0, Math.floor(toNumber(invoicingRaw.netTerms ?? invoicingRaw.net_terms_days, 30))),
      taxRate: Math.max(0, toNumber(invoicingRaw.taxRate ?? invoicingRaw.tax_rate, 0)),
      autoInvoicing: Boolean(invoicingRaw.autoInvoicing ?? invoicingRaw.auto_invoicing),
      autoAmountBasis: String(
        invoicingRaw.autoAmountBasis ?? invoicingRaw.auto_invoice_amount_based_on ?? "hourly",
      ).toLowerCase(),
      autoFixedAmount: Math.max(0, toNumber(invoicingRaw.autoFixedAmount ?? invoicingRaw.auto_fixed_amount, 0)),
      autoFrequency: String(
        invoicingRaw.autoFrequency ?? invoicingRaw.auto_invoice_frequency ?? "monthly",
      ).toLowerCase(),
      autoDelaySending: Math.max(
        0,
        Math.floor(toNumber(invoicingRaw.autoDelaySending ?? invoicingRaw.auto_invoice_delay_days, 0)),
      ),
      autoReminderDays: Math.max(
        0,
        Math.floor(toNumber(invoicingRaw.autoReminderDays ?? invoicingRaw.auto_invoice_reminder_days, 7)),
      ),
      autoLineItems: String(
        invoicingRaw.autoLineItems ?? invoicingRaw.auto_invoice_line_items ?? "detailed_project_user_date",
      ),
      autoIncludeNonBillable: Boolean(
        invoicingRaw.autoIncludeNonBillable ?? invoicingRaw.include_non_billable_time,
      ),
      autoIncludeExpenses: Boolean(invoicingRaw.autoIncludeExpenses ?? invoicingRaw.include_expenses),
    },
  };
}

export function validateClientCore(parsed, { isCreate = false } = {}) {
  if (isCreate && !parsed.name) throw new Error("name is required");
  if (parsed.status && !["active", "archived"].includes(String(parsed.status).toLowerCase())) {
    throw new Error("status must be active|archived");
  }
}

export function validateClientBudget(budget) {
  if (!budget || budget.type === "none") return;
  if (!BUDGET_TYPES.has(budget.type)) throw new Error("budget.type must be hourly|fixed|retainer|none");
  if (!BUDGET_BASES.has(budget.basedOn)) throw new Error("budget.basedOn must be per_person|per_project|total");
  if (!BUDGET_RESETS.has(budget.resets)) throw new Error("budget.resets must be monthly|quarterly|yearly|never");
  if (budget.cost < 0) throw new Error("budget.cost must be >= 0");
  if (budget.notifyAt < 0 || budget.notifyAt > 100) {
    throw new Error("budget.notifyAt must be between 0 and 100");
  }
}

export function validateClientInvoicing(invoicing) {
  if (!invoicing.custom && !invoicing.autoInvoicing) return;
  if (invoicing.taxRate < 0 || invoicing.taxRate > 100) {
    throw new Error("invoicing.taxRate must be between 0 and 100");
  }
  if (invoicing.netTerms < 0) throw new Error("invoicing.netTerms must be >= 0");
  if (invoicing.autoInvoicing) {
    if (!AMOUNT_BASIS.has(invoicing.autoAmountBasis)) {
      throw new Error("invoicing.autoAmountBasis must be hourly|fixed");
    }
    if (!FREQUENCIES.has(invoicing.autoFrequency)) {
      throw new Error("invoicing.autoFrequency must be weekly|biweekly|monthly");
    }
    if (!LINE_ITEMS.has(invoicing.autoLineItems)) {
      throw new Error("invoicing.autoLineItems is invalid");
    }
    if (invoicing.autoAmountBasis === "fixed" && invoicing.autoFixedAmount < 0) {
      throw new Error("invoicing.autoFixedAmount must be >= 0");
    }
    if (invoicing.autoDelaySending < 0) throw new Error("invoicing.autoDelaySending must be >= 0");
    if (invoicing.autoReminderDays < 0) throw new Error("invoicing.autoReminderDays must be >= 0");
  }
}

function mapBudgetRow(doc) {
  if (!doc) return null;
  const row = doc.data ? doc.data() : doc;
  const id = doc.id ?? row.id;
  return {
    id,
    type: String(row.type ?? "none"),
    basedOn: String(row.based_on ?? row.basedOn ?? "per_project"),
    cost: toNumber(row.cost, 0),
    notifyAt: toNumber(row.notify_at_pct ?? row.notifyAtPct, 0),
    resets: String(row.resets ?? "never"),
  };
}

function mapInvoicingRow(doc) {
  if (!doc) return defaultInvoicing();
  const row = doc.data ? doc.data() : doc;
  return {
    id: doc.id ?? row.id,
    custom: Boolean(row.custom_for_client ?? row.customForClient),
    notes: String(row.notes ?? ""),
    netTerms: Math.floor(toNumber(row.net_terms_days ?? row.netTermsDays, 30)),
    taxRate: toNumber(row.tax_rate ?? row.taxRate, 0),
    autoInvoicing: Boolean(row.auto_invoicing ?? row.autoInvoicing),
    autoAmountBasis: String(row.auto_invoice_amount_based_on ?? row.autoInvoiceAmountBasedOn ?? "hourly"),
    autoFixedAmount: toNumber(row.auto_fixed_amount ?? row.autoFixedAmount, 0),
    autoFrequency: String(row.auto_invoice_frequency ?? row.autoInvoiceFrequency ?? "monthly"),
    autoDelaySending: Math.floor(toNumber(row.auto_invoice_delay_days ?? row.autoInvoiceDelayDays, 0)),
    autoReminderDays: Math.floor(toNumber(row.auto_invoice_reminder_days ?? row.autoInvoiceReminderDays, 7)),
    autoLineItems: String(row.auto_invoice_line_items ?? row.autoInvoiceLineItems ?? "detailed_project_user_date"),
    autoIncludeNonBillable: Boolean(row.include_non_billable_time ?? row.includeNonBillableTime),
    autoIncludeExpenses: Boolean(row.include_expenses ?? row.includeExpenses),
  };
}

export function mapClientResponse(clientDoc, budgetDoc, invoicingDoc, projectIds = []) {
  const row = clientDoc.data ? clientDoc.data() : clientDoc;
  const id = clientDoc.id ?? row.id;
  const budget = mapBudgetRow(budgetDoc);
  const invoicingMapped = mapInvoicingRow(invoicingDoc);
  const invoicingId = invoicingMapped.id;
  const { id: _invId, ...invoicing } = invoicingMapped;

  return {
    id,
    status: String(row.status ?? "active").toLowerCase() === "archived" ? "archived" : "active",
    name: String(row.name ?? ""),
    address: String(row.street_address ?? row.streetAddress ?? ""),
    city: String(row.city ?? ""),
    state: String(row.state ?? ""),
    zip: String(row.zip ?? ""),
    country: String(row.country ?? ""),
    phone: String(row.phone_number ?? row.phoneNumber ?? ""),
    email: String(row.email_addresses ?? row.emailAddresses ?? ""),
    clientMember: String(row.member_id ?? row.memberId ?? ""),
    projects: projectIds,
    budget: budget
      ? {
          type: budget.type,
          basedOn: budget.basedOn,
          cost: budget.cost,
          notifyAt: budget.notifyAt,
          resets: budget.resets,
        }
      : null,
    budgetId: budget?.id,
    invoicing,
    invoicingId,
  };
}

async function loadProjectIdsForClient(db, clientId) {
  return (await listProjectIdsForClientPg(clientId)).map((id) => String(id).trim()).filter(Boolean);
}

async function assertMemberExists(db, memberId) {
  if (!memberId) return;
  const doc = await db.collection("members").doc(memberId).get();
  if (!doc.exists) throw new Error("member_id references missing members");
}

async function assertProjectsExist(db, projectIds) {
  if (!projectIds.length) return;
  for (const id of projectIds) {
    if (!(await getProjectPg(id))) throw new Error("projects contains missing project id");
  }
}

// budgetId param kept for call-site compatibility (edit path used to pass the
// loaded budget's id) but is no longer needed - client_budgets has a unique
// index on client_id, so ON CONFLICT (client_id) replaces the Firestore-era
// "resolve the existing doc id, then branch on create vs update" dance.
export async function upsertClientBudget(db, clientId, budget, _budgetId, actorId) {
  if (!budget || budget.type === "none") {
    await deleteClientBudgetPg(clientId);
    await syncClientBudgetAutomationState(db, clientId, null);
    return null;
  }

  const saved = await upsertClientBudgetPg(clientId, budget, actorId);
  await syncClientBudgetAutomationState(db, clientId, budget);
  await evaluateAndNotifyClientBudget(db, clientId).catch(() => null);
  return saved;
}

// invoicingId param kept for call-site compatibility, unused for the same
// reason as upsertClientBudget's _budgetId above.
export async function upsertClientInvoicing(db, clientId, invoicing, _invoicingId, actorId) {
  return upsertClientInvoicingPg(clientId, invoicing, actorId);
}

export async function syncClientProjects(db, clientId, projectIds, actorId) {
  const desired = new Set(projectIds);
  const existing = new Set(await listProjectIdsForClientPg(clientId));

  for (const projectId of existing) {
    if (!desired.has(projectId)) await unlinkClientProjectPg(clientId, projectId);
  }
  for (const projectId of desired) {
    if (existing.has(projectId)) continue;
    await linkClientProjectPg(clientId, projectId, actorId || null);
  }
}

export async function listClientsEnriched(db) {
  const [clientRows, budgetRows, invoicingRows, clientProjectRows] = await Promise.all([
    pgQuery("SELECT * FROM clients ORDER BY created_at"),
    pgQuery("SELECT * FROM client_budgets"),
    pgQuery("SELECT * FROM client_invoicing"),
    pgQuery("SELECT client_id, project_id FROM client_projects"),
  ]);

  const budgetByClient = new Map();
  for (const row of budgetRows) {
    const cid = String(row.client_id ?? "").trim();
    if (cid && !budgetByClient.has(cid)) budgetByClient.set(cid, row);
  }

  const invoicingByClient = new Map();
  for (const row of invoicingRows) {
    const cid = String(row.client_id ?? "").trim();
    if (cid && !invoicingByClient.has(cid)) invoicingByClient.set(cid, row);
  }

  const projectsByClient = new Map();
  for (const row of clientProjectRows) {
    const cid = String(row.client_id ?? "").trim();
    const pid = String(row.project_id ?? "").trim();
    if (!cid || !pid) continue;
    if (!projectsByClient.has(cid)) projectsByClient.set(cid, []);
    projectsByClient.get(cid).push(pid);
  }

  return clientRows.map((row) =>
    mapClientResponse(
      row,
      budgetByClient.get(row.id) ?? null,
      invoicingByClient.get(row.id) ?? null,
      projectsByClient.get(row.id) ?? [],
    ),
  );
}

export async function getClientEditState(db, clientId) {
  const client = await getClientPg(clientId);
  if (!client) throw new Error("Client not found");

  const [budget, invoicing, projectIds] = await Promise.all([
    getClientBudgetPg(clientId),
    getClientInvoicingPg(clientId),
    loadProjectIdsForClient(db, clientId),
  ]);

  return mapClientResponse(client, budget, invoicing, projectIds);
}

export async function createClientWithDetails(db, body, actorId) {
  const parsed = parseClientDetailsBody(body);
  validateClientCore(parsed, { isCreate: true });
  validateClientBudget(parsed.budget);
  validateClientInvoicing(parsed.invoicing);
  await assertMemberExists(db, parsed.clientMember);
  await assertProjectsExist(db, parsed.projects);

  const client = await createClientPg({
    name: parsed.name,
    status: "active",
    streetAddress: parsed.address,
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip,
    country: parsed.country,
    phoneNumber: parsed.phone,
    emailAddresses: parsed.email,
    memberId: parsed.clientMember || null,
    actorId,
  });

  const budgetDoc = await upsertClientBudget(db, client.id, parsed.budget, null, actorId);
  const invoicingDoc = await upsertClientInvoicing(db, client.id, parsed.invoicing, null, actorId);
  await syncClientProjects(db, client.id, parsed.projects, actorId);

  return mapClientResponse(client, budgetDoc, invoicingDoc, parsed.projects);
}

export async function updateClientWithDetails(db, clientId, body, actorId) {
  const parsed = parseClientDetailsBody(body);
  validateClientCore(parsed);
  validateClientBudget(parsed.budget);
  validateClientInvoicing(parsed.invoicing);
  await assertMemberExists(db, parsed.clientMember);
  await assertProjectsExist(db, parsed.projects);

  const existing = await getClientPg(clientId);
  if (!existing) throw new Error("Client not found");

  const patch = {
    streetAddress: parsed.address,
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip,
    country: parsed.country,
    phoneNumber: parsed.phone,
    emailAddresses: parsed.email,
    // Explicitly null when no member is linked - clears the column rather
    // than leaving the previous value in place (Firestore's FieldValue.delete()
    // did the equivalent for the doc-field version of this).
    memberId: parsed.clientMember || null,
  };
  if (parsed.name) patch.name = parsed.name
  if (parsed.status) patch.status = String(parsed.status).toLowerCase();
  if (actorId) patch.updatedBy = actorId;

  const updated = await updateClientPg(clientId, patch);

  const budgetDoc = await upsertClientBudget(db, clientId, parsed.budget, null, actorId);
  const invoicingDoc = await upsertClientInvoicing(db, clientId, parsed.invoicing, null, actorId);
  await syncClientProjects(db, clientId, parsed.projects, actorId);

  const projectIds = await loadProjectIdsForClient(db, clientId);
  return mapClientResponse(updated, budgetDoc, invoicingDoc, projectIds);
}

/** Resolves invoicing settings for billing (custom overrides when enabled). */
export async function resolveClientInvoicingSettings(db, clientId) {
  const row = await getClientInvoicingPg(clientId);
  if (!row) return { source: "global", settings: defaultInvoicing() };
  const mapped = mapInvoicingRow(row);
  return {
    source: mapped.custom ? "client" : mapped.autoInvoicing ? "client-auto" : "global",
    settings: mapped,
    clientId,
  };
}

export { normalizeDoc, defaultInvoicing, LINE_ITEM_OPTIONS };
