"use client"

import { useEffect, useMemo } from "react"
import { Users } from "lucide-react"
import { SearchableSelectField } from "@/shared/ui/forms/searchable-select-field";
import { useActivityFeedContext } from "@/features/activity/components/activity-feed-context"
import { usePeopleTeamScope } from "@/features/members/context/people-team-scope-context"

function MemberInitials({ initials }: { initials: string }) {
  return (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600">
      {initials}
    </div>
  )
}

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

  useEffect(() => {
    if (!canToggleMyTeam || !myTeamOnly || teamMemberIdsLoading) return
    if (teamMemberIds.size === 0) return
    if (selectedMemberId !== "all" && teamMemberIds.has(selectedMemberId)) return
    const fallback =
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

  if (!showMemberFilter) return null

  const options = [
    ...(scope?.canSeeAllMembers && !myTeamOnly
      ? [
          {
            value: "all",
            label: compact ? "All" : "All members",
            meta: <Users className="h-4 w-4 shrink-0 text-slate-400" />,
          },
        ]
      : []),
    ...memberOptions.map((m) => ({
      value: String(m.id),
      label: m.name,
      meta: <MemberInitials initials={m.initials} />,
    })),
  ]

  return (
    <SearchableSelectField
      value={selectedMemberId}
      onChange={(value) => {
        if (value) setSelectedMemberId(value)
      }}
      placeholder={compact ? "Member" : "All members"}
      className={compact ? "w-36 shrink-0 sm:w-40" : "w-44 shrink-0 sm:w-52"}
      menuMinWidth={240}
      visibleOptionRows={5}
      truncateOptions={false}
      options={options}
    />
  )
}
