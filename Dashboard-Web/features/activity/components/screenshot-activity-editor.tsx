"use client"

import { useState } from "react"

/**
 * Correcting a capture's activity level.
 *
 * The default is to apply across the capture run - the unbroken stretch of
 * tracked work this screenshot belongs to, bounded by idle gaps - because a
 * bad reading is rarely wrong for exactly one screenshot. The single-capture
 * escape hatch is there for when it genuinely is.
 *
 * The original measurement is kept server-side and never overwritten, so an
 * edit is a correction on the record, not a rewrite of it.
 */
export function ScreenshotActivityEditor({
  currentLevel,
  onSave,
  onCancel,
}: {
  currentLevel: number
  onSave: (activityLevel: number, applyToRun: boolean, reason: string) => Promise<void>
  onCancel: () => void
}) {
  const [level, setLevel] = useState(currentLevel)
  const [applyToRun, setApplyToRun] = useState(true)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(level, applyToRun, reason.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update activity level")
      setSaving(false)
    }
  }

  return (
    <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <label htmlFor="activity-level" className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Activity
        </label>
        <input
          id="activity-level"
          type="range"
          min={0}
          max={100}
          value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
          className="h-2 flex-1 cursor-pointer accent-emerald-500"
        />
        <input
          type="number"
          min={0}
          max={100}
          value={level}
          onChange={(e) => setLevel(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
          aria-label="Activity percentage"
          className="w-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-sm text-slate-800 dark:text-slate-100"
        />
        <span className="text-sm text-slate-500 dark:text-slate-400">%</span>
      </div>

      <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
        <input
          type="checkbox"
          checked={applyToRun}
          onChange={(e) => setApplyToRun(e.target.checked)}
          className="mt-0.5 accent-emerald-500"
        />
        <span>
          Apply to this whole stretch of tracked work. Captures separated by an idle break are not
          affected. Uncheck to change only this capture.
        </span>
      </label>

      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional) — recorded with the change"
        maxLength={500}
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
      />

      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || level === currentLevel}
          className="px-3 py-1.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  )
}
