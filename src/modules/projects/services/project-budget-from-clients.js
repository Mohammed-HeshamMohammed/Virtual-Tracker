import { generateUUID, now } from "../../schema/catalog/index.js";
import { computeClientContributionForProject, normalizeBudget } from "../../clients/services/budget-logic.js";

function mapClientTypeToProjectType(type) {
  if (type === "hourly") return "Amount limit";
  return "Total cost";
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

async function countProjectMembers(db, projectId) {
  const snap = await db.collection("project_members").where("project_id", "==", projectId).limit(500).get();
  return Math.max(1, snap.size);
}

/**
 * Sum linked client budget caps for a single project.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} projectId
 */
export async function aggregateProjectBudgetFromClients(db, projectId) {
  const linksSnap = await db.collection("client_projects").where("project_id", "==", projectId).limit(50).get();
  const clientIds = linksSnap.docs
    .map((doc) => String(doc.data()?.client_id ?? doc.data()?.clientId ?? "").trim())
    .filter(Boolean);

  if (clientIds.length === 0) {
    return { totalCost: 0, primaryBudget: null, clientCount: 0 };
  }

  const memberCount = await countProjectMembers(db, projectId);
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

/**
 * Upsert project budget cost (and baseline fields) from linked clients.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} projectId
 */
export async function syncProjectBudgetFromClients(db, projectId) {
  if (!projectId) return { skipped: "missing_project" };

  const { totalCost, primaryBudget } = await aggregateProjectBudgetFromClients(db, projectId);
  if (!primaryBudget || totalCost <= 0) return { skipped: "no_client_budgets" };

  const budgetsSnap = await db.collection("project_budgets").where("project_id", "==", projectId).limit(1).get();
  const payload = {
    type: mapClientTypeToProjectType(primaryBudget.type),
    based_on: "Bill rate",
    cost: totalCost,
    resets: mapResetsToProject(primaryBudget.resets),
    stop_timers_when_reached: true,
    updated_at: now(),
  };

  if (budgetsSnap.empty) {
    const id = generateUUID();
    await db.collection("project_budgets").doc(id).set({
      id,
      project_id: projectId,
      ...payload,
      notify_project_members: false,
      include_non_billable_time: true,
      created_at: now(),
    });
    return { created: true, totalCost };
  }

  const doc = budgetsSnap.docs[0];
  await doc.ref.update(payload);
  return { updated: true, totalCost, budgetId: doc.id };
}
