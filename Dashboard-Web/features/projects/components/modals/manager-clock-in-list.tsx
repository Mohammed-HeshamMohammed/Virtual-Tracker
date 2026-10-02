"use client"

import { cn } from "@/shared/utils/utils"
import { Checkbox } from "@/shared/ui/checkbox"
import { useClientFormTheme } from "@/shared/ui/forms/form-styles"
import { MemberOptionAvatar } from "@/features/projects/components/member-option-avatar"
import type { ProjectFormOption } from "@/features/projects/api/project-form-api"

/**
 * "Only specific managers can clock in": the managers on the project, each with
 * a checkbox. Styled like the picker rows elsewhere in this form (avatar, name,
 * role, accent-tinted when selected) and with a batch action so a long list does
 * not need one click per person.
 */
export function ManagerClockInList({
  managers,
  allowedIds,
  onChange,
  disabled = false,
}: {
  managers: Array<Pick<ProjectFormOption, "id" | "label" | "initials" | "avatarUrl" | "role">>
  allowedIds: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  const theme = useClientFormTheme()
  const allowed = new Set(allowedIds)
  const allChecked = managers.length > 0 && managers.every((m) => allowed.has(m.id))
  const checkedCount = managers.filter((m) => allowed.has(m.id)).length

  function toggle(id: string) {
    onChange(allowed.has(id) ? allowedIds.filter((x) => x !== id) : [...allowedIds, id])
  }

  const batchButton = cn(
    "rounded-md px-1.5 py-0.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
    theme.accent.link,
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-xs font-medium", theme.isDark ? "text-[#bccbb9]" : "text-slate-500")}>
          {checkedCount} of {managers.length} can clock in
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={disabled || allChecked}
            onClick={() => onChange([...new Set([...allowedIds, ...managers.map((m) => m.id)])])}
            className={batchButton}
          >
            Select all
          </button>
          <span className={theme.isDark ? "text-[#3d4a3d]" : "text-slate-300"}>·</span>
          <button
            type="button"
            disabled={disabled || checkedCount === 0}
            onClick={() => onChange(allowedIds.filter((id) => !managers.some((m) => m.id === id)))}
            className={batchButton}
          >
            Clear
          </button>
        </div>
      </div>

      <div
        className={cn(
          "overflow-hidden rounded-xl border",
          theme.isDark ? "border-[#3d4a3d]/40 bg-[#151b2d]" : "border-slate-200 bg-white",
        )}
      >
        {managers.map((manager, index) => {
          const checked = allowed.has(manager.id)
          return (
            <div
              key={manager.id}
              role="checkbox"
              aria-checked={checked}
              aria-disabled={disabled}
              tabIndex={disabled ? -1 : 0}
              onClick={() => !disabled && toggle(manager.id)}
              onKeyDown={(e) => {
                if (disabled || (e.key !== " " && e.key !== "Enter")) return
                e.preventDefault()
                toggle(manager.id)
              }}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors aria-disabled:cursor-not-allowed",
                index > 0 && (theme.isDark ? "border-t border-[#3d4a3d]/30" : "border-t border-slate-100"),
                theme.isDark ? "text-[#dce1fb] hover:bg-[#2e3447]" : "text-slate-600 hover:bg-slate-50",
                checked && theme.accent.selectedBg,
              )}
            >
              <Checkbox
                checked={checked}
                isDark={theme.isDark}
                onChange={() => {}}
                className="pointer-events-none h-5 w-5"
              />
              <MemberOptionAvatar member={manager} />
              <span className="min-w-0 flex-1 truncate">{manager.label}</span>
              {manager.role ? (
                <span className={cn("shrink-0 text-xs", theme.isDark ? "text-[#bccbb9]/70" : "text-slate-400")}>
                  {manager.role}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>

      {checkedCount === 0 ? (
        <p className={cn("text-xs", theme.isDark ? "text-amber-300" : "text-amber-600")}>
          Nobody is checked, so no one can clock in on this project yet.
        </p>
      ) : null}
    </div>
  )
}
