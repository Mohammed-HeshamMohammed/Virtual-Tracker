import { CUSTOM_FILTER_FIELDS, CUSTOM_FILTER_OPERATORS } from "@/features/reports/components/shared/constants"
import type { TimeActivityCustomFilterRow } from "@/features/reports/models/time-and-activity"

export function newTimeActivityCustomFilterRow(): TimeActivityCustomFilterRow {
  return {
    id: `cf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    field: CUSTOM_FILTER_FIELDS[0] ?? "Activity %",
    operator: CUSTOM_FILTER_OPERATORS[0] ?? "is",
    value: "",
  }
}
