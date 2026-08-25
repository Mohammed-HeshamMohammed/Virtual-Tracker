/* eslint-disable react-doctor/use-lazy-motion, react-doctor/exhaustive-deps, react-doctor/no-initialize-state */
"use client"

import { useState as useComponentState, useEffect, useMemo, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Check, Info } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { validateRequiredText } from "@/shared/validation"
import { TEAM_STEPS } from "@/features/members/config/ui-config"
import { PROJECTS_NAME_LIST_API_FIELDS } from "@/features/members/components/list-api-fields"
import { Tooltip } from "@/shared/ui/simple-tooltip";
import { MultiSelectField as MultiSelect } from "@/shared/ui/forms/multi-select-field"
import { Avatar } from "@/shared/ui/avatar";
import type { Member } from "@/features/members/models/member"
import type { TeamMember } from "@/features/teams/models/team"
import { getMembers } from "@/features/members/api/member-api"
import { getProjects, getProjectMembers } from "@/features/projects/api/project-api"
import { getTeamMembers } from "@/features/teams/api/team-api"
import { MyTeamScopeSwitch } from "@/features/members/components/my-team-scope-controls"
import { getMemberRoleLabel, normalizeMemberRole } from "@/features/auth"
import { getTeamStaffableMembers } from "@/features/members/services/member-relationships"
import { canAssignMemberToTeam, canBeTeamLead, canBeTeamMember } from "@/features/auth/permissions/team-member-assign-policy"
import { validateTeamMemberRoles, validateTeamRoster } from "@/features/teams/validators/validate-team-roster"

function memberRoleLabel(member: Member): string {
  const role = (member.role_name || member.role || "").trim()
  if (!role || role === "User") return ""
  return role
}

function isExcludedTeamMember(member: Member): boolean {
  const role = member.role_name || member.role || ""
  const key = normalizeMemberRole(role || "viewer")
  return key === "viewer" || key === "user" || !canBeTeamMember(role || "viewer")
}

function staffableSummaryToMember(row: {
  id: string
  first_name?: string
  last_name?: string
  work_email?: string
  role_name?: string
  avatar?: string
  avatar_color?: string
  avatar_url?: string
}): Member {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Unknown Member"
  const initials = row.avatar || name.slice(0, 2).toUpperCase() || "??"
  const role = row.role_name || ""
  return {
    id: row.id,
    name,
    email: row.work_email || "",
    avatar: initials,
    avatarColor: row.avatar_color || "#6366f1",
    avatarUrl: row.avatar_url,
    status: "active",
    role,
    role_name: role,
    projects: 0,
    payment: "",
    limits: "",
    trackingStatus: "offline",
    dateAdded: "",
    teams: 0,
    weeklyLimit: "",
  }
}

function rosterMemberToMember(roster: TeamMember): Member {
  const initials = roster.avatar || roster.name.slice(0, 2).toUpperCase() || "??"
  const role = roster.role || ""
  return {
    id: roster.id,
    name: roster.name,
    email: "",
    avatar: initials,
    avatarColor: roster.color || "#6366f1",
    avatarUrl: roster.avatarUrl,
    status: "active",
    role,
    role_name: role,
    projects: 0,
    payment: "",
    limits: "",
    trackingStatus: "offline",
    dateAdded: "",
    teams: 0,
    weeklyLimit: "",
  }
}

function memberIsIncluded(
  memberId: string,
  allowedMemberIds: Set<string> | null | undefined,
  rosterMemberIds: Set<string>,
): boolean {
  if (rosterMemberIds.has(memberId)) return true
  if (!allowedMemberIds) return true
  return allowedMemberIds.has(memberId)
}

export type TeamWizardSavePayload = {
  name: string
  schedule_weekly_report?: boolean
  memberIds: string[]
  leadIds: string[]
  projectIds: string[]
}

export type TeamWizardInitial = {
  name: string
  schedule_weekly_report?: boolean
  memberIds: string[]
  leadIds: string[]
  projectIds: string[]
}

interface AddTeamModalProps {
  onClose: () => void
  onSave: (team: TeamWizardSavePayload) => Promise<void>
  initial?: TeamWizardInitial | null
  mode?: "create" | "edit"
  /** When set, only these member ids can be assigned (manager hierarchy scope). */
  allowedMemberIds?: Set<string> | null
  /** Manager picker — subtree + org-wide employees from backend. */
  useTeamStaffablePicker?: boolean
  /** Current team roster — always shown in edit picker even outside hierarchy scope. */
  rosterMembers?: TeamMember[]
  /** Current team projects — always shown in edit picker even outside project scope. */
  rosterProjects?: Array<{ id: string; name: string }>
  /** When editing, fetch fresh roster for this team id. */
  teamId?: string
  /** Actor role — limits which members can be assigned (rank ceiling). */
  actorRole?: string
  /** When set, project picker is limited to projects with members in this tree scope. */
  teamScopeMemberIds?: Set<string> | null
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-start justify-center gap-0 mb-6">
      {TEAM_STEPS.map((s, i) => {
        const done = step > s.n
        const active = step === s.n
        return (
          <div key={s.n} className="flex items-start">
            <div className="flex flex-col items-center gap-2 w-28">
              <div
                className={cn(
                  "w-9 h-9 rounded-full border-2 flex items-center justify-center text-sm font-semibold transition-colors",
                  done
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : active
                      ? "bg-white dark:bg-slate-800 border-blue-400 dark:border-emerald-500 text-blue-500 dark:text-emerald-400"
                      : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500"
                )}
              >
                {done ? <Check className="w-4 h-4" /> : s.n}
              </div>
              <span
                className={cn(
                  "text-[10px] font-bold tracking-wider uppercase text-center leading-tight whitespace-nowrap",
                  active ? "text-blue-500 dark:text-emerald-400" : done ? "text-slate-400 dark:text-slate-500" : "text-slate-400 dark:text-slate-500"
                )}
              >
                {s.label}
              </span>
            </div>
            {i < TEAM_STEPS.length - 1 && (
              <div className="w-28 h-0.5 mt-[18px] relative">
                <div className="absolute inset-0 bg-slate-200 dark:bg-slate-700 rounded-full" />
                <motion.div
                  className="absolute inset-y-0 left-0 bg-emerald-500 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: done ? "100%" : "0%" }}
                  transition={{ duration: 0.4 }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function formatMemberOptionLabel(member: Member): string {
  const role = memberRoleLabel(member)
  return role ? `${member.name} (${role})` : member.name
}

function buildRosterPayload(
  selectedMembers: string[],
  selectedLeads: string[],
  assignableMemberIds: Set<string>,
  scopedMembers: Member[],
): { memberIds: string[]; leadIds: string[] } {
  const memberIdSet = new Set(selectedMembers.filter((id) => assignableMemberIds.has(id)))
  for (const leadId of selectedLeads) {
    if (!assignableMemberIds.has(leadId)) continue
    const role =
      scopedMembers.find((m) => m.id === leadId)?.role_name ||
      scopedMembers.find((m) => m.id === leadId)?.role ||
      ""
    if (canBeTeamLead(role)) memberIdSet.add(leadId)
  }

  const memberIds = [...memberIdSet]
  const leadIds = selectedLeads.filter(
    (id) =>
      memberIdSet.has(id) &&
      canBeTeamLead(
        scopedMembers.find((m) => m.id === id)?.role_name ||
          scopedMembers.find((m) => m.id === id)?.role ||
          "",
      ),
  )

  return { memberIds, leadIds }
}

export function AddTeamModal({
  onClose,
  onSave,
  initial,
  mode = "create",
  allowedMemberIds = null,
  useTeamStaffablePicker = false,
  rosterMembers = [],
  rosterProjects = [],
  teamId,
  actorRole = "",
  teamScopeMemberIds = null,
}: AddTeamModalProps) {
  const isEdit = mode === "edit"
  // If the exit animation's deferred unmount ever stalls, this invisible fixed-inset-0
  // backdrop would keep intercepting every click/hover on the dashboard underneath it.
  const [isClosing, setIsClosing] = useComponentState(false)
  const handleClose = () => {
    setIsClosing(true)
    onClose()
  }
  const [step, setStep] = useComponentState(1)
  const [teamName, setTeamName] = useComponentState(initial?.name ?? "")
  const [selectedMembers, setSelectedMembers] = useComponentState<string[]>(initial?.memberIds ?? [])
  const [selectedLeads, setSelectedLeads] = useComponentState<string[]>(initial?.leadIds ?? [])
  const [selectedProjects, setSelectedProjects] = useComponentState<string[]>(initial?.projectIds ?? [])
  const [scheduleReport, setScheduleReport] = useComponentState(initial?.schedule_weekly_report ?? true)
  const [members, setMembers] = useComponentState<Member[]>([])
  const [projects, setProjects] = useComponentState<{ id: string; name: string }[]>([])
  const [membersLoading, setMembersLoading] = useComponentState(true)
  const [projectsLoading, setProjectsLoading] = useComponentState(false)
  const [saving, setSaving] = useComponentState(false)
  const [saveError, setSaveError] = useComponentState<string | null>(null)
  const [fetchedRoster, setFetchedRoster] = useComponentState<TeamMember[]>([])
  const hasHydratedInitialRef = useRef(false)
  const shouldFetchRoster = mode === "edit" && Boolean(teamId)
  const teamScopeActive = Boolean(teamScopeMemberIds && teamScopeMemberIds.size > 0)
  const projectsScopeKey = teamScopeActive
    ? `team:${[...teamScopeMemberIds!].sort().join(",")}`
    : "all"

  const rosterKey = `${mode}:${teamId ?? ""}`
  const [prevRosterKey, setPrevRosterKey] = useComponentState(rosterKey)
  if (rosterKey !== prevRosterKey) {
    setPrevRosterKey(rosterKey)
    if (!shouldFetchRoster) {
      setFetchedRoster([])
    }
  }

  useEffect(() => {
    async function fetchMembers() {
      try {
        const membersData = useTeamStaffablePicker
          ? await getTeamStaffableMembers().then((result) =>
              Array.isArray(result.members) ? result.members.map(staffableSummaryToMember) : [],
            )
          : await getMembers({
              fields: [
                "id",
                "first_name",
                "last_name",
                "work_email",
                "role",
                "role_name",
                "avatar",
                "avatar_color",
                "avatar_url",
              ],
            })
        setMembers(membersData)
      } catch (err) {
        console.error("Failed to fetch members:", err)
      } finally {
        setMembersLoading(false)
      }
    }
    void fetchMembers()
  }, [useTeamStaffablePicker])

  useEffect(() => {
    let cancelled = false
    setProjectsLoading(true)
    void Promise.all([
      getProjects({ fields: [...PROJECTS_NAME_LIST_API_FIELDS] }),
      teamScopeActive
        ? getProjectMembers(undefined, { fields: ["project_id", "member_id"] })
        : Promise.resolve([]),
    ])
      .then(([projectsData, projectMemberLinks]) => {
        if (cancelled) return
        let nextProjects = projectsData.map((project) => ({ id: project.id, name: project.name }))
        if (teamScopeActive && teamScopeMemberIds && teamScopeMemberIds.size > 0) {
          const allowedProjectIds = new Set<string>()
          for (const link of projectMemberLinks) {
            if (teamScopeMemberIds.has(link.memberId)) {
              allowedProjectIds.add(link.projectId)
            }
          }
          for (const project of rosterProjects) {
            allowedProjectIds.add(project.id)
          }
          const scopedProjects = nextProjects.filter((project) => allowedProjectIds.has(project.id))
          if (scopedProjects.length > 0) {
            nextProjects = scopedProjects
          }
        }
        setProjects(nextProjects)
      })
      .catch((err) => {
        if (!cancelled) console.error("Failed to fetch projects:", err)
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectsScopeKey, teamScopeActive, teamScopeMemberIds, rosterProjects])

  useEffect(() => {
    if (!shouldFetchRoster || !teamId) return
    let cancelled = false
    void getTeamMembers(teamId)
      .then((rows) => {
        if (cancelled) return
        setFetchedRoster(
          rows.map((row) => {
            const name = row.member_name || "Unknown"
            return {
              id: row.member_id,
              name,
              // `avatar` is the initials text slot; the photo URL goes to avatarUrl.
              avatar:
                name
                  .split(/\s+/)
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase() || "?",
              avatarUrl: row.member_avatar_url || undefined,
              color: row.member_color,
              role: row.member_role,
              is_lead: row.is_lead,
            }
          }),
        )
      })
      .catch((err) => {
        if (!cancelled) console.error("Failed to fetch team roster:", err)
      })
    return () => {
      cancelled = true
    }
  }, [shouldFetchRoster, teamId])

  useEffect(() => {
    hasHydratedInitialRef.current = false
  }, [initial, mode, teamId, fetchedRoster])

  const effectiveRosterMembers = fetchedRoster.length > 0 ? fetchedRoster : rosterMembers

  const rosterMemberIds = useMemo(
    () => new Set(effectiveRosterMembers.map((member) => member.id)),
    [effectiveRosterMembers],
  )

  const scopedMembers = useMemo(() => {
    const byId = new Map<string, Member>()

    for (const member of members) {
      if (!memberIsIncluded(member.id, allowedMemberIds, rosterMemberIds)) continue
      if (isExcludedTeamMember(member)) continue
      if (actorRole && !canAssignMemberToTeam(actorRole, getMemberRoleLabel(member))) continue
      byId.set(member.id, member)
    }

    for (const rosterMember of effectiveRosterMembers) {
      const existing = byId.get(rosterMember.id)
      if (existing) {
        if (!memberRoleLabel(existing) && rosterMember.role) {
          byId.set(rosterMember.id, {
            ...existing,
            role: rosterMember.role,
            role_name: rosterMember.role,
          })
        }
        continue
      }
      byId.set(rosterMember.id, rosterMemberToMember(rosterMember))
    }

    return Array.from(byId.values())
  }, [members, allowedMemberIds, effectiveRosterMembers, rosterMemberIds, actorRole])

  const assignableMemberIds = useMemo(() => new Set(scopedMembers.map((m) => m.id)), [scopedMembers])

  const rosterDraft = useMemo(
    () => buildRosterPayload(selectedMembers, selectedLeads, assignableMemberIds, scopedMembers),
    [selectedMembers, selectedLeads, assignableMemberIds, scopedMembers],
  )

  const membersById = useMemo(() => new Map(scopedMembers.map((m) => [m.id, m])), [scopedMembers])

  const rosterValidationError = useMemo(() => {
    const rosterError = validateTeamRoster(rosterDraft.memberIds, rosterDraft.leadIds)
    if (rosterError) return rosterError
    return validateTeamMemberRoles(rosterDraft.memberIds, membersById)
  }, [rosterDraft, membersById])

  function handleNext() {
    if (step === 2) {
      if (rosterValidationError) {
        setSaveError(rosterValidationError)
        return
      }
      setSaveError(null)
    }
    if (step < 3) setStep((s) => s + 1)
  }

  function handleBack() {
    if (step > 1) setStep((s) => s - 1)
  }

  async function handleSave() {
    if (saving) return
    const validationError = validateRequiredText(teamName, "Team name")
    if (validationError) {
      setSaveError(validationError)
      return
    }
    if (rosterValidationError) {
      setSaveError(rosterValidationError)
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      await onSave({
        name: teamName.trim(),
        schedule_weekly_report: scheduleReport,
        memberIds: rosterDraft.memberIds,
        leadIds: rosterDraft.leadIds,
        projectIds: selectedProjects,
      })
      handleClose()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save team")
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (membersLoading || hasHydratedInitialRef.current) return

    if (initial && mode === "edit") {
      setTeamName(initial.name)
      setScheduleReport(initial.schedule_weekly_report ?? true)
      setSelectedMembers(initial.memberIds.filter((id) => assignableMemberIds.has(id)))
      setSelectedLeads(initial.leadIds.filter((id) => assignableMemberIds.has(id)))
      setSelectedProjects(initial.projectIds)
      hasHydratedInitialRef.current = true
      return
    }

    setSelectedMembers((prev) => prev.filter((id) => assignableMemberIds.has(id)))
    setSelectedLeads((prev) =>
      prev.filter((id) => assignableMemberIds.has(id) && canBeTeamLead(
        scopedMembers.find((m) => m.id === id)?.role_name ||
          scopedMembers.find((m) => m.id === id)?.role ||
          "",
      )),
    )
    hasHydratedInitialRef.current = true
  }, [membersLoading, initial, mode, assignableMemberIds, setTeamName, setScheduleReport, setSelectedMembers, setSelectedLeads, setSelectedProjects])

  const leadEligibleMembers = useMemo(
    () =>
      scopedMembers.filter((member) =>
        canBeTeamLead(member.role_name || member.role || ""),
      ),
    [scopedMembers],
  )

  const leadMemberOptions = useMemo(
    () =>
      leadEligibleMembers
        .filter((m) => selectedMembers.includes(m.id))
        .map((m) => ({
          label: formatMemberOptionLabel(m),
          value: m.id,
          meta: (
            <Avatar
              initials={m.avatar}
              color={m.avatarColor}
              imageUrl={m.avatarUrl}
              alt={m.name}
              size="sm"
            />
          ),
        })),
    [leadEligibleMembers, selectedMembers],
  )

  const memberOptions = scopedMembers.map((m) => ({
    label: formatMemberOptionLabel(m),
    value: m.id,
    meta: (
      <Avatar
        initials={m.avatar}
        color={m.avatarColor}
        imageUrl={m.avatarUrl}
        alt={m.name}
        size="sm"
      />
    ),
  }))

  const projectOptions = useMemo(() => {
    const byId = new Map(projects.map((project) => [project.id, project]))
    for (const project of rosterProjects) {
      if (!byId.has(project.id)) {
        byId.set(project.id, { id: project.id, name: project.name })
      }
    }
    return [...byId.values()].map((project) => ({
      label: project.name,
      value: project.id,
    }))
  }, [projects, rosterProjects])

  useEffect(() => {
    const allowedProjectIds = new Set(projectOptions.map((option) => option.value))
    setSelectedProjects((prev) => prev.filter((id) => allowedProjectIds.has(id)))
  }, [projectOptions, setSelectedProjects])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={cn(
        "fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6",
        isClosing && "pointer-events-none",
      )}
      onClick={handleClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, y: 12, opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-[600px] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-7 pt-6 pb-2 shrink-0">
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">{isEdit ? "Edit team" : "New team"}</h2>
          <div className="flex items-center gap-2">
            <MyTeamScopeSwitch />
            <button onClick={handleClose} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors" type="button">
              <X className="w-5 h-5 text-slate-400 dark:text-slate-500" />
            </button>
          </div>
        </div>

        {/* Stepper */}
        <div className="px-7 pt-4 pb-0 shrink-0">
          <Stepper step={step} />
        </div>

        {/* Body */}
        <div className="px-7 pb-4">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.18 }}
                className="space-y-4 pt-2"
              >
                <div>
                  <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 block" htmlFor="fallback-id">
                    TEAM NAME*
                  </label>
                  <input
                    type="text"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && teamName.trim() && handleNext()}
                    placeholder="Enter a team name"
                    className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-400 dark:focus:border-emerald-500 focus:ring-2 focus:ring-blue-400/20 dark:focus:ring-emerald-500/20 transition-colors" aria-label="Interactive control"
                  />
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.18 }}
                className="space-y-5 pt-2"
              >
                <div>
                  <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 block">
                    MEMBERS
                  </label>
                  <MultiSelect
                    placeholder="Select members"
                    options={memberOptions}
                    selected={selectedMembers}
                    onChange={(ids) => {
                      setSelectedMembers(ids)
                      setSelectedLeads((prev) => prev.filter((id) => ids.includes(id)))
                      setSaveError(null)
                    }}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      TEAM LEADS
                    </label>
                    <Tooltip text="Team leads can manage members, approve timesheets and more.">
                      <Info className="w-4 h-4 text-slate-400 dark:text-slate-500 cursor-default" />
                    </Tooltip>
                  </div>
                  <MultiSelect
                    placeholder="Select members"
                    options={leadMemberOptions}
                    selected={selectedLeads.filter((id) => leadMemberOptions.some((o) => o.value === id))}
                    onChange={(ids) => {
                      setSelectedLeads(ids)
                      setSaveError(null)
                    }}
                  />
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                    Only Team Lead and above can be team leads. At least one member and one team lead are required.
                  </p>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.18 }}
                className="space-y-5 pt-2"
              >
                <div>
                  <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 block">
                    PROJECTS
                  </label>
                  <MultiSelect
                    placeholder={
                      projectsLoading
                        ? "Loading projects…"
                        : projectOptions.length === 0
                          ? "No projects available"
                          : "Select projects"
                    }
                    options={projectOptions}
                    selected={selectedProjects}
                    onChange={setSelectedProjects}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Schedule report toggle */}
        <div className="px-7 pb-4">
          <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Schedule weekly report</span>
              <Tooltip text="Automatically schedule a weekly time and activity report for this team to be sent to you and the team leads.">
                <Info className="w-4 h-4 text-slate-400 dark:text-slate-500 cursor-default" />
              </Tooltip>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={scheduleReport}
              onClick={() => setScheduleReport((v) => !v)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
                scheduleReport ? "bg-blue-500 dark:bg-emerald-500" : "bg-slate-200 dark:bg-slate-700"
              )}
            >
              {scheduleReport && (
                <span className="absolute left-1 top-1/2 -translate-y-1/2">
                  <Check className="w-3 h-3 text-white" />
                </span>
              )}
              <span
                className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200",
                  scheduleReport ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>
        </div>

        {saveError ? (
          <p className="px-7 pb-2 text-sm text-red-500 dark:text-red-400">{saveError}</p>
        ) : null}

        {/* Footer */}
        <div className="flex items-center justify-between px-7 py-4 border-t border-slate-100 dark:border-slate-800 shrink-0 bg-white dark:bg-slate-900 rounded-b-2xl">
          <button
            onClick={handleClose}
            className="px-5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" type="button"
          >
            Cancel
          </button>
          <div className="flex items-center gap-3">
            {step > 1 && (
              <button
                onClick={handleBack}
                className="px-5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" type="button"
              >
                Back
              </button>
            )}
            {step < 3 ? (
                <button
                  onClick={handleNext}
                  disabled={
                    (step === 1 && !teamName.trim()) ||
                    (step === 2 && Boolean(rosterValidationError))
                  }
                  className="px-6 py-2.5 bg-blue-500 dark:bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-600 dark:hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" type="button"
                >
                  Next
                </button>
            ) : (
                <button
                  onClick={handleSave}
                  disabled={saving || Boolean(rosterValidationError)}
                  className="px-6 py-2.5 bg-blue-500 dark:bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-600 dark:hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" type="button"
                >
                  {saving ? "Saving…" : isEdit ? "Save changes" : "Save"}
                </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
