import { initialsFromName } from "@/features/members/utils/build-tree"
import type { TimeActivityMemberSubRow } from "@/features/reports/models/time-and-activity"

export type MemberFilterOption = { value: string; label: string; avatar: string; avatarUrl?: string | null }

/** Someone the Members filter can offer who may have no activity in the range. */
export type RosterMember = { name: string; avatarUrl?: string | null }

export function getMemberFilterOptions(
  memberRows: Record<string, TimeActivityMemberSubRow[]>,
  roster: RosterMember[] = [],
  currentMemberName = "",
): MemberFilterOption[] {
  // First sighting per name wins - the avatar doesn't change day to day. The
  // roster comes second: it is how someone with no activity in the range
  // still gets their photo instead of falling back to plain initials.
  const byName = new Map<string, { avatar: string; avatarUrl?: string | null }>()
  for (const rows of Object.values(memberRows)) {
    for (const r of rows) {
      if (!byName.has(r.name)) byName.set(r.name, { avatar: r.avatar, avatarUrl: r.avatarUrl })
    }
  }
  const rosterPhoto = new Map<string, string>()
  for (const m of roster) if (m.name && m.avatarUrl && !rosterPhoto.has(m.name)) rosterPhoto.set(m.name, m.avatarUrl)
  const self = currentMemberName.trim()
  const names = Array.from(new Set([...roster.map((m) => m.name), ...byName.keys(), self].filter(Boolean))).sort((a, b) => {
    if (a === self) return -1
    if (b === self) return 1
    return a.localeCompare(b)
  })
  return names.map((name) => {
    const known = byName.get(name)
    return {
      value: name,
      label: name === self ? "Myself" : name,
      avatar: known?.avatar ?? initialsFromName(name),
      avatarUrl: known?.avatarUrl ?? rosterPhoto.get(name) ?? null,
    }
  })
}

export function getProjectFilterOptions(
  memberRows: Record<string, TimeActivityMemberSubRow[]>
): { value: string; label: string }[] {
  const names = Array.from(
    new Set(Object.values(memberRows).flatMap((rows) => rows.flatMap((r) => r.projectNames)))
  ).sort()
  return names.map((name) => ({ value: name, label: name }))
}
