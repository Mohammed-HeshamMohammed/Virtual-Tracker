"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Send } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import {
  getMessageThread,
  listMessageThreads,
  markMessageThreadRead,
  replyToMessageThread,
  type MessageThread,
  type MessageThreadSummary,
} from "@/features/messages/api/messages-api"

const MAX_BODY = 2000

/**
 * Reading and replying to Owner<->member conversations. Used as the Messages
 * tab of the Notifications page. Either participant can reply - the Owner sees
 * the threads they opened, the member sees their own.
 */
export function MessageThreadsPanel({ initialThreadId }: { initialThreadId?: string }) {
  const { isDark } = useTheme()
  const [threads, setThreads] = useState<MessageThreadSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(initialThreadId ?? null)
  const [thread, setThread] = useState<MessageThread | null>(null)
  const [reply, setReply] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)

  const loadThreads = useCallback(async () => {
    try {
      const next = await listMessageThreads()
      setThreads(next)
      setSelectedId((current) => current ?? next[0]?.id ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load conversations")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  const loadThread = useCallback(async (id: string) => {
    try {
      const next = await getMessageThread(id)
      setThread(next)
      // Reading it is what marks it read - not merely having it in the list.
      await markMessageThreadRead(id).catch(() => undefined)
      setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, unread: 0 } : t)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the conversation")
    }
  }, [])

  useEffect(() => {
    if (selectedId) void loadThread(selectedId)
  }, [selectedId, loadThread])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [thread?.messages.length])

  async function send() {
    const body = reply.trim()
    if (!body || !thread || sending) return
    setSending(true)
    setError("")
    try {
      await replyToMessageThread(thread.id, body)
      setReply("")
      await loadThread(thread.id)
      await loadThreads()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send the reply")
    } finally {
      setSending(false)
    }
  }

  if (loading) return <p className="p-6 text-center text-sm text-slate-400">Loading…</p>

  if (!threads.length) {
    return (
      <p className="p-10 text-center text-sm text-slate-400">
        No conversations yet. The Owner can start one from the Onboarding list.
      </p>
    )
  }

  return (
    <div className="grid gap-3 md:grid-cols-[minmax(200px,280px)_1fr]">
      <ul className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {threads.map((t) => (
          <li key={t.id} className="border-b border-slate-200/60 last:border-0 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setSelectedId(t.id)}
              className={cn(
                "w-full px-3 py-2.5 text-left transition-colors",
                selectedId === t.id ? "bg-slate-100 dark:bg-slate-800" : "hover:bg-slate-50 dark:hover:bg-slate-800/60",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={cn("truncate text-sm font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                  {t.subject}
                </span>
                {t.unread > 0 ? (
                  <span className="rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white dark:bg-emerald-600">
                    {t.unread}
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">
                {t.openedByMe ? t.memberName : "From the Owner"} · {t.lastBody}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="flex max-h-[60vh] flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {thread ? (
          <>
            <div className="border-b border-slate-200/70 px-4 py-3 dark:border-slate-800">
              <p className={cn("text-sm font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
                {thread.subject}
              </p>
            </div>
            <div className="flex-1 space-y-2 overflow-auto p-4">
              {thread.messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "max-w-[80%] rounded-xl px-3 py-2 text-sm",
                    m.mine
                      ? "ml-auto bg-blue-600 text-white dark:bg-emerald-600"
                      : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100",
                  )}
                >
                  {m.body}
                </div>
              ))}
              <div ref={endRef} />
            </div>
            {thread.closed ? (
              <p className="border-t border-slate-200/70 p-3 text-xs text-slate-400 dark:border-slate-800">
                This conversation is closed.
              </p>
            ) : (
              <div className="border-t border-slate-200/70 p-3 dark:border-slate-800">
                {error ? <p className="mb-2 text-xs text-red-500">{error}</p> : null}
                <div className="flex gap-2">
                  <textarea
                    value={reply}
                    maxLength={MAX_BODY}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter sends, Shift+Enter makes a new line.
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        void send()
                      }
                    }}
                    rows={2}
                    placeholder="Write a reply…"
                    className="min-w-0 flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  />
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={sending || !reply.trim()}
                    aria-label="Send reply"
                    className="shrink-0 self-end rounded-lg bg-blue-600 px-3 py-2 text-white disabled:opacity-40 dark:bg-emerald-600"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="p-10 text-center text-sm text-slate-400">Pick a conversation.</p>
        )}
      </div>
    </div>
  )
}
