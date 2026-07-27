import { computeClientContributionForProject, normalizeBudget } from "../../clients/services/budget-logic.js";
import {
  listClientIdsForProjectPg,
  listProjectMembersPg,
  upsertProjectBudgetPg,
} from "../../../lib/postgres/projects-postgres.service.js";

function mapClientTypeToProjectType(type) {
  if (type === "hourly") return "Hours based";
  return "Cost based";
}

function mapResetsToProject(resets) {
  const value = String(resets ?? "never").toLowerCase();
  if (value === "monthly") return "Monthly";
  if (value === "quarterly") return "Quarterly";
  if (value === "yearly") return "Yearly";
  return "Never";
}

async function readClientBudget(db, clientId) {
  const snap = await db.collection("client_budgets").where("client_id", "==", clientId).limit(1).get();
  const doc = snap.docs[0];
  if (!doc) return null;
  const row = doc.data() || {};
  return normalizeBudget({
    type: row.type,
    basedOn: row.based_on ?? row.basedOn,
    cost: row.cost,
    notifyAt: row.notify_at_pct ?? row.notifyAt,
    resets: row.resets,
  });
}

async function countProjectMembers(projectId) {
  const rows = await listProjectMembersPg(projectId);
  return Math.max(1, rows.length);
}

/** Sum linked client budget caps for one project. */
export async function aggregateProjectBudgetFromClients(db, projectId) {
  const clientIds = (await listClientIdsForProjectPg(projectId)).map((id) => String(id).trim()).filter(Boolean);

  if (clientIds.length === 0) {
    return { totalCost: 0, primaryBudget: null, clientCount: 0 };
  }

  const memberCount = await countProjectMembers(projectId);
  let totalCost = 0;
  let primaryBudget = null;

  for (const clientId of clientIds) {
    const budget = await readClientBudget(db, clientId);
    if (!budget) continue;
    if (!primaryBudget) primaryBudget = budget;
    totalCost += computeClientContributionForProject(budget, { memberCount });
  }

  return {
    totalCost,
    primaryBudget,
    clientCount: clientIds.length,
  };
}

/** Upsert project_budgets cost from linked client budgets. */
export async function syncProjectBudgetFromClients(db, projectId) {
  if (!projectId) return { skipped: "missing_project" };

  const { totalCost, primaryBudget } = await aggregateProjectBudgetFromClients(db, projectId);
  if (!primaryBudget || totalCost <= 0) return { skipped: "no_client_budgets" };

  const row = await upsertProjectBudgetPg(projectId, {
    type: mapClientTypeToProjectType(primaryBudget.type),
    basedOn: "Bill rate",
    cost: totalCost,
    resets: mapResetsToProject(primaryBudget.resets),
    stopTimersWhenReached: true,
    notifyProjectMembers: false,
    includeNonBillableTime: true,
  });
  return { updated: true, totalCost, budgetId: row?.id };
}
