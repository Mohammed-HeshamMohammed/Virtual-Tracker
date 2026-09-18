import { ALL_MEMBERS_VALUE, ALL_PROJECTS_VALUE } from "@/features/reports/components/shared/constants"
import { initialsFromName } from "@/features/members/utils/build-tree"
import type { TimeActivityMemberSubRow } from "@/features/reports/models/time-and-activity"

export type MemberFilterOption = { value: string; label: string; avatar: string; avatarUrl?: string | null }

export function getMemberFilterOptions(
  memberRows: Record<string, TimeActivityMemberSubRow[]>,
  rosterNames: string[] = [],
  currentMemberName = "",
): MemberFilterOption[] {
  // First sighting per name wins - the avatar doesn't change day to day, and
  // a roster name with no activity in range has no row to pull one from at
  // all, so it falls back to plain initials like everywhere else does.
  const byName = new Map<string, { avatar: string; avatarUrl?: string | null }>()
  for (const rows of Object.values(memberRows)) {
    for (const r of rows) {
      if (!byName.has(r.name)) byName.set(r.name, { avatar: r.avatar, avatarUrl: r.avatarUrl })
    }
  }
  const self = currentMemberName.trim()
  const names = Array.from(new Set([...rosterNames, ...byName.keys(), self].filter(Boolean))).sort((a, b) => {
    if (a === self) return -1
    if (b === self) return 1
    return a.localeCompare(b)
  })
  return [
    { value: ALL_MEMBERS_VALUE, label: "All members", avatar: "" },
    ...names.map((name) => {
      const known = byName.get(name)
      return {
        value: name,
        label: name === self ? "Myself" : name,
        avatar: known?.avatar ?? initialsFromName(name),
        avatarUrl: known?.avatarUrl ?? null,
      }
    }),
  ]
}

export function getProjectFilterOptions(
  memberRows: Record<string, TimeActivityMemberSubRow[]>
): { value: string; label: string }[] {
  const names = Array.from(
    new Set(Object.values(memberRows).flatMap((rows) => rows.flatMap((r) => r.projectNames)))
  ).sort()
  return [{ value: ALL_PROJECTS_VALUE, label: "All projects" }, ...names.map((name) => ({ value: name, label: name }))]
}
