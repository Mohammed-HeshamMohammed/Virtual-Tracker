// Postgres-backed CRUD for the clients domain (clients, client_budgets,
// client_invoicing - client_projects already existed pre-migration). See
// project-budget-fixes-plan.md Phase 7+ ("Clients domain migration to
// Postgres"). No dual-write, no backfill - direct cutover from Firestore,
// same as the Projects migration this mirrors.

import crypto from "node:crypto";
import { query } from "./client.js";

function uuidOrNull(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

// ---------------------------------------------------------------------------
// clients
// ---------------------------------------------------------------------------

export async function getClientPg(id) {
  const rows = await query("SELECT * FROM clients WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ?? null;
}

export async function listClientsPg({ limit = 1000 } = {}) {
  return query("SELECT * FROM clients ORDER BY created_at LIMIT $1", [limit]);
}

/** @param {{ memberId?: string|null, name: string, streetAddress?: string, city?: string,
 *   state?: string, zip?: string, country?: string, phoneNumber?: string,
 *   emailAddresses?: string, status?: string, actorId?: string }} data */
export async function createClientPg(data) {
  const id = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO clients (
       id, member_id, name, street_address, city, state, zip, country, phone_number,
       email_addresses, status, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
     RETURNING *`,
    [
      id,
      uuidOrNull(data.memberId),
      data.name,
      data.streetAddress ?? "",
      data.city ?? "",
      data.state ?? "",
      data.zip ?? "",
      data.country ?? "",
      data.phoneNumber ?? "",
      data.emailAddresses ?? "",
      data.status ?? "active",
      uuidOrNull(data.actorId),
    ],
  );
  return rows[0] ?? null;
}

/** @param {string} id @param {Record<string, unknown>} patch */
export async function updateClientPg(id, patch) {
  const columns = {
    memberId: "member_id",
    name: "name",
    streetAddress: "street_address",
    city: "city",
    state: "state",
    zip: "zip",
    country: "country",
    phoneNumber: "phone_number",
    emailAddresses: "email_addresses",
    status: "status",
    updatedBy: "updated_by",
  };
  const sets = [];
  const params = [id];
  for (const [key, column] of Object.entries(columns)) {
    if (!(key in patch)) continue;
    params.push(key === "memberId" || key === "updatedBy" ? uuidOrNull(patch[key]) : patch[key]);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return getClientPg(id);
  sets.push("updated_at = now()");
  const rows = await query(`UPDATE clients SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  return rows[0] ?? null;
}

/** Cascades to client_budgets/client_invoicing/client_projects via their FKs. */
export async function deleteClientPg(id) {
  await query("DELETE FROM clients WHERE id = $1", [id]);
}

// ---------------------------------------------------------------------------
// client_budgets
// ---------------------------------------------------------------------------

export async function getClientBudgetPg(clientId) {
  const rows = await query("SELECT * FROM client_budgets WHERE client_id = $1 LIMIT 1", [clientId]);
  return rows[0] ?? null;
}

export async function getAllClientBudgetsPg() {
  return query("SELECT * FROM client_budgets");
}

export async function deleteClientBudgetPg(clientId) {
  await query("DELETE FROM client_budgets WHERE client_id = $1", [clientId]);
}

/** Create-or-replace, one row per client (unique index on client_id makes
 * the Firestore-era "resolve existing doc id first" step unnecessary). */
export async function upsertClientBudgetPg(clientId, budget, actorId) {
  const rows = await query(
    `INSERT INTO client_budgets (
       id, client_id, type, based_on, cost, notify_at_pct, resets, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     ON CONFLICT (client_id) DO UPDATE SET
       type = EXCLUDED.type, based_on = EXCLUDED.based_on, cost = EXCLUDED.cost,
       notify_at_pct = EXCLUDED.notify_at_pct, resets = EXCLUDED.resets,
       updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [
      crypto.randomUUID(),
      clientId,
      budget.type,
      budget.basedOn,
      budget.cost ?? 0,
      budget.notifyAt ?? null,
      budget.resets ?? "never",
      uuidOrNull(actorId),
    ],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// client_invoicing
// ---------------------------------------------------------------------------

export async function getClientInvoicingPg(clientId) {
  const rows = await query("SELECT * FROM client_invoicing WHERE client_id = $1 LIMIT 1", [clientId]);
  return rows[0] ?? null;
}

/** Create-or-replace, one row per client (same ON CONFLICT simplification as client_budgets). */
export async function upsertClientInvoicingPg(clientId, invoicing, actorId) {
  const rows = await query(
    `INSERT INTO client_invoicing (
       id, client_id, custom_for_client, notes, net_terms_days, tax_rate, auto_invoicing,
       auto_invoice_amount_based_on, auto_fixed_amount, auto_invoice_frequency,
       auto_invoice_delay_days, auto_invoice_reminder_days, auto_invoice_line_items,
       include_non_billable_time, include_expenses, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
     ON CONFLICT (client_id) DO UPDATE SET
       custom_for_client = EXCLUDED.custom_for_client, notes = EXCLUDED.notes,
       net_terms_days = EXCLUDED.net_terms_days, tax_rate = EXCLUDED.tax_rate,
       auto_invoicing = EXCLUDED.auto_invoicing,
       auto_invoice_amount_based_on = EXCLUDED.auto_invoice_amount_based_on,
       auto_fixed_amount = EXCLUDED.auto_fixed_amount,
       auto_invoice_frequency = EXCLUDED.auto_invoice_frequency,
       auto_invoice_delay_days = EXCLUDED.auto_invoice_delay_days,
       auto_invoice_reminder_days = EXCLUDED.auto_invoice_reminder_days,
       auto_invoice_line_items = EXCLUDED.auto_invoice_line_items,
       include_non_billable_time = EXCLUDED.include_non_billable_time,
       include_expenses = EXCLUDED.include_expenses,
       updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [
      crypto.randomUUID(),
      clientId,
      invoicing.custom ?? false,
      invoicing.notes ?? "",
      invoicing.netTerms ?? 30,
      invoicing.taxRate ?? 0,
      invoicing.autoInvoicing ?? false,
      invoicing.autoAmountBasis ?? "hourly",
      invoicing.autoFixedAmount ?? 0,
      invoicing.autoFrequency ?? "monthly",
      invoicing.autoDelaySending ?? 0,
      invoicing.autoReminderDays ?? 7,
      invoicing.autoLineItems ?? "detailed_project_user_date",
      invoicing.autoIncludeNonBillable ?? false,
      invoicing.autoIncludeExpenses ?? false,
      uuidOrNull(actorId),
    ],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// client_automation_state (budget notify threshold + period-key dedupe)
// ---------------------------------------------------------------------------

export async function getClientAutomationStatePg(clientId) {
  const rows = await query(
    "SELECT * FROM client_automation_state WHERE client_id = $1 LIMIT 1",
    [clientId],
  );
  return rows[0] ?? null;
}

/** Partial merge, matching the Firestore-era `.set(payload, { merge: true })`
 * semantics this replaces - only the keys present in `patch` are touched,
 * everything else on the existing row is left alone via COALESCE. */
export async function upsertClientAutomationStatePg(clientId, patch) {
  const rows = await query(
    `INSERT INTO client_automation_state (
       client_id, budget_policy, notify_at_pct, notified_period_key, last_usage_pct, last_sent_at
     ) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (client_id) DO UPDATE SET
       budget_policy = COALESCE(EXCLUDED.budget_policy, client_automation_state.budget_policy),
       notify_at_pct = COALESCE(EXCLUDED.notify_at_pct, client_automation_state.notify_at_pct),
       notified_period_key = COALESCE(EXCLUDED.notified_period_key, client_automation_state.notified_period_key),
       last_usage_pct = COALESCE(EXCLUDED.last_usage_pct, client_automation_state.last_usage_pct),
       last_sent_at = COALESCE(EXCLUDED.last_sent_at, client_automation_state.last_sent_at),
       updated_at = now()
     RETURNING *`,
    [
      clientId,
      patch.budgetPolicy !== undefined ? JSON.stringify(patch.budgetPolicy) : null,
      patch.notifyAtPct ?? null,
      patch.notifiedPeriodKey ?? null,
      patch.lastUsagePct ?? null,
      patch.lastSentAt ?? null,
    ],
  );
  return rows[0] ?? null;
}
