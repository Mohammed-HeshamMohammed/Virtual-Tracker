"use client"

import { useState } from "react"
import { Volume2, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { buzzMember, type BuzzCorner, type BuzzStyle } from "@/features/messages/api/messages-api"
import {
  BUZZ_SOUND_OPTIONS,
  previewBuzzSound,
  type BuzzSound,
} from "@/features/messages/components/buzz-sound"

export const BUZZ_DEFAULT_MESSAGE = "Dude. Focus on work."
const MAX_MESSAGE = 140

const STYLES: { value: BuzzStyle; label: string; hint: string }[] = [
  { value: "nudge", label: "Nudge", hint: "A small card that pops up in the corner of their screen." },
  { value: "bluescreen", label: "Blue screen", hint: "A joke blue screen with your message. They can close it at once." },
]

const CORNERS: { value: BuzzCorner; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
]

/**
 * The Owner or a Super Admin buzzing one person: on their desktop tracker, or in their open
 * dashboard when the tracker is not open. Live only - nothing is stored or queued - so it says
 * plainly when neither is open instead of pretending it went through.
 */
export function BuzzModal({
  memberId,
  memberName,
  onClose,
}: {
  memberId: string
  memberName: string
  onClose: () => void
}) {
  const [style, setStyle] = useState<BuzzStyle>("nudge")
  const [corner, setCorner] = useState<BuzzCorner>("top-right")
  const [sound, setSound] = useState<BuzzSound>("buzz")
  const [message, setMessage] = useState(BUZZ_DEFAULT_MESSAGE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [sent, setSent] = useState<"tracker" | "dashboard" | null>(null)

  async function send() {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const result = await buzzMember(memberId, style, message.trim(), corner, sound)
      setSent(result.reached?.tracker === false ? "dashboard" : "tracker")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not buzz them.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Buzz ${memberName}`}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Buzz {memberName}</h3>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Pops up on their desktop tracker right now, or in their dashboard if the tracker is not
              open. They can close it with one click.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {sent ? (
          <div className="mt-4 space-y-2 text-sm text-slate-700 dark:text-slate-200">
            <p>
              {sent === "dashboard"
                ? "Buzzed in their dashboard - their tracker is not open. Hopefully they are back to work."
                : "Buzzed. Hopefully they are back to work."}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white dark:bg-emerald-600"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Buzz style">
              {STYLES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={style === s.value}
                  onClick={() => setStyle(s.value)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                    style === s.value
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
                  )}
                >
                  <span className="block font-semibold">{s.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug opacity-80">{s.hint}</span>
                </button>
              ))}
            </div>

            {style === "nudge" ? (
              <div className="mt-3">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Corner of their screen
                </span>
                <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Corner of their screen">
                  {CORNERS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      role="radio"
                      aria-checked={corner === c.value}
                      onClick={() => setCorner(c.value)}
                      className={cn(
                        "rounded-lg border px-1.5 py-1.5 text-[11px] font-semibold transition-colors",
                        corner === c.value
                          ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-3">
              <label
                htmlFor="buzz-sound"
                className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400"
              >
                Sound
              </label>
              <div className="flex gap-2">
                <select
                  id="buzz-sound"
                  value={sound}
                  onChange={(e) => setSound(e.target.value as BuzzSound)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  {BUZZ_SOUND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void previewBuzzSound(sound, style)}
                  disabled={sound === "none"}
                  title="Hear this sound before sending"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Preview
                </button>
              </div>
              <p className="mt-1 text-[10px] text-slate-400">
                Plays when the buzz shows in their browser. The desktop tracker does not play sounds yet.
              </p>
            </div>

            <div className="mt-3">
              <label
                htmlFor="buzz-message"
                className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400"
              >
                Message
              </label>
              <input
                id="buzz-message"
                value={message}
                maxLength={MAX_MESSAGE}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={BUZZ_DEFAULT_MESSAGE}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
              <p className="mt-1 text-right text-[10px] text-slate-400">
                {message.length}/{MAX_MESSAGE}
              </p>
            </div>
            {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy}
                className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                {busy ? "Buzzing…" : "Buzz"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
