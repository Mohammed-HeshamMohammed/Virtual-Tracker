"use client"

import { ListChecks, PhoneCall } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useClientFormTheme } from "@/shared/ui/forms/form-styles"
import type { ProjectType } from "@/features/projects/api/project-api"

const PROJECT_TYPE_OPTIONS: {
  value: ProjectType
  label: string
  blurb: string
  hover: string
  Icon: typeof ListChecks
}[] = [
  {
    value: "normal",
    label: "Normal project",
    blurb: "Work is broken into tasks",
    hover: "Tasks are used to indicate performance",
    Icon: ListChecks,
  },
  {
    value: "calling",
    label: "Calling",
    blurb: "No tasks — members time their own calls",
    hover: "No tasks needed — each assigned member starts their own timer",
    Icon: PhoneCall,
  },
]

/**
 * First step of project creation. Type decides whether the project tracks
 * time against tasks at all, and cannot be changed later, so it is picked
 * before the form rather than buried in it.
 */
export function ProjectTypePicker({ onSelect }: { onSelect: (type: ProjectType) => void }) {
  const theme = useClientFormTheme()

  return (
    <div className="flex flex-col gap-3">
      {PROJECT_TYPE_OPTIONS.map(({ value, label, blurb, hover, Icon }) => (
        <button
          key={value}
          type="button"
          title={hover}
          onClick={() => onSelect(value)}
          className={cn(
            "group flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
            theme.isDark
              ? "border-[#3d4a3d]/40 bg-[#191f31] hover:border-[#4be277] hover:bg-[#4be277]/10"
              : "border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50",
          )}
        >
          <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", theme.accent.check)} />
          <span className="min-w-0">
            <span className={cn("block text-sm font-semibold", theme.modal.title)}>{label}</span>
            <span className={cn("mt-0.5 block text-xs", theme.mutedText)}>{blurb}</span>
            <span className={cn("mt-1.5 hidden text-xs group-hover:block", theme.hint)}>{hover}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
