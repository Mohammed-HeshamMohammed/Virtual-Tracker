"use client"

import { useEffect, useRef, useState } from "react"
import { Pencil } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { updateSeatLimit, type SeatUsage } from "@/features/members/api/member-api"

/**
 * "(N) Seats || (N) Occupied || (N) Open" next to the Members header
 * (PLAN-bug-fixes-round-1.md item 18). "Occupied" is the backend's single
 * used-seats definition - active members, pending invites and not-yet-
 * signed-in pre-provisioned accounts - which is exactly what blocks the next
 * invite, so this number and the error someone hits can never disagree.
 *
 * With no real limit set the readout is hidden; an Owner/Super Admin of the
 * main organization instead gets a "Set seat limit" control, which is also
 * how they change or remove one later.
 */
export function SeatIndicator({
  usage,
  onChange,
}: {
  usage: SeatUsage | null
  onChange: (next: SeatUsage | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const limited = Boolean(usage && !usage.unlimited && usage.seatLimit !== null)
  if (!usage || (!limited && !usage.canEdit)) return null

  return (
    <div className="relative ml-1 flex items-center">
      {limited ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2 text-xs font-semibold tabular-nums shadow-sm dark:border-slate-800 dark:bg-slate-800/80">
          <span className="text-slate-500 dark:text-slate-400">
            <span className="text-slate-800 dark:text-slate-100">{usage.seatLimit}</span> Seats
          </span>
          <span className="text-slate-300 dark:text-slate-600">||</span>
          <span className="text-slate-500 dark:text-slate-400">
            <span className="text-slate-800 dark:text-slate-100">{usage.seatsUsed}</span> Occupied
          </span>
          <span className="text-slate-300 dark:text-slate-600">||</span>
          <span className={cn(usage.seatsOpen === 0 ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400")}>
            <span className={cn(usage.seatsOpen === 0 ? "text-red-600 dark:text-red-400" : "text-slate-800 dark:text-slate-100")}>
              {usage.seatsOpen}
            </span>{" "}
            Open
          </span>
          {usage.canEdit ? (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              aria-label="Change seat limit"
              title="Change seat limit"
              className="ml-0.5 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Set seat limit
        </button>
      )}
      {editing ? (
        <SeatLimitEditor
          usage={usage}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            onChange(next)
            setEditing(false)
          }}
        />
      ) : null}
    </div>
  )
}

function SeatLimitEditor({
  usage,
  onClose,
  onSaved,
}: {
  usage: SeatUsage
  onClose: () => void
  onSaved: (next: SeatUsage | null) => void
}) {
  const [value, setValue] = useState(usage.seatLimit !== null ? String(usage.seatLimit) : String(Math.max(usage.seatsUsed, 1)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  async function save(seats: number | null) {
    if (seats !== null) {
      if (!Number.isInteger(seats) || seats < 1) {
        setError("Enter a whole number of seats.")
        return
      }
      if (seats < usage.seatsUsed) {
        setError(`${usage.seatsUsed} seats are already in use.`)
        return
      }
    }
    setBusy(true)
    setError("")
    try {
      onSaved(await updateSeatLimit(seats))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the seat limit.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-30 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
    >
      <label htmlFor="seat-limit-input" className="mb-1.5 block font-semibold text-slate-700 dark:text-slate-200">
        Seat limit
      </label>
      <p className="mb-2 text-slate-500 dark:text-slate-400">
        {usage.seatsUsed} in use (members, pending invites and accounts not yet signed in).
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save(Number(value))
        }}
        className="flex gap-2"
      >
        <input
          id="seat-limit-input"
          type="number"
          // No `min`: the browser's own bubble would block the submit before
          // save() can say why ("7 seats are already in use").
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 focus:border-blue-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        >
          Save
        </button>
      </form>
      {!usage.unlimited ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(null)}
          className="mt-2 font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Remove limit (unlimited)
        </button>
      ) : null}
      {error ? <p className="mt-2 text-red-500">{error}</p> : null}
    </div>
  )
}
