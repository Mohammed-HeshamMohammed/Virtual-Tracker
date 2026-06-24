/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState as useComponentState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Search, Plus, Info } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { Toggle, Segment, Label } from "@/features/settings/components/organization/components/ui"
import { MEMBERS, PROJECTS, ROLE_OPTS, BINARY_OPTS, PROJECTS_TODOS_SUBNAV, ORGANIZATION_PROJECTS_TODOS_PAGE_SIZE, type RoleOption, type BinaryOption, type ProjectsTodosTabKey } from "@/features/settings/components/shared/constants"

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useComponentState<{ top: number; left: number } | null>(null)
  const show = () => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ top: r.top - 8, left: r.left + r.width / 2 })
  }
  return (
    <div ref={ref} className="relative inline-flex items-center" onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      {children}
      {pos && (
        <div style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translate(-50%, -100%)", zIndex: 9999, pointerEvents: "none" }}
          className="w-64 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-lg">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-800" />
        </div>
      )}
    </div>
  )
}

function SectionHeader({ title, info, isDark }: { title: string; info?: string; isDark: boolean }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className={cn("text-[11px] font-bold tracking-widest uppercase", isDark ? "text-white/40" : "text-slate-500")}>{title}</span>
      {info && <Tooltip text={info}><Info className={cn("w-3.5 h-3.5 cursor-help", isDark ? "text-white/30" : "text-slate-400")} /></Tooltip>}
    </div>
  )
}

function SearchInput({ placeholder, isDark, value, onChange }: { placeholder: string; isDark: boolean; value: string; onChange: (v: string) => void }) {
  return (
    <div className={cn("flex items-center gap-2 px-3 py-2 border rounded-full text-sm", isDark ? "bg-[#1a2235] border-white/10 text-white" : "bg-white border-slate-200 text-slate-600")}>
      <Search className="w-3.5 h-3.5 shrink-0 opacity-40" />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="bg-transparent outline-none placeholder:opacity-40 w-40 text-sm" aria-label="Interactive control" />
    </div>
  )
}

function Pagination({ page, total, onChange, isDark }: { page: number; total: number; onChange: (p: number) => void; isDark: boolean }) {
  if (total <= 1) return null
  const btn = (label: string, target: number, disabled: boolean) => (
    <button onClick={() => onChange(target)} disabled={disabled}
      className={cn("w-6 h-6 flex items-center justify-center rounded text-sm transition-colors",
        disabled
          ? isDark ? "text-white/20 cursor-not-allowed" : "text-slate-300 cursor-not-allowed"
          : isDark ? "text-white/50 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"
      )} type="button">
      {label}
    </button>
  )
  return (
    <div className="flex items-center gap-1">
      {btn("‹", page - 1, page === 0)}
      {Array.from({ length: total }, (_, i) => (
        <button key={i} onClick={() => onChange(i)}
          className={cn("w-6 h-6 flex items-center justify-center rounded text-xs font-medium transition-colors",
            page === i ? "bg-[#006e2f] text-white" : isDark ? "text-white/40 hover:bg-white/10" : "text-slate-400 hover:bg-slate-100"
          )} type="button">
          {i + 1}
        </button>
      ))}
      {btn("›", page + 1, page === total - 1)}
    </div>
  )
}

function DefaultProjectRole({ isDark }: { isDark: boolean }) {
  const [globalRole, setGlobalRole] = useComponentState("None")
  const [memberRoles, setMemberRoles] = useComponentState<Record<number, string>>(Object.fromEntries(MEMBERS.map(m => [m.id, "None"])))
  const [search, setSearch] = useComponentState("")
  const filtered = MEMBERS.filter(m => m.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-6">
      <div>
        <SectionHeader title="Default Project Role" info="When creating a new project, members will be assigned by default to the selected role." isDark={isDark} />
        <p className={cn("text-sm mb-4", isDark ? "text-white/40" : "text-slate-500")}>When creating a new project, members will be assigned by default to the selected role.</p>
        <Label label="Global:" isDark={isDark} />
        <Segment options={ROLE_OPTS} value={globalRole} onChange={setGlobalRole} isDark={isDark} />
      </div>
      <div>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h3 className={cn("text-base font-bold", isDark ? "text-white" : "text-slate-800")}>Individual settings</h3>
            <p className={cn("text-sm", isDark ? "text-white/40" : "text-slate-500")}>Override the organization default for specific members</p>
          </div>
          <SearchInput placeholder="Search members" isDark={isDark} value={search} onChange={setSearch} />
        </div>
        <div className={cn("border rounded-xl overflow-hidden", isDark ? "border-white/5" : "border-slate-100")}>
          <div className={cn("px-4 py-2.5 text-xs font-bold uppercase tracking-wider", isDark ? "bg-white/5 text-white/30" : "bg-slate-50 text-slate-400")}>Name</div>
          {filtered.map((m, i) => (
            <div key={m.id} className={cn("flex items-center justify-between px-4 py-3", i < filtered.length - 1 && (isDark ? "border-b border-white/5" : "border-b border-slate-100"))}>
              <div className="flex items-center gap-3">
                <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold", m.color)}>{m.initials}</div>
                <span className={cn("text-sm font-medium", isDark ? "text-white/80" : "text-slate-700")}>{m.name}</span>
              </div>
              <Segment options={ROLE_OPTS} value={memberRoles[m.id]} onChange={v => setMemberRoles(p => ({ ...p, [m.id]: v }))} isDark={isDark} />
            </div>
          ))}
          <div className={cn("px-4 py-2.5 text-xs", isDark ? "text-white/30" : "text-slate-400")}>Showing {filtered.length} of {MEMBERS.length} members</div>
        </div>
      </div>
    </div>
  )
}

function BinarySection({ title, info, isDark }: { title: string; info: string; isDark: boolean }) {
  const [val, setVal] = useComponentState("Everyone")
  return (
    <div className="space-y-4">
      <SectionHeader title={title} info={info} isDark={isDark} />
      <p className={cn("text-sm", isDark ? "text-white/40" : "text-slate-500")}>{info}</p>
      <Label label="Default:" isDark={isDark} />
      <Segment options={BINARY_OPTS} value={val} onChange={setVal} isDark={isDark} />
    </div>
  )
}

function AllowProjectTracking({ isDark }: { isDark: boolean }) {
  const [globalOn, setGlobalOn] = useComponentState(true)
  const [projectToggles, setProjectToggles] = useComponentState<Record<string, boolean>>(Object.fromEntries(PROJECTS.map(p => [p, true])))
  const [search, setSearch] = useComponentState("")
  const [checked, setChecked] = useComponentState<Record<string, boolean>>({})
  const [page, setPage] = useComponentState(0)

  const filtered = PROJECTS.filter(p => p.toLowerCase().includes(search.toLowerCase()))
  const totalPages = Math.ceil(filtered.length / ORGANIZATION_PROJECTS_TODOS_PAGE_SIZE)
  const paginated = filtered.slice(page * ORGANIZATION_PROJECTS_TODOS_PAGE_SIZE, (page + 1) * ORGANIZATION_PROJECTS_TODOS_PAGE_SIZE)

  const handleSearch = (v: string) => { setSearch(v); setPage(0) }

  return (
    <div className="space-y-6">
      <div>
        <SectionHeader title="Allow Project Tracking" info="When enabled, members will be allowed to track time directly to the project. Disabling requires selecting a to-do before tracking." isDark={isDark} />
        <p className={cn("text-sm mb-4", isDark ? "text-white/40" : "text-slate-500")}>When enabled, members will be allowed to track time directly to the project. Disabling requires selecting a to-do first.</p>
        <Label label="Global:" isDark={isDark} />
        <Toggle checked={globalOn} onChange={() => setGlobalOn(p => !p)} />
      </div>
      <div>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h3 className={cn("text-base font-bold", isDark ? "text-white" : "text-slate-800")}>Individual settings</h3>
            <p className={cn("text-sm", isDark ? "text-white/40" : "text-slate-500")}>Override the organization default for specific projects</p>
          </div>
          <SearchInput placeholder="Search projects" isDark={isDark} value={search} onChange={handleSearch} />
        </div>
        <div className={cn("border rounded-xl overflow-hidden", isDark ? "border-white/5" : "border-slate-100")}>
          <div className={cn("grid items-center px-4 py-2.5 gap-4 text-xs font-bold uppercase tracking-wider", isDark ? "bg-white/5 text-white/30" : "bg-slate-50 text-slate-400")}
            style={{ gridTemplateColumns: "24px 1fr 60px 56px" }}>
            <span /><span>Project</span><span>Tasks</span><span />
          </div>
          {paginated.map((p, i) => (
            <div key={p} className={cn("grid items-center px-4 py-3 gap-4", i < paginated.length - 1 && (isDark ? "border-b border-white/5" : "border-b border-slate-100"))}
              style={{ gridTemplateColumns: "24px 1fr 60px 56px" }} aria-label="Interactive control">
              <input type="checkbox" checked={!!checked[p]} onChange={() => setChecked(prev => ({ ...prev, [p]: !prev[p] }))}
                className="w-4 h-4 rounded border-slate-300 accent-[#006e2f]" />
              <span className={cn("text-sm", isDark ? "text-white/80" : "text-slate-700")}>{p}</span>
              <span className={cn("text-sm", isDark ? "text-white/30" : "text-slate-400")}>0</span>
              <Toggle checked={projectToggles[p]} onChange={() => setProjectToggles(prev => ({ ...prev, [p]: !prev[p] }))} />
            </div>
          ))}
          <div className={cn("flex items-center justify-between px-4 py-2.5 border-t text-xs", isDark ? "border-white/5 text-white/30" : "border-slate-100 text-slate-400")}>
            <span>Showing {filtered.length === 0 ? 0 : page * ORGANIZATION_PROJECTS_TODOS_PAGE_SIZE + 1}–{Math.min((page + 1) * ORGANIZATION_PROJECTS_TODOS_PAGE_SIZE, filtered.length)} of {filtered.length} projects</span>
            <Pagination page={page} total={totalPages} onChange={setPage} isDark={isDark} />
          </div>
        </div>
      </div>
    </div>
  )
}

function AddTodoModal({ isDark, onClose }: { isDark: boolean; onClose: () => void }) {
  const [name, setName] = useComponentState("")
  const [projectSearch, setProjectSearch] = useComponentState("")
  const [allFuture, setAllFuture] = useComponentState(false)
  const [dropOpen, setDropOpen] = useComponentState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}>
      <div onClick={e => e.stopPropagation()} className={cn("w-full max-w-lg rounded-2xl shadow-2xl p-7 space-y-5", isDark ? "bg-[#151b2d] border border-white/10" : "bg-white")}>
        <div className="flex items-center justify-between">
          <h2 className={cn("text-lg font-bold", isDark ? "text-white" : "text-slate-800")}>Add a global to-do</h2>
          <button onClick={onClose} type="button" aria-label="Interactive control"><X className={cn("w-5 h-5", isDark ? "text-white/40" : "text-slate-400")} /></button>
        </div>
        <div>
          <Label label="Name" required isDark={isDark} />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name this to-do"
            className={cn("w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#006e2f]/20 focus:border-[#006e2f] transition-colors",
              isDark ? "bg-[#1a2235] border-white/10 text-white placeholder:text-white/20" : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-300")} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label label="Projects Selected" isDark={isDark} />
            <button className="text-xs font-semibold text-blue-500" type="button">Select all</button>
          </div>
          <div className="relative">
            <input value={projectSearch} onFocus={() => setDropOpen(true)} onBlur={() => setTimeout(() => setDropOpen(false), 150)}
              onChange={e => setProjectSearch(e.target.value)} placeholder="Select projects"
              className={cn("w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#006e2f]/20 focus:border-[#006e2f] transition-colors",
                isDark ? "bg-[#1a2235] border-white/10 text-white placeholder:text-white/20" : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-300")} />
            {dropOpen && (
              <div className={cn("absolute z-10 mt-1 w-full border rounded-xl shadow-lg py-2 text-sm", isDark ? "bg-[#1a2235] border-white/10" : "bg-white border-slate-200")}>
                <div className={cn("flex items-center gap-2 px-3 py-1.5 mb-1 mx-2 border rounded-lg", isDark ? "border-[#006e2f] bg-[#006e2f]/10" : "border-[#006e2f]")} aria-label="Interactive control">
                  <Search className="w-3.5 h-3.5 text-[#006e2f]" />
                  <input placeholder="Search projects" className="bg-transparent outline-none text-sm flex-1 placeholder:text-slate-400" />
                  <X className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <div className="flex flex-col items-center py-4 gap-2">
                  <div className={cn("w-12 h-12 rounded-lg border-2", isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50")} />
                  <span className={cn("text-sm font-medium", isDark ? "text-white/40" : "text-slate-500")}>No projects found</span>
                </div>
                <div className="px-3 pt-1 border-t border-slate-100">
                  <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                    <div className={cn("w-8 h-4 rounded-full border flex items-center px-0.5", isDark ? "border-white/10 bg-white/5" : "border-slate-300 bg-slate-100")}>
                      <div className="w-3 h-3 rounded-full bg-slate-400" />
                    </div>
                    Show only selected
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className={cn("flex items-start gap-2.5 p-3 border rounded-lg text-sm", isDark ? "bg-blue-500/10 border-blue-500/20 text-blue-300" : "bg-blue-50 border-blue-200 text-blue-700")}>
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>All members added to selected projects will be able to track time to global to-dos</span>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={allFuture} onChange={() => setAllFuture(p => !p)} className="w-4 h-4 rounded accent-[#006e2f]" />
          <span className={cn("text-sm", isDark ? "text-white/60" : "text-slate-600")}>Add all future projects</span>
          <Tooltip text="Automatically add this global to-do to all future projects">
            <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" />
          </Tooltip>
        </label>
        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className={cn("px-5 py-2 text-sm font-medium border rounded-lg transition-colors", isDark ? "border-white/10 text-white/60 hover:bg-white/5" : "border-slate-200 text-slate-600 hover:bg-slate-50")} type="button">Cancel</button>
          <button className="px-5 py-2 text-sm font-semibold bg-[#006e2f] text-white rounded-lg hover:bg-[#005a26] transition-colors" type="button">Save</button>
        </div>
      </div>
    </div>
  )
}

function GlobalTodos({ isDark }: { isDark: boolean }) {
  const [modalOpen, setModalOpen] = useComponentState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <SectionHeader title="Global To-Dos" isDark={isDark} />
          <p className={cn("text-sm max-w-2xl", isDark ? "text-white/40" : "text-slate-500")}>
            Global to-dos can be added to any project. Once added, all members of the project can track time to them, and they cannot be marked as complete. Data from these shared to-dos can be viewed across projects in the 'Time & activity' report.
          </p>
        </div>
        <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[#006e2f] text-white rounded-lg hover:bg-[#005a26] transition-colors shrink-0" type="button">
          <Plus className="w-4 h-4" /> Add a global to-do
        </button>
      </div>
      <div className={cn("border rounded-xl overflow-hidden", isDark ? "border-white/5" : "border-slate-100")}>
        <div className={cn("grid grid-cols-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider", isDark ? "bg-white/5 text-white/30" : "bg-slate-50 text-slate-400")}>
          <span>Name</span><span>Projects</span>
        </div>
        <div className="flex flex-col items-center py-12 gap-3">
          <div className={cn("w-16 h-16 rounded-xl border-2 flex items-center justify-center", isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50")}>
            <div className={cn("w-8 h-5 rounded border-2", isDark ? "border-white/20" : "border-slate-300")} />
          </div>
          <p className={cn("text-base font-bold", isDark ? "text-white/60" : "text-slate-700")}>Add global to-dos</p>
          <p className={cn("text-sm text-center", isDark ? "text-white/30" : "text-slate-400")}>Create global to-dos and easily add them to multiple projects</p>
        </div>
      </div>
      {modalOpen && <AddTodoModal isDark={isDark} onClose={() => setModalOpen(false)} />}
    </div>
  )
}

export default function ProjectsTodos() {
  const { isDark } = useTheme()
  const [active, setActive] = useComponentState("role")

  return (
    <div className="flex flex-col md:flex-row w-full min-h-[500px]">
      <div className={cn("w-full md:w-56 md:border-r py-4 md:pr-4 space-y-0.5 shrink-0", isDark ? "border-white/5" : "border-slate-100")}>
        {PROJECTS_TODOS_SUBNAV.map(i => (
          <button key={i.k} onClick={() => setActive(i.k)} className={cn("w-full text-left text-sm py-2 px-3 transition-colors rounded-r",
            active === i.k
              ? "text-[#006e2f] font-semibold border-l-2 border-[#006e2f]"
              : isDark ? "text-white/40 hover:text-white/70" : "text-slate-500 hover:text-slate-700"
          )} type="button">{i.l}</button>
        ))}
      </div>
      <div className="flex-1 py-4 md:pl-8">
        <AnimatePresence mode="wait">
          <motion.div key={active} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {active === "role" && <DefaultProjectRole isDark={isDark} />}
            {active === "complete" && <BinarySection title="Permission to Complete To-Dos" info="Allow tasks/to-dos completion within projects for everyone (role: users) or management only (roles: org owner and org managers)" isDark={isDark} />}
            {active === "manage" && <BinarySection title="Permission to Manage To-Dos" info="Allow tasks/to-dos to be managed (create, edit, delete) by everyone (role: users) or management only (roles: org owner and org managers)" isDark={isDark} />}
            {active === "tracking" && <AllowProjectTracking isDark={isDark} />}
            {active === "global" && <GlobalTodos isDark={isDark} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

