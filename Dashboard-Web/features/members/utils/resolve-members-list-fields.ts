import { DEFAULT_ENABLED_MEMBER_COLS } from "@/features/members/config/members-config"
import type { MemberListFilters } from "@/features/members/components/filters/member-filters-panel"

export const MEMBERS_LIST_CORE_API_FIELDS = [
  "id",
  "first_name",
  "last_name",
  "display_name",
  "work_email",
  "personal_email",
  "avatar",
  "avatar_color",
  "avatar_url",
  "firebase_uid",
  "status",
  "role",
  "role_name",
  "tracking_status",
  "project_ids",
] as const

export const MEMBER_COLUMN_API_FIELDS: Record<string, readonly string[]> = {
  status: ["tracking_status"],
  role: ["role", "role_name", "role_id"],
  projects: ["projects"],
  payment: ["payment", "pay_rate", "pay_period"],
  limits: ["limits", "weekly_limit"],
  date_added: ["date_added"],
  teams: ["teams"],
  phone: ["phone"],
}

export type ResolveMembersListFieldsInput = {
  enabledCols: Set<string> | readonly string[]
  memberFilters?: Pick<MemberListFilters, "projectIds">
  sortCol?: string | null
}

function normalizeEnabledCols(enabledCols: Set<string> | readonly string[]): Set<string> {
  return enabledCols instanceof Set ? enabledCols : new Set(enabledCols)
}

export function resolveMembersListFields(input: ResolveMembersListFieldsInput): string[] {
  const enabled = normalizeEnabledCols(input.enabledCols)
  const fields = new Set<string>(MEMBERS_LIST_CORE_API_FIELDS)

  for (const colKey of enabled) {
    const mapped = MEMBER_COLUMN_API_FIELDS[colKey]
    if (mapped) {
      for (const field of mapped) fields.add(field)
    }
  }

  if (input.sortCol && MEMBER_COLUMN_API_FIELDS[input.sortCol]) {
    for (const field of MEMBER_COLUMN_API_FIELDS[input.sortCol]) fields.add(field)
  }

  const projectFilterActive = (input.memberFilters?.projectIds.length ?? 0) > 0
  if (projectFilterActive) {
    fields.add("project_ids")
  }

  return [...fields].sort()
}

export function membersListFieldSignature(fields: readonly string[]): string {
  return fields.join(",")
}

export function membersListCacheKey(fields: readonly string[]): string {
  return `people-members:members:${membersListFieldSignature(fields)}`
}

export function resolveDefaultMembersListFields(): string[] {
  return resolveMembersListFields({
    enabledCols: DEFAULT_ENABLED_MEMBER_COLS,
    memberFilters: { projectIds: [] },
    sortCol: null,
  })
}

export function getAddedColumnKeys(previous: Set<string>, next: Set<string>): string[] {
  const added: string[] = []
  for (const key of next) {
    if (!previous.has(key)) added.push(key)
  }
  return added
}

export function fieldSetIncludes(haystack: readonly string[], needle: readonly string[]): boolean {
  const set = new Set(haystack)
  return needle.every((field) => set.has(field))
}
