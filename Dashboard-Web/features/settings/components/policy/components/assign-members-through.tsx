/* eslint-disable react-doctor/use-lazy-motion, react-doctor/exhaustive-deps */
"use client"

import { useState as useComponentState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { CheckSquare, Square, Info, ChevronDown } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import {
  ASSIGN_MEMBER_METHODS,
  EMPLOYMENT_TYPE_OPTIONS,
  SAMPLE_COUNTRY_OPTIONS,
  HOLIDAY_ASSIGN_METHOD_OPTIONS,
} from "@/features/settings/components/shared/constants"
import { SimpleDropdown } from "@/features/settings/components/policy/components/shared"

function Tooltip({ text }: { text: string }) {
  const [visible, setVisible] = useComponentState(false)
  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" />
      {visible && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[100] w-52 bg-slate-700 text-white text-xs rounded-xl px-3 py-2 text-center shadow-lg pointer-events-none">
          {text}
        </span>
      )}
    </span>
  )
}

function RichAssignMethodDropdown({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  const [open, setOpen] = useComponentState(false)
  const [rect, setRect] = useComponentState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  useEffect(() => {
    if (!open) return
    const update = () => {
      if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect())
    }
    update()
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [open])

  const openMenu = () => {
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect())
    setOpen(o => !o)
  }

  const selected = HOLIDAY_ASSIGN_METHOD_OPTIONS.find(o => o.value === value)
  const maxListHeight =
    rect && typeof window !== "undefined"
      ? Math.max(160, Math.min(360, window.innerHeight - rect.bottom - 16))
      : 360

  return (
    <div className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={openMenu}
        className={cn(
          "w-full flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left text-sm transition-colors bg-white",
          open ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200 hover:border-slate-300"
        )}
      >
        <span className={selected ? "text-slate-800 font-medium" : "text-slate-400"}>
          {selected ? selected.title : placeholder}
        </span>
        <ChevronDown className={cn("w-4 h-4 text-slate-400 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open &&
        rect &&
        createPortal(
          <motion.div
            ref={dropdownRef}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.12 }}
            style={{
              position: "fixed",
              top: rect.bottom + 4,
              left: rect.left,
              minWidth: rect.width,
              width: "max-content",
              maxWidth: "min(calc(100vw - 1rem), 26rem)",
              maxHeight: maxListHeight,
              zIndex: 100000,
            }}
            className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl overflow-y-auto overflow-x-hidden"
          >
            {HOLIDAY_ASSIGN_METHOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-slate-100 last:border-0 transition-colors shrink-0",
                  opt.value === value ? "bg-blue-50" : "hover:bg-slate-50"
                )}
              >
                <p className="text-sm font-semibold text-slate-800">{opt.title}</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-snug">{opt.description}</p>
              </button>
            ))}
          </motion.div>,
          document.body
        )}
    </div>
  )
}

const DEMO_MEMBERS: { id: string; name: string; role: string }[] = []

export function AssignMembersThroughStep({
  introText,
  saveLabel,
  autoAddEntity,
  methodVariant,
  methodPlaceholder = "Select method",
  assignmentContext,
  onBack,
  onSave,
  onClose,
}: {
  introText: string
  saveLabel: string
  autoAddEntity: "policy" | "holiday"
  methodVariant: "simple" | "rich"
  methodPlaceholder?: string
  assignmentContext: "policy" | "holiday"
  onBack: () => void
  onSave: () => void
  onClose: () => void
}) {
  const [assignMethod, setAssignMethod] = useComponentState<string>(methodVariant === "rich" ? "" : "List of members")
  const [search, setSearch] = useComponentState("")
  const [selected, setSelected] = useComponentState<string[]>([])
  const [homeCountry, setHomeCountry] = useComponentState("")
  const [employmentType, setEmploymentType] = useComponentState("")
  const [autoAddNew, setAutoAddNew] = useComponentState(false)

  const filtered = DEMO_MEMBERS.filter(
    m =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.role.toLowerCase().includes(search.toLowerCase())
  )

  const toggle = (id: string) =>
    setSelected(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))

  const selectAllMembers = () => {
    if (selected.length === filtered.length) setSelected([])
    else setSelected(filtered.map(m => m.id))
  }

  const autoAddLabel =
    autoAddEntity === "holiday"
      ? "Automatically add all new members to this holiday"
      : "Automatically add all new members to this policy"

  const memberListBlock = (
    <>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Members</p>
        <button type="button" onClick={selectAllMembers} className="text-xs font-semibold text-blue-500 hover:text-blue-600">
          Select all
        </button>
      </div>
      <input
        readOnly
        placeholder="Select members"
        className="w-full border border-blue-400 ring-1 ring-blue-400 rounded-xl px-4 py-3 text-sm text-slate-400 bg-white cursor-default" aria-label="Interactive control"
      />
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search members..."
        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mt-2"
      />
      <div className="space-y-2 mt-3">
        {filtered.map(m => (
          <div
            key={m.id}
            role="button"
            tabIndex={0}
            onClick={() => toggle(m.id)}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") toggle(m.id)
            }}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all",
              selected.includes(m.id) ? "border-blue-400 bg-blue-50/50" : "border-slate-200 hover:border-slate-300"
            )}
          >
            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600 shrink-0">
              {m.name
                .split(" ")
                .map(n => n[0])
                .join("")}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-700">{m.name}</p>
              <p className="text-xs text-slate-400">{m.role}</p>
            </div>
            {selected.includes(m.id) ? (
              <CheckSquare className="w-4 h-4 text-blue-500 shrink-0" />
            ) : (
              <Square className="w-4 h-4 text-slate-300 shrink-0" />
            )}
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 mt-4 cursor-pointer">
        <input
          type="checkbox"
          checked={autoAddNew}
          onChange={() => setAutoAddNew(v => !v)}
          className="w-4 h-4 accent-blue-500 rounded border-slate-300"
        />
        <span className="text-sm text-slate-700">{autoAddLabel}</span>
      </label>
    </>
  )

  const countryBlock = (
    <>
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex gap-3 text-sm text-slate-700">
        <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <p>
          {assignmentContext === "holiday" ? (
            <>
              This holiday uses <strong>Home address - country</strong> and <strong>Employment type</strong> from member
              profiles.{" "}
              <button type="button" className="text-blue-500 font-semibold hover:underline">
                Member profiles
              </button>{" "}
              must be up-to-date for correct assignment.
            </>
          ) : (
            <>
              This policy is based on <strong>Home address - country</strong> and <strong>Employment type</strong> fields.{" "}
              <button type="button" className="text-blue-500 font-semibold hover:underline">
                Member profiles
              </button>{" "}
              must be up-to-date to ensure proper policy assignment.
            </>
          )}
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Home address - country</p>
            <button type="button" className="text-xs font-semibold text-blue-500 hover:text-blue-600">
              Select all
            </button>
          </div>
          <SimpleDropdown
            value={homeCountry}
            options={[...SAMPLE_COUNTRY_OPTIONS]}
            onChange={setHomeCountry}
            placeholder="Select home country"
            searchable
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Employment type</p>
            <button type="button" className="text-xs font-semibold text-blue-500 hover:text-blue-600">
              Select all
            </button>
          </div>
          <SimpleDropdown
            value={employmentType}
            options={[...EMPLOYMENT_TYPE_OPTIONS]}
            onChange={setEmploymentType}
            placeholder="Select employment type"
            searchable
          />
        </div>
      </div>
      <label className="flex items-center gap-2 mt-4 cursor-pointer">
        <input
          type="checkbox"
          checked={autoAddNew}
          onChange={() => setAutoAddNew(v => !v)}
          className="w-4 h-4 accent-blue-500 rounded border-slate-300"
        />
        <span className="text-sm text-slate-700">{autoAddLabel}</span>
      </label>
    </>
  )

  const csvBlock = (
    <>
      <div className="border-2 border-dashed border-slate-200 rounded-xl px-6 py-10 flex flex-col items-center gap-3 bg-slate-50/50">
        <label className="cursor-pointer">
          <span className="inline-flex px-5 py-2 text-sm font-semibold text-blue-500 border border-blue-400 rounded-lg hover:bg-blue-50 transition-colors">
            Browse files
          </span>
          <input type="file" accept=".csv" className="hidden" />
        </label>
        <p className="text-xs text-slate-500">
          Accepted file formats: <strong>.CSV</strong>
        </p>
      </div>
      <button type="button" className="text-sm font-semibold text-blue-500 hover:text-blue-600 mt-2">
        Download the template here
      </button>
      <label className="flex items-center gap-2 mt-4 cursor-pointer">
        <input
          type="checkbox"
          checked={autoAddNew}
          onChange={() => setAutoAddNew(v => !v)}
          className="w-4 h-4 accent-blue-500 rounded border-slate-300"
        />
        <span className="text-sm text-slate-700">{autoAddLabel}</span>
      </label>
    </>
  )

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-6 space-y-5" style={{ scrollbarWidth: "none" }}>
        <p className="text-sm text-slate-600">{introText}</p>
        <div>
          <div className="flex items-center gap-1 mb-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Add members through</span>
            <Tooltip text="Choose whether to pick members directly, match by profile fields, or import a CSV." />
          </div>
          {methodVariant === "rich" ? (
            <RichAssignMethodDropdown
              value={assignMethod}
              onChange={setAssignMethod}
              placeholder={methodPlaceholder}
            />
          ) : (
            <SimpleDropdown
              value={assignMethod}
              options={[...ASSIGN_MEMBER_METHODS]}
              onChange={setAssignMethod}
              placeholder={methodPlaceholder}
            />
          )}
        </div>
        {assignMethod === "List of members" && memberListBlock}
        {assignMethod === "Home country and Employment type" && countryBlock}
        {assignMethod === "Import CSV" && csvBlock}
      </div>

      <div className="flex justify-between items-center px-8 py-5 border-t border-slate-100 shrink-0 gap-4">
        <button
          type="button"
          onClick={onClose}
          className="px-6 py-2.5 text-sm border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-2.5 text-sm border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onSave}
            className="px-8 py-2.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-semibold transition-colors"
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </>
  )
}

