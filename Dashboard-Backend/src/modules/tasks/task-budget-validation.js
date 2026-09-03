import { estimateAssignmentSeconds } from "./task-schedule-math.js";
import {
  getProjectBudgetPg,
  resolveMemberHourlyRatePg,
} from "../../lib/postgres/projects-postgres.service.js";
import { listTasksPg } from "../../lib/postgres/tasks-postgres.service.js";
import { getTaskAssignmentsPg } from "../../lib/postgres/task-assignments-postgres.service.js";
import { buildMemberMetaMap } from "../activity/activity-scope.js";

async function resolveRates(db, projectId, memberIds, basedOn, cache) {
  const rates = [];
  for (const memberId of memberIds) {
    if (!cache.has(memberId)) {
      cache.set(memberId, await resolveMemberHourlyRatePg(db, projectId, memberId, basedOn));
    }
    rates.push(cache.get(memberId));
  }
  return rates;
}

function avg(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * Every other task's own committed hours in this project, once each - a
 * task's estimateAssignmentSeconds is already a single total regardless of
 * how many people are assigned to it (see shared_task_budget's own doc
 * comment on task-time-tracking.js: the estimate is one number every
 * assignee either shares or each gets independently, it was never
 * multiplied by assignee count to begin with). Excludes the task being
 * saved so its own new estimate isn't counted twice. When pricing (basedOn
 * set), each other task is costed at the average of its own assignees'
 * rates, and a task nobody is on yet contributes 0 - it commits nothing
 * real until someone actually has hours against it.
 */
// ponytail: one getTaskAssignmentsPg call per hour-bearing task when pricing
// (basedOn set) - fine at real project sizes (dozens of tasks), would need
// batching into a single query if a project ever runs into the thousands.
async function sumOtherTasks(db, projectId, excludeTaskId, basedOn, rateCache) {
  const rows = await listTasksPg({ projectId, limit: 5000 });
  let totalHours = 0;
  let totalCost = 0;
  for (const row of rows) {
    if (row.id === excludeTaskId) continue;
    const hours = (estimateAssignmentSeconds(row) ?? 0) / 3600;
    if (hours <= 0) continue;
    totalHours += hours;
    if (!basedOn) continue;
    const assignments = await getTaskAssignmentsPg(row.id).catch(() => []);
    const assigneeIds = assignments.map((a) => a.memberId ?? a.member_id).filter(Boolean);
    if (!assigneeIds.length) continue;
    const rates = await resolveRates(db, projectId, assigneeIds, basedOn, rateCache);
    totalCost += hours * avg(rates);
  }
  return { totalHours, totalCost };
}

/**
 * Holds a task's own committed time to the project's own budget, once the
 * task actually has assignees to cost out (a bare estimate with nobody on
 * it yet doesn't commit anything real). Runs from syncTaskAssignments,
 * alongside validateAssigneeWorkLimits - same tier, same "throw with a
 * clear message, caller returns 400" contract.
 *
 * per_person-scoped budgets are left alone here - computeMemberTimerAllowance
 * already enforces those live, per member, as time is actually tracked;
 * this check is specifically about the project-wide (per_project) total,
 * which nothing else currently checks at task-save time.
 */
export async function assertTaskWithinProjectBudget(db, { projectId, taskId, taskDraft, assigneeIds }) {
  if (!projectId) return;
  const budget = await getProjectBudgetPg(projectId);
  if (!budget || budget.scope === "per_person") return;

  const thisTaskHours = (estimateAssignmentSeconds(taskDraft) ?? 0) / 3600;
  if (thisTaskHours <= 0 || !assigneeIds?.length) return;

  if (String(budget.type) === "Hours based") {
    const capHours = Number(budget.cost ?? 0);
    if (capHours <= 0) return;
    const { totalHours: otherHours } = await sumOtherTasks(db, projectId, taskId, null, new Map());
    const totalHours = otherHours + thisTaskHours;
    if (totalHours > capHours) {
      const over = Math.round((totalHours - capHours) * 100) / 100;
      throw new Error(
        `This task would put the project's committed hours at ${Math.round(totalHours * 100) / 100}h, ` +
          `${over}h over its ${capHours}h budget.`,
      );
    }
    return;
  }

  // Cost based - every assignee needs a resolvable rate before their hours
  // can be priced at all. Only "Pay rate" is actually per-member (see
  // resolveMemberHourlyRatePg) - a "Bill rate" budget prices off the
  // project's linked client instead, so there's nothing per-assignee to
  // require there.
  const rateCache = new Map();
  const basedOnIsPay = String(budget.based_on || "").toLowerCase().includes("pay");
  if (basedOnIsPay) {
    const rates = await resolveRates(db, projectId, assigneeIds, budget.based_on, rateCache);
    const missingIds = assigneeIds.filter((_, i) => !(rates[i] > 0));
    if (missingIds.length > 0) {
      const nameMap = await buildMemberMetaMap(db, missingIds);
      const labels = missingIds.map((id) => nameMap.get(id)?.name ?? id);
      throw new Error(
        `Set an hourly pay rate for ${labels.join(", ")} before assigning them hours on this cost-budget project - ` +
          `there's no rate to price their time against otherwise.`,
      );
    }
  }

  const capCost = Number(budget.cost ?? 0);
  if (capCost <= 0) return;
  const thisTaskRates = await resolveRates(db, projectId, assigneeIds, budget.based_on, rateCache);
  const thisTaskCost = thisTaskHours * avg(thisTaskRates);
  const { totalCost: otherCost } = await sumOtherTasks(db, projectId, taskId, budget.based_on, rateCache);
  const totalCost = otherCost + thisTaskCost;
  if (totalCost > capCost) {
    const over = Math.round((totalCost - capCost) * 100) / 100;
    throw new Error(
      `This task would put the project's committed cost at $${Math.round(totalCost * 100) / 100}, ` +
        `$${over} over its $${capCost} budget.`,
    );
  }
}
