/* eslint-disable react-doctor/use-lazy-motion, react-doctor/exhaustive-deps, react-doctor/no-initialize-state */
/* eslint-disable react-doctor/prefer-module-scope-pure-function */
/* eslint-disable react-doctor/no-giant-component */
"use client"

import { useEffect, useMemo, useState as useComponentState, type FormEvent, type ReactNode } from "react"
import { motion } from "framer-motion"
import { X, Info } from "lucide-react"
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
import type { Team } from "@/features/teams/api/team-api"
import { getTeamMembers } from "@/features/teams/api/team-api"
import {
  FORM_GRID,
  FORM_STACK,
  FORM_SCROLL_HIDDEN,
  useClientFormTheme,
} from "@/shared/ui/forms/form-styles"
import { DatePickerField } from "@/shared/ui/forms/date-picker-field"
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
  billable: boolean
  disableActivity: boolean
  allowProjectTracking: boolean
  disableIdleTime: boolean
  clientIds: string[]
  teams: string[]
  managers: string[]
  users: string[]
  viewers: string[]
  memberLimit: string
  hasBudget: boolean
  budgetType: string
  budgetBasedOn: string
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
    billable: true,
    disableActivity: false,
    allowProjectTracking: true,
    disableIdleTime: false,
    clientIds: [],
    teams: [],
    managers: [],
    users: [],
    viewers: [],
    memberLimit: "",
    hasBudget: true,
    budgetType: "Total cost",
    budgetBasedOn: "Bill rate",
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
    billable: addForm.billable,
    disableActivity: addForm.disableActivity,
    allowProjectTracking: addForm.allowProjectTracking,
    disableIdleTime: addForm.disableIdleTime,
    clientIds: addForm.clientIds,
    teamIds: addForm.teams,
    managerIds,
    userIds,
    viewerIds: addForm.viewers,
    memberLimitMemberIds,
    hasBudget: addForm.hasBudget,
    budgetType: addForm.budgetType,
    budgetBasedOn: addForm.budgetBasedOn,
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
  const isEditMode = projectId !== null

  const [addForm, setAddForm] = useComponentState<AddProjectFormState>(createDefaultAddForm)
  const [budgetFieldErrors, setBudgetFieldErrors] = useComponentState<ProjectBudgetFieldErrors>({})
  const [editingBudgetId, setEditingBudgetId] = useComponentState<string | undefined>(undefined)
  const [addProjectTab, setAddProjectTab] = useComponentState<AddProjectTab>("general")
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
          billable: payload.billable,
          disableActivity: payload.disableActivity,
          allowProjectTracking: payload.allowProjectTracking,
          disableIdleTime: payload.disableIdleTime,
          clientIds: payload.clientIds,
          teams: payload.teamIds,
          managers: payload.managerIds,
          users: payload.userIds,
          viewers: payload.viewerIds,
          memberLimit: payload.memberLimitMembers ?? "",
          memberLimitMembers: payload.memberLimitMemberIds,
          hasBudget: payload.hasBudget,
          budgetType: payload.budgetType || "Total cost",
          budgetBasedOn: payload.budgetBasedOn || "Bill rate",
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
      hasBudget: aggregated.hasBudget,
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
    const budgetError = validateProjectBudgetFields(addForm)
    if (budgetError) {
      setBudgetFieldErrors(getProjectBudgetFieldErrors(addForm))
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

        <div className={cn("flex shrink-0 gap-1 overflow-x-auto border-b px-5", formTheme.modal.headerBorder)}>
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
                  <div className={FORM_GRID}>
                    <FormField label="Type" required>
                      <ProjectModalSelect
                        value={addForm.budgetType}
                        onChange={(value) => setAddForm((p) => ({ ...p, budgetType: value }))}
                        placeholder="Select a type"
                        options={["Total cost", "Hours limit", "Amount limit"]}
                      />
                    </FormField>
                    <FormField label="Based on" required>
                      <ProjectModalSelect
                        value={addForm.budgetBasedOn}
                        onChange={(value) => setAddForm((p) => ({ ...p, budgetBasedOn: value }))}
                        placeholder="Select a rate"
                        options={["Bill rate", "Pay rate"]}
                      />
                    </FormField>
                    <FormField label="Cost" required className="sm:col-span-2" error={budgetFieldErrors.budgetTotal}>
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
                    </FormField>
                  </div>

                  <SettingToggleRow
                    checked={addForm.budgetNotifyMembers}
                    onChange={(next) => setAddForm((p) => ({ ...p, budgetNotifyMembers: next }))}
                    label={
                      <>
                        Notify project members
                        <Info className={cn("h-3.5 w-3.5", formTheme.isDark ? "text-[#bccbb9]" : "text-slate-400")} />
                      </>
                    }
                  />

                  <div className={FORM_GRID}>
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
                          % budget
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

                  <SettingToggleRow
                    checked={addForm.hasBudget}
                    onChange={(next) => updateAddForm({ hasBudget: next })}
                    label="Stop timers when budget is reached"
                  />

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
                        % budget
                      </span>
                    </div>
                  </FormField>

                  <div className={FORM_GRID}>
                    <FormField label="Resets" required>
                      <ProjectModalSelect
                        value={addForm.budgetResets}
                        onChange={(value) => setAddForm((p) => ({ ...p, budgetResets: value }))}
                        options={["Never", "Weekly", "Monthly"]}
                      />
                    </FormField>
                    <FormField label="Start date">
                      <DatePickerField
                        value={addForm.budgetStartDate}
                        onChange={(date) => setAddForm((p) => ({ ...p, budgetStartDate: date }))}
                        placeholder="Select date"
                      />
                    </FormField>
                  </div>

                  <SettingToggleRow
                    checked={addForm.budgetIncludeNonBillable}
                    onChange={(next) => setAddForm((p) => ({ ...p, budgetIncludeNonBillable: next }))}
                    label="Include non-billable time"
                  />
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
            {addProjectTabs.map((item) => (
              <div
                key={item.key}
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  addProjectTab === item.key ? formTheme.accent.dot : formTheme.footer.dotInactive,
                )}
              />
            ))}
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
            <button
              type="submit"
              disabled={isSubmitting || modalContentLoading || formConfigPending}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                formTheme.accent.primarySolid,
              )}
            >
              {isSubmitting ? "Saving…" : isEditMode ? "Save changes" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </motion.div>
  )
}
