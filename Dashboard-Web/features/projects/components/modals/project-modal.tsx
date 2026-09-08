"use client"

import { useCallback, useEffect, useMemo, useState as useComponentState, type FormEvent, type ReactNode } from "react"
import { useEntityLiveGuard } from "@/shared/hooks/use-entity-live-guard"
import { changedEvent } from "@/infrastructure/api/change-events"
import { AnimatePresence, motion } from "framer-motion"
import { X, Info, Wallet, Users, Bell, TimerOff, RotateCw } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import {
  fetchProjectForEdit,
  getProjectFormConfig,
  getProjectTeams,
  type CreateProjectFormPayload,
  type ProjectMemberLimitEntry,
  type ProjectFormConfig,
  type ProjectFormTab,
  type ProjectTeamOption,
} from "@/infrastructure/api"
import type { ProjectType } from "@/features/projects/api/project-api"
import { ProjectTypePicker } from "@/features/projects/components/modals/project-type-picker"
import {
  MemberLimitsEditor,
  derivedBasedOn,
  derivedLimitType,
} from "@/features/projects/components/modals/member-limits-editor"
import { projectTypeDef } from "@/features/projects/config/project-types"
import { SubProjectsPicker, type SubProjectOption } from "@/features/projects/components/modals/sub-projects-picker"
import { getProjectMembers, getProjects } from "@/features/projects/api/project-api"
import { formatHoursLabel } from "@/features/projects/components/project-table-cells"
import type { Team } from "@/features/teams/api/team-api"
import { getTeamMembers, getTeams } from "@/features/teams/api/team-api"
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
import { ProjectModalSkeleton } from "@/features/projects/components/skeletons/project-modal-skeleton"
import { getProjectBudgetFieldErrors, validateProjectBudgetFields, validateProjectNames, type ProjectBudgetFieldErrors } from "@/shared/validation/project-form"
import { filterProjectFormMemberIds } from "@/features/projects/utils/project-form-member-filter"
import { decimalHoursToParts, partsToDecimalHours } from "@/shared/utils/hours-minutes"
import { syncProjectMembersFromTeams } from "@/features/projects/utils/sync-members-from-teams"
import {
  aggregateClientBudgetsForProject,
} from "@/features/projects/utils/aggregate-client-budgets"
import {
  PROJECT_MEMBER_LIMITS_COMING_SOON_MESSAGE,
  PROJECT_MEMBER_LIMITS_ENABLED,
} from "@/features/projects/config/project-management-config"
import { usePermissions } from "@/features/auth/hooks/use-permissions"

const MODAL_BODY_CLASS = cn("min-h-0 flex-1 px-5 py-5", FORM_SCROLL_HIDDEN)

interface AddProjectFormState {
  projectNames: string
  type: ProjectType
  billable: boolean
  disableActivity: boolean
  allowProjectTracking: boolean
  requireTaskToTrack: boolean
  restrictTaskCreation: boolean
  requireStopNote: boolean
  clientCanManage: boolean
  clientCanTrack: boolean
  subProjectIds: string[]
  disableIdleTime: boolean
  idleTimeMinutes: string
  endDate: string
  clientIds: string[]
  teams: string[]
  managers: string[]
  users: string[]
  viewers: string[]
  memberLimit: string
  budgetStopTimers: boolean
  budgetType: string
  budgetTypeTouched: boolean
  budgetBasedOn: string
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
  memberLimitRows: Record<string, ProjectMemberLimitEntry>
  memberOwnLimits: Record<string, { daily: number; weekly: number }>
  includeNonBillableTime: boolean
  budgetSpent: number
  budgetTotal: string
}

const PROJECT_COLOR_POOL = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6", "#0ea5e9"]

/**
 * 7.5 minutes — the same default `projects.idle_time_seconds` carries in
 * `ensure-lookup-schema.js`, and the fallback the agent and backend both use.
 * Kept in one place here so the form's initial value, the edit-time hydration
 * and the save-time floor can't drift apart.
 */
const DEFAULT_IDLE_TIME_SECONDS = 450
export const MEMBERS_TEAMS_TAB_KEY = "members-teams"
export const LIMITS_TAB_KEY = "limits"
export const MANAGEMENT_TAB_KEY = "management"

function emptyMemberLimitRow(memberId: string): ProjectMemberLimitEntry {
  return { memberId, type: "", basedOn: "", cost: "", resets: "Never", startDate: "" }
}

const TAB_LABEL_OVERRIDES: Record<string, string> = {
  budget: "BUDGET LIMITS",
  [LIMITS_TAB_KEY]: "MEMBERS LIMITS",
}

const DEFAULT_ADD_PROJECT_TABS: ProjectFormTab[] = [
  { key: "general", label: "GENERAL" },
  { key: MEMBERS_TEAMS_TAB_KEY, label: "MEMBERS & TEAMS" },
  { key: "budget", label: "BUDGET LIMITS" },
  { key: LIMITS_TAB_KEY, label: "MEMBERS LIMITS" },
]

function normalizeProjectModalTabs(tabs: ProjectFormTab[]): ProjectFormTab[] {
  const hasMembers = tabs.some((tab) => tab.key === "members")
  const hasTeams = tabs.some((tab) => tab.key === "teams")

  const normalized: ProjectFormTab[] = []
  let merged = false
  for (const tab of tabs) {
    if (tab.key === "members" || tab.key === "teams") {
      if (hasMembers || hasTeams) {
        if (!merged) {
          normalized.push({ key: MEMBERS_TEAMS_TAB_KEY, label: "MEMBERS & TEAMS" })
          merged = true
        }
        continue
      }
    }
    normalized.push({ ...tab, label: TAB_LABEL_OVERRIDES[tab.key] ?? tab.label })
    if (tab.key === "budget" && !tabs.some((t) => t.key === LIMITS_TAB_KEY)) {
      normalized.push({ key: LIMITS_TAB_KEY, label: "MEMBERS LIMITS" })
    }
  }
  return normalized
}
type AddProjectTab = string

function createDefaultAddForm(): AddProjectFormState {
  return {
    projectNames: "",
    type: "normal",
    billable: true,
    disableActivity: false,
    allowProjectTracking: true,
    requireTaskToTrack: true,
    restrictTaskCreation: true,
    requireStopNote: false,
    clientCanManage: false,
    clientCanTrack: false,
    subProjectIds: [],
    disableIdleTime: false,
    idleTimeMinutes: String(DEFAULT_IDLE_TIME_SECONDS / 60),
    endDate: "",
    clientIds: [],
    teams: [],
    managers: [],
    users: [],
    viewers: [],
    memberLimit: "",
    budgetStopTimers: true,
    budgetType: "Cost based",
    budgetTypeTouched: false,
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
    memberLimitRows: {},
    memberOwnLimits: {},
    includeNonBillableTime: true,
    budgetSpent: 0,
    budgetTotal: "5000",
  }
}

function toSelectOptions(items: string[], placeholder = "Select") {
  return [{ value: "", label: placeholder }, ...items.map((item) => ({ value: item, label: item }))]
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
    requireTaskToTrack: addForm.requireTaskToTrack,
    restrictTaskCreation: addForm.restrictTaskCreation,
    requireStopNote: addForm.requireStopNote,
    clientCanManage: addForm.clientCanManage,
    clientCanTrack: addForm.clientCanTrack,
    subProjectIds: projectTypeDef(addForm.type).hasSubProjects ? addForm.subProjectIds : [],
    disableIdleTime: addForm.disableIdleTime,
    // ID-4: a cleared field used to floor to 0, which the agent reads as an
    // idle allowance that can never be satisfied - it stops and rewinds the
    // session on the first tick, so the project cannot be tracked at all.
    // Fall back to the same 450s default an unset project already gets rather
    // than sending a value that bricks tracking.
    idleTimeSeconds: Math.round((Number(addForm.idleTimeMinutes) || 0) * 60) || DEFAULT_IDLE_TIME_SECONDS,
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
    memberLimits: memberLimitMemberIds.map((memberId) => ({
      ...(addForm.memberLimitRows[memberId] ?? emptyMemberLimitRow(memberId)),
      type: derivedLimitType(addForm.budgetType),
      basedOn: derivedBasedOn(addForm.budgetType, addForm.budgetBasedOn),
    })),
    memberOwnLimits: addForm.memberOwnLimits,
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
  onSave: (
    editingProjectId: string | null,
    payloads: CreateProjectFormPayload[],
    editingBudgetId?: string,
    expectedUpdatedAt?: string,
    expectedBudgetUpdatedAt?: string,
  ) => Promise<void>
  onEntityGone?: (message: string) => void
  readOnly?: boolean
}

export function ProjectModal({
  projectId,
  user,
  onClose,
  onSave,
  onEntityGone,
  readOnly = false,
}: ProjectModalProps) {
  const formTheme = useClientFormTheme()
  const segmented = useSegmentedClasses()
  const isEditMode = projectId !== null

  const [addForm, setAddForm] = useComponentState<AddProjectFormState>(createDefaultAddForm)
  const [budgetFieldErrors, setBudgetFieldErrors] = useComponentState<ProjectBudgetFieldErrors>({})
  const [editingBudgetId, setEditingBudgetId] = useComponentState<string | undefined>(undefined)
  const [editingUpdatedAt, setEditingUpdatedAt] = useComponentState<string | undefined>(undefined)
  const [editingBudgetUpdatedAt, setEditingBudgetUpdatedAt] = useComponentState<string | undefined>(undefined)
  const [addProjectTab, setAddProjectTab] = useComponentState<AddProjectTab>("general")
  const [addProjectStep, setAddProjectStep] = useComponentState<"type" | "form">(
    isEditMode ? "form" : "type",
  )
  const { isAdminOrOwner, isSuperManager } = usePermissions()
  const canManageProjectTracking = isAdminOrOwner || isSuperManager

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
  const [reloadKey, setReloadKey] = useComponentState(0)
  const [liveUpdateNotice, setLiveUpdateNotice] = useComponentState(false)
  const [staleSelectionNote, setStaleSelectionNote] = useComponentState<string | null>(null)

  const modalContentLoading = isEditMode && editFormLoading
  const formConfigPending = formConfigLoading && !formConfig && !formConfigError
  const saveDisabledReason = useMemo((): string | null => {
    if (isSubmitting) return "Saving…"
    if (modalContentLoading || formConfigPending) return "Still loading this project's settings."
    if (!addForm.projectNames.trim()) return "A project name is required."
    if (addForm.budgetType.trim() && !addForm.budgetTotal.trim()) {
      return "Enter a budget amount, or clear the budget type to save without one."
    }
    return null
  }, [
    isSubmitting,
    modalContentLoading,
    formConfigPending,
    addForm.projectNames,
    addForm.budgetType,
    addForm.budgetTotal,
  ])

  const addProjectTabs = useMemo(() => {
    const base = normalizeProjectModalTabs(formConfig?.tabs ?? DEFAULT_ADD_PROJECT_TABS)
    if (!canManageProjectTracking) return base
    return [...base, { key: MANAGEMENT_TAB_KEY, label: "MANAGEMENT" }]
  }, [formConfig?.tabs, canManageProjectTracking])

  const memberLabelById = useMemo(
    () => Object.fromEntries((formConfig?.options.members ?? []).map((m) => [m.id, m.label])),
    [formConfig?.options.members],
  )

  const [subProjectOptions, setSubProjectOptions] = useComponentState<SubProjectOption[]>([])
  const [managerNamesByProject, setManagerNamesByProject] = useComponentState<Record<string, string[]>>({})

  const canHaveSubProjects = projectTypeDef(addForm.type).hasSubProjects

  useEffect(() => {
    if (!canHaveSubProjects) return
    let cancelled = false
    void Promise.all([getProjects(), getProjectMembers()])
      .then(([projects, links]) => {
        if (cancelled) return
        const candidates = projects
          .filter((p) => !projectTypeDef(p.type).hasSubProjects && p.id !== projectId)
          .map((p) => ({ id: p.id, name: p.name, type: String(p.type ?? "normal") }))
        setSubProjectOptions(candidates)

        const byProject: Record<string, string[]> = {}
        for (const link of links) {
          if (String(link.projectRole ?? "").toLowerCase() !== "manager") continue
          const label = memberLabelById[link.memberId]
          if (!label) continue
          ;(byProject[link.projectId] ??= []).push(label)
        }
        setManagerNamesByProject(byProject)
      })
      .catch(() => {
        if (!cancelled) setSubProjectOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [canHaveSubProjects, projectId, memberLabelById])


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
      setLiveUpdateNotice(false)
      setStaleSelectionNote(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    const load = () => {
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
    }
    load()
    const onClientsChanged = () => load()
    const onMembersChanged = () => load()
    window.addEventListener(changedEvent("clients"), onClientsChanged)
    window.addEventListener(changedEvent("members"), onMembersChanged)
    return () => {
      cancelled = true
      window.removeEventListener(changedEvent("clients"), onClientsChanged)
      window.removeEventListener(changedEvent("members"), onMembersChanged)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      getTeams()
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
    }
    load()
    const onTeamsChanged = () => load()
    window.addEventListener(changedEvent("teams"), onTeamsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(changedEvent("teams"), onTeamsChanged)
    }
  }, [user?.uid, user?.email])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      getTeamMembers(undefined, { fields: ["team_id", "member_id", "member_role"] })
        .then((rows) => {
          if (!cancelled) setAllTeamMembers(rows)
        })
        .catch(() => {
          if (!cancelled) setAllTeamMembers([])
        })
    }
    load()
    const onChanged = () => load()
    window.addEventListener(changedEvent("teams"), onChanged)
    window.addEventListener(changedEvent("members"), onChanged)
    return () => {
      cancelled = true
      window.removeEventListener(changedEvent("teams"), onChanged)
      window.removeEventListener(changedEvent("members"), onChanged)
    }
  }, [])

  useEffect(() => {
    if (!formConfig) return
    const validClientIds = new Set(formConfig.options.clients.map((c) => c.id))
    const validMemberIds = new Set(formConfig.options.members.map((m) => m.id))
    setAddForm((prev) => {
      const nextClientIds = prev.clientIds.filter((id) => validClientIds.has(id))
      const nextManagers = prev.managers.filter((id) => validMemberIds.has(id))
      const nextUsers = prev.users.filter((id) => validMemberIds.has(id))
      const nextViewers = prev.viewers.filter((id) => validMemberIds.has(id))
      const nextMemberLimitMembers = prev.memberLimitMembers.filter((id) => validMemberIds.has(id))
      const droppedCount =
        prev.clientIds.length -
        nextClientIds.length +
        (prev.managers.length - nextManagers.length) +
        (prev.users.length - nextUsers.length) +
        (prev.viewers.length - nextViewers.length) +
        (prev.memberLimitMembers.length - nextMemberLimitMembers.length)
      if (droppedCount === 0) return prev
      setStaleSelectionNote(
        `${droppedCount} selected ${droppedCount === 1 ? "item was" : "items were"} removed and ${droppedCount === 1 ? "has" : "have"} been deselected.`,
      )
      return {
        ...prev,
        clientIds: nextClientIds,
        managers: nextManagers,
        users: nextUsers,
        viewers: nextViewers,
        memberLimitMembers: nextMemberLimitMembers,
      }
    })
  }, [formConfig])

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
        const { budgetId, updatedAt, budgetUpdatedAt, ...payload } = loaded
        setEditingBudgetId(budgetId)
        setEditingUpdatedAt(updatedAt)
        setEditingBudgetUpdatedAt(budgetUpdatedAt)
        setAddForm({
          projectNames: payload.name,
          type: payload.type ?? "normal",
          billable: payload.billable,
          disableActivity: payload.disableActivity,
          allowProjectTracking: payload.allowProjectTracking,
          requireTaskToTrack: payload.requireTaskToTrack,
          restrictTaskCreation: payload.restrictTaskCreation,
          requireStopNote: payload.requireStopNote,
          clientCanManage: payload.clientCanManage,
          clientCanTrack: payload.clientCanTrack,
          subProjectIds: payload.subProjectIds ?? [],
          disableIdleTime: payload.disableIdleTime,
          idleTimeMinutes: String((payload.idleTimeSeconds || DEFAULT_IDLE_TIME_SECONDS) / 60),
          endDate: payload.endDate || "",
          clientIds: payload.clientIds,
          teams: payload.teamIds,
          managers: payload.managerIds,
          users: payload.userIds,
          viewers: payload.viewerIds,
          memberLimit: payload.memberLimitMembers ?? "",
          memberLimitMembers: payload.memberLimitMemberIds,
          budgetStopTimers: payload.budgetStopTimers,
          budgetType: payload.budgetType,
          budgetTypeTouched: true,
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
          memberLimitRows: Object.fromEntries(
            (payload.memberLimits ?? []).map((row) => [row.memberId, row]),
          ),
          memberOwnLimits: payload.memberOwnLimits ?? {},
          includeNonBillableTime: payload.budgetIncludeNonBillable,
          budgetSpent: payload.budgetSpent,
          budgetTotal: payload.budgetTotal,
        })
      })
      .catch((err) => {
        if (cancelled) return
        const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined
        if (status === 404) {
          onClose()
          onEntityGone?.("This project no longer exists.")
          return
        }
        setSubmitError(err instanceof Error ? err.message : "Failed to load project details")
      })
      .finally(() => {
        if (!cancelled) setEditFormLoading(false)
      })
    return () => {
      cancelled = true
    }
    // reloadKey has no value of its own - bumping it (from the live-update
    // banner's "Reload" button) is only ever a signal to re-run this fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, reloadKey])

  const handleLiveDeleted = useCallback(() => {
    onClose()
    onEntityGone?.("This project was deleted by another user - your changes weren't saved.")
  }, [onClose, onEntityGone])
  const handleLiveUpdated = useCallback(() => {
    setLiveUpdateNotice(true)
  }, [setLiveUpdateNotice])
  useEntityLiveGuard({
    resource: "projects",
    id: projectId,
    onDeleted: handleLiveDeleted,
    onUpdated: handleLiveUpdated,
  })

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
    if (prev.budgetTypeTouched) {
      return { ...prev, clientIds }
    }
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

  function updateMemberLimitRow(memberId: string, patch: Partial<ProjectMemberLimitEntry>) {
    setAddForm((prev) => ({
      ...prev,
      memberLimitRows: {
        ...prev.memberLimitRows,
        [memberId]: { ...(prev.memberLimitRows[memberId] ?? emptyMemberLimitRow(memberId)), ...patch },
      },
    }))
  }

  function copyMemberLimitToAll(sourceMemberId: string) {
    setAddForm((prev) => {
      const source = prev.memberLimitRows[sourceMemberId]
      if (!source) return prev
      const nextRows = { ...prev.memberLimitRows }
      for (const memberId of prev.memberLimitMembers) {
        if (memberId === sourceMemberId) continue
        nextRows[memberId] = { ...source, memberId }
      }
      return { ...prev, memberLimitRows: nextRows }
    })
  }

  function removeMemberLimit(memberId: string) {
    setAddForm((prev) => {
      const nextRows = { ...prev.memberLimitRows }
      delete nextRows[memberId]
      return {
        ...prev,
        memberLimitMembers: prev.memberLimitMembers.filter((id) => id !== memberId),
        memberLimitRows: nextRows,
      }
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
    if (!PROJECT_MEMBER_LIMITS_ENABLED && addProjectTab === LIMITS_TAB_KEY) {
      setAddProjectTab("budget")
    }
  }, [addProjectTab])

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
    if (readOnly) return
    const projectNames = parseProjectNamesFromInput(addForm.projectNames)
    const namesError = validateProjectNames(projectNames)
    const budgetErrors = getProjectBudgetFieldErrors(addForm)
    const budgetError = validateProjectBudgetFields(addForm)
    if (budgetError) {
      setBudgetFieldErrors(budgetErrors)
      if (addProjectTab !== "budget") {
        setAddProjectTab("budget")
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
      const sanitizedAddForm = formConfig
        ? {
            ...addForm,
            clientIds: addForm.clientIds.filter((id) => formConfig.options.clients.some((c) => c.id === id)),
            managers: addForm.managers.filter((id) => formConfig.options.members.some((m) => m.id === id)),
            users: addForm.users.filter((id) => formConfig.options.members.some((m) => m.id === id)),
            viewers: addForm.viewers.filter((id) => formConfig.options.members.some((m) => m.id === id)),
            memberLimitMembers: addForm.memberLimitMembers.filter((id) =>
              formConfig.options.members.some((m) => m.id === id),
            ),
          }
        : addForm
      const payloads = projectNames.map((name) => formStateToPayload(sanitizedAddForm, name, memberRoleById))
      await onSave(projectId, payloads, editingBudgetId, editingUpdatedAt, editingBudgetUpdatedAt)
      onClose()
    } catch (err) {
      const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined
      if (status === 409) {
        setLiveUpdateNotice(true)
      } else {
        setSubmitError(err instanceof Error ? err.message : "Failed to save project")
      }
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
              {readOnly ? "View project" : isEditMode ? "Edit project" : "New project"}
            </h2>
            <p className={cn("mt-0.5 text-sm", formTheme.modal.subtitle)}>
              {readOnly
                ? "Project settings, members, and budget - read-only"
                : isEditMode
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

        <div className={MODAL_BODY_CLASS} inert={readOnly}>
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
                  const def = projectTypeDef(type)
                  setAddForm((p) => ({
                    ...p,
                    type,
                    billable: def.billable,
                    requireTaskToTrack: def.requiresTask,
                    budgetResets: def.defaultResets,
                    ...(def.forcesHours ? { budgetType: "Hours based", budgetBasedOn: "" } : {}),
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
                  checked={addForm.disableIdleTime}
                  onChange={(next) => setAddForm((p) => ({ ...p, disableIdleTime: next }))}
                  label={
                    <>
                      Disable idle time
                      <Info className={cn("h-3.5 w-3.5", formTheme.isDark ? "text-[#bccbb9]" : "text-slate-400")} />
                    </>
                  }
                />
                <ExpandCollapse show={!addForm.disableIdleTime}>
                  {(() => {
                    const totalMinutes = Number(addForm.idleTimeMinutes) || 0
                    const hours = Math.floor(totalMinutes / 60)
                    const minutes = totalMinutes - hours * 60
                    return (
                      <FormField
                        label="Idle time"
                        hint="How long without activity before time on this project is marked idle."
                        className="pt-1"
                      >
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <input
                              type="number"
                              min={0}
                              value={hours}
                              onChange={(e) =>
                                setAddForm((p) => ({
                                  ...p,
                                  idleTimeMinutes: String((Number(e.target.value) || 0) * 60 + minutes),
                                }))
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
                              step={0.5}
                              value={minutes}
                              onChange={(e) =>
                                setAddForm((p) => ({
                                  ...p,
                                  idleTimeMinutes: String(hours * 60 + (Number(e.target.value) || 0)),
                                }))
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
                      </FormField>
                    )
                  })()}
                </ExpandCollapse>
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
                      fields={
                        projectTypeDef(addForm.type).membersRoleFilter === "manager_and_above"
                          ? formConfig.fields.filter((f) => f.roleFilter !== "employee")
                          : formConfig.fields
                      }
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
                  {budgetFromClientsCount > 0 ? (
                    <p className={cn("text-xs leading-relaxed", formTheme.mutedText)}>
                      Project budget combines {budgetFromClientsCount} client
                      {budgetFromClientsCount === 1 ? "" : "s"}. Spend is split evenly across linked
                      clients; each client is notified at their own budget threshold on their share.
                    </p>
                  ) : null}

                  {!addForm.budgetType.trim() && !projectTypeDef(addForm.type).forcesHours ? (
                    <p className={cn("text-xs leading-relaxed", formTheme.mutedText)}>
                      This project has no budget. Pick a type below to give it one — nothing is capped
                      or notified until you do.
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
                        {projectTypeDef(addForm.type).forcesHours ? (
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
                                budgetTypeTouched: true,
                                budgetBasedOn: value === "Hours based" ? "" : (p.budgetBasedOn || "Bill rate"),
                              }))
                            }
                            options={[
                              { id: "", label: "No budget" },
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
              ) : null}

              {addProjectTab === LIMITS_TAB_KEY ? (
                PROJECT_MEMBER_LIMITS_ENABLED ? (
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

                  <MemberLimitsEditor
                    memberIds={addForm.memberLimitMembers}
                    rows={addForm.memberLimitRows}
                    ownLimits={addForm.memberOwnLimits}
                    memberLabels={memberLabelById}
                    budgetType={addForm.budgetType}
                    budgetBasedOn={addForm.budgetBasedOn}
                    onChange={updateMemberLimitRow}
                    onRemove={removeMemberLimit}
                    onCopyToAll={copyMemberLimitToAll}
                  />
                </div>
                ) : (
                  <div className={cn("rounded-xl border px-4 py-5", formTheme.card)}>
                    <p className={cn("text-sm leading-relaxed", formTheme.mutedText)}>
                      {PROJECT_MEMBER_LIMITS_COMING_SOON_MESSAGE}
                    </p>
                  </div>
                )
              ) : null}

              {addProjectTab === MANAGEMENT_TAB_KEY && canManageProjectTracking ? (
                <div className={FORM_STACK}>
                  {canHaveSubProjects ? (
                    <div className="flex flex-col gap-2">
                      <p className={cn("text-sm font-semibold", formTheme.modal.title)}>
                        Projects this one oversees
                      </p>
                      <SubProjectsPicker
                        options={subProjectOptions}
                        selectedIds={addForm.subProjectIds}
                        managerNamesByProject={managerNamesByProject}
                        onToggle={(id) =>
                          setAddForm((p) => ({
                            ...p,
                            subProjectIds: p.subProjectIds.includes(id)
                              ? p.subProjectIds.filter((x) => x !== id)
                              : [...p.subProjectIds, id],
                          }))
                        }
                      />
                    </div>
                  ) : null}
                  <div className={cn("flex flex-col gap-3 rounded-xl border p-3", formTheme.card)}>
                    <SettingToggleRow
                      checked={addForm.allowProjectTracking}
                      onChange={(next) => setAddForm((p) => ({ ...p, allowProjectTracking: next }))}
                      label={
                        <>
                          Allow managers to record time on this project
                          <Info className={cn("h-3.5 w-3.5", formTheme.isDark ? "text-[#bccbb9]" : "text-slate-400")} />
                        </>
                      }
                    />
                  </div>

                  {!projectTypeDef(addForm.type).hasTasks ? null : (
                    <div className={cn("flex flex-col gap-3 rounded-xl border p-3", formTheme.card)}>
                      <SettingToggleRow
                        checked={addForm.requireTaskToTrack}
                        onChange={(next) => setAddForm((p) => ({ ...p, requireTaskToTrack: next }))}
                        label="Require a task to start tracking"
                      />
                      <p className={cn("text-xs", formTheme.mutedText)}>
                        Off lets members run the timer against the project itself, with no task selected.
                      </p>
                      <SettingToggleRow
                        checked={addForm.restrictTaskCreation}
                        onChange={(next) => setAddForm((p) => ({ ...p, restrictTaskCreation: next }))}
                        label="Only managers can create tasks"
                      />
                      <p className={cn("text-xs", formTheme.mutedText)}>
                        Off lets any assigned member of this project add tasks to it.
                      </p>
                    </div>
                  )}

                  <div className={cn("flex flex-col gap-3 rounded-xl border p-3", formTheme.card)}>
                    <SettingToggleRow
                      checked={addForm.requireStopNote}
                      onChange={(next) => setAddForm((p) => ({ ...p, requireStopNote: next }))}
                      label="Require a note when stopping the timer"
                    />
                    <p className={cn("text-xs", formTheme.mutedText)}>
                      Members are asked what they worked on before their timer stops.
                    </p>
                  </div>

                  <div className={cn("flex flex-col gap-3 rounded-xl border p-3", formTheme.card)}>
                    <SettingToggleRow
                      checked={addForm.clientCanManage}
                      onChange={(next) => setAddForm((p) => ({ ...p, clientCanManage: next }))}
                      label="This project's client can manage it"
                    />
                    <p className={cn("text-xs", formTheme.mutedText)}>
                      On lets the client create and edit this project&apos;s tasks. Off, they can still see the
                      project, its activity and its reports, but change nothing.
                    </p>
                  </div>

                  <div className={cn("flex flex-col gap-3 rounded-xl border p-3", formTheme.card)}>
                    <SettingToggleRow
                      checked={addForm.clientCanTrack}
                      onChange={(next) => setAddForm((p) => ({ ...p, clientCanTrack: next }))}
                      label="This project's client can clock in"
                    />
                    <p className={cn("text-xs", formTheme.mutedText)}>
                      On lets the client run a timer on this project from the desktop app, alongside its other
                      members. Off, they can&apos;t track time on it at all.
                    </p>
                  </div>
                </div>
              ) : null}
            </>
          )}
          </motion.div>
          )}
          </AnimatePresence>
        </div>

        {staleSelectionNote ? (
          <div
            className={cn(
              "mx-5 mb-2 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm",
              formTheme.isDark
                ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                : "border-amber-200 bg-amber-50 text-amber-800",
            )}
          >
            <span>{staleSelectionNote}</span>
            <button
              type="button"
              onClick={() => setStaleSelectionNote(null)}
              className="shrink-0 text-sm font-medium underline underline-offset-2"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {liveUpdateNotice ? (
          <div
            className={cn(
              "mx-5 mb-2 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm",
              formTheme.isDark
                ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                : "border-amber-200 bg-amber-50 text-amber-800",
            )}
          >
            <span>Someone else changed this project while you had it open.</span>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setLiveUpdateNotice(false)}
                className="text-sm font-medium underline underline-offset-2"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => {
                  setLiveUpdateNotice(false)
                  setEditFormLoading(true)
                  setReloadKey((k) => k + 1)
                }}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium",
                  formTheme.isDark ? "bg-amber-500/20" : "bg-amber-100",
                )}
              >
                <RotateCw className="h-3.5 w-3.5" />
                Reload
              </button>
            </div>
          </div>
        ) : null}

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
              {readOnly ? "Close" : "Cancel"}
            </button>
            {addProjectStep === "form" && !readOnly ? (
              <button
                type="submit"
                disabled={saveDisabledReason !== null}
                title={saveDisabledReason ?? undefined}
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
