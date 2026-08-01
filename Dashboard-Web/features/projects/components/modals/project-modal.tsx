/* eslint-disable react-doctor/use-lazy-motion, react-doctor/exhaustive-deps, react-doctor/no-initialize-state */
/* eslint-disable react-doctor/prefer-module-scope-pure-function */
/* eslint-disable react-doctor/no-giant-component */
"use client"

import { useEffect, useMemo, useState as useComponentState, type FormEvent, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { X, Info, Wallet, Users, Bell, TimerOff, RotateCw } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import {
  fetchProjectForEdit,
  getProjectFormConfig,
  getProjectTeams,
  type CreateProjectFormPayload,
  type ProjectFormConfig,
  type ProjectFormTab,
  type ProjectTeamOption,
} from "@/infrastructure/api"
import type { ProjectType } from "@/features/projects/api/project-api"
import { ProjectTypePicker } from "@/features/projects/components/modals/project-type-picker"
import type { Team } from "@/features/teams/api/team-api"
import { getTeamMembers } from "@/features/teams/api/team-api"
import {
  FORM_GRID,
  FORM_STACK,
  FORM_SCROLL_HIDDEN,
  useClientFormTheme,
} from "@/shared/ui/forms/form-styles"
import { DatePickerField } from "@/shared/ui/forms/date-picker-field"
import { ExpandCollapse, SegmentedControl } from "@/shared/ui/motion/expand-collapse"
import { FormField } from "@/shared/ui/forms/form-field"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import { SelectField } from "@/shared/ui/forms/select-field"
import { Toggle } from "@/shared/ui/forms/toggle"
import { AddProjectDynamicFields } from "@/features/projects/components/add-project-dynamic-fields"
import { ProjectNamesPreviewButton } from "@/features/projects/components/project-names-preview-button"
import { fetchUserTeams } from "@/features/projects/services/fetch-user-teams"
import { ProjectModalSkeleton } from "@/features/projects/components/skeletons/project-modal-skeleton"
import { getProjectBudgetFieldErrors, validateProjectBudgetFields, validateProjectNames, type ProjectBudgetFieldErrors } from "@/shared/validation/project-form"
import { filterProjectFormMemberIds } from "@/features/projects/utils/project-form-member-filter"
import { syncProjectMembersFromTeams } from "@/features/projects/utils/sync-members-from-teams"
import {
  aggregateClientBudgetsForProject,
} from "@/features/projects/utils/aggregate-client-budgets"
import {
  PROJECT_MEMBER_LIMITS_COMING_SOON_MESSAGE,
  PROJECT_MEMBER_LIMITS_ENABLED,
} from "@/features/projects/config/project-management-config"

const MODAL_BODY_CLASS = cn("min-h-0 flex-1 px-5 py-5", FORM_SCROLL_HIDDEN)

interface AddProjectFormState {
  projectNames: string
  type: ProjectType
  billable: boolean
  disableActivity: boolean
  allowProjectTracking: boolean
  disableIdleTime: boolean
  endDate: string
  clientIds: string[]
  teams: string[]
  managers: string[]
  users: string[]
  viewers: string[]
  memberLimit: string
  // Whether timers stop once the budget cap is reached - NOT "does this
  // project have a budget" (every project always does, see item 6). Was
  // named `hasBudget` before, which conflated the two.
  budgetStopTimers: boolean
  budgetType: string
  budgetBasedOn: string
  // 'per_project': budgetTotal is a flat total (the only behavior before this
  // field existed). 'per_person': budgetTotal is hours-per-member - the real
  // total scales with current headcount, so it's read-only/derived, not typed.
  budgetScope: string
  budgetResets: string
  budgetNotifyAt: string
  budgetWhoToNotify: string
  budgetStopTimersAt: string
  budgetStartDate: string
  budgetIncludeNonBillable: boolean
  budgetNotifyMembers: boolean
  memberLimitNotifyAt: string
  memberLimitNotifyMembers: boolean
  memberLimitMembers: string[]
  memberLimitType: string
  memberLimitBasedOn: string
  memberLimitResets: string
  memberLimitStartDate: string
  includeNonBillableTime: boolean
  budgetSpent: number
  budgetTotal: string
}

const PROJECT_COLOR_POOL = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6", "#0ea5e9"]
export const MEMBERS_TEAMS_TAB_KEY = "members-teams"

const DEFAULT_ADD_PROJECT_TABS: ProjectFormTab[] = [
  { key: "general", label: "GENERAL" },
  { key: MEMBERS_TEAMS_TAB_KEY, label: "MEMBERS & TEAMS" },
  { key: "budget", label: "BUDGET & LIMITS" },
]

function normalizeProjectModalTabs(tabs: ProjectFormTab[]): ProjectFormTab[] {
  const hasMembers = tabs.some((tab) => tab.key === "members")
  const hasTeams = tabs.some((tab) => tab.key === "teams")
  if (!hasMembers && !hasTeams) return tabs

  const normalized: ProjectFormTab[] = []
  let merged = false
  for (const tab of tabs) {
    if (tab.key === "members" || tab.key === "teams") {
      if (!merged) {
        normalized.push({ key: MEMBERS_TEAMS_TAB_KEY, label: "MEMBERS & TEAMS" })
        merged = true
      }
      continue
    }
    normalized.push(tab)
  }
  return normalized
}
type AddProjectTab = string
type BudgetLimitsTab = "project-budget" | "member-limits"

function createDefaultAddForm(): AddProjectFormState {
  return {
    projectNames: "",
    type: "normal",
    billable: true,
    disableActivity: false,
    allowProjectTracking: true,
    disableIdleTime: false,
    endDate: "",
    clientIds: [],
    teams: [],
    managers: [],
    users: [],
    viewers: [],
    memberLimit: "",
    budgetStopTimers: true,
    budgetType: "Cost based",
    budgetBasedOn: "Bill rate",
    budgetScope: "per_project",
    budgetResets: "Never",
    budgetNotifyAt: "",
    budgetWhoToNotify: "",
    budgetStopTimersAt: "",
    budgetStartDate: "",
    budgetIncludeNonBillable: true,
    budgetNotifyMembers: false,
    memberLimitNotifyAt: "80",
    memberLimitNotifyMembers: true,
    memberLimitMembers: [],
    memberLimitType: "",
    memberLimitBasedOn: "",
    memberLimitResets: "Never",
    memberLimitStartDate: "",
    includeNonBillableTime: true,
    budgetSpent: 0,
    budgetTotal: "5000",
  }
}

function toSelectOptions(items: string[], placeholder = "Select") {
  return [{ value: "", label: placeholder }, ...items.map((item) => ({ value: item, label: item }))]
}

/** Budget hours are stored as a single decimal-hours string (`budgetTotal`,
 * unchanged on the wire) - these two just let the input show/take hours AND
 * minutes instead of forcing e.g. "8.5" for 8h30m. */
function formatHoursLabel(totalHours: number): string {
  if (!(totalHours > 0)) return "0h"
  const totalMinutes = Math.round(totalHours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function decimalHoursToParts(value: string): { hours: string; minutes: string } {
  const trimmed = value.trim()
  if (!trimmed) return { hours: "", minutes: "" }
  const total = Number(trimmed)
  if (!Number.isFinite(total) || total < 0) return { hours: "", minutes: "" }
  const totalMinutes = Math.round(total * 60)
  return { hours: String(Math.floor(totalMinutes / 60)), minutes: String(totalMinutes % 60) }
}

function partsToDecimalHours(hoursRaw: string, minutesRaw: string): string {
  const hours = Math.max(0, Number(hoursRaw) || 0)
  const minutes = Math.max(0, Math.min(59, Number(minutesRaw) || 0))
  const total = hours + minutes / 60
  if (total <= 0) return ""
  return String(Math.round(total * 100) / 100)
}

function ProjectModalSelect({
  value,
  onChange,
  options,
  placeholder = "Select",
}: {
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
}) {
  return <SelectField value={value} onChange={onChange} options={toSelectOptions(options, placeholder)} />
}

function SettingToggleRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: ReactNode
}) {
  const theme = useClientFormTheme()
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={cn("inline-flex items-center gap-1 text-sm", theme.bodyText)}>{label}</span>
      <Toggle checked={checked} onChange={() => onChange(!checked)} />
    </div>
  )
}

/** Icon + title + one-line description, with a divider above every section
 * but the first - the same "labeled section" rhythm the client modal uses
 * for e.g. its "Auto invoicing" block, applied here so the Budget tab reads
 * as a sequence of distinct decisions instead of one flat field list. */
function BudgetSection({
  icon,
  title,
  sub,
  first,
  children,
}: {
  icon: ReactNode
  title: string
  sub: string
  first?: boolean
  children: ReactNode
}) {
  const theme = useClientFormTheme()
  return (
    <div className={cn("flex flex-col gap-3", !first && "border-t pt-4", theme.modal.headerBorder)}>
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]",
            theme.isDark ? "bg-[#4be277]/10 text-[#4be277]" : "bg-blue-50 text-blue-600",
          )}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className={cn("text-[13px] font-bold", theme.modal.title)}>{title}</p>
          <p className={cn("mt-0.5 text-xs leading-relaxed", theme.mutedText)}>{sub}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

/** Class hooks for SegmentedControl matching this file's own tokens - reuses
 * the sub-tab pill's track color and the theme's solid-accent pill, rather
 * than inventing a third set of segmented-control colors. */
function useSegmentedClasses() {
  const theme = useClientFormTheme()
  return {
    trackClassName: theme.isDark ? "bg-[#191f31]" : "bg-slate-100",
    pillClassName: theme.accent.primarySolid,
    buttonClassName: (active: boolean) =>
      active ? (theme.isDark ? "text-[#0c1324]" : "text-white") : theme.mutedText,
  }
}

function formStateToPayload(
  addForm: AddProjectFormState,
  name: string,
  roleByMemberId?: ReadonlyMap<string, string>,
): CreateProjectFormPayload {
  const managerIds = roleByMemberId
    ? filterProjectFormMemberIds(addForm.managers, "manager_and_above", roleByMemberId)
    : addForm.managers
  const userIds = roleByMemberId
    ? filterProjectFormMemberIds(addForm.users, "employee", roleByMemberId)
    : addForm.users
  const memberLimitMemberIds = roleByMemberId
    ? filterProjectFormMemberIds(addForm.memberLimitMembers, undefined, roleByMemberId)
    : addForm.memberLimitMembers

  return {
    name,
    type: addForm.type,
    billable: addForm.billable,
    disableActivity: addForm.disableActivity,
    allowProjectTracking: addForm.allowProjectTracking,
    disableIdleTime: addForm.disableIdleTime,
    endDate: addForm.endDate,
    clientIds: addForm.clientIds,
    teamIds: addForm.teams,
    managerIds,
    userIds,
    viewerIds: addForm.viewers,
    memberLimitMemberIds,
    budgetStopTimers: addForm.budgetStopTimers,
    budgetType: addForm.budgetType,
    budgetBasedOn: addForm.budgetBasedOn,
    budgetScope: addForm.budgetScope,
    budgetTotal: addForm.budgetTotal,
    budgetResets: addForm.budgetResets,
    budgetNotifyAt: addForm.budgetNotifyAt,
    budgetWhoToNotify: addForm.budgetWhoToNotify,
    budgetStopTimersAt: addForm.budgetStopTimersAt,
    budgetStartDate: addForm.budgetStartDate,
    budgetIncludeNonBillable: addForm.budgetIncludeNonBillable,
    budgetNotifyMembers: addForm.budgetNotifyMembers,
    memberLimitType: addForm.memberLimitType,
    memberLimitBasedOn: addForm.memberLimitBasedOn,
    memberLimitResets: addForm.memberLimitResets,
    memberLimitStartDate: addForm.memberLimitStartDate,
    memberLimitNotifyAt: addForm.memberLimitNotifyAt,
    memberLimitNotifyMembers: addForm.memberLimitNotifyMembers,
    memberLimitMembers: addForm.memberLimit,
    budgetSpent: addForm.budgetSpent,
  }
}

interface ProjectModalProps {
  projectId: string | null
  user: any
  onClose: () => void
  onSave: (editingProjectId: string | null, payloads: CreateProjectFormPayload[], editingBudgetId?: string) => Promise<void>
}

export function ProjectModal({
  projectId,
  user,
  onClose,
  onSave,
}: ProjectModalProps) {
  const formTheme = useClientFormTheme()
  const segmented = useSegmentedClasses()
  const isEditMode = projectId !== null

  const [addForm, setAddForm] = useComponentState<AddProjectFormState>(createDefaultAddForm)
  const [budgetFieldErrors, setBudgetFieldErrors] = useComponentState<ProjectBudgetFieldErrors>({})
  const [editingBudgetId, setEditingBudgetId] = useComponentState<string | undefined>(undefined)
  const [addProjectTab, setAddProjectTab] = useComponentState<AddProjectTab>("general")
  // Type is create-time only, so editing an existing project skips the picker.
  const [addProjectStep, setAddProjectStep] = useComponentState<"type" | "form">(
    isEditMode ? "form" : "type",
  )
  const [budgetLimitsTab, setBudgetLimitsTab] = useComponentState<BudgetLimitsTab>("project-budget")

  const [formConfig, setFormConfig] = useComponentState<ProjectFormConfig | null>(null)
  const [formConfigLoading, setFormConfigLoading] = useComponentState(false)
  const [formConfigError, setFormConfigError] = useComponentState<string | null>(null)

  const [availableTeams, setAvailableTeams] = useComponentState<Team[]>([])
  const [linkedTeamOptions, setLinkedTeamOptions] = useComponentState<ProjectTeamOption[]>([])
  const [allTeamMembers, setAllTeamMembers] = useComponentState<Awaited<ReturnType<typeof getTeamMembers>>>([])
  const [teamsLoading, setTeamsLoading] = useComponentState(false)
  const [teamsLoadError, setTeamsLoadError] = useComponentState<string | null>(null)

  const [editFormLoading, setEditFormLoading] = useComponentState(false)
  const [isSubmitting, setIsSubmitting] = useComponentState(false)
  const [submitError, setSubmitError] = useComponentState<string | null>(null)
  const [budgetFromClientsCount, setBudgetFromClientsCount] = useComponentState(0)

  const modalContentLoading = isEditMode && editFormLoading
  const formConfigPending = formConfigLoading && !formConfig && !formConfigError
  const addProjectTabs = useMemo(
    () => normalizeProjectModalTabs(formConfig?.tabs ?? DEFAULT_ADD_PROJECT_TABS),
    [formConfig?.tabs],
  )

  const teamPickerOptions = useMemo((): Team[] => {
    const map = new Map<string, Team>()
    for (const team of availableTeams) map.set(team.id, team)
    for (const team of linkedTeamOptions) {
      if (!map.has(team.id)) {
        map.set(team.id, { id: team.id, name: team.name, schedule_weekly_report: false })
      }
    }
    for (const teamId of addForm.teams) {
      if (!map.has(teamId)) {
        map.set(teamId, { id: teamId, name: teamId, schedule_weekly_report: false })
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [availableTeams, linkedTeamOptions, addForm.teams])

  const [prevUserId, setPrevUserId] = useComponentState(user?.uid)
  const [prevUserEmail, setPrevUserEmail] = useComponentState(user?.email)

  if (user?.uid !== prevUserId || user?.email !== prevUserEmail) {
    setPrevUserId(user?.uid)
    setPrevUserEmail(user?.email)
    setTeamsLoading(true)
    setTeamsLoadError(null)
  }

  const [prevProjectId, setPrevProjectId] = useComponentState(projectId)

  if (projectId !== prevProjectId) {
    setPrevProjectId(projectId)
    if (projectId) {
      setEditFormLoading(true)
      setSubmitError(null)
    }
  }

  // Fetch configs
  useEffect(() => {
    let cancelled = false
    setFormConfigLoading(true)
    setFormConfigError(null)
    getProjectFormConfig()
      .then((config) => {
        if (!cancelled) setFormConfig(config)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFormConfig(null)
          setFormConfigError(err instanceof Error ? err.message : "Failed to load form fields")
        }
      })
      .finally(() => {
        if (!cancelled) setFormConfigLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Fetch teams
  useEffect(() => {
    let cancelled = false
    fetchUserTeams(user?.uid, user?.email ?? undefined)
      .then((teams) => {
        if (!cancelled) setAvailableTeams(teams)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setAvailableTeams([])
          setTeamsLoadError(err instanceof Error ? err.message : "Failed to load teams")
        }
      })
      .finally(() => {
        if (!cancelled) setTeamsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user?.uid, user?.email])

  useEffect(() => {
    let cancelled = false
    getTeamMembers(undefined, { fields: ["team_id", "member_id", "member_role"] })
      .then((rows) => {
        if (!cancelled) setAllTeamMembers(rows)
      })
      .catch(() => {
        if (!cancelled) setAllTeamMembers([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Fetch project details for editing
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    Promise.all([
      fetchProjectForEdit(projectId),
      getProjectTeams(projectId),
    ])
      .then(([loaded, linkedTeams]) => {
        if (cancelled) return
        setLinkedTeamOptions(linkedTeams)
        const { budgetId, ...payload } = loaded
        setEditingBudgetId(budgetId)
        setAddForm({
          projectNames: payload.name,
          type: payload.type ?? "normal",
          billable: payload.billable,
          disableActivity: payload.disableActivity,
          allowProjectTracking: payload.allowProjectTracking,
          disableIdleTime: payload.disableIdleTime,
          endDate: payload.endDate || "",
          clientIds: payload.clientIds,
          teams: payload.teamIds,
          managers: payload.managerIds,
          users: payload.userIds,
          viewers: payload.viewerIds,
          memberLimit: payload.memberLimitMembers ?? "",
          memberLimitMembers: payload.memberLimitMemberIds,
          budgetStopTimers: payload.budgetStopTimers,
          budgetType: payload.budgetType || "Cost based",
          budgetBasedOn: payload.budgetBasedOn || "Bill rate",
          budgetScope: payload.budgetScope === "per_person" ? "per_person" : "per_project",
          budgetResets: payload.budgetResets,
          budgetNotifyAt: payload.budgetNotifyAt,
          budgetWhoToNotify: payload.budgetWhoToNotify,
          budgetStopTimersAt: payload.budgetStopTimersAt,
          budgetStartDate: payload.budgetStartDate,
          budgetIncludeNonBillable: payload.budgetIncludeNonBillable,
          budgetNotifyMembers: payload.budgetNotifyMembers,
          memberLimitNotifyAt: payload.memberLimitNotifyAt,
          memberLimitNotifyMembers: payload.memberLimitNotifyMembers,
          memberLimitType: payload.memberLimitType,
          memberLimitBasedOn: payload.memberLimitBasedOn,
          memberLimitResets: payload.memberLimitResets,
          memberLimitStartDate: payload.memberLimitStartDate,
          includeNonBillableTime: payload.budgetIncludeNonBillable,
          budgetSpent: payload.budgetSpent,
          budgetTotal: payload.budgetTotal,
        })
      })
      .catch((err) => {
        if (!cancelled) {
          setSubmitError(err instanceof Error ? err.message : "Failed to load project details")
        }
      })
      .finally(() => {
        if (!cancelled) setEditFormLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  function parseProjectNamesFromInput(raw: string): string[] {
    const seen = new Set<string>()
    const names: string[] = []
    for (const line of raw.split("\n")) {
      const name = line.trim()
      if (!name) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      names.push(name)
    }
    return names
  }

  const previewProjectNames = useMemo(
    () => parseProjectNamesFromInput(addForm.projectNames),
    [addForm.projectNames],
  )

  const memberRoleById = useMemo(() => {
    const map = new Map<string, string>()
    for (const member of formConfig?.options.members ?? []) {
      if (member.role) map.set(member.id, member.role)
    }
    return map
  }, [formConfig?.options.members])

  function countProjectMemberSlots(form: AddProjectFormState): number {
    const ids = new Set([
      ...form.managers,
      ...form.users,
      ...form.viewers,
      ...form.memberLimitMembers,
    ])
    return Math.max(1, ids.size)
  }

  function applyClientBudgetAggregation(
    prev: AddProjectFormState,
    clientIds: string[],
  ): AddProjectFormState {
    const aggregated = aggregateClientBudgetsForProject(formConfig?.options.clients ?? [], clientIds, {
      memberCount: countProjectMemberSlots({ ...prev, clientIds }),
    })
    if (!aggregated) {
      setBudgetFromClientsCount(0)
      return { ...prev, clientIds }
    }
    setBudgetFromClientsCount(aggregated.fromClientCount)
    const next = {
      ...prev,
      clientIds,
      budgetStopTimers: aggregated.budgetStopTimers,
      budgetType: aggregated.budgetType,
      budgetBasedOn: aggregated.budgetBasedOn,
      budgetTotal: aggregated.budgetTotal,
      budgetResets: aggregated.budgetResets,
      budgetNotifyAt: aggregated.budgetNotifyAt,
    }
    setBudgetFieldErrors(getProjectBudgetFieldErrors(next))
    return next
  }

  function updateAddForm(patch: Partial<AddProjectFormState>) {
    setAddForm((prev) => {
      const next = { ...prev, ...patch }
      setBudgetFieldErrors(getProjectBudgetFieldErrors(next))
      return next
    })
  }

  function handleProjectFormChange<K extends keyof AddProjectFormState>(
    key: K,
    value: AddProjectFormState[K],
  ) {
    setAddForm((prev) => {
      if (key === "clientIds") {
        const nextClientIds = Array.isArray(value) ? value.map(String) : []
        return applyClientBudgetAggregation(prev, nextClientIds)
      }
      if (key !== "teams") {
        return { ...prev, [key]: value }
      }
      const nextTeamIds = Array.isArray(value) ? value.map(String) : []
      if (allTeamMembers.length === 0) {
        return { ...prev, teams: nextTeamIds }
      }
      return {
        ...prev,
        ...syncProjectMembersFromTeams(
          {
            teams: prev.teams,
            managers: prev.managers,
            users: prev.users,
          },
          nextTeamIds,
          allTeamMembers,
          memberRoleById,
        ),
      }
    })
  }

  /** Quick-add-client popover finished — reload the client list (same call the modal already
   * makes on mount) and select the new client in the form, same as picking it from the dropdown. */
  function handleClientAdded(clientId: string) {
    getProjectFormConfig()
      .then((config) => {
        setFormConfig(config)
        if (!addForm.clientIds.includes(clientId)) {
          handleProjectFormChange("clientIds", [...addForm.clientIds, clientId])
        }
      })
      .catch((err: unknown) => {
        setFormConfigError(err instanceof Error ? err.message : "Failed to reload client list")
      })
  }

  useEffect(() => {
    if (!formConfig || addForm.clientIds.length === 0) {
      setBudgetFromClientsCount(0)
      return
    }
    const stacked = aggregateClientBudgetsForProject(formConfig.options.clients, addForm.clientIds, {
      memberCount: countProjectMemberSlots(addForm),
    })
    setBudgetFromClientsCount(stacked?.fromClientCount ?? 0)
  }, [
    formConfig,
    addForm.clientIds,
    addForm.managers,
    addForm.users,
    addForm.viewers,
    addForm.memberLimitMembers,
  ])

  useEffect(() => {
    if (!PROJECT_MEMBER_LIMITS_ENABLED && budgetLimitsTab === "member-limits") {
      setBudgetLimitsTab("project-budget")
    }
  }, [budgetLimitsTab])

  useEffect(() => {
    if (allTeamMembers.length === 0) return
    setAddForm((prev) => {
      if (prev.teams.length === 0) return prev
      return {
        ...prev,
        ...syncProjectMembersFromTeams(
          {
            teams: prev.teams,
            managers: prev.managers,
            users: prev.users,
          },
          prev.teams,
          allTeamMembers,
          memberRoleById,
        ),
      }
    })
  }, [allTeamMembers, memberRoleById])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const projectNames = parseProjectNamesFromInput(addForm.projectNames)
    const namesError = validateProjectNames(projectNames)
    const budgetErrors = getProjectBudgetFieldErrors(addForm)
    const budgetError = validateProjectBudgetFields(addForm)
    if (budgetError) {
      setBudgetFieldErrors(budgetErrors)
      // A budget is required for every project (item 6) - if the failure is
      // on the BUDGET tab and the user is looking at a different tab, jump
      // them there. Otherwise the error text above renders on a tab nobody's
      // looking at.
      if (addProjectTab !== "budget") {
        setAddProjectTab("budget")
        setBudgetLimitsTab("project-budget")
      }
    }
    const validationError = namesError ?? budgetError
    if (validationError) {
      setSubmitError(validationError)
      return
    }
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const payloads = projectNames.map((name) => formStateToPayload(addForm, name, memberRoleById))
      await onSave(projectId, payloads, editingBudgetId)
      onClose()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save project")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <motion.div
      initial={{ scale: 0.95, opacity: 0, y: 8 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.95, opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      className={cn(
        "flex h-[min(680px,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl shadow-2xl",
        formTheme.modal.panel,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className={cn("flex shrink-0 items-center justify-between border-b px-5 py-4", formTheme.modal.headerBorder)}>
          <div>
            <h2 className={cn("text-lg font-bold", formTheme.modal.title)}>
              {isEditMode ? "Edit project" : "New project"}
            </h2>
            <p className={cn("mt-0.5 text-sm", formTheme.modal.subtitle)}>
              {isEditMode
                ? "Update project settings, members, and budget"
                : addProjectStep === "type"
                  ? "Choose how this project tracks time — this can't be changed later"
                  : "Add one or more projects — enter each name on a new line"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "rounded-lg p-2 transition-colors",
              formTheme.isDark ? "hover:bg-[#2e3447]" : "hover:bg-slate-100",
            )}
          >
            <X className={cn("h-5 w-5", formTheme.isDark ? "text-[#bccbb9]" : "text-slate-400")} />
          </button>
        </div>

        <div
          className={cn(
            "flex shrink-0 gap-1 overflow-x-auto border-b px-5",
            formTheme.modal.headerBorder,
            addProjectStep === "type" && "hidden",
          )}
        >
          {addProjectTabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setAddProjectTab(item.key)}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-3 text-xs font-semibold transition-colors",
                addProjectTab === item.key ? formTheme.tab.active : formTheme.tab.inactive,
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className={MODAL_BODY_CLASS}>
          <AnimatePresence mode="wait" initial={false}>
          {addProjectStep === "type" ? (
            <motion.div
              key="type-step"
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.18 }}
            >
              <ProjectTypePicker
                onSelect={(type) => {
                  setAddForm((p) => ({
                    ...p,
                    type,
                    // Calling projects have no tasks and no per-task bill/pay-rate
                    // anchor, so a Cost based budget has nothing coherent to
                    // multiply (item 2 of the budget fixes plan) - force Hours based.
                    ...(type === "calling" ? { budgetType: "Hours based", budgetBasedOn: "" } : {}),
                  }))
                  setAddProjectStep("form")
                }}
              />
            </motion.div>
          ) : (
          <motion.div
            key="form-step"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.18 }}
          >
          {modalContentLoading ? (
            <ProjectModalSkeleton
              isDark={formTheme.isDark}
              activeTab={addProjectTab}
              budgetSubTab={budgetLimitsTab}
            />
          ) : (
            <>
              {formConfigError ? (
                <p className={cn("mb-4 text-sm", formTheme.isDark ? "text-amber-300" : "text-amber-700")}>
                  {formConfigError} Some fields may be unavailable.
                </p>
              ) : null}

              {addProjectTab === "general" ? (
            <div className={FORM_STACK}>
              <FormField
                label={isEditMode ? "Project name" : "Project names"}
                required
                hint={
                  isEditMode
                    ? undefined
                    : "Create multiple projects by adding each name on a separate line"
                }
              >
                {isEditMode ? (
                  <input
                    required
                    value={addForm.projectNames}
                    onChange={(e) => setAddForm((p) => ({ ...p, projectNames: e.target.value }))}
                    placeholder="Project name"
                    className={formTheme.control} aria-label="Interactive control"
                  />
                ) : (
                  <>
                    <textarea
                      required
                      value={addForm.projectNames}
                      onChange={(e) => setAddForm((p) => ({ ...p, projectNames: e.target.value }))}
                      rows={3}
                      placeholder="Add project names separated by new lines"
                      className={formTheme.textarea}
                    />
                    {previewProjectNames.length > 0 ? (
                      <div className="mt-2 flex justify-end">
                        <ProjectNamesPreviewButton names={previewProjectNames} />
                      </div>
                    ) : null}
                  </>
                )}
              </FormField>

              <div className={FORM_GRID}>
                <FormField label="End date" hint="Optional - purely informational, nothing archives on it">
                  <DatePickerField
                    value={addForm.endDate}
                    onChange={(date) => setAddForm((p) => ({ ...p, endDate: date }))}
                    placeholder="Select date"
                  />
                </FormField>
                <FormField label="Budget start date" hint="When the budget's own tracking period begins">
                  <DatePickerField
                    value={addForm.budgetStartDate}
                    onChange={(date) => setAddForm((p) => ({ ...p, budgetStartDate: date }))}
                    placeholder="Select date"
                  />
                </FormField>
              </div>

              <div className={cn("space-y-3 rounded-xl border p-3", formTheme.card)}>
                <SettingToggleRow
                  checked={addForm.billable}
                  onChange={(next) => setAddForm((p) => ({ ...p, billable: next }))}
                  label="Billable"
                />
                <SettingToggleRow
                  checked={addForm.disableActivity}
                  onChange={(next) => setAddForm((p) => ({ ...p, disableActivity: next }))}
                  label={
                    <>
                      Disable activity
                      <Info className={cn("h-3.5 w-3.5", formTheme.isDark ? "text-[#bccbb9]" : "text-slate-400")} />
                    </>
                  }
                />
                <SettingToggleRow
                  checked={addForm.allowProjectTracking}
                  onChange={(next) => setAddForm((p) => ({ ...p, allowProjectTracking: next }))}
                  label={
                    <>
                      Allow project tracking
                      <Info className={cn("h-3.5 w-3.5", formTheme.isDark ? "text-[#bccbb9]" : "text-slate-400")} />
                    </>
                  }
                />
                <SettingToggleRow
                  checked={addForm.disableIdleTime}
                  onChange={(next) => setAddForm((p) => ({ ...p, disableIdleTime: next }))}
                  label={
                    <>
                      Disable idle time
                      <Info className={cn("h-3.5 w-3.5", formTheme.isDark ? "text-[#bccbb9]" : "text-slate-400")} />
                    </>
                  }
                />
              </div>

              {formConfig ? (
                <AddProjectDynamicFields
                  fields={formConfig.fields}
                  tab="general"
                  values={addForm}
                  onChange={handleProjectFormChange}
                  onClientAdded={handleClientAdded}
                  clientOptions={formConfig.options.clients}
                  memberOptions={formConfig.options.members}
                  availableTeams={teamPickerOptions}
                  teamsLoading={teamsLoading}
                  teamsLoadError={teamsLoadError}
                />
              ) : null}
            </div>
              ) : null}

              {addProjectTab === MEMBERS_TEAMS_TAB_KEY ? (
                formConfig ? (
                  <div className={FORM_STACK}>
                    <AddProjectDynamicFields
                      fields={formConfig.fields}
                      tab="members"
                      values={addForm}
                      onChange={handleProjectFormChange}
                      onClientAdded={handleClientAdded}
                      clientOptions={formConfig.options.clients}
                      memberOptions={formConfig.options.members}
                      availableTeams={teamPickerOptions}
                      teamsLoading={teamsLoading}
                      teamsLoadError={teamsLoadError}
                    />
                    <AddProjectDynamicFields
                      fields={formConfig.fields}
                      tab="teams"
                      values={addForm}
                      onChange={handleProjectFormChange}
                      onClientAdded={handleClientAdded}
                      clientOptions={formConfig.options.clients}
                      memberOptions={formConfig.options.members}
                      availableTeams={teamPickerOptions}
                      teamsLoading={teamsLoading}
                      teamsLoadError={teamsLoadError}
                    />
                  </div>
                ) : formConfigPending ? (
                  <ProjectModalSkeleton isDark={formTheme.isDark} activeTab={MEMBERS_TEAMS_TAB_KEY} />
                ) : null
              ) : null}

              {addProjectTab === "budget" ? (
            <div className={FORM_STACK}>
              <div
                className={cn(
                  "flex w-full max-w-md rounded-full p-0.5 text-sm font-medium",
                  formTheme.isDark ? "bg-[#191f31]" : "bg-slate-100",
                )}
              >
                {(["project-budget", "member-limits"] as const).map((key) => {
                  const isMemberLimits = key === "member-limits"
                  const disabled = isMemberLimits && !PROJECT_MEMBER_LIMITS_ENABLED
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        if (!disabled) setBudgetLimitsTab(key)
                      }}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-center transition-colors",
                        disabled && "cursor-not-allowed opacity-60",
                        !disabled && budgetLimitsTab === key
                          ? formTheme.isDark
                            ? "bg-[#2e3447] text-[#dce1fb] shadow-sm"
                            : "bg-white text-slate-800 shadow-sm"
                          : formTheme.mutedText,
                      )}
                    >
                      <span>{key === "project-budget" ? "Project budget" : "Member limits"}</span>
                      {disabled ? (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                          Coming soon
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>

              {budgetLimitsTab === "project-budget" ? (
                <div className={FORM_STACK}>
                  {budgetFromClientsCount > 0 ? (
                    <p className={cn("text-xs leading-relaxed", formTheme.mutedText)}>
                      Project budget combines {budgetFromClientsCount} client
                      {budgetFromClientsCount === 1 ? "" : "s"}. Spend is split evenly across linked
                      clients; each client is notified at their own budget threshold on their share.
                    </p>
                  ) : null}

                  <BudgetSection
                    first
                    icon={<Wallet className="h-3.5 w-3.5" />}
                    title="Amount"
                    sub="How this project's budget is measured and who it applies to."
                  >
                    <div className={FORM_GRID}>
                      <FormField label="Type" required className="sm:col-span-2">
                        {addForm.type === "calling" ? (
                          // Calling projects have no tasks and no per-task bill/pay-rate
                          // anchor to multiply a Cost based budget against - Hours based
                          // is the only coherent option, so this isn't a choice here.
                          <div
                            className={cn(
                              "flex h-9 items-center rounded-lg border px-3 text-sm",
                              formTheme.isDark ? "border-[#2e3447] text-[#dce1fb]" : "border-slate-200 text-slate-600",
                            )}
                          >
                            Hours based
                          </div>
                        ) : (
                          <SegmentedControl
                            value={addForm.budgetType}
                            onChange={(value) =>
                              setAddForm((p) => ({
                                ...p,
                                budgetType: value,
                                budgetBasedOn: value === "Hours based" ? "" : (p.budgetBasedOn || "Bill rate"),
                              }))
                            }
                            options={[
                              { id: "Cost based", label: "Cost based" },
                              { id: "Hours based", label: "Hours based" },
                            ]}
                            {...segmented}
                          />
                        )}
                      </FormField>
                      <FormField label="Scope" required className="sm:col-span-2">
                        <SegmentedControl
                          value={addForm.budgetScope}
                          onChange={(value) => setAddForm((p) => ({ ...p, budgetScope: value }))}
                          options={[
                            { id: "per_project", label: "Whole project" },
                            { id: "per_person", label: "Per person", icon: <Users className="h-3.5 w-3.5" /> },
                          ]}
                          {...segmented}
                        />
                      </FormField>
                    </div>

                    <ExpandCollapse show={addForm.budgetType !== "Hours based"}>
                      <FormField label="Based on" required className="pt-1">
                        <ProjectModalSelect
                          value={addForm.budgetBasedOn}
                          onChange={(value) => setAddForm((p) => ({ ...p, budgetBasedOn: value }))}
                          placeholder="Select a rate"
                          options={["Bill rate", "Pay rate"]}
                        />
                      </FormField>
                    </ExpandCollapse>

                    {(() => {
                      // A per_person scope always takes hours-per-member as
                      // its input, regardless of budget type - Cost based
                      // multiplies those hours by each member's own rate at
                      // read time (see computeProjectBudgetTargetForAllPg),
                      // it isn't a dollar figure typed here.
                      const isHoursInput = addForm.budgetType === "Hours based" || addForm.budgetScope === "per_person"
                      const label =
                        addForm.budgetScope === "per_person"
                          ? "Hours per person"
                          : addForm.budgetType === "Hours based"
                            ? "Hours"
                            : "Cost"
                      return (
                        <FormField
                          label={label}
                          required
                          className="sm:max-w-xs"
                          error={budgetFieldErrors.budgetTotal}
                        >
                          {isHoursInput ? (
                            (() => {
                              const { hours, minutes } = decimalHoursToParts(addForm.budgetTotal)
                              return (
                                <div className="flex items-center gap-2">
                                  <div className="relative flex-1">
                                    <input
                                      type="number"
                                      min={0}
                                      value={hours}
                                      onChange={(e) =>
                                        updateAddForm({ budgetTotal: partsToDecimalHours(e.target.value, minutes) })
                                      }
                                      className={cn(formTheme.control, "pr-7")}
                                    />
                                    <span
                                      className={cn(
                                        "absolute right-3 top-1/2 -translate-y-1/2 text-sm",
                                        formTheme.isDark ? "text-[#bccbb9]" : "text-slate-400",
                                      )}
                                    >
                                      h
                                    </span>
                                  </div>
                                  <div className="relative flex-1">
                                    <input
                                      type="number"
                                      min={0}
                                      max={59}
                                      value={minutes}
                                      onChange={(e) =>
                                        updateAddForm({ budgetTotal: partsToDecimalHours(hours, e.target.value) })
                                      }
                                      className={cn(formTheme.control, "pr-7")}
                                    />
                                    <span
                                      className={cn(
                                        "absolute right-3 top-1/2 -translate-y-1/2 text-sm",
                                        formTheme.isDark ? "text-[#bccbb9]" : "text-slate-400",
                                      )}
                                    >
                                      m
                                    </span>
                                  </div>
                                </div>
                              )
                            })()
                          ) : (
                            <div className="relative">
                              <span
                                className={cn(
                                  "absolute left-3 top-1/2 -translate-y-1/2 text-sm",
                                  formTheme.isDark ? "text-[#bccbb9]" : "text-slate-400",
                                )}
                              >
                                $
                              </span>
                              <input
                                type="number"
                                min={0}
                                value={addForm.budgetTotal}
                                onChange={(e) => updateAddForm({ budgetTotal: e.target.value })}
                                className={cn(formTheme.control, "pl-7")}
                              />
                            </div>
                          )}
                        </FormField>
                      )
                    })()}

                    <ExpandCollapse show={addForm.budgetScope === "per_person"}>
                      {(() => {
                        const memberCount = new Set(
                          [...addForm.managers, ...addForm.users, ...addForm.viewers].filter(Boolean),
                        ).size
                        const perPerson = Number(addForm.budgetTotal) || 0
                        return (
                          <div
                            className={cn(
                              "flex items-center gap-3 rounded-xl border p-3.5",
                              formTheme.isDark
                                ? "border-[#4be277]/20 bg-[#4be277]/10"
                                : "border-blue-100 bg-blue-50",
                            )}
                          >
                            <span
                              className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]",
                                formTheme.accent.primarySolid,
                              )}
                            >
                              <Users className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className={cn("text-lg font-extrabold leading-none", formTheme.modal.title)}>
                                {memberCount > 0 ? formatHoursLabel(perPerson * memberCount) : formatHoursLabel(perPerson)}
                                <span className={cn("ml-1.5 text-xs font-semibold", formTheme.mutedText)}>
                                  total budget
                                </span>
                              </p>
                              <p className={cn("mt-1 text-xs", formTheme.mutedText)}>
                                {memberCount > 0
                                  ? `${memberCount} member${memberCount === 1 ? "" : "s"} × ${formatHoursLabel(perPerson)} each`
                                  : `Add members to see the combined total — ${formatHoursLabel(perPerson)} each so far`}
                                {addForm.budgetType !== "Hours based" ? " · converted to cost at each member's rate" : ""}
                              </p>
                            </div>
                          </div>
                        )
                      })()}
                    </ExpandCollapse>
                  </BudgetSection>

                  <BudgetSection
                    icon={<Bell className="h-3.5 w-3.5" />}
                    title="Notifications"
                    sub="Warn the team before the budget runs out."
                  >
                    <div className={cn("flex flex-col gap-3 rounded-xl border p-3", formTheme.card)}>
                      <SettingToggleRow
                        checked={addForm.budgetNotifyMembers}
                        onChange={(next) =>
                          setAddForm((p) => ({
                            ...p,
                            budgetNotifyMembers: next,
                            // Off means off - clear the dependent fields so a
                            // stale value isn't silently what gets submitted.
                            ...(next ? {} : { budgetNotifyAt: "", budgetWhoToNotify: "" }),
                          }))
                        }
                        label="Notify project members"
                      />
                      <ExpandCollapse show={addForm.budgetNotifyMembers}>
                        <div className={cn(FORM_GRID, "pt-1")}>
                          <FormField label="Notify at" error={budgetFieldErrors.budgetNotifyAt}>
                            <div className="relative" aria-label="Interactive control">
                              <input
                                value={addForm.budgetNotifyAt}
                                onChange={(e) => updateAddForm({ budgetNotifyAt: e.target.value })}
                                className={cn(formTheme.control, "pr-20")}
                              />
                              <span
                                className={cn(
                                  "absolute right-3 top-1/2 -translate-y-1/2 text-xs",
                                  formTheme.isDark ? "text-[#bccbb9]" : "text-slate-400",
                                )}
                              >
                                {addForm.budgetType === "Hours based" ? "% hours" : "% budget"}
                              </span>
                            </div>
                          </FormField>
                          <FormField label="Who to notify">
                            <ProjectModalSelect
                              value={addForm.budgetWhoToNotify}
                              onChange={(value) => setAddForm((p) => ({ ...p, budgetWhoToNotify: value }))}
                              placeholder="Select"
                              options={["Org management", "All members"]}
                            />
                          </FormField>
                        </div>
                      </ExpandCollapse>
                    </div>
                  </BudgetSection>

                  <BudgetSection
                    icon={<TimerOff className="h-3.5 w-3.5" />}
                    title="Timer enforcement"
                    sub="Stop tracking automatically once the cap is hit."
                  >
                    <div className={cn("flex flex-col gap-3 rounded-xl border p-3", formTheme.card)}>
                      <SettingToggleRow
                        checked={addForm.budgetStopTimers}
                        onChange={(next) =>
                          updateAddForm({
                            budgetStopTimers: next,
                            ...(next ? {} : { budgetStopTimersAt: "" }),
                          })
                        }
                        label={addForm.budgetType === "Hours based" ? "Stop timers when hours limit is reached" : "Stop timers when budget is reached"}
                      />
                      <ExpandCollapse show={addForm.budgetStopTimers}>
                        <div className="pt-1">
                          <FormField label="Stop timers at" className="max-w-xs" error={budgetFieldErrors.budgetStopTimersAt}>
                            <div className="relative">
                              <input
                                value={addForm.budgetStopTimersAt}
                                onChange={(e) => updateAddForm({ budgetStopTimersAt: e.target.value })}
                                className={cn(formTheme.control, "pr-20")}
                              />
                              <span
                                className={cn(
                                  "absolute right-3 top-1/2 -translate-y-1/2 text-xs",
                                  formTheme.isDark ? "text-[#bccbb9]" : "text-slate-400",
                                )}
                              >
                                {addForm.budgetType === "Hours based" ? "% hours" : "% budget"}
                              </span>
                            </div>
                          </FormField>
                        </div>
                      </ExpandCollapse>
                    </div>
                  </BudgetSection>

                  <BudgetSection
                    icon={<RotateCw className="h-3.5 w-3.5" />}
                    title="Reset period"
                    sub="When the budget total starts counting over from zero."
                  >
                    <FormField label="Resets" required className="max-w-xs">
                      <ProjectModalSelect
                        value={addForm.budgetResets}
                        onChange={(value) => setAddForm((p) => ({ ...p, budgetResets: value }))}
                        options={["Never", "Weekly", "Monthly"]}
                      />
                    </FormField>
                    <SettingToggleRow
                      checked={addForm.budgetIncludeNonBillable}
                      onChange={(next) => setAddForm((p) => ({ ...p, budgetIncludeNonBillable: next }))}
                      label="Include non-billable time"
                    />
                  </BudgetSection>
                </div>
              ) : PROJECT_MEMBER_LIMITS_ENABLED ? (
                <div className={FORM_STACK}>
                  <p className={formTheme.mutedText}>
                    Member limits aim to stop time tracking at the set amount. While uncommon,
                    technical factors such as network connectivity may occasionally cause a slight overrun.
                  </p>

                  <FormField label="Notify at" className="max-w-xs" error={budgetFieldErrors.memberLimitNotifyAt}>
                    <div className="relative">
                      <input
                        value={addForm.memberLimitNotifyAt}
                        onChange={(e) => updateAddForm({ memberLimitNotifyAt: e.target.value })}
                        className={cn(formTheme.control, "pr-16")}
                      />
                      <span
                        className={cn(
                          "absolute right-3 top-1/2 -translate-y-1/2 text-xs",
                          formTheme.isDark ? "text-[#bccbb9]" : "text-slate-400",
                        )}
                      >
                        % limit
                      </span>
                    </div>
                  </FormField>

                  <SettingToggleRow
                    checked={addForm.memberLimitNotifyMembers}
                    onChange={(next) => setAddForm((p) => ({ ...p, memberLimitNotifyMembers: next }))}
                    label="Notify project members"
                  />

                  {formConfig ? (
                    <AddProjectDynamicFields
                      fields={formConfig.fields}
                      tab="budget"
                      budgetSubTab="member-limits"
                      values={addForm}
                      onChange={handleProjectFormChange}
                      onClientAdded={handleClientAdded}
                      clientOptions={formConfig.options.clients}
                      memberOptions={formConfig.options.members}
                      availableTeams={teamPickerOptions}
                      teamsLoading={teamsLoading}
                      teamsLoadError={teamsLoadError}
                    />
                  ) : null}

                  <div className={cn("rounded-xl border p-4", formTheme.card)}>
                    <div className={FORM_GRID}>
                      <FormField label="Type" required>
                        <ProjectModalSelect
                          value={addForm.memberLimitType}
                          onChange={(value) => setAddForm((p) => ({ ...p, memberLimitType: value }))}
                          placeholder="Select a type"
                          options={["Total cost", "Hours limit", "Amount limit"]}
                        />
                      </FormField>
                      <FormField label="Based on" required>
                        <ProjectModalSelect
                          value={addForm.memberLimitBasedOn}
                          onChange={(value) => setAddForm((p) => ({ ...p, memberLimitBasedOn: value }))}
                          placeholder="Select a rate"
                          options={["Bill rate", "Pay rate"]}
                        />
                      </FormField>
                      <FormField label="Cost" required className="sm:col-span-2">
                        <div className="relative">
                          <span
                            className={cn(
                              "absolute left-3 top-1/2 -translate-y-1/2 text-sm",
                              formTheme.isDark ? "text-[#bccbb9]" : "text-slate-400",
                            )}
                          >
                            $
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={addForm.budgetSpent}
                            onChange={(e) =>
                              setAddForm((p) => ({ ...p, budgetSpent: Number(e.target.value) }))
                            }
                            className={cn(formTheme.control, "pl-7")}
                          />
                        </div>
                      </FormField>
                      <FormField label="Resets" required>
                        <ProjectModalSelect
                          value={addForm.memberLimitResets}
                          onChange={(value) => setAddForm((p) => ({ ...p, memberLimitResets: value }))}
                          options={["Never", "Weekly", "Monthly"]}
                        />
                      </FormField>
                      <FormField label="Start date">
                        <DatePickerField
                          value={addForm.memberLimitStartDate}
                          onChange={(date) => setAddForm((p) => ({ ...p, memberLimitStartDate: date }))}
                          placeholder="Select date"
                        />
                      </FormField>
                    </div>
                  </div>

                  <button
                    type="button"
                    className={cn("text-sm font-medium hover:underline", formTheme.accent.link)}
                  >
                    + Add member limit
                  </button>
                </div>
              ) : (
                <div className={cn("rounded-xl border px-4 py-5", formTheme.card)}>
                  <p className={cn("text-sm leading-relaxed", formTheme.mutedText)}>
                    {PROJECT_MEMBER_LIMITS_COMING_SOON_MESSAGE}
                  </p>
                </div>
              )}
            </div>
              ) : null}
            </>
          )}
          </motion.div>
          )}
          </AnimatePresence>
        </div>

        {submitError ? (
          <div
            className={cn(
              "mx-5 mb-2 rounded-lg border px-3 py-2 text-sm",
              formTheme.isDark
                ? "border-red-500/30 bg-red-500/10 text-red-300"
                : "border-red-200 bg-red-50 text-red-800",
            )}
          >
            {submitError}
          </div>
        ) : null}
        <div
          className={cn(
            "flex shrink-0 items-center justify-between border-t px-5 py-4",
            formTheme.footer.border,
            formTheme.modal.footerBg,
          )}
        >
          <div className="flex gap-1">
            {addProjectStep === "form"
              ? addProjectTabs.map((item) => (
                  <div
                    key={item.key}
                    className={cn(
                      "h-1.5 w-1.5 rounded-full transition-colors",
                      addProjectTab === item.key ? formTheme.accent.dot : formTheme.footer.dotInactive,
                    )}
                  />
                ))
              : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting || modalContentLoading || formConfigPending}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50",
                formTheme.footer.cancel,
              )}
            >
              Cancel
            </button>
            {addProjectStep === "form" ? (
              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  modalContentLoading ||
                  formConfigPending ||
                  !addForm.projectNames.trim() ||
                  !addForm.budgetTotal.trim()
                }
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  formTheme.accent.primarySolid,
                )}
              >
                {isSubmitting ? "Saving…" : isEditMode ? "Save changes" : "Save"}
              </button>
            ) : null}
          </div>
        </div>
      </form>
    </motion.div>
  )
}
