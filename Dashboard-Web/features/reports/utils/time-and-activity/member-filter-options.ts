import { ALL_MEMBERS_VALUE, ALL_PROJECTS_VALUE } from "@/features/reports/components/shared/constants"
import type { TimeActivityMemberSubRow } from "@/features/reports/models/time-and-activity"

export function getMemberFilterOptions(
  memberRows: Record<string, TimeActivityMemberSubRow[]>
): { value: string; label: string }[] {
  const names = Array.from(new Set(Object.values(memberRows).flatMap((rows) => rows.map((r) => r.name)))).sort()
  return [{ value: ALL_MEMBERS_VALUE, label: "All members" }, ...names.map((name) => ({ value: name, label: name }))]
}

export function getProjectFilterOptions(
  memberRows: Record<string, TimeActivityMemberSubRow[]>
): { value: string; label: string }[] {
  const names = Array.from(
    new Set(Object.values(memberRows).flatMap((rows) => rows.flatMap((r) => r.projectNames)))
  ).sort()
  return [{ value: ALL_PROJECTS_VALUE, label: "All projects" }, ...names.map((name) => ({ value: name, label: name }))]
}
