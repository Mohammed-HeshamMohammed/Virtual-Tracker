import { NAV_SECTIONS, type NavSection } from "@/shared/ui/layout"

/**
 * Mirrors Backend `ROLE_PRIVILEGE_RANK` in relation-sync.js.
 * Prototype-less so a role named "constructor" or "valueOf" misses instead of returning an
 * Object.prototype member — every lookup here is `ROLE_PRIVILEGE_RANK[key] ?? <default>`.
 */
const ROLE_PRIVILEGE_RANK: Record<string, number> = Object.assign(Object.create(null), {
  owner: 100,
  superadmin: 90,
  admin: 80,
  supermanager: 70,
  manager: 60,
  teamlead: 50,
  employee: 40,
  intern: 30,
  client: 20,
  viewer: 10,
})

/**
 * Misspelled role names that exist in older records — folded onto the canonical key
 * so every policy check and rank lookup sees one spelling. Mirrors Backend
 * `LEGACY_ROLE_KEY_ALIASES` in relation-sync.js.
 */
const LEGACY_ROLE_KEY_ALIASES = new Map([
  ["supermanger", "supermanager"],
  ["manger", "manager"],
])

/** Normalize role string for comparisons (lowercase, no spaces). */
export function normalizeMemberRole(role: string): string {
  const key = role.trim().toLowerCase().replace(/\s+/g, "")
  return LEGACY_ROLE_KEY_ALIASES.get(key) ?? key
}

/** Intern / Employee / Team Lead. */
export function isEmployeeRole(role: string): boolean {
  const r = normalizeMemberRole(role)
  return r === "intern" || r === "employee" || r === "teamlead"
}

/** Team Lead and below (Team Lead, Employee, Intern, Client, Viewer) — self-manage info/settings only. */
export function isLimitedSelfManageRole(role: string): boolean {
  const rank = ROLE_PRIVILEGE_RANK[normalizeMemberRole(role)] ?? -1
  return rank <= (ROLE_PRIVILEGE_RANK.teamlead ?? 50)
}

/** Team Lead tier only (not Manager or above). */
export function isEmployeeL2OrHigherRole(role: string): boolean {
  const rank = ROLE_PRIVILEGE_RANK[normalizeMemberRole(role)] ?? -1
  const managerRank = ROLE_PRIVILEGE_RANK.manager ?? 60
  const l2Rank = ROLE_PRIVILEGE_RANK.teamlead ?? 50
  return rank >= l2Rank && rank < managerRank
}

/** Client / Viewer portal roles — not employees. */
export function isClientOrViewerRole(role: string): boolean {
  const r = normalizeMemberRole(role)
  return r === "viewer" || r === "client" || r === "user"
}

/** Pick the highest-privilege role label (same logic as Backend enrichMembersWithRoleNames). */
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

/** Resolve primary role from API member payload (`role`, `role_name`, `member_roles`, etc.). */
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

/** Owner, Super Admin, and Admin may manage banned members. */
export function canManageMemberBans(role: string): boolean {
  const key = normalizeMemberRole(role)
  return key === "owner" || key === "superadmin" || key === "admin"
}

/** Owner, Super Admin, and Admin may migrate existing mobile-app (Firebase Auth) users into Virtual Tracker — mirrors Backend `canMigrateMembers` in member-migration-policy.js. Narrower than `canManageMembers` (which also allows Manager/Super Manager). */
export function canMigrateMembers(role: string): boolean {
  const key = normalizeMemberRole(role)
  return key === "owner" || key === "superadmin" || key === "admin"
}

/** Batch edit/remove — same management roles as row actions (Manager+). Scope enforced per target. */
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

/** Roles with full sidebar navigation (same sections/sub-pages as Owner / Admin / Super Admin). */
const PRIVILEGED_SIDEBAR_ROLE_KEYS = new Set([
  "owner",
  "superadmin",
  "admin",
  "supermanager",
  "supermanger", // legacy typo in some records
  "manager",
])

/** Roles that see the full sidebar (not just Dashboard / People / Activity / Settings). */
export function canAccessAllSidebarTabs(role: string): boolean {
  return PRIVILEGED_SIDEBAR_ROLE_KEYS.has(normalizeMemberRole(role))
}

/** Roles that may view multi-assignee participation metrics. */
export function canViewParticipationMetrics(role: string): boolean {
  return canAccessAllSidebarTabs(role)
}

/** Intern+ may see PM tasks section and create tasks (UI hint — server enforces writes). */
export function canSeePmTasksSection(role: string): boolean {
  const rank = ROLE_PRIVILEGE_RANK[normalizeMemberRole(role)] ?? -1
  return rank >= ROLE_PRIVILEGE_RANK.intern
}

/** Org roles that may create tasks on any project without a project-manager assignment. */
const ORG_TASK_CREATE_ROLES = new Set([
  "owner",
  "superadmin",
  "admin",
  "supermanager",
  "supermanger",
])

export function canCreateTasksByOrgRole(role: string): boolean {
  return ORG_TASK_CREATE_ROLES.has(normalizeMemberRole(role))
}

/** Client budget figures are financial - Owner/Super Admin/Admin/Super Manager only. */
export function canSeeClientBudgets(role: string): boolean {
  return ORG_TASK_CREATE_ROLES.has(normalizeMemberRole(role))
}

/**
 * Pay/bill rate is Owner/Super Admin/Admin/Super Manager only - narrower than
 * canManageMembers (which also lets a plain Manager edit a member's other
 * tabs). Mirrors Backend's own gate: isOrgProjectAdminRole in
 * project-access.js, enforced in member-profile.service.js's hasPayBill
 * branch (the actual authority - this is a UI hint only, so the tab reads
 * as read-only for a Manager instead of erroring after they try to save).
 */
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
  /** The project's `restrictTaskCreation` setting. Defaults to true, which is
   * the manager-only rule this function has always enforced unconditionally.
   * false lets any assigned member of that project create tasks in it. */
  restrictTaskCreation = true,
  /** The project's `clientCanManage` setting. A client has no project_members
   *  row, so without this the checks below always deny them - which is right
   *  by default, and wrong for the one project their organization handed them
   *  to run. Mirrors clientMayManageProject on the server. */
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

/** Roles that may create tasks in the tasks UI (org admins only — project managers resolved per project). */
export function canCreateTasks(role: string): boolean {
  return canCreateTasksByOrgRole(role)
}

/** Roles that may open the View & Edit review center. */
export function canAccessReviewCenter(role: string): boolean {
  const r = normalizeMemberRole(role)
  return (
    canAccessAllSidebarTabs(role) ||
    r === "client"
  )
}

/** Management roles that may create/edit/delete projects, clients, teams, and members. */
export function isManagementRole(role: string): boolean {
  return PRIVILEGED_SIDEBAR_ROLE_KEYS.has(normalizeMemberRole(role))
}

/** UI hint — server enforces project writes via management role + project ACL. */
export function canManageProjects(role: string): boolean {
  return isManagementRole(role)
}

/** UI hint — server enforces client writes via management role + visibility filters. */
export function canManageClients(role: string): boolean {
  return isManagementRole(role)
}

/** UI hint — server enforces assignment approve/reject via management role + scope. */
export function canReviewAssignments(role: string): boolean {
  return isManagementRole(role)
}

/** UI hint — timesheet approval setup and admin actions. */
export function canManageTimesheetApprovals(role: string): boolean {
  return isManagementRole(role)
}

/** UI hint — export team activity feeds (apps/URLs). */
export function canExportActivity(role: string): boolean {
  return isManagementRole(role)
}

/** UI hint — delete screenshots, block URLs, etc. when backed by API. */
export function canManageActivityData(role: string): boolean {
  return isManagementRole(role)
}

/**
 * Owner, Super Admin and Admin may label apps and URLs as productive or not.
 * Deliberately narrower than `canManageActivityData` — a Manager is management
 * for approvals and scheduling, but classification is an org-wide policy call
 * that moves everyone's reported focused time. Mirrors Backend
 * `canClassifyActivity` in modules/classification/activity-categories.js, which
 * enforces it; this only decides whether the button is worth showing.
 */
export function canClassifyActivity(role: string): boolean {
  const key = normalizeMemberRole(role)
  return key === "owner" || key === "superadmin" || key === "admin"
}

/** Default landing page after sign-in — dashboard first for every role. */
export function defaultNavItemForRole(_role: string): string {
  return "command-center"
}

const RESTRICTED_SECTION_IDS = new Set(["dashboard", "people", "activity", "settings"])

/**
 * A Client is attached to projects through their client record, and reads
 * everything about those projects: the dashboard, the reports, the activity,
 * the project pages, the timesheet outcomes and the people on them. They do
 * not manage any of it - the server scopes every one of those reads to their
 * projects and refuses their writes unless the project has client_can_manage
 * turned on.
 */
/**
 * Pages inside a client's sections that are still not theirs. Time off is
 * staff leave - a client has no policy, no balance and nobody to approve
 * them, so the request form would only ever produce a row nobody can action.
 */
const CLIENT_EXCLUDED_PAGE_IDS = new Set(["calendar-timeoff"])

const CLIENT_SECTION_IDS = new Set([
  "dashboard",
  "timesheets",
  "activity",
  "project-management",
  "reports",
  "people",
  "settings",
  "financials",
])

/** Client and Viewer are read-only everywhere the UI offers a create action. */
export function isReadOnlyRole(role: string): boolean {
  const key = normalizeMemberRole(role)
  return key === "client" || key === "viewer" || key === "user"
}

/**
 * Nav sections this role may open. The sidebar, the breadcrumb dropdowns and
 * the global search each used to carry their own copy of this list, so a
 * client could reach a page from one of them that the others did not show.
 */
/**
 * Roles whose project list the server already resolves, so a page must not
 * narrow it again client-side by looking for the viewer in project_members.
 * Org admins are there because they are rarely members of anything; a client
 * is there because they are attached through their client record and have no
 * membership row at all.
 */
/** Pages a client's sections list but that the client may not open. */
export function clientHiddenPageIds(): Set<string> {
  return new Set(CLIENT_EXCLUDED_PAGE_IDS)
}

export const SERVER_SCOPED_PROJECT_ROLES = new Set(["owner", "superadmin", "admin", "client"])

export function allowedNavSectionIds(role: string): Set<string> {
  if (canAccessAllSidebarTabs(role)) return new Set(NAV_SECTIONS.map((section) => section.id))
  if (normalizeMemberRole(role) === "client") return new Set(CLIENT_SECTION_IDS)
  const ids = new Set(RESTRICTED_SECTION_IDS)
  // Intern+ (see canSeePmTasksSection): own project rows and own timesheet outcomes.
  if (canSeePmTasksSection(role)) ids.add("project-management")
  if (canAccessReviewCenter(role) || canSeePmTasksSection(role)) ids.add("timesheets")
  return ids
}

/**
 * The nav tree exactly as the sidebar renders it for this role: sections
 * filtered by allowedNavSectionIds, then trimmed page-by-page the same way
 * the sidebar trims them. Single source for the sidebar, the breadcrumb
 * dropdowns and the global search, so none of the three can drift from what
 * the others show - allowedNavSectionIds fixed this same class of bug once
 * already, at the section level; this closes it at the page level too.
 */
export function visibleNavSections(role: string): NavSection[] {
  if (canAccessAllSidebarTabs(role)) return NAV_SECTIONS

  const isClient = normalizeMemberRole(role) === "client"
  const allowedSectionIds = allowedNavSectionIds(role)
  const sections = NAV_SECTIONS.filter((s) => allowedSectionIds.has(s.id))

  if (isClient) {
    const hidden = clientHiddenPageIds()
    return sections.map((s) => {
      if (s.id === "timesheets") {
        return { ...s, pages: s.pages?.filter((p) => p.id === "timesheets-view") }
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

  return sections.map((s) => {
    if (s.id === "dashboard") {
      return { ...s, pages: s.pages?.filter((p) => p.id === "command-center") }
    }
    if (s.id === "project-management") {
      // Own tasks, own project rows (read-only), and own time off requests -
      // Overview and Clients stay manager-only.
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
    // Every page of those sections, dashboard included - a client's dashboard
    // is the same one, already scoped to their projects by the server.
    clientPageIdsCache = collectPageIdsForSections(CLIENT_SECTION_IDS, false)
    for (const id of CLIENT_EXCLUDED_PAGE_IDS) clientPageIdsCache.delete(id)
    clientPageIdsCache.add("profile")
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
    // Own project rows (read-only), own time off requests, and own timesheet
    // outcomes - matches the sections allowedNavSectionIds now opens for this tier.
    ids.add("pm-projects")
    ids.add("calendar-timeoff")
    ids.add("timesheets-view")
    ids.add("timesheets-submissions")
    ids.add("timesheets-manual-requests")
    ids.add("timesheets-time-activity")
  }
  return ids
}

/** Whether the signed-in role may open this nav page id (matches sidebar visibility). */
export function isPageAllowedForRole(pageId: string, role: string): boolean {
  if (canAccessAllSidebarTabs(role)) return true
  if (pageId === "timesheets-view" && canAccessReviewCenter(role)) return true
  return getRestrictedPageIds(role).has(pageId)
}

/** Redirect disallowed deep links to the role default landing page. */
export function coerceNavItemForRole(pageId: string, role: string): string {
  if (isPageAllowedForRole(pageId, role)) return pageId
  return defaultNavItemForRole(role)
}
