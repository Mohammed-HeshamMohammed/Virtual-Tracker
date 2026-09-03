import {
  computeBudgetCap,
  getBudgetPeriodWindow,
  normalizeBudget,
  splitProjectSpendAmongClients,
} from "./budget-logic.js";
import { isPostgresConfigured } from "../../../lib/postgres/client.js";
import { sumBillableHoursForProjectInPeriod as sumBillableHoursPg } from "../../schema/services/postgres-crud.service.js";
import { getProjectBudgetPg, listClientIdsForProjectPg, listProjectIdsForClientPg } from "../../../lib/postgres/projects-postgres.service.js";

function parseEntryDate(value) {

  if (!value) return null;

  if (value instanceof Date) return value;

  if (typeof value?.toDate === "function") return value.toDate();

  const parsed = Date.parse(String(value));

  return Number.isFinite(parsed) ? new Date(parsed) : null;

}



function entryInPeriod(entryDate, period) {

  if (!entryDate) return false;

  if (!period.end) return entryDate >= period.start;

  return entryDate >= period.start && entryDate < period.end;

}



function entryDurationSeconds(row) {

  const duration = row.duration;

  if (typeof duration === "number" && Number.isFinite(duration)) return duration;

  const parsed = Number.parseInt(String(duration ?? ""), 10);

  return Number.isFinite(parsed) ? parsed : 0;

}




export async function sumBillableHoursForProjectInPeriod(db, projectId, period) {
  return sumBillableHoursPg(projectId, period.start, period.end);
}




export function resolveClientSpentAmount(budget, billableHours, scope = {}) {

  if (!budget) return 0;

  const hours = Math.max(0, Number(billableHours) || 0);



  if (budget.type === "hourly") {

    return hours * budget.cost;

  }



  const cap = computeBudgetCap(budget, scope);

  if (cap <= 0) return 0;



  const periodHours =

    budget.resets === "monthly"

      ? 160

      : budget.resets === "quarterly"

        ? 480

        : budget.resets === "yearly"

          ? 1920

          : Math.max(hours, 1);



  return Math.min(cap, (hours / periodHours) * cap);

}



function normalizeProjectBudgetRow(row) {

  if (!row) return null;

  const typeLabel = String(row.type ?? "").toLowerCase();

  let type = "fixed";

  if (typeLabel.includes("amount") || typeLabel.includes("bill") || typeLabel.includes("hour")) {

    type = "hourly";

  }



  return normalizeBudget({

    type,

    basedOn: "per_project",

    cost: Number(row.cost ?? 0),

    notifyAt: 0,

    resets: String(row.resets ?? "never").toLowerCase(),

  });

}




export async function resolveProjectSpendInPeriod(db, projectId, period) {

  const hours = await sumBillableHoursForProjectInPeriod(db, projectId, period);

  const projectBudget = normalizeProjectBudgetRow(await getProjectBudgetPg(projectId));

  if (!projectBudget || projectBudget.cost <= 0) {

    return { hours, spend: 0 };

  }

  const spend = resolveClientSpentAmount(projectBudget, hours, { projectCount: 1 });

  return { hours, spend };

}




export async function countClientsOnProject(db, projectId) {

  const clientIds = await listClientIdsForProjectPg(projectId);

  return Math.max(1, clientIds.length);

}




export async function resolveClientBudgetUsage(db, clientId, budget, options = {}) {

  if (!budget) {

    return { billableHours: 0, spentAmount: 0, projectCount: 0 };

  }



  let projectIds = options.projectIds;

  if (!projectIds) {

    projectIds = (await listProjectIdsForClientPg(clientId)).map((id) => String(id).trim()).filter(Boolean);

  }



  const period = getBudgetPeriodWindow(budget, options.asOf ?? new Date());

  let billableHours = 0;

  let spentAmount = 0;

  const clientCountCache = new Map();



  for (const projectId of projectIds) {

    let clientCount = clientCountCache.get(projectId);

    if (clientCount === undefined) {

      clientCount = await countClientsOnProject(db, projectId);

      clientCountCache.set(projectId, clientCount);

    }



    const { hours, spend } = await resolveProjectSpendInPeriod(db, projectId, period);

    billableHours += hours / clientCount;

    spentAmount += splitProjectSpendAmongClients(spend, clientCount);

  }



  const scope = {

    projectCount: projectIds.length,

    memberCount: options.memberCount ?? 1,

  };



  return {

    billableHours,

    spentAmount,

    projectCount: projectIds.length,

    scope,

  };

}


