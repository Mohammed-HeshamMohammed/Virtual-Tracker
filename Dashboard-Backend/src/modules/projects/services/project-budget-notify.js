// Notify project members/managers when project budget spend crosses the
// notify threshold. Mirrors clients/services/client-budget-notify.js's
// threshold + period-key dedupe shape, adapted to project_budgets' own field
// names, units (hours vs cost), and reset vocabulary ('Never'|'Weekly'|
// 'Monthly', not the client-budget 'monthly'|'quarterly'|'yearly'|'never').
//
// Unlike client budgets (still Firestore, see client_automation_state),
// project_budgets already lives in Postgres, so the dedupe state does too -
// see project_budget_notify_state in ensure-lookup-schema.js.

import { query } from "../../../lib/postgres/client.js";
import { createNotification } from "../../notifications/service.js";
import { resolveMemberRoleName } from "../../activity/activity-scope.js";
import { listProjectMembersPg } from "../../../lib/postgres/projects-postgres.service.js";

const NOTIFY_TYPE = "project_budget_threshold";
const MANAGEMENT_ROLES = new Set(["owner", "superadmin", "admin", "supermanager", "supermanger", "manager"]);

function normalizeRole(roleName) {
  return String(roleName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function formatAmount(amount, unit) {
  const value = Math.max(0, Number(amount) || 0);
  if (unit === "hours") return Number.isInteger(value) ? `${value}h` : `${value.toFixed(1)}h`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${Math.round(value)}`;
}

function periodKeyFor(resets, asOf) {
  const value = String(resets || "Never");
  if (value === "Never") return "all_time";
  if (value === "Weekly") {
    const weekStart = new Date(asOf);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    return `weekly:${weekStart.toISOString().slice(0, 10)}`;
  }
  return `monthly:${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, "0")}`;
}

async function loadNotifyState(projectId) {
  const rows = await query(
    "SELECT * FROM project_budget_notify_state WHERE project_id = $1 LIMIT 1",
    [projectId],
  );
  return rows[0] ?? null;
}

async function markNotified(projectId, periodKey, notifyAtPct, usagePct) {
  await query(
    `INSERT INTO project_budget_notify_state (project_id, notified_period_key, notify_at_pct, last_usage_pct, last_sent_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (project_id) DO UPDATE SET
       notified_period_key = EXCLUDED.notified_period_key,
       notify_at_pct = EXCLUDED.notify_at_pct,
       last_usage_pct = EXCLUDED.last_usage_pct,
       last_sent_at = now()`,
    [projectId, periodKey, notifyAtPct, usagePct],
  );
}

/**
 * "Org management" -> project's own managers/admins; "All members" -> every
 * member on the project. Matches the two options the BUDGET tab's "Who to
 * notify" select actually offers (project-modal.tsx).
 * @param {import("firebase-admin/firestore").Firestore} db
 */
async function resolveRecipients(db, projectId, whoToNotify) {
  const memberRows = await listProjectMembersPg(projectId);
  const wantsAllMembers = String(whoToNotify || "").toLowerCase() === "all members";
  const recipients = new Set();
  for (const row of memberRows) {
    const memberId = String(row.member_id ?? "").trim();
    if (!memberId) continue;
    if (wantsAllMembers) {
      recipients.add(memberId);
      continue;
    }
    const roleName = await resolveMemberRoleName(db, memberId);
    if (MANAGEMENT_ROLES.has(normalizeRole(roleName))) recipients.add(memberId);
  }
  return [...recipients];
}

/**
 * Called from the timer start/resume path (activity/routes.js) right after
 * computing spend AND the live cap for the stop-timer gate - same two reads,
 * shared here instead of recomputed. Never throws into the caller; timer
 * start/stop must not fail because a notification failed to send.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} projectId
 * @param {Record<string, unknown>} budget project_budgets row
 * @param {number} spent
 * @param {number} cap live budget total - for scope='per_person' this is
 *   NOT `budget.cost` (that's hours-per-member), it's the caller's already-
 *   computed computeProjectBudgetTargetPg result.
 */
export async function maybeNotifyProjectBudget(db, projectId, budget, spent, cap) {
  if (!budget?.notify_project_members) return { skipped: "notify_disabled" };
  const notifyAtPct = Number(budget.notify_at_pct);
  if (!(notifyAtPct > 0) || notifyAtPct > 100) return { skipped: "no_threshold" };

  const usagePct = cap > 0 ? Math.round((spent / cap) * 10000) / 100 : 0;
  if (usagePct < notifyAtPct) return { skipped: "below_threshold" };

  const asOf = new Date();
  const periodKey = periodKeyFor(budget.resets, asOf);
  const state = await loadNotifyState(projectId);
  if (state?.notified_period_key === periodKey) return { skipped: "already_notified" };

  const recipients = await resolveRecipients(db, projectId, budget.who_to_notify);
  if (recipients.length === 0) return { skipped: "no_recipients" };

  const unit = String(budget.type) === "Hours based" ? "hours" : "cost";
  const title = "Project budget threshold reached";
  const message = `Spend is at ${usagePct}% of budget (${formatAmount(spent, unit)} of ${formatAmount(cap, unit)}). Notify threshold: ${notifyAtPct}%.`;

  for (const recipientId of recipients) {
    await createNotification(db, {
      recipient_id: recipientId,
      type: NOTIFY_TYPE,
      title,
      message,
      link: "/?page=pm-projects",
    });
  }

  await markNotified(projectId, periodKey, notifyAtPct, usagePct);
  return { sent: recipients.length };
}
