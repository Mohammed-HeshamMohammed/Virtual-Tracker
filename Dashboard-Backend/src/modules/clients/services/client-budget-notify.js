import { createNotification } from "../../notifications/service.js";
import { resolveMemberRoleName } from "../../activity/activity-scope.js";
import {
  buildBudgetPolicy,
  evaluateBudgetUsage,
  getBudgetPeriodKey,
  normalizeBudget,
} from "./budget-logic.js";
import { resolveClientBudgetUsage } from "./client-budget-usage.js";

const AUTOMATION_COLLECTION = "client_automation_state";
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
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} clientId
 * @param {ReturnType<typeof normalizeBudget>|null} budget
 */
export async function syncClientBudgetAutomationState(db, clientId, budget) {
  const normalized = normalizeBudget(budget);
  const ref = db.collection(AUTOMATION_COLLECTION).doc(clientId);
  const existing = await ref.get();
  const prevNotify = existing.exists ? existing.data()?.budget_notify ?? {} : {};

  const payload = {
    client_id: clientId,
    budget_policy: buildBudgetPolicy(normalized),
    budget_notify: {
      ...prevNotify,
      notify_at_pct: normalized?.notifyAt ?? 0,
      updated_at: new Date(),
    },
    updated_at: new Date(),
  };

  if (!normalized) {
    payload.budget_policy = buildBudgetPolicy(null);
  }

  await ref.set(payload, { merge: true });
}

async function loadManagementMemberIds(db) {
  const rolesSnap = await db.collection("roles").limit(100).get();
  const managementRoleIds = new Set();
  for (const doc of rolesSnap.docs) {
    const roleKey = normalizeRole(doc.data()?.name);
    if (MANAGEMENT_ROLES.has(roleKey)) managementRoleIds.add(doc.id);
  }

  if (managementRoleIds.size === 0) return [];

  const membersSnap = await db.collection("members").limit(500).get();
  return membersSnap.docs
    .filter((doc) => managementRoleIds.has(String(doc.data()?.role_id ?? "")))
    .map((doc) => doc.id);
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

  const linksSnap = await db.collection("client_projects").where("client_id", "==", clientId).limit(50).get();
  for (const link of linksSnap.docs) {
    const projectId = String(link.data()?.project_id ?? link.data()?.projectId ?? "").trim();
    if (!projectId) continue;
    const membersSnap = await db
      .collection("project_members")
      .where("project_id", "==", projectId)
      .limit(50)
      .get();
    for (const memberDoc of membersSnap.docs) {
      const memberId = String(memberDoc.data()?.member_id ?? memberDoc.data()?.memberId ?? "").trim();
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

  const prev = state?.budget_notify ?? {};
  if (prev.notified_period_key === periodKey) return false;
  return true;
}

async function markBudgetNotificationSent(db, clientId, periodKey, notifyAtPct, usagePct) {
  await db.collection(AUTOMATION_COLLECTION).doc(clientId).set(
    {
      client_id: clientId,
      budget_notify: {
        notified_period_key: periodKey,
        notify_at_pct: notifyAtPct,
        last_usage_pct: usagePct,
        last_sent_at: new Date(),
      },
      updated_at: new Date(),
    },
    { merge: true },
  );
}

/**
 * Evaluate client budget usage and emit in-app notifications when the notify threshold is crossed.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} clientId
 * @param {{ asOf?: Date }} [options]
 */
export async function evaluateAndNotifyClientBudget(db, clientId, options = {}) {
  const clientDoc = await db.collection("clients").doc(clientId).get();
  if (!clientDoc.exists) return { skipped: "client_not_found" };

  const budgetsSnap = await db.collection("client_budgets").where("client_id", "==", clientId).limit(1).get();
  const budget = readBudgetFromDoc(budgetsSnap.docs[0] ?? null);
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
  const stateSnap = await db.collection(AUTOMATION_COLLECTION).doc(clientId).get();
  const state = stateSnap.exists ? stateSnap.data() : null;

  if (!shouldSendBudgetNotification(state, periodKey, budget.notifyAt, evaluation.usagePct)) {
    return { skipped: "already_notified", evaluation };
  }

  const clientName = String(clientDoc.data()?.name ?? "Client").trim() || "Client";
  const recipients = await resolveClientBudgetNotifyRecipients(db, clientId, clientDoc.data());
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

  await markBudgetNotificationSent(db, clientId, periodKey, budget.notifyAt, evaluation.usagePct);
  return { sent: recipients.length, evaluation };
}

/**
 * When billable time changes on a project, check all linked client budgets.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} projectId
 */
export async function maybeNotifyClientBudgetsForProject(db, projectId) {
  if (!projectId) return [];

  const linksSnap = await db.collection("client_projects").where("project_id", "==", projectId).limit(20).get();
  const results = [];
  for (const link of linksSnap.docs) {
    const clientId = String(link.data()?.client_id ?? link.data()?.clientId ?? "").trim();
    if (!clientId) continue;
    results.push(await evaluateAndNotifyClientBudget(db, clientId));
  }
  return results;
}
