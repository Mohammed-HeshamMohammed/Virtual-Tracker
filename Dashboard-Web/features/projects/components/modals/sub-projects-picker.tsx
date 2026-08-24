"use client"

import { useMemo } from "react"
import { Check, Network } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useClientFormTheme } from "@/shared/ui/forms/form-styles"

export type SubProjectOption = { id: string; name: string; type: string }

interface SubProjectsPickerProps {
  options: SubProjectOption[]
  selectedIds: string[]
  /** Managers this selection will pull in, by sub-project id. Purely
   * informational - the roll-up itself happens server-side on save. */
  managerNamesByProject: Record<string, string[]>
  onToggle: (projectId: string) => void
}

/**
 * Picks the projects a management project oversees. Selecting one also rolls
 * that project's managers into this project's member list (server-side, in
 * management-rollup.service.js), so the row shows who that will be - the
 * membership change is a consequence of linking, and hiding it would make
 * people appear on the project with no visible cause.
 */
export function SubProjectsPicker({
  options,
  selectedIds,
  managerNamesByProject,
  onToggle,
}: SubProjectsPickerProps) {
  const theme = useClientFormTheme()
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  const rollingUp = useMemo(() => {
    const names = new Set<string>()
    for (const id of selectedIds) {
      for (const name of managerNamesByProject[id] ?? []) names.add(name)
    }
    return [...names]
  }, [selectedIds, managerNamesByProject])

  if (options.length === 0) {
    return (
      <div className={cn("rounded-xl border px-4 py-5 text-center", theme.card)}>
        <p className={cn("text-sm", theme.mutedText)}>
          No other projects to oversee yet. Create one first, then link it here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "rounded-lg border px-3 py-2 text-xs",
          theme.isDark ? "border-[#3d4a3d]/40 bg-[#191f31]" : "border-slate-200 bg-slate-50",
        )}
      >
        <span className={theme.mutedText}>
          {rollingUp.length > 0 ? (
            <>
              Linking these adds{" "}
              <span className={cn("font-semibold", theme.modal.title)}>{rollingUp.length}</span>{" "}
              manager{rollingUp.length === 1 ? "" : "s"} to this project:{" "}
              <span className={cn("font-semibold", theme.modal.title)}>{rollingUp.join(", ")}</span>. It
              stays in sync — a manager added to a linked project later appears here too.
            </>
          ) : (
            <>
              Pick the projects this one oversees. Their managers are added to this project
              automatically, and stay in sync as those projects change.
            </>
          )}
        </span>
      </div>

      <div
        className={cn(
          "divide-y overflow-hidden rounded-xl border",
          theme.card,
          theme.isDark ? "divide-[#2e3447]" : "divide-slate-200",
        )}
      >
        {options.map((option) => {
          const isSelected = selected.has(option.id)
          const managers = managerNamesByProject[option.id] ?? []
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onToggle(option.id)}
              aria-pressed={isSelected}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                theme.isDark ? "hover:bg-[#2e3447]" : "hover:bg-slate-50",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                  isSelected
                    ? theme.isDark
                      ? "border-[#4be277] bg-[#4be277]/15 text-[#4be277]"
                      : "border-emerald-500 bg-emerald-50 text-emerald-600"
                    : theme.isDark
                      ? "border-[#3d4a3d]/60"
                      : "border-slate-300",
                )}
              >
                {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-sm font-medium", theme.modal.title)}>
                  {option.name}
                </span>
                <span className={cn("block truncate text-xs", theme.mutedText)}>
                  {managers.length > 0
                    ? `Managers: ${managers.join(", ")}`
                    : "No managers assigned yet"}
                </span>
              </span>
              <Network className={cn("h-3.5 w-3.5 shrink-0", theme.mutedText)} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
