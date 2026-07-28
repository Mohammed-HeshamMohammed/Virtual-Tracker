/* eslint-disable react-doctor/use-lazy-motion, react-doctor/exhaustive-deps, react-doctor/no-derived-state */
/* eslint-disable react-doctor/only-export-components */
"use client"

import { useCallback, useEffect, useMemo, useRef, useState as useComponentState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, Search, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { createOrganizationFieldOption, getOrganizationFieldOptions } from "@/infrastructure/api"
import {
  STATIC_EMPLOYMENT_TYPES,
  STATIC_EMPLOYED_THROUGH,
  STATIC_WORKPLACE_MODELS,
  STATIC_TERMINATION_REASONS,
} from "@/features/members/config/members-config"

const STATIC_OPTIONS_BY_TYPE: Record<string, string[]> = {
  employmentType: STATIC_EMPLOYMENT_TYPES,
  employedThrough: STATIC_EMPLOYED_THROUGH,
  workplaceModel: STATIC_WORKPLACE_MODELS,
  terminationReason: STATIC_TERMINATION_REASONS,
}

export type OrgFieldOptionType =
  | "jobTitle"
  | "department"
  | "jobType"
  | "employmentType"
  | "employedThrough"
  | "workplaceModel"
  | "taxType"
  | "terminationReason"

const PORTAL_DROPDOWN_BACKDROP_Z = "z-71"
const PORTAL_DROPDOWN_MENU_Z = "z-80"
/** Sub-modals (e.g. New option) must sit above member manage modal z-70 and dropdown menus */
const PORTAL_MODAL_Z = "z-90"

const MODAL_LABEL = "mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500"
const MODAL_INPUT =
  "w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-blue-400 dark:focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-emerald-500"

/** Matches `SimpleSelect` trigger in members modal (text-sm, py-2.5). */
const DROPDOWN_TRIGGER_CLASS =
  "flex w-full items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-left text-sm text-slate-700 dark:text-slate-200 transition-colors hover:border-blue-400 dark:hover:border-emerald-500"

const DROPDOWN_MENU_LIST_CLASS =
  "min-h-0 max-h-72 flex-1 overflow-y-auto py-1"

const DROPDOWN_OPTION_CLASS =
  "flex w-full items-center px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60"

function getOrCreateCreatorId(): string {
  if (typeof window === "undefined") return "server"
  try {
    let id = window.localStorage.getItem("vt-creator-id")
    if (!id) {
      id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `u_${Date.now()}`
      window.localStorage.setItem("vt-creator-id", id)
    }
    return id
  } catch {
    return "unknown"
  }
}

type OptionRow = { id: string; label: string; position: number }

type RankBandDef = { id: string; label: string; ratio: number }

const JOB_TITLE_RANKS: RankBandDef[] = [
  { id: "jt_intern", label: "Intern / Entry level", ratio: 0 },
  { id: "jt_junior", label: "Junior", ratio: 0.25 },
  { id: "jt_mid", label: "Intermediate", ratio: 0.5 },
  { id: "jt_senior", label: "Senior", ratio: 0.75 },
  { id: "jt_lead", label: "Lead / Principal", ratio: 1 },
]

/** Org criticality / exposure for ordering departments. */
const DEPARTMENT_RANKS: RankBandDef[] = [
  { id: "dept_support", label: "Support / ancillary", ratio: 0 },
  { id: "dept_ops", label: "Operational", ratio: 0.25 },
  { id: "dept_core", label: "Core business unit", ratio: 0.5 },
  { id: "dept_strategic", label: "Strategic / revenue-critical", ratio: 0.75 },
  { id: "dept_exec", label: "Executive / company-critical", ratio: 1 },
]

/** Engagement / role shape for ordering job types. */
const JOB_TYPE_RANKS: RankBandDef[] = [
  { id: "jt_seasonal", label: "Seasonal / occasional", ratio: 0 },
  { id: "jt_part", label: "Part-time", ratio: 0.25 },
  { id: "jt_contract", label: "Contract / project-based", ratio: 0.5 },
  { id: "jt_ft", label: "Full-time", ratio: 0.75 },
  { id: "jt_exec", label: "Leadership / executive", ratio: 1 },
]

const DEFAULT_RANK_FALLBACK = JOB_TITLE_RANKS

function rankBandsForFieldType(fieldType: OrgFieldOptionType): RankBandDef[] {
  if (fieldType === "department") return DEPARTMENT_RANKS
  if (fieldType === "jobType") return JOB_TYPE_RANKS
  if (fieldType === "jobTitle") return JOB_TITLE_RANKS
  return DEFAULT_RANK_FALLBACK
}

function defaultRankBandId(fieldType: OrgFieldOptionType): string {
  const bands = rankBandsForFieldType(fieldType)
  return bands[Math.min(2, Math.floor(bands.length / 2))]?.id ?? bands[0]?.id ?? "jt_mid"
}

function rankBandToPositionIndex(rankId: string, existingCount: number, fieldType: OrgFieldOptionType): number {
  const n = Math.max(0, existingCount)
  if (n === 0) return 0
  const bands = rankBandsForFieldType(fieldType)
  const ratio = bands.find((b) => b.id === rankId)?.ratio ?? 0.5
  const idx = Math.round(n * ratio)
  return Math.min(n, Math.max(0, idx))
}

async function fetchOptions(type: OrgFieldOptionType): Promise<OptionRow[]> {
  return (await getOrganizationFieldOptions(type)) as OptionRow[]
}

async function postOption(
  type: OrgFieldOptionType,
  label: string,
  position: number,
  createdBy: string,
): Promise<OptionRow | null> {
  return (await createOrganizationFieldOption({ type, label, position, createdBy })) as OptionRow | null
}

export function ManageableFieldOptionsSelect({
  fieldType,
  label,
  placeholder,
  value,
  onChange,
  staticOptions = [],
  /** When true: list only (no search, no “Edit options”) — e.g. Hiring details row. */
  compactMenu = false,
  /** When true, no built-in label (use an external label so grid rows can align). */
  hideLabel = false,
  /**
   * When true, GET options as soon as this control mounts (not only on first open).
   * Defaults to the same value as `compactMenu` so compact lists show API rows immediately.
   */
  prefetchOnMount,
}: {
  fieldType: OrgFieldOptionType
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  /** Merged with server options (deduped by label) */
  staticOptions?: string[]
  compactMenu?: boolean
  hideLabel?: boolean
  prefetchOnMount?: boolean
}) {
  const shouldPrefetchOptions = prefetchOnMount ?? compactMenu
  const [open, setOpen] = useComponentState(false)
  const [search, setSearch] = useComponentState("")
  const [options, setOptions] = useComponentState<OptionRow[]>([])
  const [loading, setLoading] = useComponentState(false)
  const [newOpen, setNewOpen] = useComponentState(false)
  const [newLabel, setNewLabel] = useComponentState("")
  const [rankBand, setRankBand] = useComponentState(() => defaultRankBandId(fieldType))
  const [saving, setSaving] = useComponentState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [menuPos, setMenuPos] = useComponentState({ top: 0, left: 0, width: 280 })

  const rankBands = useMemo(() => rankBandsForFieldType(fieldType), [fieldType])

  const mergedLabels = useMemo(() => {
    const fromServer = options.map((o) => o.label)
    const set = new Set<string>([...staticOptions, ...fromServer].filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [options, staticOptions])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return mergedLabels
    return mergedLabels.filter((l) => l.toLowerCase().includes(q))
  }, [mergedLabels, search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await fetchOptions(fieldType)
      setOptions(rows)
    } finally {
      setLoading(false)
    }
  }, [fieldType])

  useEffect(() => {
    if (!shouldPrefetchOptions) return
    void load()
  }, [shouldPrefetchOptions, load])

  const [prevOpen, setPrevOpen] = useComponentState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setSearch("")
    }
  }

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  useEffect(() => {
    setRankBand(defaultRankBandId(fieldType))
  }, [fieldType])

  function computeMenuPosition(): void {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const w = Math.min(320, Math.max(260, rect.width))
    setMenuPos({
      top: rect.bottom + 6,
      left: Math.min(Math.max(8, rect.left), window.innerWidth - w - 8),
      width: w,
    })
  }

  useEffect(() => {
    if (!open) return
    const u = () => computeMenuPosition()
    u()
    window.addEventListener("resize", u)
    window.addEventListener("scroll", u, true)
    return () => {
      window.removeEventListener("resize", u)
      window.removeEventListener("scroll", u, true)
    }
  }, [open])

  async function saveNewOption() {
    const labelTrim = newLabel.trim()
    if (!labelTrim) return
    setSaving(true)
    try {
      const createdBy = getOrCreateCreatorId()
      const staticOptions = STATIC_OPTIONS_BY_TYPE[fieldType] ?? []
      const staticIndex = staticOptions.indexOf(labelTrim)
      const positionIndex = staticIndex >= 0 ? staticIndex : rankBandToPositionIndex(rankBand, mergedLabels.length, fieldType)
      const created = await postOption(fieldType, labelTrim, positionIndex, createdBy)
      if (created) {
        setOptions((prev) => [...prev, created].sort((a, b) => a.position - b.position))
        onChange(labelTrim)
      }
      setNewOpen(false)
      setNewLabel("")
      setRankBand(defaultRankBandId(fieldType))
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const rankHelpText =
    fieldType === "department"
      ? "Where this department sits in org criticality vs other departments."
      : fieldType === "jobType"
        ? "How this job type ranks vs others (engagement / seniority of role shape)."
        : "Rough seniority band for where this option sits among others."

  return (
    <div className="relative">
      {!hideLabel ? <label className={MODAL_LABEL}>{label}</label> : null}
      <button
        ref={triggerRef}
        type="button"
        aria-label={hideLabel ? label : undefined}
        onClick={() => {
          if (open) {
            setOpen(false)
            return
          }
          computeMenuPosition()
          setOpen(true)
        }}
        className={cn(DROPDOWN_TRIGGER_CLASS, open && "border-blue-400 ring-1 ring-blue-400/20 dark:border-emerald-500 dark:ring-emerald-500/20")}
      >
        <span className={cn("truncate", !value && "text-slate-400 dark:text-slate-500")}>{value || placeholder}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500 transition-transform", open && "rotate-180")} />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className={cn("fixed inset-0", PORTAL_DROPDOWN_BACKDROP_Z)} aria-hidden onClick={() => setOpen(false)} />
            <div
              className={cn(
                "fixed flex max-h-72 flex-col overflow-hidden rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 py-1 shadow-lg",
                PORTAL_DROPDOWN_MENU_Z,
              )}
              style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
              onClick={(e) => e.stopPropagation()}
            >
              {!compactMenu ? (
                <div className="border-b border-slate-100 dark:border-slate-700 p-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search"
                      className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 py-1.5 pl-8 pr-2 text-xs focus:border-blue-400 dark:focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-blue-400/20 dark:focus:ring-emerald-500/20" aria-label="Interactive control"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      setNewOpen(true)
                      setRankBand(defaultRankBandId(fieldType))
                    }}
                    className="mt-2 w-full py-1.5 text-left text-xs font-semibold text-blue-600 dark:text-emerald-400 hover:underline"
                  >
                    Edit options
                  </button>
                </div>
              ) : null}
              <div className={DROPDOWN_MENU_LIST_CLASS}>
                {loading ? (
                  <p className="px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-500">Loading…</p>
                ) : filtered.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-500">No results found</p>
                ) : (
                  filtered.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        onChange(opt)
                        setOpen(false)
                      }}
                      className={cn(DROPDOWN_OPTION_CLASS, opt === value && "bg-blue-50 dark:bg-emerald-950/60 font-medium text-blue-800 dark:text-emerald-300")}
                    >
                      {opt}
                    </button>
                  ))
                )}
              </div>
            </div>
          </>,
          document.body,
        )}

      <AnimatePresence>
        {newOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn("fixed inset-0 flex items-center justify-center bg-black/50 p-4", PORTAL_MODAL_Z)}
            onClick={() => !saving && setNewOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 6 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 6 }}
              className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">New option</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">This will update selection choices in all member profiles.</p>
                </div>
                <button type="button" onClick={() => !saving && setNewOpen(false)} className="rounded-lg p-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className={MODAL_LABEL}>{label}</label>
                  <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className={MODAL_INPUT} placeholder="" />
                </div>
                <div>
                  <label className={MODAL_LABEL}>List ranking</label>
                  <p className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">{rankHelpText}</p>
                  <select
                    value={rankBand}
                    onChange={(e) => setRankBand(e.target.value)}
                    className={MODAL_INPUT}
                  >
                    {rankBands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setNewOpen(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving || !newLabel.trim()}
                  onClick={() => void saveNewOption()}
                  className="rounded-lg bg-blue-500 dark:bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 dark:hover:bg-emerald-500 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
