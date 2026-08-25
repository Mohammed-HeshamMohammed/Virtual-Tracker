/* eslint-disable react-doctor/exhaustive-deps */
/* eslint-disable react-doctor/no-giant-component */
"use client"

import { useEffect, useMemo, useState as useComponentState } from "react"
import { Users, UsersRound, Loader2 } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { getTeamMembers, type TeamMember } from "@/features/teams/api/team-api"
import { fetchTaskParticipation } from "@/features/tasks/api/task-assignments-api"
import type { ProjectTeamOption } from "@/features/projects/api/project-teams-api"
import type { MemberLookup } from "@/features/tasks/utils/team-assignee-options"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog"
import { SearchableSelectField } from "@/shared/ui/forms/searchable-select-field"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"

type TaskLike = {
  id: string
  title: string
  teamId: string | null
}

function displayNameForMember(
  memberId: string,
  fromLookup: MemberLookup | undefined,
  row: TeamMember,
): string {
  if (fromLookup?.name?.trim()) return fromLookup.name.trim()
  // No email fallback: member emails are Owner/Super Admin only
  // (field-policy.js) and the roster read no longer returns one. member_name
  // is already display_name-or-first+last, resolved server-side.
  if (row.member_name?.trim()) return row.member_name.trim()
  return "Unknown member"
}

function avatarForMember(
  fromLookup: MemberLookup | undefined,
  row: TeamMember,
  name: string,
): string {
  if (fromLookup?.avatar?.trim()) return fromLookup.avatar.trim()
  // member_avatar_url is a photo URL, not initials - deliberately not used
  // here, since this slot renders as text.
  return (
    name
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "??"
  )
}

export function TaskAssignButton({
  selectedTask,
  projectTeams,
  memberLookups,
  directProjectMembers = [],
  isDark,
  onAssign,
}: {
  selectedTask: TaskLike | null
  projectTeams: ProjectTeamOption[]
  memberLookups: MemberLookup[]
  /** Direct project members (not via team). Merged into the roster for display. */
  directProjectMembers?: MemberLookup[]
  isDark: boolean
  onAssign: (patch: { teamId: string; assignedTo: string | null; assigneeIds: string[] }) => void | Promise<void>
}) {
  const [selectedMemberIds, setSelectedMemberIds] = useComponentState<string[]>([])
  const t = isDark ? dark : light
  const [open, setOpen] = useComponentState(false)
  const [activeTeamId, setActiveTeamId] = useComponentState<string | null>(null)
  const [teamMembers, setTeamMembers] = useComponentState<TeamMember[]>([])
  const [loading, setLoading] = useComponentState(false)
  const [assignError, setAssignError] = useComponentState<string | null>(null)
  const [assigning, setAssigning] = useComponentState(false)

  const [prevOpen, setPrevOpen] = useComponentState(open)
  const [prevSelectedTask, setPrevSelectedTask] = useComponentState(selectedTask)

  if (open !== prevOpen || selectedTask !== prevSelectedTask) {
    setPrevOpen(open)
    setPrevSelectedTask(selectedTask)
    if (!open) {
      setActiveTeamId(null)
      setAssignError(null)
    } else if (selectedTask) {
      const taskTeam = selectedTask.teamId
      if (taskTeam && projectTeams.some((team) => team.id === taskTeam)) {
        setActiveTeamId(taskTeam)
      } else if (projectTeams.length === 1) {
        setActiveTeamId(projectTeams[0]!.id)
      } else {
        setActiveTeamId(null)
      }
    }
  }

  const memberById = useMemo(
    () => new Map(memberLookups.map((m) => [m.id, m])),
    [memberLookups],
  )

  const activeTeamName =
    projectTeams.find((team) => team.id === activeTeamId)?.name ?? "Teams"

  useEffect(() => {
    if (!open || !activeTeamId) {
      setTeamMembers([])
      return
    }
    let cancelled = false
    setLoading(true)
    getTeamMembers(activeTeamId)
      .then((rows) => {
        if (!cancelled) setTeamMembers(rows)
      })
      .catch(() => {
        if (!cancelled) setTeamMembers([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, activeTeamId])

  useEffect(() => {
    if (!open || !selectedTask) {
      setSelectedMemberIds([])
      return
    }
    let cancelled = false
    fetchTaskParticipation(selectedTask.id, { manage: true })
      .then((participation) => {
        if (cancelled) return
        const ids = participation.assignments.map((row) => row.userId).filter(Boolean)
        setSelectedMemberIds(ids)
      })
      .catch(() => {
        if (!cancelled) setSelectedMemberIds([])
      })
    return () => {
      cancelled = true
    }
  }, [open, selectedTask])

  // Build roster from the selected team only
  const roster = useMemo(() => {
    const seen = new Set<string>()
    const list: Array<{
      id: string
      name: string
      avatar: string
      color: string
      isLead: boolean
    }> = []

    for (const row of teamMembers) {
      const memberId = row.member_id
      if (!memberId || seen.has(memberId)) continue
      seen.add(memberId)

      const fromLookup = memberById.get(memberId)
      const name = displayNameForMember(memberId, fromLookup, row)
      list.push({
        id: memberId,
        name,
        avatar: avatarForMember(fromLookup, row, name),
        color: fromLookup?.color ?? row.member_color ?? "#6366f1",
        isLead: row.is_lead,
      })
    }

    return list.sort((a, b) => {
      if (a.isLead !== b.isLead) return a.isLead ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [teamMembers, memberById])

  const disabled = !selectedTask
  const needsTeamPick = projectTeams.length > 0 && !activeTeamId
  const borderedInputClass = cn(
    "w-full px-4 py-3 border rounded-lg focus:outline-none focus:border-blue-500 text-sm",
    isDark ? "bg-[#191f31] border-[#2e3447]" : "bg-white border-slate-200",
  )
  const sectionLabelClass = cn("text-xs font-semibold", isDark ? "text-slate-400" : "text-slate-500")

  async function applyAssign(teamId: string, assigneeIds: string[]) {
    setAssigning(true)
    setAssignError(null)
    try {
      await onAssign({
        teamId,
        assignedTo: assigneeIds[0] ?? null,
        assigneeIds,
      })
      setSelectedMemberIds([])
      setOpen(false)
    } catch (error: unknown) {
      setAssignError(error instanceof Error ? error.message : "Failed to assign task")
    } finally {
      setAssigning(false)
    }
  }

  return (
    <>
      <IconTooltip
        text={disabled ? "Select a task first" : "Assign to team or member"}
        placement="bottom"
      >
        <button
          type="button"
          disabled={disabled}
          aria-label="Assign to team or member"
          onClick={() => {
            if (!selectedTask) return
            setOpen(true)
          }}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors",
            disabled
              ? isDark
                ? "cursor-not-allowed border-[#3d4a3d]/20 bg-[#151b2d] text-[#3d4a3d]"
                : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
              : cn(
                  t.searchWrap,
                  isDark ? "hover:bg-[#2e3447]" : "hover:bg-slate-50",
                  open && (isDark ? "ring-1 ring-[#4be277]/40" : "ring-1 ring-blue-200"),
                ),
          )}
        >
        <Users className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">Assign</span>
      </button>
      </IconTooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            "flex w-[92vw] max-w-3xl flex-col gap-0 overflow-hidden p-6 sm:max-w-3xl",
            "max-h-[min(85vh,40rem)]",
            isDark ? "bg-[#151b2d] border-[#2e3447] text-[#dce1fb]" : "",
          )}
        >
          <DialogHeader className="shrink-0 pb-1 text-left">
            <DialogTitle className="text-lg font-semibold">Assign task</DialogTitle>
            {selectedTask ? (
              <p className={cn("truncate text-sm font-normal", t.tableCell)}>{selectedTask.title}</p>
            ) : null}
          </DialogHeader>

          <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto py-4 pr-1">
            {projectTeams.length === 0 ? (
              <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
                Link a team to this project first (Project → Teams tab).
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className={sectionLabelClass}>
                      TEAM {projectTeams.length > 1 ? <span className="text-red-500">*</span> : null}
                    </label>
                    <SearchableSelectField
                      value={activeTeamId}
                      onChange={(teamId) => setActiveTeamId(teamId)}
                      placeholder="Select team"
                      className="w-full"
                      isDark={isDark}
                      options={projectTeams.map((team) => ({ value: team.id, label: team.name }))}
                    />
                    {needsTeamPick ? (
                      <p className={cn("text-xs", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
                        Pick a team, then assign the whole team or one member.
                      </p>
                    ) : null}
                  </div>

                  {!needsTeamPick ? (
                    <div className="space-y-2">
                      <p className={sectionLabelClass}>WHO GETS THIS TASK?</p>
                      {/* Entire Teams button */}
                      <button
                        type="button"
                        onClick={() => applyAssign(activeTeamId!, roster.map((m) => m.id))}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                          borderedInputClass,
                          isDark ? "hover:bg-[#2e3447]" : "hover:bg-slate-50",
                        )}
                      >
                        <UsersRound className="h-5 w-5 shrink-0 opacity-70" />
                        <span className="min-w-0 font-medium truncate">
                          Entire team ({roster.length} members)
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>

                {!needsTeamPick ? (
                  <div
                    className={cn(
                      "space-y-2 lg:border-l lg:pl-5",
                      isDark ? "lg:border-[#2e3447]" : "lg:border-slate-200",
                    )}
                  >
                    <p className={cn("text-[10px] font-semibold uppercase tracking-wide", t.tableCellMuted)}>
                      Select members
                    </p>
                    {loading ? (
                      <div className={cn("flex items-center gap-2 py-4 text-sm", t.tableCellMuted)}>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading members…
                      </div>
                    ) : roster.length === 0 ? (
                      <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
                        No members on this team.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setSelectedMemberIds(roster.map((m) => m.id))}
                          className={cn(
                            "col-span-full flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-sm font-medium transition-colors",
                            isDark
                              ? "border-[#4be277]/30 bg-[#4be277]/5 text-[#4be277] hover:bg-[#4be277]/10"
                              : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
                          )}
                        >
                          <Users className="h-4 w-4 shrink-0" />
                          <span>Select all</span>
                        </button>

                        {roster.map((member) => {
                          const checked = selectedMemberIds.includes(member.id)
                          return (
                            <label
                              key={member.id}
                              className={cn(
                                "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors",
                                isDark ? "border-[#2e3447] hover:bg-[#2e3447]" : "border-slate-200 hover:bg-slate-50",
                                checked && (isDark ? "bg-[#2e3447]/60" : "bg-slate-50"),
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  const next = checked
                                    ? selectedMemberIds.filter((id) => id !== member.id)
                                    : [...selectedMemberIds, member.id]
                                  setSelectedMemberIds(next)
                                }}
                                className="rounded border-slate-300"
                              />
                              <span
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                                style={{ backgroundColor: member.color }}
                              >
                                {member.avatar}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-medium">{member.name}</span>
                              {member.isLead ? (
                                <span className={cn("shrink-0 text-[10px]", t.tableCellMuted)}>Lead</span>
                              ) : null}
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <DialogFooter className={cn("shrink-0 gap-2 pt-2 sm:justify-end")}>
            {assignError ? <p className="mr-auto text-sm text-red-500">{assignError}</p> : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={cn(
                "rounded-lg px-6 py-2.5 text-sm font-medium transition-colors border",
                isDark ? "border-[#2e3447] hover:bg-[#2e3447]" : "border-slate-200 hover:bg-slate-50",
              )}
            >
              Cancel
            </button>
            {!needsTeamPick ? (
              <button
                type="button"
                disabled={selectedMemberIds.length === 0 || assigning}
                onClick={() => void applyAssign(activeTeamId!, selectedMemberIds)}
                className={cn(
                  "rounded-lg px-6 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50",
                  isDark ? "bg-[#4be277] text-black hover:bg-[#4be277]/90" : "bg-blue-500 hover:bg-blue-600",
                )}
              >
                Assign {selectedMemberIds.length > 0 ? `(${selectedMemberIds.length})` : ""}
                {assigning ? "…" : ""}
              </button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
