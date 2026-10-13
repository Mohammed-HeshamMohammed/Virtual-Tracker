"use client"

import { useEffect, useMemo } from "react"
import { useActivityFeedContext } from "@/features/activity/components/activity-feed-context"
import { joinSelectedMemberIds, splitSelectedMemberIds } from "@/features/activity/utils/activity-scope-preferences"
import { usePeopleTeamScope } from "@/features/members/context/people-team-scope-context"
import { ReportMemberAvatar } from "@/features/reports/components/time-activity-report/report-member-avatar"
import { ReportToolbarMultiSelect } from "@/features/reports/components/shared/report-filters-panel"

/** Pick any number of members, or leave it on "all". The picked ids travel as
 *  one comma-joined string (see splitSelectedMemberIds), so the feed query,
 *  its cache key and the stored preference all stay a plain string. */
export function ActivityMemberSelect({ compact = false }: { compact?: boolean }) {
  const { scope, selectedMemberId, setSelectedMemberId } = useActivityFeedContext()
  const { canToggleMyTeam, myTeamOnly, teamMemberIds, teamMemberIdsLoading } = usePeopleTeamScope()

  const memberOptions = useMemo(() => {
    const all = scope?.members ?? []
    if (!canToggleMyTeam || !myTeamOnly || teamMemberIdsLoading) return all
    if (teamMemberIds.size === 0) return []
    return all.filter((member) => teamMemberIds.has(member.id))
  }, [scope?.members, canToggleMyTeam, myTeamOnly, teamMemberIds, teamMemberIdsLoading])

  const showMemberFilter = (scope?.canSeeAllMembers ?? false) || memberOptions.length > 1
  // "All" asks the server for everyone the viewer may see, which in My team
  // mode is more than the team - so there it means "every member listed".
  const allowAll = Boolean(scope?.canSeeAllMembers) && !myTeamOnly

  useEffect(() => {
    if (!canToggleMyTeam || !myTeamOnly || teamMemberIdsLoading) return
    if (teamMemberIds.size === 0) return
    const picked = splitSelectedMemberIds(selectedMemberId)
    if (picked.length > 0 && picked.every((id) => teamMemberIds.has(id))) return
    const kept = picked.filter((id) => teamMemberIds.has(id))
    const fallback =
      (kept.length > 0 ? joinSelectedMemberIds(kept) : null) ??
      memberOptions.find((member) => teamMemberIds.has(member.id))?.id ??
      scope?.defaultMemberId ??
      memberOptions[0]?.id
    if (fallback) setSelectedMemberId(fallback)
  }, [
    canToggleMyTeam,
    myTeamOnly,
    teamMemberIds,
    teamMemberIdsLoading,
    selectedMemberId,
    memberOptions,
    scope?.defaultMemberId,
    setSelectedMemberId,
  ])

  const options = useMemo(
    () =>
      memberOptions.map((m) => ({
        id: String(m.id),
        name: m.name,
        meta: <ReportMemberAvatar initials={m.initials} imageUrl={m.avatarUrl} />,
      })),
    [memberOptions],
  )
  const selected = useMemo(() => new Set(splitSelectedMemberIds(selectedMemberId)), [selectedMemberId])

  if (!showMemberFilter) return null

  const everyoneListed = options.length > 0 && options.every((o) => selected.has(o.id))

  return (
    <ReportToolbarMultiSelect
      label="Members"
      emptyLabel={compact ? "All" : "All members"}
      options={options}
      selected={selected}
      allSelected={allowAll ? selectedMemberId === "all" : everyoneListed}
      onSelectAll={() => setSelectedMemberId(allowAll ? "all" : joinSelectedMemberIds(options.map((o) => o.id)))}
      onChange={(next) => {
        // Unticking the last one goes back to "all" where that is allowed, and
        // is ignored where it is not (someone has to stay selected).
        if (next.size === 0) {
          if (allowAll) setSelectedMemberId("all")
          return
        }
        setSelectedMemberId(joinSelectedMemberIds(next))
      }}
      width={compact ? "w-36 shrink-0 sm:w-44" : "w-44 shrink-0 sm:w-52"}
    />
  )
}
