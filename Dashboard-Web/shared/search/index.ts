/* eslint-disable react-doctor/js-combine-iterations */
import { NAV_SECTIONS, getPageLabel, getSectionForPage, type NavSection } from "@/shared/ui/layout"
import { visibleNavSections, canAccessAllSidebarTabs } from "@/features/auth"
import { POPULAR_REPORTS, REPORT_SECTIONS } from "@/features/reports"
import { SHIFT_STYLE_HUB_REPORTS } from "@/features/reports"
import { APP_UI_SEARCH_ENTRIES } from "@/shared/search/ui-catalog"
import type { AppSearchEntry, AppSearchEntryKind } from "@/shared/search/types"

export type { AppSearchEntry, AppSearchEntryKind } from "@/shared/search/types"

const EXTRA_ENTRIES: AppSearchEntry[] = [
  {
    id: "profile::edit-account",
    pageId: "profile",
    title: "Edit account",
    section: "Account",
    description: "Update your profile, password, and personal details",
    keywords: ["profile", "account", "user", "password", "email"],
    kind: "page",
  },
  {
    id: "settings-all::all-settings",
    pageId: "settings-all",
    title: "All settings",
    section: "Settings",
    description: "Browse all organization and workspace settings",
    keywords: ["settings", "configuration", "preferences", "setup"],
    kind: "page",
  },
  {
    id: "people-members-tree::members-tree",
    pageId: "people-members-tree",
    title: "Members tree",
    section: "People",
    pageLabel: "Members",
    description: "Organization chart and member hierarchy",
    keywords: ["org chart", "hierarchy", "tree", "relationships", "members"],
    kind: "page",
  },
  {
    id: "settings-billing-plans::subscription-plans",
    pageId: "settings-billing-plans",
    title: "Subscription plans",
    section: "Settings",
    pageLabel: "Billing",
    description: "Compare and change subscription plans",
    keywords: ["billing", "subscription", "plans", "pricing", "upgrade"],
    kind: "page",
  },
  {
    id: "reports-custom::customized-reports",
    pageId: "reports-custom",
    title: "Customized reports",
    section: "Reports",
    description: "Saved and customized report views",
    keywords: ["custom", "saved", "reports"],
    kind: "page",
  },
  {
    id: "reports-daily::daily-totals",
    pageId: "reports-daily",
    title: "Daily totals",
    section: "Reports",
    subsection: "General",
    description: "Review daily hours and totals across members",
    keywords: ["daily", "totals", "hours", "report"],
    kind: "page",
  },
]

const SETTINGS_HUB_ENTRIES: AppSearchEntry[] = [
  {
    id: "settings-organization::organization-settings",
    pageId: "settings-organization",
    title: "Organization settings",
    section: "Settings",
    description: "Company branding, work week cycles, and global security policies",
    keywords: ["organization", "company", "branding", "security", "manage settings"],
    kind: "page",
  },
  {
    id: "settings-members::members-settings",
    pageId: "settings-members",
    title: "Members settings",
    section: "Settings",
    description: "Invite members, manage roles, and view invitation status",
    keywords: ["members", "invite", "roles", "permissions", "manage members"],
    kind: "page",
  },
  {
    id: "pm-projects::projects-settings",
    pageId: "pm-projects",
    title: "Projects settings",
    section: "Settings",
    description: "Configure global project settings and tracking requirements",
    keywords: ["projects", "project management", "budget", "manage projects"],
    kind: "page",
  },
  {
    id: "settings-schedules::schedules",
    pageId: "settings-schedules",
    title: "Schedules",
    section: "Settings",
    description: "Shift management, holidays, time-off policies, and attendance",
    keywords: ["schedules", "shifts", "holidays", "time off", "attendance", "manage schedules"],
    kind: "page",
  },
  {
    id: "settings-activity::activity-tracking",
    pageId: "settings-activity",
    title: "Activity & tracking",
    section: "Settings",
    description: "Timesheets, screenshots, URLs, and app monitoring",
    keywords: ["activity", "tracking", "screenshots", "timesheets", "monitoring", "manage tracking"],
    kind: "page",
  },
  {
    id: "settings-billing::billing",
    pageId: "settings-billing",
    title: "Billing",
    section: "Settings",
    description: "Subscription plans, payment methods, and invoices",
    keywords: ["billing", "payment", "invoice", "subscription", "manage billing"],
    kind: "page",
  },
  {
    id: "settings-integrations::integrations",
    pageId: "settings-integrations",
    title: "Integrations",
    section: "Settings",
    description: "Connect Slack, Jira, Trello, GitHub, and other tools",
    keywords: ["integrations", "slack", "jira", "github", "connect", "manage integrations"],
    kind: "page",
  },
  {
    id: "settings-policies::policies",
    pageId: "settings-policies",
    title: "Policies",
    section: "Settings",
    description: "Time off accrual, paid and unpaid rules, and coverage",
    keywords: ["policies", "time off", "accrual", "rules", "manage policies"],
    kind: "page",
  },
  {
    id: "settings-enterprise-security::enterprise-security",
    pageId: "settings-enterprise-security",
    title: "Enterprise security",
    section: "Settings",
    description: "Advanced security controls for enterprise organizations",
    keywords: ["enterprise", "security", "sso", "compliance"],
    kind: "page",
  },
]

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1)
}

function entryId(pageId: string, title: string): string {
  return `${pageId}::${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
}

function entryFromNavPage(
  section: NavSection,
  page: { id: string; label: string },
  subsection?: string,
): AppSearchEntry {
  const keywords = new Set<string>([
    ...tokenize(page.label),
    ...tokenize(section.label),
    ...(subsection ? tokenize(subsection) : []),
    ...tokenize(page.id.replace(/-/g, " ")),
  ])
  return {
    id: entryId(page.id, page.label),
    pageId: page.id,
    title: page.label,
    section: section.label,
    subsection,
    keywords: [...keywords],
    kind: "page",
  }
}

/** Full searchable catalog: pages, buttons, tabs, and section titles. */
export function buildAppSearchIndex(): AppSearchEntry[] {
  const byId = new Map<string, AppSearchEntry>()

  const add = (entry: AppSearchEntry) => {
    if (!byId.has(entry.id)) byId.set(entry.id, entry)
  }

  for (const section of NAV_SECTIONS) {
    for (const page of section.pages ?? []) {
      add(entryFromNavPage(section, page))
    }
    for (const subsection of section.subsections ?? []) {
      for (const item of subsection.items) {
        add(entryFromNavPage(section, item, subsection.label))
      }
    }
  }

  for (const entry of EXTRA_ENTRIES) add(entry)
  for (const entry of SETTINGS_HUB_ENTRIES) add(entry)
  for (const entry of APP_UI_SEARCH_ENTRIES) add(entry)

  for (const report of POPULAR_REPORTS) {
    add({
      id: entryId(report.pageId, report.title),
      pageId: report.pageId,
      title: report.title,
      section: "Reports",
      subsection: "Popular",
      description: report.description,
      keywords: [...tokenize(report.title), ...tokenize(report.description), "report", "reports"],
      kind: "page",
    })
  }

  for (const group of REPORT_SECTIONS) {
    for (const card of group.cards) {
      add({
        id: entryId(card.pageId, card.title),
        pageId: card.pageId,
        title: card.title,
        section: "Reports",
        subsection: group.heading,
        description: card.description,
        keywords: [
          ...tokenize(card.title),
          ...tokenize(card.description),
          ...tokenize(group.heading),
          "report",
          "reports",
        ],
        kind: "page",
      })
    }
  }

  for (const [pageId, meta] of Object.entries(SHIFT_STYLE_HUB_REPORTS)) {
    add({
      id: entryId(pageId, meta.title),
      pageId,
      title: meta.title,
      section: "Reports",
      keywords: [...tokenize(meta.title), "report", "reports"],
      kind: "page",
    })
  }

  return [...byId.values()]
}

/**
 * Page ids this role may open. Built from visibleNavSections, the same
 * source the sidebar and breadcrumb dropdowns use, so search cannot surface
 * a page that neither of those would let the role reach.
 */
export function getAccessiblePageIds(role: string): Set<string> {
  const ids = new Set<string>(["profile"])

  for (const section of visibleNavSections(role)) {
    for (const page of section.pages ?? []) ids.add(page.id)
    for (const subsection of section.subsections ?? []) {
      for (const item of subsection.items) ids.add(item.id)
    }
  }

  if (canAccessAllSidebarTabs(role)) {
    ids.add("settings-billing-plans")
    ids.add("people-members-tree")
    ids.add("reports-custom")
    ids.add("reports-daily")
  }

  return ids
}

function scoreEntry(entry: AppSearchEntry, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0

  const title = entry.title.toLowerCase()
  const section = entry.section.toLowerCase()
  const subsection = entry.subsection?.toLowerCase() ?? ""
  const pageLabel = entry.pageLabel?.toLowerCase() ?? ""
  const description = entry.description?.toLowerCase() ?? ""
  const keywordBlob = entry.keywords.join(" ").toLowerCase()
  const path = [entry.section, entry.pageLabel, entry.subsection, entry.title].filter(Boolean).join(" ").toLowerCase()

  const kindBoost = entry.kind === "action" || entry.kind === "tab" ? 5 : 0

  if (title === q) return 100 + kindBoost
  if (path === q) return 95 + kindBoost
  if (title.startsWith(q)) return 90 + kindBoost
  if (path.startsWith(q)) return 85 + kindBoost
  if (title.includes(q)) return 78 + kindBoost
  if (pageLabel.includes(q)) return 72 + kindBoost
  if (section.includes(q) || subsection.includes(q)) return 65
  if (keywordBlob.includes(q)) return 58 + kindBoost
  if (description.includes(q)) return 48

  const tokens = tokenize(q)
  if (tokens.length === 0) return 0
  const allMatch = tokens.every(
    (token) =>
      title.includes(token) ||
      pageLabel.includes(token) ||
      section.includes(token) ||
      subsection.includes(token) ||
      keywordBlob.includes(token) ||
      description.includes(token),
  )
  return allMatch ? 38 + kindBoost : 0
}

export function searchAppIndex(
  entries: AppSearchEntry[],
  query: string,
  accessiblePageIds: Set<string>,
  limit = 20,
): AppSearchEntry[] {
  const q = query.trim()
  if (!q) return []

// eslint-disable-next-line react-doctor/js-flatmap-filter
  return entries
    .filter((entry) => accessiblePageIds.has(entry.pageId))
    .map((entry) => ({ entry, score: scoreEntry(entry, q) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
    .slice(0, limit)
    .map(({ entry }) => entry)
}

const KIND_LABEL: Record<AppSearchEntryKind, string> = {
  page: "Page",
  action: "Action",
  tab: "Tab",
  section: "Section",
}

export function formatSearchEntryPath(entry: AppSearchEntry): string {
  const parts: string[] = [entry.section]
  const pageLabel = entry.pageLabel ?? getPageLabel(entry.pageId)
  const sectionForPage = getSectionForPage(entry.pageId)
  const isTopLevelPage = sectionForPage?.pages?.some((p: any) => p.id === entry.pageId && p.label === entry.title)

  if (pageLabel && pageLabel !== entry.title && !isTopLevelPage) {
    parts.push(pageLabel)
  } else if (entry.subsection && entry.subsection !== entry.section) {
    parts.push(entry.subsection)
  }

  if (entry.kind && entry.kind !== "page" && entry.title !== pageLabel) {
    parts.push(`${entry.title} · ${KIND_LABEL[entry.kind]}`)
  } else if (!isTopLevelPage && entry.title !== parts[parts.length - 1]) {
    parts.push(entry.title)
  }

  return parts.join(" › ")
}
