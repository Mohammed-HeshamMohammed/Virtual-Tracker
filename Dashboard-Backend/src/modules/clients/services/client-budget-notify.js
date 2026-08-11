import { createNotification } from "../../notifications/service.js";
import { resolveMemberRoleName } from "../../activity/activity-scope.js";
import { resolveRoleIdsWhere } from "../../members/services/relation-sync.js";
import {
  buildBudgetPolicy,
  evaluateBudgetUsage,
  getBudgetPeriodKey,
  normalizeBudget,
} from "./budget-logic.js";
import { resolveClientBudgetUsage } from "./client-budget-usage.js";
import { listClientIdsForProjectPg, listProjectIdsForClientPg, listProjectMembersPg } from "../../../lib/postgres/projects-postgres.service.js";
import {
  getClientPg,
  getClientBudgetPg,
  getClientAutomationStatePg,
  upsertClientAutomationStatePg,
} from "../../../lib/postgres/clients-postgres.service.js";
import { listMembersPg } from "../../../lib/postgres/members-postgres.service.js";

const NOTIFY_TYPE = "client_budget_threshold";
const MANAGEMENT_ROLES = new Set([
  "owner",
  "superadmin",
  "admin",
  "supermanager",
  "supermanger",
  "manager",
]);

function readBudgetFromDoc(doc) {
  if (!doc) return null;
  const row = doc.data ? doc.data() : doc;
  return normalizeBudget({
    type: row.type,
    basedOn: row.based_on ?? row.basedOn,
    cost: row.cost,
    notifyAt: row.notify_at_pct ?? row.notifyAtPct,
    resets: row.resets,
  });
}

function normalizeRole(roleName) {
  return String(roleName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function formatMoney(amount) {
  const value = Math.max(0, Number(amount) || 0);
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${Math.round(value)}`;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db unused, kept for call-site compatibility
 * @param {string} clientId
 * @param {ReturnType<typeof normalizeBudget>|null} budget
 */
export async function syncClientBudgetAutomationState(_db, clientId, budget) {
  const normalized = normalizeBudget(budget);
  // notified_period_key/last_usage_pct/last_sent_at are deliberately not
  // passed here - upsertClientAutomationStatePg's COALESCE leaves them at
  // whatever markBudgetNotificationSent below last set, this call only
  // touches the policy snapshot and threshold.
  await upsertClientAutomationStatePg(clientId, {
    budgetPolicy: buildBudgetPolicy(normalized),
    notifyAtPct: normalized?.notifyAt ?? 0,
  });
}

async function loadManagementMemberIds(db) {
  const managementRoleIds = new Set(
    await resolveRoleIdsWhere((name) => MANAGEMENT_ROLES.has(normalizeRole(name))),
  );

  if (managementRoleIds.size === 0) return [];

  const members = await listMembersPg({ limit: 500 });
  return members
    .filter((data) => managementRoleIds.has(String(data.role_id ?? "")))
    .map((data) => data.id);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} clientId
 * @param {Record<string, unknown>} [clientRow]
 */
export async function resolveClientBudgetNotifyRecipients(db, clientId, clientRow) {
  const recipients = new Set(await loadManagementMemberIds(db));

  const linkedMemberId = String(clientRow?.member_id ?? clientRow?.memberId ?? "").trim();
  if (linkedMemberId) recipients.add(linkedMemberId);

  const projectIds = (await listProjectIdsForClientPg(clientId)).map((id) => String(id).trim()).filter(Boolean);
  for (const projectId of projectIds) {
    const memberRows = await listProjectMembersPg(projectId);
    for (const row of memberRows) {
      const memberId = String(row.member_id ?? "").trim();
      if (!memberId) continue;
      const roleName = await resolveMemberRoleName(db, memberId);
      if (MANAGEMENT_ROLES.has(normalizeRole(roleName))) recipients.add(memberId);
    }
  }

  recipients.delete("");
  return [...recipients];
}

function shouldSendBudgetNotification(state, periodKey, notifyAtPct, usagePct) {
  if (notifyAtPct <= 0 || notifyAtPct > 100) return false;
  if (usagePct < notifyAtPct) return false;
  if (state?.notified_period_key === periodKey) return false;
  return true;
}

async function markBudgetNotificationSent(clientId, periodKey, notifyAtPct, usagePct) {
  await upsertClientAutomationStatePg(clientId, {
    notifiedPeriodKey: periodKey,
    notifyAtPct,
    lastUsagePct: usagePct,
    lastSentAt: new Date(),
  });
}

/** Notify when client budget crosses threshold. */
export async function evaluateAndNotifyClientBudget(db, clientId, options = {}) {
  const client = await getClientPg(clientId);
  if (!client) return { skipped: "client_not_found" };

  const budgetRow = await getClientBudgetPg(clientId);
  const budget = readBudgetFromDoc(budgetRow);
  if (!budget || budget.notifyAt <= 0) return { skipped: "no_budget_policy" };

  const asOf = options.asOf ?? new Date();
  const usage = await resolveClientBudgetUsage(db, clientId, budget, { asOf });
  const evaluation = evaluateBudgetUsage(budget, {
    spentAmount: usage.spentAmount,
    projectCount: usage.scope.projectCount,
    memberCount: usage.scope.memberCount,
    asOf,
  });

  if (!evaluation.shouldNotify) return { skipped: "below_threshold", evaluation };

  const periodKey = getBudgetPeriodKey(budget, asOf);
  const state = await getClientAutomationStatePg(clientId);

  if (!shouldSendBudgetNotification(state, periodKey, budget.notifyAt, evaluation.usagePct)) {
    return { skipped: "already_notified", evaluation };
  }

  const clientName = String(client.name ?? "Client").trim() || "Client";
  const recipients = await resolveClientBudgetNotifyRecipients(db, clientId, client);
  if (recipients.length === 0) return { skipped: "no_recipients", evaluation };

  const title = "Client budget threshold reached";
  const message = `${clientName} is at ${evaluation.usagePct}% of the budget (${formatMoney(evaluation.spent)} of ${formatMoney(evaluation.cap)}). Notify threshold: ${budget.notifyAt}%.`;

  for (const recipientId of recipients) {
    await createNotification(db, {
      recipient_id: recipientId,
      type: NOTIFY_TYPE,
      title,
      message,
      link: "/?page=pm-clients",
    });
  }

  await markBudgetNotificationSent(clientId, periodKey, budget.notifyAt, evaluation.usagePct);
  return { sent: recipients.length, evaluation };
}

/** Check linked client budgets after billable time changes on a project. */
export async function maybeNotifyClientBudgetsForProject(db, projectId) {
  if (!projectId) return [];

  const clientIds = (await listClientIdsForProjectPg(projectId)).map((id) => String(id).trim()).filter(Boolean);
  const results = [];
  for (const clientId of clientIds) {
    results.push(await evaluateAndNotifyClientBudget(db, clientId));
  }
  return results;
}
