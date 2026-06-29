"use client"

import { Info, Lock } from "lucide-react"
import type { MemberRole } from "@/features/members/models/member"
import { listAssignableRoles } from "@/features/auth/permissions/role-hierarchy"
import { isOwnerRole } from "@/features/auth/permissions/role-hierarchy"
import type { TabProps } from "@/features/members/components/modals/member-manage/types"
import { memberRoleAsString } from "@/features/members/utils/member-utils"
import { SimpleSelect } from "@/shared/ui/simple-select"

function resolveAssignableRoles(actorRole?: TabProps["actorRole"]): MemberRole[] {
  if (!actorRole) return []
  if (typeof actorRole === "string") return listAssignableRoles(actorRole)
  if (Array.isArray(actorRole.assignableRoles)) {
    return actorRole.assignableRoles.filter(
      (role): role is MemberRole => typeof role === "string" && role.trim().length > 0,
    )
  }
  return []
}

export function RolesTab({ member, state, setState, actorRole }: TabProps) {
  const memberRole = memberRoleAsString(member.role)
  const roleOptions = resolveAssignableRoles(actorRole)
  const roleLocked = isOwnerRole(memberRole)
  const currentRole = memberRoleAsString(state.role, memberRole)
  const displayOptions = roleLocked
    ? [memberRole]
    : roleOptions.length > 0
      ? roleOptions
      : [currentRole]

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400" htmlFor="member-role-select">
            Role <span className="text-red-500">*</span>
          </label>
          <button type="button" className="text-xs font-medium text-blue-600 hover:underline">
            Learn more
          </button>
        </div>

        {roleLocked ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <Lock className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <span>The Owner role is protected and cannot be changed through this form.</span>
            </div>
            <div
              id="member-role-select"
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800"
              aria-readonly="true"
            >
              {memberRole}
            </div>
          </div>
        ) : (
          <SimpleSelect
            value={currentRole}
            onChange={(v) => setState((s) => ({ ...s, role: v as MemberRole }))}
            options={displayOptions}
            portalToBody
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <div className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-800">
            Projects
            <Info className="h-3.5 w-3.5 text-slate-400" />
          </div>
          <p className="mb-2 text-xs text-slate-500">Able to track time on these projects</p>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            {member.projects === 0 ? "No projects assigned" : `${member.projects} project(s)`}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <div className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-800">
            Teams
            <Info className="h-3.5 w-3.5 text-slate-400" />
          </div>
          <p className="mb-2 text-xs text-slate-500">Member in these teams</p>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            {(member.teamNames?.length ?? 0) === 0 ? "None" : member.teamNames!.join(", ")}
          </div>
        </div>
      </div>
    </div>
  )
}
