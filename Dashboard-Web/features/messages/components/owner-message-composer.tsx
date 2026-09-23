"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { openMessageThreads } from "@/features/messages/api/messages-api"

const MAX_SUBJECT = 160
const MAX_BODY = 2000

export type MessageRecipient = { memberId: string; email: string; supportsInbox?: boolean }

/**
 * The Owner writing to one or more members' trackers
 * (PLAN-notifications-and-owner-messaging.md A4).
 *
 * It says plainly how many people will only see this in the web app: an older
 * tracker has no inbox to show it in, and silently reaching fewer people than
 * you think is worse than being told.
 */
export function OwnerMessageComposer({
  recipients,
  onClose,
  onSent,
}: {
  recipients: MessageRecipient[]
  onClose: () => void
  onSent?: (result: { sent: number; skipped: number }) => void
}) {
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState<{ sent: number; skipped: number } | null>(null)

  const withoutInbox = recipients.filter((r) => r.supportsInbox === false).length
  const canSend = Boolean(subject.trim() && body.trim()) && recipients.length > 0 && !busy

  async function send() {
    if (!canSend) return
    setBusy(true)
    setError("")
    try {
      const result = await openMessageThreads(
        recipients.map((r) => r.memberId),
        subject.trim(),
        body.trim(),
      )
      setDone({ sent: result.sent, skipped: result.skipped })
      onSent?.({ sent: result.sent, skipped: result.skipped })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the message.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Message trackers"
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Message tracker</h3>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {recipients.length === 1
                ? `To ${recipients[0].email}`
                : `To ${recipients.length} people`}
              . They can reply.
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

        {done ? (
          <div className="mt-4 space-y-2 text-sm text-slate-700 dark:text-slate-200">
            <p>
              Sent to {done.sent} {done.sent === 1 ? "person" : "people"}.
            </p>
            {done.skipped > 0 ? (
              <p className="text-amber-600 dark:text-amber-400">
                {done.skipped} could not be reached and were skipped.
              </p>
            ) : null}
            {withoutInbox > 0 ? (
              <p className="text-slate-500 dark:text-slate-400">
                {withoutInbox} of them have an older tracker and will only see this in the web app.
              </p>
            ) : null}
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
            <div className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="owner-message-subject"
                  className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400"
                >
                  Subject*
                </label>
                <input
                  id="owner-message-subject"
                  value={subject}
                  maxLength={MAX_SUBJECT}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Please update your tracker"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
              <div>
                <label
                  htmlFor="owner-message-body"
                  className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400"
                >
                  Message*
                </label>
                <textarea
                  id="owner-message-body"
                  value={body}
                  maxLength={MAX_BODY}
                  rows={5}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write what you need them to know."
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
                <p className="mt-1 text-right text-[10px] text-slate-400">
                  {body.length}/{MAX_BODY}
                </p>
              </div>
              {withoutInbox > 0 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  {withoutInbox} of these {withoutInbox === 1 ? "person has" : "people have"} an older tracker and will
                  only see this in the web app.
                </p>
              ) : null}
              {error ? <p className="text-xs text-red-500">{error}</p> : null}
            </div>

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
                disabled={!canSend}
                className={cn(
                  "rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-40",
                  "bg-blue-600 hover:bg-blue-700 dark:bg-emerald-600 dark:hover:bg-emerald-500",
                )}
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
