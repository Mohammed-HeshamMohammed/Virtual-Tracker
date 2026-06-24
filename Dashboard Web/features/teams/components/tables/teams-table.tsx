"use client"

import { Users } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { peopleTableCellClass, peopleTableRowStyle } from "@/shared/tables/ui"
import { AvatarStack } from "@/shared/ui/avatar-stack"
import { TeamRowMenu } from "@/features/teams/components/menus/team-row-menu"
import type { TeamWithRelations } from "@/features/teams/models/team"

type TeamsTableProps = {
  teams: TeamWithRelations[]
  onEdit: (team: TeamWithRelations) => void
  onDelete: (id: string) => void
  canEditTeam: (team: TeamWithRelations) => boolean
  isDark?: boolean
  distributedRowHeight?: number
}

export function TeamsTable({
  teams,
  onEdit,
  onDelete,
  canEditTeam,
  isDark = false,
  distributedRowHeight,
}: TeamsTableProps) {
  return (
    <>
      {teams.map((team) => {
        const editable = canEditTeam(team)
        return (
        <tr
          key={team.id}
          style={peopleTableRowStyle(distributedRowHeight)}
          onClick={() => {
            if (editable) onEdit(team)
          }}
          className={cn(
            "group transition-colors",
            isDark ? "hover:bg-[#191f31]/60" : "hover:bg-slate-50",
            editable && "cursor-pointer",
          )}
        >
          <td className={peopleTableCellClass("px-4", distributedRowHeight)}>
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  isDark ? "bg-purple-500/20" : "bg-purple-100",
                )}
              >
                <Users className={cn("h-4 w-4", isDark ? "text-purple-400" : "text-purple-500")} />
              </div>
              <div>
                <p className={cn("text-sm font-medium", isDark ? "text-[#dce1fb]" : "text-slate-700")}>{team.name}</p>
                {team.leads.length > 0 && (
                  <p className={cn("text-xs", isDark ? "text-[#bccbb9]" : "text-slate-400")}>
                    Lead: {team.leads.join(", ")}
                  </p>
                )}
              </div>
            </div>
          </td>
          <td className={peopleTableCellClass("px-4", distributedRowHeight)}>
            <div className="flex items-center gap-2">
              <AvatarStack members={team.members} isDark={isDark} />
              <span className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>{team.members.length}</span>
            </div>
          </td>
          <td className={peopleTableCellClass("px-4", distributedRowHeight)}>
            {team.projects.length === 0 ? (
              <span className={cn("text-sm", isDark ? "text-[#3d4a3d]" : "text-slate-400")}>-</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {team.projects.slice(0, 2).map((p) => (
                  <span
                    key={p.id}
                    className={cn(
                      "rounded px-2 py-0.5 text-xs",
                      isDark ? "bg-[#2e3447] text-[#dce1fb]" : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {p.name}
                  </span>
                ))}
                {team.projects.length > 2 && (
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 text-xs",
                      isDark ? "bg-[#2e3447] text-[#bccbb9]" : "bg-slate-100 text-slate-500",
                    )}
                  >
                    +{team.projects.length - 2}
                  </span>
                )}
              </div>
            )}
          </td>
          <td className={peopleTableCellClass("px-2", distributedRowHeight)} onClick={(e) => e.stopPropagation()}>
            {editable ? (
              <TeamRowMenu onEdit={() => onEdit(team)} onDelete={() => onDelete(team.id)} isDark={isDark} />
            ) : (
              <span className="inline-flex h-7 w-7" />
            )}
          </td>
        </tr>
        )
      })}
    </>
  )
}
