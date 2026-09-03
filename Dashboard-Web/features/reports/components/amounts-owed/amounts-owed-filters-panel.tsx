"use client"

import { useMemo, useState as useComponentState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, ChevronDown, Search, User, X, XCircle } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import type { ReportFilterOptions } from "@/features/reports/api/misc-reports-api"

type FilterTab = "filters" | "saved"

export function AmountsOwedFiltersPanel({
  onClose,
  className,
  onScheduleReport,
  options,
  selectedMemberIds,
  onSelectedMemberIdsChange,
  selectedProjectIds,
  onSelectedProjectIdsChange,
}: {
  onClose: () => void
  className?: string
  onScheduleReport?: () => void
  options: ReportFilterOptions
  selectedMemberIds: Set<string>
  onSelectedMemberIdsChange: (next: Set<string>) => void
  selectedProjectIds: Set<string>
  onSelectedProjectIdsChange: (next: Set<string>) => void
}) {
  const [tab, setTab] = useComponentState<FilterTab>("filters")
  const [membersOpen, setMembersOpen] = useComponentState(false)
  const [projectsOpen, setProjectsOpen] = useComponentState(false)
  const [memberSearch, setMemberSearch] = useComponentState("")
  const [showOnlySelectedMembers, setShowOnlySelectedMembers] = useComponentState(false)

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    let list = options.members
    if (q) list = list.filter((m) => m.name.toLowerCase().includes(q))
    if (showOnlySelectedMembers) list = list.filter((m) => selectedMemberIds.has(m.id))
    return list
  }, [options.members, memberSearch, showOnlySelectedMembers, selectedMemberIds])

  function toggleMember(id: string) {
    const next = new Set(selectedMemberIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectedMemberIdsChange(next)
  }

  function toggleProject(id: string) {
    const next = new Set(selectedProjectIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectedProjectIdsChange(next)
  }

  function selectAllMembers() {
    onSelectedMemberIdsChange(new Set(options.members.map((m) => m.id)))
  }

  function clearFilters() {
    setMemberSearch("")
    setShowOnlySelectedMembers(false)
    onSelectedMemberIdsChange(new Set())
    onSelectedProjectIdsChange(new Set())
  }

  function scheduleReport() {
    onClose()
    onScheduleReport?.()
  }

  return (
    <motion.div
      initial={{ x: "100%", opacity: 0.96 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0.96 }}
      transition={{ type: "spring", stiffness: 400, damping: 34 }}
      onWheel={(e) => e.stopPropagation()}
      className={cn(
        "z-110 flex h-[500px] w-[400px] min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151b2d] shadow-sm",
        className ?? "fixed right-16 top-1/2 -translate-y-1/2"
      )}
    >
      <div className="flex shrink-0 items-end justify-between gap-2 border-b border-slate-200 dark:border-white/10 px-2 pt-3">
        <div className="flex min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setTab("filters")}
            className={cn(
              "flex-1 border-b-2 pb-2.5 text-center text-[10px] font-bold uppercase tracking-wider transition-colors",
              tab === "filters" ? "border-blue-500 text-blue-500" : "border-transparent text-slate-400 dark:text-white/40"
            )}
          >
            Filters
          </button>
          <button
            type="button"
            onClick={() => setTab("saved")}
            className={cn(
              "flex-1 border-b-2 pb-2.5 text-center text-[10px] font-bold uppercase tracking-wider transition-colors",
              tab === "saved" ? "border-blue-500 text-blue-500" : "border-transparent text-slate-400 dark:text-white/40"
            )}
          >
            Saved filters
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mb-1 shrink-0 rounded-lg p-1.5 text-slate-400 dark:text-white/40 transition-colors hover:bg-slate-100 dark:hover:bg-white/10"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {tab === "filters" ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-4 scrollbar-hide">
            <div className="space-y-5">
              <div className="relative">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">Projects</div>
                <button
                  type="button"
                  onClick={() => setProjectsOpen((o) => !o)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border bg-white dark:bg-[#151b2d] px-3 py-2.5 text-left text-sm text-slate-500 dark:text-white/45 transition-colors",
                    projectsOpen ? "border-blue-500 ring-1 ring-blue-500" : "border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20"
                  )}
                >
                  <span>
                    {selectedProjectIds.size === 0
                      ? "All projects"
                      : `${selectedProjectIds.size} project${selectedProjectIds.size === 1 ? "" : "s"} selected`}
                  </span>
                  <ChevronDown className={cn("h-4 w-4 text-slate-400 dark:text-white/40 transition-transform", projectsOpen && "rotate-180")} />
                </button>
                <AnimatePresence>
                  {projectsOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151b2d] shadow-sm scrollbar-hide"
                    >
                      {options.projects.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-slate-500 dark:text-white/45">No projects available</p>
                      ) : (
                        options.projects.map((proj) => {
                          const on = selectedProjectIds.has(proj.id)
                          return (
                            <button
                              key={proj.id}
                              type="button"
                              onClick={() => toggleProject(proj.id)}
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                            >
                              <span
                                className={cn(
                                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                  on ? "border-blue-500 bg-blue-500" : "border-slate-300 dark:border-white/20 bg-white dark:bg-[#151b2d]"
                                )}
                              >
                                {on ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
                              </span>
                              <span className="truncate text-slate-800 dark:text-[#dce1fb]">{proj.name}</span>
                            </button>
                          )
                        })
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="relative">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">Members</div>
                <button
                  type="button"
                  onClick={() => setMembersOpen((o) => !o)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border bg-white dark:bg-[#151b2d] px-3 py-2.5 text-left text-sm text-slate-500 dark:text-white/45 transition-colors",
                    membersOpen ? "border-blue-500 ring-1 ring-blue-500" : "border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20"
                  )}
                >
                  <span>
                    {selectedMemberIds.size === 0
                      ? "All members"
                      : `${selectedMemberIds.size} member${selectedMemberIds.size === 1 ? "" : "s"} selected`}
                  </span>
                  <ChevronDown className={cn("h-4 w-4 text-slate-400 dark:text-white/40 transition-transform", membersOpen && "rotate-180")} />
                </button>
                <AnimatePresence>
                  {membersOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151b2d] shadow-sm"
                    >
                      <div className="p-3">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-white/40" />
                          <input
                            type="search"
                            value={memberSearch}
                            onChange={(e) => setMemberSearch(e.target.value)}
                            placeholder="Search members"
                            className="w-full rounded-full border border-blue-500 py-2 pl-9 pr-9 text-sm text-slate-800 dark:text-[#dce1fb] outline-none placeholder:text-slate-400" aria-label="Interactive control"
                          />
                          {memberSearch ? (
                            <button
                              type="button"
                              onClick={() => setMemberSearch("")}
                              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/10"
                              aria-label="Clear search"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={selectAllMembers}
                          className="mt-2 text-sm font-medium text-blue-500 hover:text-blue-600"
                        >
                          Select all
                        </button>
                      </div>
                      <div className="max-h-48 overflow-y-auto border-t border-slate-100 dark:border-white/10 scrollbar-hide">
                        {filteredMembers.map((m) => {
                          const on = selectedMemberIds.has(m.id)
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => toggleMember(m.id)}
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                            >
                              <span
                                className={cn(
                                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                  on ? "border-blue-500 bg-blue-500" : "border-slate-300 dark:border-white/20 bg-white dark:bg-[#151b2d]"
                                )}
                              >
                                {on ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
                              </span>
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white">
                                <User className="h-4 w-4" />
                              </div>
                              <span className="text-slate-800 dark:text-[#dce1fb]">{m.name}</span>
                            </button>
                          )
                        })}
                      </div>
                      <div className="border-t border-slate-100 dark:border-white/10 px-4 py-3">
                        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                          Show only selected
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowOnlySelectedMembers((v) => !v)}
                          className={cn(
                            "relative inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors",
                            showOnlySelectedMembers ? "bg-blue-500" : "bg-slate-200 dark:bg-white/15"
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
                              showOnlySelectedMembers ? "translate-x-4" : "translate-x-0"
                            )}
                          />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>


            </div>
          </div>

          <div className="shrink-0 space-y-2 border-t border-slate-100 dark:border-white/10 px-5 py-4">
            <button
              type="button"
              onClick={scheduleReport}
              className="w-full rounded-xl bg-blue-500 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-600"
            >
              Schedule report
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151b2d] py-2.5 text-sm font-bold text-slate-600 dark:text-[#bccbb9] transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
            >
              Clear filters
            </button>
          </div>
        </>
      ) : (
        <div className="flex min-h-[280px] flex-col px-5 py-4">
          <h3 className="text-base font-semibold text-slate-800 dark:text-[#dce1fb]">Saved filters</h3>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-white/40" aria-label="Interactive control" />
            <input
              type="search"
              placeholder="Search saved filters"
              className="w-full rounded-full border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151b2d] py-2.5 pl-10 pr-4 text-sm text-slate-800 dark:text-[#dce1fb] outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <p className="mt-8 text-center text-sm text-slate-500 dark:text-white/45">No saved filters</p>
        </div>
      )}
    </motion.div>
  )
}

