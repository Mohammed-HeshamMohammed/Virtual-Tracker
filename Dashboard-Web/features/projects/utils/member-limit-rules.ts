/**
 * A member limit only tightens a project's own budget, so it has to be
 * denominated the same way that budget is - an hours-based project budget
 * cannot be capped in dollars, and a cost-based one has to use the same rate
 * the budget itself is computed from. Both therefore derive from the
 * project's Budget Limits tab rather than being picked per member.
 *
 * Pure, framework-free helpers so both the per-project Members Limits editor
 * (a "use client" component) and the batch-apply API function can share one
 * derivation without the API layer importing a component module.
 */

/** "Hours limit" is denominated in time; the other two are money. The backend
 * converts them differently, so the field must not label an hours cap with a "$". */
export function isHoursLimit(type: string): boolean {
  return type.toLowerCase().includes("hour")
}

export function derivedLimitType(budgetType: string): string {
  return budgetType === "Hours based" ? "Hours limit" : "Total cost"
}

/** Cost-based budgets carry a rate; Hours based clears it. Falling back to
 * Bill rate keeps a cost row saveable if the budget somehow has none. */
export function derivedBasedOn(budgetType: string, budgetBasedOn: string): string {
  if (budgetType === "Hours based") return "Bill rate"
  return budgetBasedOn.trim() || "Bill rate"
}
