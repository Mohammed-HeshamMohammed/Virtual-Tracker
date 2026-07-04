// Client budget tab rules (save + spend-vs-cap checks).

/** @typedef {"hourly"|"fixed"|"retainer"|"none"} BudgetType */
/** @typedef {"per_person"|"per_project"|"total"} BudgetBasedOn */
/** @typedef {"monthly"|"quarterly"|"yearly"|"never"} BudgetResets */

/**
 * @param {Record<string, unknown>|null|undefined} budget
 */
export function normalizeBudget(budget) {
  if (!budget || String(budget.type ?? "none").toLowerCase() === "none") {
    return null;
  }
  return {
    type: String(budget.type ?? "none").toLowerCase(),
    basedOn: String(budget.basedOn ?? budget.based_on ?? "per_project").toLowerCase(),
    cost: Math.max(0, Number(budget.cost ?? 0)),
    notifyAt: Math.min(100, Math.max(0, Number(budget.notifyAt ?? budget.notify_at_pct ?? 80))),
    resets: String(budget.resets ?? "monthly").toLowerCase(),
  };
}

/**
 * Budget policy snapshot stored on client_automation_state for future triggers.
 * @param {ReturnType<typeof normalizeBudget>} budget
 */
export function buildBudgetPolicy(budget) {
  if (!budget) {
    return {
      enabled: false,
      triggers: [],
      rules: {},
    };
  }

  return {
    enabled: true,
    type: budget.type,
    basedOn: budget.basedOn,
    cost: budget.cost,
    notifyAtPct: budget.notifyAt,
    resets: budget.resets,
    triggers: [
      {
        key: "budget.notify_threshold",
        label: "Notify when spend reaches threshold % of cap",
        condition: `usage_pct >= ${budget.notifyAt}`,
        activations: ["notify_managers", "audit_log"],
      },
      {
        key: "budget.period_reset",
        label: "Reset tracked spend at period boundary",
        condition: `period_end reached (resets=${budget.resets})`,
        activations: ["reset_period_spend"],
      },
    ],
    rules: {
      capFormula:
        budget.basedOn === "per_person"
          ? "cost * active_member_count"
          : budget.basedOn === "per_project"
            ? "cost * linked_project_count"
            : "cost",
      unitLabel: budget.type === "hourly" ? "per_hour" : budget.type === "retainer" ? "retainer" : "fixed",
    },
  };
}

/**
 * @param {ReturnType<typeof normalizeBudget>} budget
 * @param {{ projectCount?: number; memberCount?: number }} scope
 */
export function computeBudgetCap(budget, scope = {}) {
  if (!budget) return 0;
  const cost = budget.cost;
  if (budget.basedOn === "per_person") {
    return cost * Math.max(1, Number(scope.memberCount ?? 1));
  }
  if (budget.basedOn === "per_project") {
    return cost * Math.max(1, Number(scope.projectCount ?? 1));
  }
  return cost;
}

/** One client's budget slice when assigned to a single project (stacking). */
export function computeClientContributionForProject(budget, scope = {}) {
  if (!budget) return 0;
  if (budget.basedOn === "per_person") {
    return budget.cost * Math.max(1, Number(scope.memberCount ?? 1));
  }
  return budget.cost;
}

/** Evenly split project spend across N linked clients. */
export function splitProjectSpendAmongClients(projectSpend, clientCount) {
  const count = Math.max(1, Number(clientCount) || 1);
  const total = Math.max(0, Number(projectSpend) || 0);
  return total / count;
}

/**
 * Current budget period [start, end) from resets.
 * @param {ReturnType<typeof normalizeBudget>} budget
 * @param {Date} [asOf]
 */
export function getBudgetPeriodWindow(budget, asOf = new Date()) {
  if (!budget || budget.resets === "never") {
    return { start: asOf, end: null, label: "all_time" };
  }

  const y = asOf.getFullYear();
  const m = asOf.getMonth();

  if (budget.resets === "monthly") {
    return {
      start: new Date(y, m, 1),
      end: new Date(y, m + 1, 1),
      label: "monthly",
    };
  }
  if (budget.resets === "quarterly") {
    const qStartMonth = Math.floor(m / 3) * 3;
    return {
      start: new Date(y, qStartMonth, 1),
      end: new Date(y, qStartMonth + 3, 1),
      label: "quarterly",
    };
  }
  if (budget.resets === "yearly") {
    return {
      start: new Date(y, 0, 1),
      end: new Date(y + 1, 0, 1),
      label: "yearly",
    };
  }

  return { start: new Date(y, m, 1), end: null, label: budget.resets };
}

/** Stable key for deduplicating budget notifications within a reset period. */
export function getBudgetPeriodKey(budget, asOf = new Date()) {
  const period = getBudgetPeriodWindow(budget, asOf);
  if (period.label === "all_time") return "all_time";
  const d = period.start;
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${period.label}:${d.getFullYear()}-${month}`;
}

/**
 * Evaluate budget usage vs policy (for timers, timesheets, project dashboards).
 * @param {ReturnType<typeof normalizeBudget>} budget
 * @param {{ spentAmount?: number; projectCount?: number; memberCount?: number; asOf?: Date }} context
 */
export function evaluateBudgetUsage(budget, context = {}) {
  if (!budget) {
    return {
      enabled: false,
      cap: 0,
      spent: 0,
      usagePct: 0,
      notifyThresholdPct: 0,
      shouldNotify: false,
      period: null,
      activeTriggers: [],
    };
  }

  const spent = Math.max(0, Number(context.spentAmount ?? 0));
  const cap = computeBudgetCap(budget, {
    projectCount: context.projectCount,
    memberCount: context.memberCount,
  });
  const usagePct = cap > 0 ? Math.round((spent / cap) * 10000) / 100 : 0;
  const period = getBudgetPeriodWindow(budget, context.asOf ?? new Date());
  const shouldNotify = usagePct >= budget.notifyAt;

  const activeTriggers = [];
  if (shouldNotify) {
    activeTriggers.push({
      key: "budget.notify_threshold",
      met: true,
      payload: { usagePct, cap, spent, notifyAtPct: budget.notifyAt },
    });
  }

  return {
    enabled: true,
    type: budget.type,
    basedOn: budget.basedOn,
    cap,
    spent,
    usagePct,
    notifyThresholdPct: budget.notifyAt,
    shouldNotify,
    period,
    activeTriggers,
  };
}
