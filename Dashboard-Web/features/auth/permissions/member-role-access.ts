import { NAV_SECTIONS, type NavSection } from "@/shared/ui/layout"

const ROLE_PRIVILEGE_RANK: Record<string, number> = Object.assign(Object.create(null), {
  owner: 100,
  superadmin: 90,
  admin: 80,
  supermanager: 70,
  // See role-hierarchy.ts for why these sit at the same rank as
  // supermanager/manager rather than getting their own tier - the grant
  // (PLAN-customer-accounts-and-tenancy.md §4.3, §16.1), not extra authority.
  enterprisesupermanager: 70,
  manager: 60,
  enterprisemanager: 60,
  teamlead: 50,
  employee: 40,
  intern: 30,
  client: 20,
  viewer: 10,
})

const LEGACY_ROLE_KEY_ALIASES = new Map([
  ["supermanger", "supermanager"],
  ["manger", "manager"],
])

export function normalizeMemberRole(role: string): string {
  const key = role.trim().toLowerCase().replace(/\s+/g, "")
  return LEGACY_ROLE_KEY_ALIASES.get(key) ?? key
}

export function isEmployeeRole(role: string): boolean {
  const r = normalizeMemberRole(role)
  return r === "intern" || r === "employee" || r === "teamlead"
}

export function isLimitedSelfManageRole(role: string): boolean {
  const rank = ROLE_PRIVILEGE_RANK[normalizeMemberRole(role)] ?? -1
  return rank <= (ROLE_PRIVILEGE_RANK.teamlead ?? 50)
}

export function isEmployeeL2OrHigherRole(role: string): boolean {
  const rank = ROLE_PRIVILEGE_RANK[normalizeMemberRole(role)] ?? -1
  const managerRank = ROLE_PRIVILEGE_RANK.manager ?? 60
  const l2Rank = ROLE_PRIVILEGE_RANK.teamlead ?? 50
  return rank >= l2Rank && rank < managerRank
}

export function isClientOrViewerRole(role: string): boolean {
  const r = normalizeMemberRole(role)
  return r === "viewer" || r === "client" || r === "user"
}

function pickHighestPrivilegeRoleName(candidates: string[]): string {
  let bestName = ""
  let bestRank = -1
  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    if (!trimmed) continue
    const key = normalizeMemberRole(trimmed)
    const rank = ROLE_PRIVILEGE_RANK[key] ?? 35
    if (rank > bestRank) {
      bestRank = rank
      bestName = trimmed
    }
  }
  return bestName || "Viewer"
}

export function extractRoleFromRecord(input: Record<string, unknown>): string {
  const candidates: string[] = []
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) candidates.push(value.trim())
  }
  push(input.role_name)
  push(input.roleName)
  push(input.role)
  push(input.primary_role)
  push(input.primaryRole)
  if (Array.isArray(input.roles)) {
    for (const row of input.roles) {
      if (typeof row === "string") push(row)
      else if (row && typeof row === "object") {
        const o = row as Record<string, unknown>
        push(o.name)
        push(o.role_name)
        push(o.roleName)
      }
    }
  }
  return pickHighestPrivilegeRoleName(candidates)
}

export function isOwnerRoleName(role: string): boolean {
  return normalizeMemberRole(role) === "owner"
}

export function canManageMemberBans(role: string): boolean {
  const key = normalizeMemberRole(role)
  return key === "owner" || key === "superadmin" || key === "admin"
}

export function canMigrateMembers(role: string): boolean {
  const key = normalizeMemberRole(role)
  return key === "owner" || key === "superadmin" || key === "admin"
}

export function canUseBatchMemberActions(role: string): boolean {
  const rank = ROLE_PRIVILEGE_RANK[normalizeMemberRole(role)] ?? 0
  const managerRank = ROLE_PRIVILEGE_RANK.manager ?? 60
  return rank >= managerRank
}

export function getMemberRoleLabel(
  member: { role?: string; role_name?: string } | null | undefined,
  fallback = "Viewer",
): string {
  if (!member) return fallback
  const fromFields = pickHighestPrivilegeRoleName([
    typeof member.role_name === "string" ? member.role_name : "",
    typeof member.role === "string" ? member.role : "",
  ])
  return fromFields || fallback
}

// A customer tenant's root runs their own tree the way an Owner/Admin runs
// the main one - full project/task/classification control within it (spec's
// "Customer hierarchy and seats": Create/edit/delete their projects,
// employees, tasks; control their classification and tracking rules - all
// "Customer tree: own tree only"). RLS is what confines that to their own
// tenant, not a narrower nav here; a customer root left out of this set
// would be unable to operate the tenant they are paying for.
const PRIVILEGED_SIDEBAR_ROLE_KEYS = new Set([
  "owner",
  "superadmin",
  "admin",
  "supermanager",
  "supermanger", // legacy typo in some records
  "manager",
  "enterprisesupermanager",
  "enterprisemanager",
])

export function canAccessAllSidebarTabs(role: string): boolean {
  return PRIVILEGED_SIDEBAR_ROLE_KEYS.has(normalizeMemberRole(role))
}

export function canViewParticipationMetrics(role: string): boolean {
  return canAccessAllSidebarTabs(role)
}

export function canSeePmTasksSection(role: string): boolean {
  const rank = ROLE_PRIVILEGE_RANK[normalizeMemberRole(role)] ?? -1
  return rank >= ROLE_PRIVILEGE_RANK.intern
}

const ORG_TASK_CREATE_ROLES = new Set([
  "owner",
  "superadmin",
  "admin",
  "supermanager",
  "supermanger",
  "enterprisesupermanager",
  "enterprisemanager",
])

export function canCreateTasksByOrgRole(role: string): boolean {
  return ORG_TASK_CREATE_ROLES.has(normalizeMemberRole(role))
}

export function canSeeClientBudgets(role: string): boolean {
  return ORG_TASK_CREATE_ROLES.has(normalizeMemberRole(role))
}

export function canEditPayRates(role: string): boolean {
  return ORG_TASK_CREATE_ROLES.has(normalizeMemberRole(role))
}

export function isProjectManagerRole(projectRole: string): boolean {
  return normalizeMemberRole(projectRole) === "manager"
}

export function canCreateTasksInProject(
  orgRole: string,
  memberId: string | null | undefined,
  projectId: string | null | undefined,
  projectMembers: ReadonlyArray<{ projectId: string; memberId: string; projectRole: string }>,
  restrictTaskCreation = true,
  clientCanManage = false,
): boolean {
  if (canCreateTasksByOrgRole(orgRole)) return true
  if (normalizeMemberRole(orgRole) === "client") return clientCanManage === true
  if (!memberId) return false
  const managesAnyProject = projectMembers.some(
    (row) => row.memberId === memberId && isProjectManagerRole(row.projectRole),
  )
  if (!projectId) return managesAnyProject
  const rowsForProject = projectMembers.filter(
    (row) => row.projectId === projectId && row.memberId === memberId,
  )
  if (!restrictTaskCreation) return rowsForProject.length > 0
  return rowsForProject.some((row) => isProjectManagerRole(row.projectRole))
}

export function canCreateTasks(role: string): boolean {
  return canCreateTasksByOrgRole(role)
}

export function canAccessReviewCenter(role: string): boolean {
  const r = normalizeMemberRole(role)
  return (
    canAccessAllSidebarTabs(role) ||
    r === "client"
  )
}

export function isManagementRole(role: string): boolean {
  return PRIVILEGED_SIDEBAR_ROLE_KEYS.has(normalizeMemberRole(role))
}

export function canManageProjects(role: string): boolean {
  return isManagementRole(role)
}

export function canManageClients(role: string): boolean {
  return isManagementRole(role)
}

export function canReviewAssignments(role: string): boolean {
  return isManagementRole(role)
}

export function canManageTimesheetApprovals(role: string): boolean {
  return isManagementRole(role)
}

export function canExportActivity(role: string): boolean {
  return isManagementRole(role)
}

export function canManageActivityData(role: string): boolean {
  return isManagementRole(role)
}

export function canClassifyActivity(role: string): boolean {
  const key = normalizeMemberRole(role)
  // A customer's classification/tracking rules are theirs alone to set -
  // the spec's "Never" column is about the MAIN org's Owner/Super Admin
  // reaching INTO a customer tenant, not the customer managing their own
  // (RLS is what enforces the boundary; this is the customer managing
  // themselves, same as an Admin classifying the main org's activity).
  return key === "owner" || key === "superadmin" || key === "admin" || key === "enterprisesupermanager" || key === "enterprisemanager"
}

export function defaultNavItemForRole(role: string): string {
  if (normalizeMemberRole(role) === "client") return "reports-work-sessions"
  return "command-center"
}

const RESTRICTED_SECTION_IDS = new Set(["dashboard", "people", "activity", "settings"])

// pm-clients is excluded for the Clients role: it lists every client company
// in the org, and a client login must never see other customers' records.
const CLIENT_EXCLUDED_PAGE_IDS = new Set(["calendar-timeoff", "pm-clients"])

const CLIENT_SECTION_IDS = new Set(["timesheets", "activity", "project-management", "reports"])

const CLIENT_ALLOWED_REPORT_PAGE_IDS = new Set([
  "reports-all",
  "reports-work-sessions",
  "reports-apps-urls",
  "reports-daily-limits",
  "reports-weekly-limits",
])

export function isReadOnlyRole(role: string): boolean {
  const key = normalizeMemberRole(role)
  return key === "client" || key === "viewer" || key === "user"
}

export function clientHiddenPageIds(): Set<string> {
  return new Set(CLIENT_EXCLUDED_PAGE_IDS)
}

export const SERVER_SCOPED_PROJECT_ROLES = new Set(["owner", "superadmin", "admin", "client"])

export function allowedNavSectionIds(role: string): Set<string> {
  if (canAccessAllSidebarTabs(role)) return new Set(NAV_SECTIONS.map((section) => section.id))
  if (normalizeMemberRole(role) === "client") return new Set(CLIENT_SECTION_IDS)
  const ids = new Set(RESTRICTED_SECTION_IDS)
  if (canSeePmTasksSection(role)) ids.add("project-management")
  if (canAccessReviewCenter(role) || canSeePmTasksSection(role)) ids.add("timesheets")
  return ids
}

// Single source of truth for what the Clients role can see: both the
// rendered sidebar (visibleNavSections) and the page-navigation guard
// (isPageAllowedForRole, via getClientPageIds) build off this so a page
// hidden from the sidebar can never be reached by direct navigation either.
function clientVisibleSections(): NavSection[] {
  const hidden = clientHiddenPageIds()
  const sections = NAV_SECTIONS.filter((s) => CLIENT_SECTION_IDS.has(s.id))
  return sections.map((s) => {
    if (s.id === "timesheets") {
      return { ...s, pages: s.pages?.filter((p) => p.id === "timesheets-view") }
    }
    if (s.id === "reports") {
      return {
        ...s,
        pages: s.pages?.filter((p) => CLIENT_ALLOWED_REPORT_PAGE_IDS.has(p.id)),
        subsections: s.subsections
          ?.map((sub) => ({
            ...sub,
            items: sub.items.filter((item) => CLIENT_ALLOWED_REPORT_PAGE_IDS.has(item.id)),
          }))
          .filter((sub) => sub.items.length > 0),
      }
    }
    return {
      ...s,
      pages: s.pages?.filter((p) => !hidden.has(p.id)),
      subsections: s.subsections?.map((sub) => ({
        ...sub,
        items: sub.items.filter((item) => !hidden.has(item.id)),
      })),
    }
  })
}

export function visibleNavSections(role: string): NavSection[] {
  if (canAccessAllSidebarTabs(role)) return NAV_SECTIONS

  if (normalizeMemberRole(role) === "client") return clientVisibleSections()

  const allowedSectionIds = allowedNavSectionIds(role)
  const sections = NAV_SECTIONS.filter((s) => allowedSectionIds.has(s.id))

  return sections.map((s) => {
    if (s.id === "dashboard") {
      return { ...s, pages: s.pages?.filter((p) => p.id === "command-center") }
    }
    if (s.id === "project-management") {
      return {
        ...s,
        pages: s.pages?.filter((p) => p.id === "pm-tasks" || p.id === "pm-projects" || p.id === "calendar-timeoff"),
      }
    }
    return s
  })
}

function collectPageIdsForSections(sectionIds: Set<string>, restrictDashboardToGeneral: boolean): Set<string> {
  const ids = new Set<string>()
  for (const section of NAV_SECTIONS) {
    if (!sectionIds.has(section.id)) continue
    for (const page of section.pages ?? []) {
      if (restrictDashboardToGeneral && section.id === "dashboard" && page.id !== "general") continue
      ids.add(page.id)
    }
    for (const sub of section.subsections ?? []) {
      for (const item of sub.items) ids.add(item.id)
    }
  }
  return ids
}

let restrictedPageIdsCache: Set<string> | null = null
let clientPageIdsCache: Set<string> | null = null

function getClientPageIds(): Set<string> {
  if (!clientPageIdsCache) {
    const ids = new Set<string>()
    for (const section of clientVisibleSections()) {
      for (const page of section.pages ?? []) ids.add(page.id)
      for (const sub of section.subsections ?? []) {
        for (const item of sub.items) ids.add(item.id)
      }
    }
    ids.add("profile")
    clientPageIdsCache = ids
  }
  return new Set(clientPageIdsCache)
}

function getRestrictedPageIds(role: string): Set<string> {
  if (normalizeMemberRole(role) === "client") return getClientPageIds()
  if (!restrictedPageIdsCache) {
    restrictedPageIdsCache = collectPageIdsForSections(RESTRICTED_SECTION_IDS, true)
    restrictedPageIdsCache.add("profile")
  }
  const ids = new Set(restrictedPageIdsCache)
  const rank = ROLE_PRIVILEGE_RANK[normalizeMemberRole(role)] ?? -1
  if (rank >= ROLE_PRIVILEGE_RANK.intern) {
    ids.add("pm-tasks")
    ids.add("pm-projects")
    ids.add("calendar-timeoff")
    ids.add("timesheets-view")
    ids.add("timesheets-submissions")
    ids.add("timesheets-manual-requests")
    ids.add("timesheets-time-activity")
  }
  return ids
}

export function isPageAllowedForRole(pageId: string, role: string): boolean {
  if (canAccessAllSidebarTabs(role)) return true
  if (pageId === "timesheets-view" && canAccessReviewCenter(role)) return true
  return getRestrictedPageIds(role).has(pageId)
}

export function coerceNavItemForRole(pageId: string, role: string): string {
  if (isPageAllowedForRole(pageId, role)) return pageId
  return defaultNavItemForRole(role)
}
