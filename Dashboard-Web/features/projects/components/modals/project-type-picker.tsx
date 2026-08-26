"use client"

import { Info } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useClientFormTheme } from "@/shared/ui/forms/form-styles"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import { PROJECT_TYPE_DEFS, type ProjectType } from "@/features/projects/config/project-types"

/**
 * First step of project creation. Type decides whether the project tracks
 * time against tasks at all and how its budget is denominated, and cannot be
 * changed later, so it is picked before the form rather than buried in it.
 *
 * The list comes from config/project-types.ts (mirroring the backend) rather
 * than being spelled out here, so adding a type is one entry in one table
 * instead of an edit to this file plus every `=== "calling"` branch.
 */
export function ProjectTypePicker({ onSelect }: { onSelect: (type: ProjectType) => void }) {
  const theme = useClientFormTheme()

  return (
    <div className="flex flex-col gap-2.5">
      {PROJECT_TYPE_DEFS.map(({ value, label, blurb, hover, Icon, hasTasks, forcesHours }) => (
        <button
          key={value}
          type="button"
          onClick={() => onSelect(value)}
          className={cn(
            "group flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
            theme.isDark
              ? "border-[#3d4a3d]/40 bg-[#191f31] hover:border-[#4be277] hover:bg-[#4be277]/10"
              : "border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50",
          )}
        >
          <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", theme.accent.check)} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className={cn("text-sm font-semibold", theme.modal.title)}>{label}</span>
              {/* The two invariants worth knowing before committing to a type,
                  since neither can be changed afterwards. */}
              {!hasTasks ? <TypeTag theme={theme}>No tasks</TypeTag> : null}
              {forcesHours ? <TypeTag theme={theme}>Hours only</TypeTag> : null}
              {/* Used to reveal this text inline on hover (group-hover:block),
                  which pushed every row below it down as the row grew taller -
                  a layout shift on hover reads as a bug, not a detail. A
                  tooltip shows the same text without moving anything. */}
              <IconTooltip text={hover} placement="bottom" multiline>
                <Info className={cn("h-3.5 w-3.5", theme.mutedText)} aria-hidden />
                <span className="sr-only">More about {label}</span>
              </IconTooltip>
            </span>
            <span className={cn("mt-0.5 block text-xs", theme.mutedText)}>{blurb}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function TypeTag({
  children,
  theme,
}: {
  children: React.ReactNode
  theme: ReturnType<typeof useClientFormTheme>
}) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        theme.isDark ? "bg-[#2e3447] text-[#bccbb9]" : "bg-slate-100 text-slate-500",
      )}
    >
      {children}
    </span>
  )
}
