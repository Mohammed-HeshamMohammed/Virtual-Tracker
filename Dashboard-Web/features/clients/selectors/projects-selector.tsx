"use client"

import { Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { FieldLabel } from "@/shared/ui/forms/field-label";
import { useClientFormTheme } from "@/shared/ui/forms/form-styles"

export type ProjectOption = { id: string; name: string }

export function ProjectsSelector({
  projects,
  selected,
  onChange,
  fillHeight = false,
}: {
  projects: ProjectOption[]
  selected: string[]
  onChange: (v: string[]) => void
  fillHeight?: boolean
}) {
  function toggle(projectId: string) {
    onChange(selected.includes(projectId) ? selected.filter((x) => x !== projectId) : [...selected, projectId])
  }
  const allSelected = projects.length > 0 && selected.length === projects.length
  const theme = useClientFormTheme()

  return (
    <div className={cn("flex flex-col", fillHeight && "h-full min-h-0")}>
      <div className="flex items-center justify-between shrink-0 mb-2">
        <FieldLabel>Projects / work orders</FieldLabel>
        <button
          type="button"
          onClick={() => onChange(allSelected ? [] : projects.map((p) => p.id))}
          className={cn("text-xs font-medium transition-colors", theme.accent.link)}
          disabled={projects.length === 0}
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      </div>
      <div
        className={cn(
          "space-y-1 pr-1 overflow-y-auto",
          fillHeight
            ? "flex-1 min-h-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            : "max-h-48",
        )}
      >
        {projects.length === 0 ? (
          <p className="text-sm text-slate-400 px-3 py-2">No projects available</p>
        ) : (
          projects.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"
            >
              <div
                role="checkbox"
                aria-checked={selected.includes(p.id)}
                onClick={() => toggle(p.id)}
                className={cn(
                  "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors cursor-pointer",
                  selected.includes(p.id)
                    ? theme.isDark
                      ? "border-[#4be277] bg-[#4be277]"
                      : "border-blue-500 bg-blue-500"
                    : theme.isDark
                      ? "border-[#3d4a3d]/60"
                      : "border-slate-300",
                )} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
              >
                {selected.includes(p.id) && <Check className="w-2.5 h-2.5 text-white" />}
              </div>
              <span className="text-sm text-slate-600">{p.name}</span>
            </label>
          ))
        )}
      </div>
    </div>
  )
}
