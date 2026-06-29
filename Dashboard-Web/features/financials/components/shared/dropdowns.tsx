/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { Avatar } from "@/features/financials/components/shared/ui-components"
import { MEMBERS_LIST, PROJECTS_LIST, CATEGORIES } from "@/features/financials/components/shared/constants"

export function FilterDropdown({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  renderOption,
  hasSearch = false,
}: {
  value: string | null
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  renderOption?: (opt: string) => React.ReactNode
  hasSearch?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const filtered = hasSearch
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2.5 border rounded-lg text-sm bg-white transition-colors",
          open ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200 hover:border-slate-300"
        )}
      >
        <span className={value ? "text-slate-700 truncate" : "text-slate-400 truncate"}>
          {value || placeholder}
        </span>
        <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform shrink-0", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setSearch("") }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }} />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="absolute left-0 top-full mt-1 z-20 w-full bg-white rounded-xl border border-blue-400 shadow-lg overflow-hidden flex flex-col max-h-60" aria-label="Interactive control"
            >
              {hasSearch && (
                <div className="px-2 py-2 border-b border-slate-100 shrink-0">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search..."
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:border-blue-400"
                  />
                </div>
              )}
              <div className="overflow-y-auto flex-1">
                {filtered.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-slate-400">No results</p>
                ) : (
                  filtered.map((opt, i) => (
                    <button
                      key={opt}
                      onClick={() => {
                        onChange(opt)
                        setOpen(false)
                        setSearch("")
                      }}
                      className={cn(
                        "w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between",
                        opt === value ? "bg-blue-50 text-blue-600 font-medium" : "text-slate-700 hover:bg-slate-50",
                        i === 0 && !hasSearch && "bg-slate-50 text-slate-700" // specifically for "All X" mostly
                      )} type="button"
                    >
                      <span className="truncate">{renderOption ? renderOption(opt) : opt}</span>
                      {opt === value && <Check className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

export function CategoryDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <FilterDropdown value={value} onChange={onChange} options={CATEGORIES} placeholder="Select a category" hasSearch />
}

export function ProjectDropdown({ value, onChange, placeholder = "Select project" }: { value: string | null; onChange: (v: string) => void; placeholder?: string }) {
  return <FilterDropdown value={value} onChange={onChange} options={["All projects", ...PROJECTS_LIST]} placeholder={placeholder} />
}

function StatusDropdown({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return <FilterDropdown value={value} onChange={onChange} options={options} placeholder="Status" />
}

export function MemberDropdown({ label, selected, onSelect }: { label: string; selected: string | null; onSelect: (id: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const sel = MEMBERS_LIST.find((m) => m.id === selected)
  return (
    <div className="relative">
      <div
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setOpen((v) => !v)
          }
        }}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2.5 border rounded-lg cursor-pointer hover:border-blue-400 transition-colors bg-white text-sm",
          open ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200"
        )}
      >
        <span className={sel ? "text-slate-700 truncate" : "text-slate-400 truncate"}>{sel?.name ?? label}</span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </div>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.1 }}
              className="absolute left-0 top-full mt-1 z-20 w-full bg-white rounded-xl border border-slate-100 shadow-lg overflow-hidden max-h-56 overflow-y-auto"
            >
              <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-50">Members</div>
              {selected && (
                <button
                  onClick={() => { onSelect(null); setOpen(false) }}
                  className="w-full text-left px-3 py-2.5 text-sm text-slate-400 hover:bg-slate-50 transition-colors italic" type="button"
                >
                  All members
                </button>
              )}
              {MEMBERS_LIST.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { onSelect(m.id); setOpen(false) }}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors",
                    selected === m.id && "bg-slate-50 font-medium"
                  )} type="button"
                >
                  <span className="flex items-center gap-2 truncate">
                    <Avatar av={m.avatar} color={m.color} size="sm" />
                    <span className="truncate">{m.name}</span>
                  </span>
                  {selected === m.id && <Check className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
