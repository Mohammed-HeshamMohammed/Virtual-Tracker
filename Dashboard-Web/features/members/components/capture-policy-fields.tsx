"use client"

import { useEffect, useState } from "react"
import { Toggle } from "@/shared/ui/forms/toggle"
import { SelectField } from "@/shared/ui/forms/select-field"
import { FormField } from "@/shared/ui/forms/form-field"
import {
  getCaptureSettings,
  saveCaptureSettings,
  type CaptureSettings,
  type CaptureSettingsPatch,
} from "@/features/members/api/capture-settings-api"

/** Label → [min, max] seconds between screenshots. */
const CADENCE = {
  Standard: [90, 210],
  Reduced: [300, 600],
  Minimal: [900, 1800],
} as const

type CadenceName = keyof typeof CADENCE

function cadenceOf(settings: CaptureSettings | null): CadenceName {
  if (!settings) return "Standard"
  const match = (Object.keys(CADENCE) as CadenceName[]).find(
    (name) => CADENCE[name][0] === settings.screenshotMinDelaySec && CADENCE[name][1] === settings.screenshotMaxDelaySec,
  )
  return match ?? "Standard"
}

function toMinutes(value: string): number | null {
  const [h, m] = value.split(":").map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

function toTime(minutes: number | null): string {
  if (minutes == null) return ""
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

export function CapturePolicyFields({ memberId, disabled }: { memberId: string; disabled?: boolean }) {
  const [settings, setSettings] = useState<CaptureSettings | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError("")
    getCaptureSettings(memberId)
      .then((data) => {
        if (!cancelled) setSettings(data)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load capture settings.")
      })
    return () => {
      cancelled = true
    }
  }, [memberId])

  async function patch(next: CaptureSettingsPatch) {
    setBusy(true)
    setError("")
    try {
      setSettings(await saveCaptureSettings(memberId, next))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save capture settings.")
    } finally {
      setBusy(false)
    }
  }

  const locked = disabled || busy || !settings

  return (
    <fieldset disabled={locked} className="space-y-3 disabled:opacity-60">
      <FormField label="Screenshot frequency">
        <SelectField
          value={cadenceOf(settings)}
          options={(Object.keys(CADENCE) as CadenceName[]).map((value) => ({ value, label: value }))}
          onChange={(name) => {
            const [min, max] = CADENCE[name as CadenceName]
            void patch({ screenshotMinDelaySec: min, screenshotMaxDelaySec: max })
          }}
        />
      </FormField>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-600 dark:text-slate-300">Always blur screenshots</span>
        <Toggle
          checked={settings?.blurDefault ?? false}
          onChange={(checked) => void patch({ blurDefault: checked })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Capture from">
          <input
            type="time"
            value={toTime(settings?.workStartMin ?? null)}
              onChange={(e) => void patch({ workStartMin: toMinutes(e.target.value) })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </FormField>
        <FormField label="Capture until">
          <input
            type="time"
            value={toTime(settings?.workEndMin ?? null)}
              onChange={(e) => void patch({ workEndMin: toMinutes(e.target.value) })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </FormField>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Leave both blank to capture whenever the timer runs. Outside these hours, and on days off, nothing is captured.
      </p>

      {error ? <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p> : null}
    </fieldset>
  )
}
