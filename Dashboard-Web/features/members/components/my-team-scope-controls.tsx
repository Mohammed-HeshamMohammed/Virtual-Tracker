"use client"

import { GitBranch } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { usePeopleTeamScope } from "@/features/members/context/people-team-scope-context"
import { ActivityToolbarTextButton } from "@/features/activity/components/activity-toolbar-primitives"
import { TableToolbarIconButton } from "@/shared/tables/ui"
import { Switch } from "@/shared/ui/switch"

export function MyTeamScopeTextButton() {
  const { canToggleMyTeam, myTeamOnly, toggleMyTeamOnly, teamMemberIdsLoading } = usePeopleTeamScope()

  if (!canToggleMyTeam) return null

  const ariaLabel = myTeamOnly
    ? "Showing my team only. Click for full organization."
    : "Show my team only"

  return (
    <ActivityToolbarTextButton
      onClick={toggleMyTeamOnly}
      disabled={teamMemberIdsLoading}
      title={ariaLabel}
      ariaLabel={ariaLabel}
      ariaPressed={myTeamOnly}
      active={myTeamOnly}
    >
      <GitBranch className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden sm:inline">{myTeamOnly ? "My team" : "All org"}</span>
      <span className="sm:hidden">{myTeamOnly ? "Team" : "All"}</span>
    </ActivityToolbarTextButton>
  )
}

export function MyTeamScopeIconButton({ isDark }: { isDark: boolean }) {
  const { canToggleMyTeam, myTeamOnly, toggleMyTeamOnly, teamMemberIdsLoading } = usePeopleTeamScope()

  if (!canToggleMyTeam) return null

  return (
    <TableToolbarIconButton
      onClick={toggleMyTeamOnly}
      isDark={isDark}
      disabled={teamMemberIdsLoading}
      title={
        myTeamOnly
          ? "Showing my team only (click for full organization)"
          : "Show my team only"
      }
      className={cn(
        myTeamOnly &&
          (isDark
            ? "border-[#4be277]/50 bg-[#4be277]/15 text-[#4be277]"
            : "border-blue-400 bg-blue-50 text-blue-600"),
      )}
    >
      <GitBranch className="h-4 w-4" />
    </TableToolbarIconButton>
  )
}

export function MyTeamScopePeopleButton({ isDark }: { isDark: boolean }) {
  const { canToggleMyTeam, myTeamOnly, toggleMyTeamOnly, teamMemberIdsLoading } = usePeopleTeamScope()

  if (!canToggleMyTeam) return null

  const ariaLabel = myTeamOnly
    ? "Showing my team only. Click for full organization."
    : "Show my team only"

  return (
    <button
      type="button"
      onClick={toggleMyTeamOnly}
      disabled={teamMemberIdsLoading}
      aria-label={ariaLabel}
      aria-pressed={myTeamOnly}
      title={ariaLabel}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm",
        isDark
          ? myTeamOnly
            ? "border-[#4be277]/50 bg-[#4be277]/15 text-[#4be277]"
            : "border-[#3d4a3d]/40 bg-[#191f31] text-[#bccbb9] hover:bg-[#2e3447]"
          : myTeamOnly
            ? "border-blue-400 bg-blue-50 text-blue-600"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      <GitBranch className="h-3.5 w-3.5 shrink-0" />
      <span>{myTeamOnly ? "My team" : "All org"}</span>
    </button>
  )
}

export function MyTeamScopeSwitch({
  isDark,
  className,
}: {
  isDark?: boolean
  className?: string
}) {
  const { canToggleMyTeam, myTeamOnly, setMyTeamOnly, teamMemberIdsLoading } = usePeopleTeamScope()

  if (!canToggleMyTeam) return null

  return (
    <label
      className={cn(
        "inline-flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm",
        isDark
          ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#dce1fb]"
          : "border-slate-200 bg-white text-slate-700",
        className,
      )}
    >
      <GitBranch className={cn("h-4 w-4 shrink-0", isDark ? "text-[#4be277]" : "text-blue-600")} />
      <span className="font-medium">My team only</span>
      <Switch
        checked={myTeamOnly}
        disabled={teamMemberIdsLoading}
        onCheckedChange={setMyTeamOnly}
        className={isDark ? "data-[state=checked]:bg-[#4be277]" : "data-[state=checked]:bg-blue-600"}
      />
    </label>
  )
}
