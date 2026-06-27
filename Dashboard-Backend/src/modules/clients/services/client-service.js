import { COLLECTIONS } from "../../../lib/firestore/collections.js";
import { FieldValue } from "firebase-admin/firestore";
import { generateUUID, now } from "../../schema/catalog/index.js";
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
  const snap = await db.collection("client_projects").where("client_id", "==", clientId).get();
  return snap.docs
    .map((doc) => {
      const row = doc.data() || {};
      return String(row.project_id ?? row.projectId ?? "").trim();
    })
    .filter(Boolean);
}

async function assertMemberExists(db, memberId) {
  if (!memberId) return;
  const doc = await db.collection("members").doc(memberId).get();
  if (!doc.exists) throw new Error("member_id references missing members");
}

async function assertProjectsExist(db, projectIds) {
  if (!projectIds.length) return;
  const refs = projectIds.map((id) => db.collection(COLLECTIONS.projects).doc(id));
  const snaps = await db.getAll(...refs);
  for (const snap of snaps) {
    if (!snap.exists) throw new Error("projects contains missing project id");
  }
}

async function resolveClientBudgetId(db, clientId, budgetId) {
  if (budgetId && isUuid(budgetId)) return budgetId;
  const snap = await db.collection("client_budgets").where("client_id", "==", clientId).limit(1).get();
  return snap.docs[0]?.id ?? null;
}

async function resolveClientInvoicingId(db, clientId, invoicingId) {
  if (invoicingId && isUuid(invoicingId)) return invoicingId;
  const snap = await db.collection("client_invoicing").where("client_id", "==", clientId).limit(1).get();
  return snap.docs[0]?.id ?? null;
}

export async function upsertClientBudget(db, clientId, budget, budgetId, actorId) {
  const resolvedId = await resolveClientBudgetId(db, clientId, budgetId);

  if (!budget || budget.type === "none") {
    if (resolvedId) {
      await db.collection("client_budgets").doc(resolvedId).delete();
    }
    await syncClientBudgetAutomationState(db, clientId, null);
    return null;
  }

  const payload = {
    client_id: clientId,
    type: budget.type,
    based_on: budget.basedOn,
    cost: budget.cost,
    notify_at_pct: budget.notifyAt,
    resets: budget.resets,
    updated_at: now(),
  };
  if (actorId) payload.updated_by = actorId;

  if (resolvedId) {
    await db.collection("client_budgets").doc(resolvedId).set(
      {
        ...payload,
        start_date: FieldValue.delete(),
        startDate: FieldValue.delete(),
      },
      { merge: true },
    );
    const saved = await db.collection("client_budgets").doc(resolvedId).get();
    await syncClientBudgetAutomationState(db, clientId, budget);
    await evaluateAndNotifyClientBudget(db, clientId).catch(() => null);
    return saved;
  }

  const id = generateUUID();
  await db.collection("client_budgets").doc(id).set({
    ...payload,
    id,
    created_at: now(),
    ...(actorId ? { created_by: actorId } : {}),
  });
  const created = await db.collection("client_budgets").doc(id).get();
  await syncClientBudgetAutomationState(db, clientId, budget);
  await evaluateAndNotifyClientBudget(db, clientId).catch(() => null);
  return created;
}

export async function upsertClientInvoicing(db, clientId, invoicing, invoicingId, actorId) {
  const resolvedId = await resolveClientInvoicingId(db, clientId, invoicingId);

  const payload = {
    client_id: clientId,
    custom_for_client: invoicing.custom,
    notes: invoicing.notes,
    net_terms_days: invoicing.netTerms,
    tax_rate: invoicing.taxRate,
    auto_invoicing: invoicing.autoInvoicing,
    auto_invoice_amount_based_on: invoicing.autoAmountBasis,
    auto_fixed_amount: invoicing.autoFixedAmount,
    auto_invoice_frequency: invoicing.autoFrequency,
    auto_invoice_delay_days: invoicing.autoDelaySending,
    auto_invoice_reminder_days: invoicing.autoReminderDays,
    auto_invoice_line_items: invoicing.autoLineItems,
    include_non_billable_time: invoicing.autoIncludeNonBillable,
    include_expenses: invoicing.autoIncludeExpenses,
    updated_at: now(),
  };
  if (actorId) payload.updated_by = actorId;

  if (resolvedId) {
    await db.collection("client_invoicing").doc(resolvedId).set(payload, { merge: true });
    return db.collection("client_invoicing").doc(resolvedId).get();
  }

  const id = generateUUID();
  await db.collection("client_invoicing").doc(id).set({
    ...payload,
    id,
    created_at: now(),
    ...(actorId ? { created_by: actorId } : {}),
  });
  return db.collection("client_invoicing").doc(id).get();
}

export async function syncClientProjects(db, clientId, projectIds, actorId) {
  const desired = new Set(projectIds);
  const snap = await db.collection("client_projects").where("client_id", "==", clientId).get();
  const batch = db.batch();
  let writes = 0;

  for (const doc of snap.docs) {
    const row = doc.data() || {};
    const projectId = String(row.project_id ?? row.projectId ?? "").trim();
    if (!desired.has(projectId)) {
      batch.delete(doc.ref);
      writes += 1;
    }
  }

  const existing = new Set(
    snap.docs.map((doc) => {
      const row = doc.data() || {};
      return String(row.project_id ?? row.projectId ?? "").trim();
    }),
  );

  for (const projectId of desired) {
    if (existing.has(projectId)) continue;
    const id = generateUUID();
    const ref = db.collection("client_projects").doc(id);
    batch.set(ref, {
      id,
      client_id: clientId,
      project_id: projectId,
      assigned_at: now(),
      ...(actorId ? { assigned_by: actorId } : {}),
    });
    writes += 1;
  }

  if (writes > 0) await batch.commit();
}

export async function listClientsEnriched(db) {
  const [clientsSnap, budgetsSnap, invoicingSnap, linksSnap] = await Promise.all([
    db.collection("clients")
      .select(
        "status",
        "name",
        "street_address",
        "streetAddress",
        "city",
        "state",
        "zip",
        "country",
        "phone_number",
        "phoneNumber",
        "email_addresses",
        "emailAddresses",
        "member_id",
        "memberId"
      )
      .limit(500)
      .get(),
    db.collection("client_budgets")
      .select(
        "client_id",
        "clientId",
        "type",
        "based_on",
        "basedOn",
        "cost",
        "notify_at_pct",
        "notifyAtPct",
        "resets",
      )
      .limit(1000)
      .get(),
    db.collection("client_invoicing")
      .select(
        "client_id",
        "clientId",
        "custom_for_client",
        "customForClient",
        "notes",
        "net_terms_days",
        "netTermsDays",
        "tax_rate",
        "taxRate",
        "auto_invoicing",
        "autoInvoicing",
        "auto_invoice_amount_based_on",
        "autoInvoiceAmountBasedOn",
        "auto_fixed_amount",
        "autoFixedAmount",
        "auto_invoice_frequency",
        "autoInvoiceFrequency",
        "auto_invoice_delay_days",
        "autoInvoiceDelayDays",
        "auto_invoice_reminder_days",
        "autoInvoiceReminderDays",
        "auto_invoice_line_items",
        "autoInvoiceLineItems",
        "include_non_billable_time",
        "includeNonBillableTime",
        "include_expenses",
        "includeExpenses"
      )
      .limit(1000)
      .get(),
    db.collection("client_projects")
      .select(
        "client_id",
        "clientId",
        "project_id",
        "projectId"
      )
      .limit(2000)
      .get(),
  ]);

  const budgetByClient = new Map();
  for (const doc of budgetsSnap.docs) {
    const row = doc.data() || {};
    const cid = String(row.client_id ?? row.clientId ?? "").trim();
    if (cid && !budgetByClient.has(cid)) budgetByClient.set(cid, doc);
  }

  const invoicingByClient = new Map();
  for (const doc of invoicingSnap.docs) {
    const row = doc.data() || {};
    const cid = String(row.client_id ?? row.clientId ?? "").trim();
    if (cid && !invoicingByClient.has(cid)) invoicingByClient.set(cid, doc);
  }

  const projectsByClient = new Map();
  for (const doc of linksSnap.docs) {
    const row = doc.data() || {};
    const cid = String(row.client_id ?? row.clientId ?? "").trim();
    const pid = String(row.project_id ?? row.projectId ?? "").trim();
    if (!cid || !pid) continue;
    if (!projectsByClient.has(cid)) projectsByClient.set(cid, []);
    projectsByClient.get(cid).push(pid);
  }

  return clientsSnap.docs.map((doc) =>
    mapClientResponse(
      doc,
      budgetByClient.get(doc.id) ?? null,
      invoicingByClient.get(doc.id) ?? null,
      projectsByClient.get(doc.id) ?? [],
    ),
  );
}

export async function getClientEditState(db, clientId) {
  const clientDoc = await db.collection("clients").doc(clientId).get();
  if (!clientDoc.exists) throw new Error("Client not found");

  const [budgetsSnap, invoicingSnap, projectIds] = await Promise.all([
    db.collection("client_budgets").where("client_id", "==", clientId).limit(1).get(),
    db.collection("client_invoicing").where("client_id", "==", clientId).limit(1).get(),
    loadProjectIdsForClient(db, clientId),
  ]);

  return mapClientResponse(
    clientDoc,
    budgetsSnap.docs[0] ?? null,
    invoicingSnap.docs[0] ?? null,
    projectIds,
  );
}

export async function createClientWithDetails(db, body, actorId) {
  const parsed = parseClientDetailsBody(body);
  validateClientCore(parsed, { isCreate: true });
  validateClientBudget(parsed.budget);
  validateClientInvoicing(parsed.invoicing);
  await assertMemberExists(db, parsed.clientMember);
  await assertProjectsExist(db, parsed.projects);

  const clientId = generateUUID();
  const clientPayload = {
    id: clientId,
    name: parsed.name,
    status: "active",
    street_address: parsed.address,
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip,
    country: parsed.country,
    phone_number: parsed.phone,
    email_addresses: parsed.email,
    created_at: now(),
    updated_at: now(),
  };
  if (parsed.clientMember) clientPayload.member_id = parsed.clientMember;
  if (actorId) {
    clientPayload.created_by = actorId;
    clientPayload.updated_by = actorId;
  }

  await db.collection("clients").doc(clientId).set(clientPayload);

  const budgetDoc = await upsertClientBudget(db, clientId, parsed.budget, null, actorId);
  const invoicingDoc = await upsertClientInvoicing(db, clientId, parsed.invoicing, null, actorId);
  await syncClientProjects(db, clientId, parsed.projects, actorId);

  const clientDoc = await db.collection("clients").doc(clientId).get();
  return mapClientResponse(clientDoc, budgetDoc, invoicingDoc, parsed.projects);
}

export async function updateClientWithDetails(db, clientId, body, actorId) {
  const parsed = parseClientDetailsBody(body);
  validateClientCore(parsed);
  validateClientBudget(parsed.budget);
  validateClientInvoicing(parsed.invoicing);
  await assertMemberExists(db, parsed.clientMember);
  await assertProjectsExist(db, parsed.projects);

  const clientRef = db.collection("clients").doc(clientId);
  const clientDoc = await clientRef.get();
  if (!clientDoc.exists) throw new Error("Client not found");

  const coreUpdate = {
    street_address: parsed.address,
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip,
    country: parsed.country,
    phone_number: parsed.phone,
    email_addresses: parsed.email,
    updated_at: now(),
  };
  if (parsed.name) coreUpdate.name = parsed.name;
  if (parsed.status) coreUpdate.status = String(parsed.status).toLowerCase();
  if (parsed.clientMember) {
    coreUpdate.member_id = parsed.clientMember;
  } else {
    coreUpdate.member_id = FieldValue.delete();
  }
  if (actorId) coreUpdate.updated_by = actorId;

  await clientRef.set(coreUpdate, { merge: true });

  const budgetId =
    parsed.budgetId && isUuid(parsed.budgetId)
      ? parsed.budgetId
      : await resolveClientBudgetId(db, clientId, null);
  const invoicingId =
    parsed.invoicingId && isUuid(parsed.invoicingId)
      ? parsed.invoicingId
      : await resolveClientInvoicingId(db, clientId, null);

  const budgetDoc = await upsertClientBudget(db, clientId, parsed.budget, budgetId, actorId);
  const invoicingDoc = await upsertClientInvoicing(db, clientId, parsed.invoicing, invoicingId, actorId);
  await syncClientProjects(db, clientId, parsed.projects, actorId);

  const updated = await clientRef.get();
  const projectIds = await loadProjectIdsForClient(db, clientId);
  return mapClientResponse(updated, budgetDoc, invoicingDoc, projectIds);
}

/** Resolves invoicing settings for billing (custom overrides when enabled). */
export async function resolveClientInvoicingSettings(db, clientId) {
  const snap = await db.collection("client_invoicing").where("client_id", "==", clientId).limit(1).get();
  const row = snap.docs[0];
  if (!row) return { source: "global", settings: defaultInvoicing() };
  const mapped = mapInvoicingRow(row);
  return {
    source: mapped.custom ? "client" : mapped.autoInvoicing ? "client-auto" : "global",
    settings: mapped,
    clientId,
  };
}

export { normalizeDoc, defaultInvoicing, LINE_ITEM_OPTIONS };
