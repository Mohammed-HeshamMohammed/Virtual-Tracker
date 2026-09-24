"use client"

import { useCallback, useEffect, useState } from "react"
import { ShieldAlert } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import {
  contestIntegrityFlag,
  getIntegrityFlags,
  type IntegrityFlag,
} from "@/features/activity/api/integrity-api"

function formatDate(value: string): string {
  const t = Date.parse(value)
  return Number.isFinite(t) ? new Date(t).toLocaleString() : ""
}

export function IntegrityFlagsPanel({ memberId, isDark }: { memberId?: string; isDark?: boolean }) {
  const [flags, setFlags] = useState<IntegrityFlag[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState("")
  const [note, setNote] = useState("")
  const [busyId, setBusyId] = useState("")

  const load = useCallback(() => {
    setLoading(true)
    setError("")
    getIntegrityFlags(memberId)
      .then(setFlags)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load integrity flags."))
      .finally(() => setLoading(false))
  }, [memberId])

  useEffect(load, [load])

  async function submit(flagId: string) {
    if (!note.trim()) return
    setBusyId(flagId)
    setError("")
    try {
      const updated = await contestIntegrityFlag(flagId, note.trim())
      if (updated) setFlags((prev) => prev.map((f) => (f.id === updated.id ? updated : f)))
      setOpenId("")
      setNote("")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not submit your response.")
    } finally {
      setBusyId("")
    }
  }

  if (loading) return null
  if (!flags.length && !error) return null

  return (
    <section
      className={cn(
        "rounded-xl border p-4",
        isDark ? "border-slate-700 bg-slate-900/40" : "border-slate-200 bg-white",
      )}
    >
      <header className="mb-3 flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Activity flags</h3>
      </header>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        These lowered an activity score on a tracked session. If one is wrong, say so — your response is stored with
        the flag and is visible to whoever reviews it.
      </p>

      {error ? <p className="mb-3 text-xs text-rose-600 dark:text-rose-400">{error}</p> : null}

      <ul className="space-y-3">
        {flags.map((flag) => (
          <li
            key={flag.id}
            className={cn(
              "rounded-lg border p-3",
              isDark ? "border-slate-700" : "border-slate-200",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{flag.label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {formatDate(flag.detectedAt)}
                  {flag.penalty ? ` · −${flag.penalty} points` : ""}
                </p>
                {flag.detail ? (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{flag.detail}</p>
                ) : null}
              </div>
              {flag.contested ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  Response sent
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(flag.id)
                    setNote("")
                  }}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  This is wrong
                </button>
              )}
            </div>

            {flag.contested && flag.contestedNote ? (
              <p className="mt-2 border-l-2 border-slate-200 pl-2 text-xs italic text-slate-600 dark:border-slate-700 dark:text-slate-300">
                {flag.contestedNote}
              </p>
            ) : null}

            {openId === flag.id ? (
              <div className="mt-3 space-y-2">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="What were you actually doing?"
                  className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenId("")}
                    className="rounded-lg px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!note.trim() || busyId === flag.id}
                    onClick={() => void submit(flag.id)}
                    className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-emerald-600"
                  >
                    Send response
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
