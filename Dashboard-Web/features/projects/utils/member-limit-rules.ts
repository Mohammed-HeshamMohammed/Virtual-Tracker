
export function isHoursLimit(type: string): boolean {
  return type.toLowerCase().includes("hour")
}

export function derivedLimitType(budgetType: string): string {
  return budgetType === "Hours based" ? "Hours limit" : "Total cost"
}

export function derivedBasedOn(budgetType: string, budgetBasedOn: string): string {
  if (budgetType === "Hours based") return "Bill rate"
  return budgetBasedOn.trim() || "Bill rate"
}
