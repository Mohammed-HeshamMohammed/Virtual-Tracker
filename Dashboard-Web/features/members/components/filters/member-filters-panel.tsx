"use client"

import { useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, X, Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { getProjects } from "@/features/projects/api/project-api"
import { MultiSelectField } from "@/shared/ui/forms/multi-select-field"

export type MemberListFilters = {
  roles: string[]
  projectIds: string[]
}

function FilterDropdown({
  label,
  options,
  selected,
  onChange,
  openKey,
  activeKey,
  setActiveKey,
  isDark,
  optionLabel,
}: {
  label: string
  options: { id: string; label: string }[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  openKey: string
  activeKey: string | null
  setActiveKey: (k: string | null) => void
  isDark: boolean
  optionLabel?: (id: string, label: string) => string
}) {
  const open = activeKey === openKey
  const t = isDark ? dark : light

  const selectedLabel =
    selected.size === 0
      ? "All"
      : selected.size === 1
        ? optionLabel?.([...selected][0]!, options.find((o) => o.id === [...selected][0])?.label ?? "") ??
          options.find((o) => o.id === [...selected][0])?.label ??
          "1 selected"
        : `${selected.size} selected`

  const toggle = (id: string) =>
    onChange(
      (() => {
        const s = new Set(selected)
        s.has(id) ? s.delete(id) : s.add(id)
        return s
      })(),
    )

  return (
    <div className={cn("overflow-hidden rounded-xl border", t.searchWrap)}>
      <button
        onClick={() => setActiveKey(open ? null : openKey)}
        className={cn(
          "flex w-full items-center justify-between px-4 py-3 text-sm transition-colors",
          isDark ? "hover:bg-[#2e3447]/60" : "hover:bg-slate-50",
          open && (isDark ? "border-b border-[#3d4a3d]/40" : "border-b border-slate-100"),
        )}
        type="button"
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <span className={cn("shrink-0 font-medium", isDark ? "text-[#dce1fb]" : "text-slate-700")}>{label}</span>
          {selected.size > 0 && (
            <span className={cn("truncate text-xs font-medium", isDark ? "text-[#4be277]" : "text-blue-500")}>
              {selectedLabel}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            "ml-2 h-4 w-4 shrink-0 transition-transform duration-200",
            isDark ? "text-[#bccbb9]" : "text-slate-400",
            open && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <div
              className={cn(
                "flex items-center justify-between border-b px-4 py-2",
                isDark ? "border-[#3d4a3d]/40 bg-[#191f31]/80" : "border-slate-100 bg-slate-50/60",
              )}
            >
              <button
                className={cn("text-xs font-semibold", isDark ? "text-[#4be277] hover:text-[#6ef59a]" : "text-blue-500 hover:text-blue-600")}
                onClick={() => onChange(new Set(options.map((o) => o.id)))}
                type="button"
              >
                Select all
              </button>
              <button
                className={cn("text-xs font-semibold", isDark ? "text-[#bccbb9] hover:text-[#dce1fb]" : "text-slate-400 hover:text-slate-600")}
                onClick={() => onChange(new Set())}
                type="button"
              >
                Unselect all
              </button>
            </div>

            <button
              onClick={() => onChange(new Set())}
              className={cn(
                "flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors",
                selected.size === 0
                  ? isDark
                    ? "bg-[#4be277]/10 font-medium text-[#4be277]"
                    : "bg-blue-50 font-medium text-blue-700"
                  : isDark
                    ? "text-[#bccbb9] hover:bg-[#2e3447]/60"
                    : "text-slate-600 hover:bg-slate-50",
              )}
              type="button"
            >
              All
              {selected.size === 0 && <Check className={cn("h-3.5 w-3.5 shrink-0", isDark ? "text-[#4be277]" : "text-blue-500")} />}
            </button>

            {options.map((opt) => {
              const isSelected = selected.has(opt.id)
              return (
                <button
                  key={opt.id}
                  onClick={() => toggle(opt.id)}
                  className={cn(
                    "flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors",
                    isSelected
                      ? isDark
                        ? "bg-[#4be277]/10 font-medium text-[#4be277]"
                        : "bg-blue-50 font-medium text-blue-700"
                      : isDark
                        ? "text-[#bccbb9] hover:bg-[#2e3447]/60"
                        : "text-slate-600 hover:bg-slate-50",
                  )}
                  type="button"
                >
                  {opt.label}
                  {isSelected && <Check className={cn("h-3.5 w-3.5 shrink-0", isDark ? "text-[#4be277]" : "text-blue-500")} />}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function MemberFiltersPanel({
  onClose,
  onApply,
  onClear,
  initialFilters,
  roleOptions,
  isDark: isDarkProp,
}: {
  onClose: () => void
  onApply: (filters: MemberListFilters) => void
  onClear: () => void
  initialFilters: MemberListFilters
  roleOptions: string[]
  isDark?: boolean
}) {
  const { isDark: themeDark } = useTheme()
  const isDark = isDarkProp ?? themeDark
  const t = isDark ? dark : light

  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(() => new Set(initialFilters.roles))
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(() => [...initialFilters.projectIds])
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsLoaded, setProjectsLoaded] = useState(false)

  useEffect(() => {
    if (projectsLoaded || projectsLoading) return
    let cancelled = false
    setProjectsLoading(true)
    void getProjects({ fields: ["id", "name"] })
      .then((rows) => {
        if (cancelled) return
        setProjects(
          rows
            .filter((p) => p.name.trim().length > 0)
            .map((p) => ({ id: p.id, name: p.name.trim() }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
        setProjectsLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setProjects([])
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectsLoaded, projectsLoading])

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        label: project.name,
        value: project.id,
      })),
    [projects],
  )

  const roleItems = roleOptions.map((role) => ({ id: role, label: role === "User" ? "Viewer" : role }))

  function handleApply() {
    onApply({
      roles: [...selectedRoles],
      projectIds: selectedProjectIds,
    })
    onClose()
  }

  function handleClear() {
    setSelectedRoles(new Set())
    setSelectedProjectIds([])
    onClear()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className={cn(
          "fixed right-16 top-1/2 flex h-[560px] w-[340px] -translate-y-1/2 flex-col rounded-2xl border shadow-2xl",
          isDark ? "border-[#3d4a3d]/40 bg-[#0f1424]" : "border-slate-200 bg-white",
        )}
        onClick={(e) => e.stopPropagation()}
      >
      <div className={cn("flex shrink-0 items-center justify-between border-b px-5 py-4", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}>
        <h2 className={cn("text-base font-bold", isDark ? "text-[#dce1fb]" : "text-slate-800")}>Filters</h2>
        <button
          onClick={onClose}
          className={cn("rounded-lg p-1.5 transition-colors", isDark ? "text-[#bccbb9] hover:bg-[#2e3447] hover:text-[#dce1fb]" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600")}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto px-5 py-4"
        style={{ msOverflowStyle: "none", scrollbarWidth: "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-5">
          <div>
            <p className={cn("mb-2 text-[10px] font-bold uppercase tracking-widest", isDark ? "text-[#bccbb9]/60" : "text-slate-400")}>
              ORGANIZATION
            </p>
            <div className="space-y-2">
              <FilterDropdown
                openKey="org::role"
                label="Role"
                options={roleItems}
                selected={selectedRoles}
                onChange={setSelectedRoles}
                activeKey={activeKey}
                setActiveKey={setActiveKey}
                isDark={isDark}
              />
              <div>
                <label className={cn("mb-1.5 block text-[10px] font-bold uppercase tracking-wider", isDark ? "text-[#bccbb9]/60" : "text-slate-400")}>
                  Projects
                </label>
                <MultiSelectField
                  placeholder={projectsLoading ? "Loading projects…" : "Select projects"}
                  options={projectOptions}
                  selected={selectedProjectIds}
                  onChange={setSelectedProjectIds}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={cn("shrink-0 space-y-2 border-t px-5 py-4", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className={cn("w-full rounded-xl py-3 text-sm font-semibold text-white transition-colors", t.btnPrimary)}
          onClick={handleApply}
          type="button"
        >
          Apply filters
        </button>
        <button
          className={cn("w-full py-2 text-center text-sm transition-colors", isDark ? "text-[#bccbb9] hover:text-[#dce1fb]" : "text-slate-400 hover:text-slate-600")}
          onClick={handleClear}
          type="button"
        >
          Clear filters
        </button>
      </div>
      </div>
    </div>
  )
}
