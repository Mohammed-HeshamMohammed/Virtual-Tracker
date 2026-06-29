/* eslint-disable react-doctor/use-lazy-motion, react-doctor/rerender-lazy-state-init */
"use client"

import { useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Info } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { Toggle } from "@/features/settings/components/organization/components/ui"
import { ROLE_TYPES, ROLE_MATRIX, CUSTOM_PERMISSIONS } from "@/features/settings/components/shared/constants"
import { ROLE_COLS, TEAM_PERMS, ORGANIZATION_PERMISSIONS_PAGE_SIZE, PERMISSIONS_SUBNAV, type PermissionsTabKey } from "@/features/settings/components/shared/constants"

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
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
          className="w-56 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-lg text-center">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-800" />
        </div>
      )}
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

function CustomRoleModal({ isDark, onClose }: { isDark: boolean; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const toggle = (p: string) => setSelected(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}>
      <div onClick={e => e.stopPropagation()} className={cn("w-full max-w-lg rounded-2xl shadow-2xl p-7 space-y-5", isDark ? "bg-[#151b2d] border border-white/10" : "bg-white")}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className={cn("text-lg font-bold", isDark ? "text-white" : "text-slate-800")}>Custom roles</h2>
            <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-violet-500 text-white rounded-full">Feedback</span>
          </div>
          <button onClick={onClose} type="button"><X className={cn("w-5 h-5", isDark ? "text-white/40" : "text-slate-400")} /></button>
        </div>
        <p className={cn("text-sm", isDark ? "text-white/50" : "text-slate-500")}>Tell us what role permissions features would make the biggest difference for your team.</p>
        <div>
          <h3 className={cn("text-sm font-bold mb-3", isDark ? "text-white" : "text-slate-800")}>What job types would you like to set custom permissions for?</h3>
          <label className={cn("text-[11px] font-semibold tracking-widest uppercase mb-1.5 block", isDark ? "text-white/40" : "text-slate-500")} aria-label="Interactive control">Job Types</label>
          <textarea placeholder="Finance, HR, etc." rows={3} className={cn("w-full px-3 py-2 text-sm border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-[#006e2f]/20 focus:border-[#006e2f]",
            isDark ? "bg-[#1a2235] border-white/10 text-white placeholder:text-white/20" : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-300")} />
        </div>
        <div>
          <h3 className={cn("text-sm font-bold mb-3", isDark ? "text-white" : "text-slate-800")}>Which additional permissions would you like to customize?</h3>
          <div className="flex flex-wrap gap-2">
            {CUSTOM_PERMISSIONS.map(p => (
              <button key={p} onClick={() => toggle(p)} className={cn("px-3 py-1.5 text-sm border rounded-lg transition-colors",
                selected.includes(p)
                  ? isDark ? "border-[#006e2f] bg-[#006e2f]/10 text-[#006e2f]" : "border-[#006e2f] text-[#006e2f]"
                  : isDark ? "border-white/10 text-white/60 hover:border-white/20" : "border-slate-200 text-slate-600 hover:border-slate-300"
              )} type="button">{p}</button>
            ))}
          </div>
        </div>
        <div>
          <label className={cn("text-[11px] font-semibold tracking-widest uppercase mb-1.5 block", isDark ? "text-white/40" : "text-slate-500")}>Other</label>
          <textarea placeholder="Let us know what other features you would like to customize" rows={3} className={cn("w-full px-3 py-2 text-sm border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-[#006e2f]/20 focus:border-[#006e2f]",
            isDark ? "bg-[#1a2235] border-white/10 text-white placeholder:text-white/20" : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-300")} />
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className={cn("px-5 py-2 text-sm font-medium border rounded-lg", isDark ? "border-white/10 text-white/60 hover:bg-white/5" : "border-slate-200 text-slate-600 hover:bg-slate-50")} type="button">Close</button>
          <button className="px-5 py-2 text-sm font-semibold bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors" type="button">Submit</button>
        </div>
      </div>
    </div>
  )
}

function CellIcon({ val, isDark }: { val: boolean | "default" | null; isDark: boolean }) {
  if (val === null) return <span className={isDark ? "text-white/20" : "text-slate-300"}>—</span>
  if (val === false) return <div className={cn("w-4 h-4 border-2 rounded", isDark ? "border-white/20" : "border-slate-300")} />
  return (
    <div className={cn("w-4 h-4 rounded flex items-center justify-center", val === "default" ? "bg-blue-300" : "bg-blue-500")}>
      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
  )
}

function RolePermissions({ isDark }: { isDark: boolean }) {
  const [modal, setModal] = useState(false)
  const [matrix, setMatrix] = useState(() => ROLE_MATRIX.map(r => ({ ...r, values: [...r.values] })))
  let lastGroup = ""

  const toggleCell = (ri: number, ci: number) => {
    if (ROLE_COLS[ci].k === "custom" || matrix[ri].values[ci] === null) return
    setMatrix(prev => prev.map((r, i) => i !== ri ? r : {
      ...r, values: r.values.map((v, j) => j !== ci ? v : (v === true ? false : true)) as any
    }))
  }

  return (
    <div className="space-y-0 w-full">
      <div className={cn("grid items-center px-4 py-3 border-b", isDark ? "border-white/5" : "border-slate-100")}
        style={{ gridTemplateColumns: "1fr repeat(4, 130px)" }}>
        <div />
        {ROLE_COLS.map(c => (
          <div key={c.k} className="flex items-center justify-center gap-1">
            {c.k === "custom"
              ? <button onClick={() => setModal(true)} className={cn("px-4 py-1.5 text-sm border rounded-lg font-medium transition-colors", isDark ? "border-white/10 text-white/60 hover:bg-white/5" : "border-slate-200 text-slate-600 hover:bg-slate-50")} type="button">{c.l}</button>
              : <>
                <span className={cn("text-sm font-semibold", isDark ? "text-white/70" : "text-slate-700")}>{c.l}</span>
                {c.info && <Tooltip text={c.info}><Info className="w-3.5 h-3.5 text-slate-400 cursor-help" /></Tooltip>}
              </>
            }
          </div>
        ))}
      </div>

      {matrix.map((row, ri) => {
        const showGroup = row.group !== lastGroup
        lastGroup = row.group
        return (
          <div key={ri}>
            {showGroup && (
              <div className={cn("grid px-4 py-2.5 text-[11px] font-bold tracking-widest uppercase", isDark ? "bg-white/5 text-white/30" : "bg-slate-50 text-slate-400")}
                style={{ gridTemplateColumns: "1fr repeat(4, 130px)" }}>
                <div className="flex items-center gap-1">
                  {row.group}
                  {row.groupInfo && <Tooltip text={row.groupInfo}><Info className="w-3.5 h-3.5 text-slate-400 cursor-help" /></Tooltip>}
                </div>
                {ROLE_COLS.map(c => <div key={c.k} />)}
              </div>
            )}
            <div className={cn("grid items-center px-4 py-4 border-b", isDark ? "border-white/5" : "border-slate-100")}
              style={{ gridTemplateColumns: "1fr repeat(4, 130px)" }}>
              <span className={cn("text-sm pr-4", isDark ? "text-white/70" : "text-slate-700")}>{row.label}</span>
              {row.values.map((val, ci) => (
                <div key={ci} className="flex justify-center">
                  <button onClick={() => toggleCell(ri, ci)} className={ROLE_COLS[ci].k === "custom" || val === null ? "cursor-default" : "cursor-pointer"} type="button">
                    <CellIcon val={val} isDark={isDark} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      <div className={cn("flex items-center justify-end gap-6 px-4 py-3 border rounded-b-xl text-xs font-semibold", isDark ? "border-white/5 bg-white/5 text-white/50" : "border-slate-100 bg-slate-50 text-slate-600")}>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-blue-500 flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          ON
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-blue-300 flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          Default setting
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 border-2 border-slate-300 rounded" />
          OFF
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">—</span>
          Not available
        </div>
      </div>

      {modal && <CustomRoleModal isDark={isDark} onClose={() => setModal(false)} />}
    </div>
  )
}

function TeamPermissions({ isDark }: { isDark: boolean }) {
  const [allowLeads, setAllowLeads] = useState(true)
  const [perms, setPerms] = useState(TEAM_PERMS.map(p => ({ ...p })))
  const [page, setPage] = useState(0)

  const togglePerm = (i: number) => setPerms(prev => prev.map((p, j) => j !== i ? p : { ...p, checked: !p.checked }))
  const toggleNotify = (i: number) => setPerms(prev => prev.map((p, j) => j !== i ? p : { ...p, notifyToggle: !p.notifyToggle }))
  const toggleSubPerm = (i: number) => setPerms(prev => prev.map((p, j) => j !== i ? p : { ...p, sub: p.sub ? { ...p.sub, toggle: !p.sub.toggle } : undefined }))

  const totalPages = Math.ceil(perms.length / ORGANIZATION_PERMISSIONS_PAGE_SIZE)
  const paginated = perms.slice(page * ORGANIZATION_PERMISSIONS_PAGE_SIZE, (page + 1) * ORGANIZATION_PERMISSIONS_PAGE_SIZE)

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-1 mb-1">
          <span className={cn("text-[11px] font-bold tracking-widest uppercase", isDark ? "text-white/40" : "text-slate-500")}>Team Permission Structure</span>
          <Tooltip text="Control Team lead permissions, when added to projects through their teams">
            <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" />
          </Tooltip>
        </div>
        <p className={cn("text-sm mb-4", isDark ? "text-white/40" : "text-slate-500")}>
          When teams are assigned to projects, allow Team leads to view all members on the project including names, screenshots, activity, timesheets (even for members not on their team).
        </p>
        <p className={cn("text-xs font-semibold mb-2", isDark ? "text-white/40" : "text-slate-500")}>Global</p>
        <label className="flex items-center gap-3 cursor-pointer">
          <Toggle checked={allowLeads} onChange={() => setAllowLeads(p => !p)} />
          <span className={cn("text-sm", isDark ? "text-white/70" : "text-slate-700")}>Allow Team leads to manage projects</span>
        </label>
      </div>

      <div className={cn("border-t pt-6", isDark ? "border-white/5" : "border-slate-100")}>
        <h3 className={cn("text-base font-bold mb-1", isDark ? "text-white" : "text-slate-800")}>General settings</h3>
        <p className={cn("text-sm mb-4", isDark ? "text-white/40" : "text-slate-500")}>Adjust all Team lead permissions with the general settings below</p>

        <div className={cn("border rounded-xl overflow-hidden", isDark ? "border-white/5" : "border-slate-100")}>
          <div className={cn("grid px-4 py-2.5 text-xs font-bold uppercase tracking-wider", isDark ? "bg-white/5 text-white/30" : "bg-slate-50 text-slate-400")}
            style={{ gridTemplateColumns: "1fr 112px 176px" }}>
            <span>Team lead permissions</span>
            <div className="flex items-center gap-1 justify-center">
              Teams
              <Tooltip text="Teams where Team leads have the selected permissions ON">
                <Info className="w-3 h-3 cursor-help" />
              </Tooltip>
            </div>
            <span className="text-center">Only notify Team leads</span>
          </div>

          {paginated.map((p, i) => {
            const globalIdx = page * ORGANIZATION_PERMISSIONS_PAGE_SIZE + i
            return (
              <div key={globalIdx} className={cn("border-b last:border-0", isDark ? "border-white/5" : "border-slate-100")}>
                <div className="grid items-center px-4 py-3 gap-4" style={{ gridTemplateColumns: "1fr 112px 176px" }}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <button onClick={() => togglePerm(globalIdx)} className="mt-0.5 cursor-pointer" type="button">
                      <CellIcon val={p.checked} isDark={isDark} />
                    </button>
                    <span className={cn("text-sm", isDark ? "text-white/70" : "text-slate-700")}>{p.label}</span>
                  </label>
                  <div className="flex justify-center" />
                  <div className="flex justify-center">
                    <Toggle checked={p.notifyToggle} onChange={() => toggleNotify(globalIdx)} />
                  </div>
                </div>
                {p.sub && (
                  <div className="pl-11 pr-4 pb-3 flex items-center gap-2">
                    <Toggle checked={p.sub.toggle} onChange={() => toggleSubPerm(globalIdx)} />
                    <span className={cn("text-sm", isDark ? "text-white/50" : "text-slate-500")}>{p.sub.label}</span>
                  </div>
                )}
              </div>
            )
          })}

          <div className={cn("flex items-center justify-between px-4 py-2.5 border-t text-xs", isDark ? "border-white/5 text-white/30" : "border-slate-100 text-slate-400")}>
            <span>Showing {page * ORGANIZATION_PERMISSIONS_PAGE_SIZE + 1}–{Math.min((page + 1) * ORGANIZATION_PERMISSIONS_PAGE_SIZE, perms.length)} of {perms.length}</span>
            <Pagination page={page} total={totalPages} onChange={setPage} isDark={isDark} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Permissions() {
  const { isDark } = useTheme()
  const [active, setActive] = useState("role")

  return (
    <div className="flex flex-col md:flex-row w-full min-h-[500px]">
      <div className={cn("w-full md:w-56 md:border-r py-4 md:pr-4 space-y-0.5 shrink-0", isDark ? "border-white/5" : "border-slate-100")}>
        {PERMISSIONS_SUBNAV.map(i => (
          <button key={i.k} onClick={() => setActive(i.k)} className={cn("w-full text-left text-sm py-2 px-3 transition-colors",
            active === i.k
              ? "text-[#006e2f] font-semibold border-l-2 border-[#006e2f]"
              : isDark ? "text-white/40 hover:text-white/70" : "text-slate-500 hover:text-slate-700"
          )} type="button">{i.l}</button>
        ))}
      </div>
      <div className="flex-1 py-4 md:pl-8">
        <AnimatePresence mode="wait">
          <motion.div key={active} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {active === "role" && <RolePermissions isDark={isDark} />}
            {active === "team" && <TeamPermissions isDark={isDark} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

