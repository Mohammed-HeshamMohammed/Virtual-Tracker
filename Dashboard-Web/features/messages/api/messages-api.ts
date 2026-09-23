import { apiFetch, extractApiError, readJsonSafe, type ApiEnvelope } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"

/**
 * Owner<->member conversations (PLAN-notifications-and-owner-messaging.md
 * Part A). Only the Owner may open a thread; either participant may reply.
 * The backend enforces both — this client just calls it.
 */

export type MessageThreadSummary = {
  id: string
  subject: string
  memberId: string
  memberName: string
  openedByMe: boolean
  createdAt: string
  lastMessageAt: string
  closed: boolean
  unread: number
  lastBody: string
}

export type ThreadMessage = {
  id: string
  body: string
  createdAt: string
  mine: boolean
  read: boolean
}

export type MessageThread = {
  id: string
  subject: string
  memberId: string
  closed: boolean
  messages: ThreadMessage[]
}

export type OpenThreadsResult = { sent: number; skipped: number; threadIds: string[] }

async function unwrap<T>(res: Response, what: string): Promise<T> {
  const json = await readJsonSafe<ApiEnvelope<T>>(res)
  if (!res.ok) throw extractApiError(res.status, what, json)
  if (!json?.success || json.data === undefined) throw new Error(json?.error || what)
  return json.data as T
}

export async function listMessageThreads(): Promise<MessageThreadSummary[]> {
  return unwrap(await apiFetch(apiPath("/api/messages/threads")), "Failed to load conversations")
}

export async function getMessageThread(id: string): Promise<MessageThread> {
  return unwrap(
    await apiFetch(apiPath(`/api/messages/threads/${encodeURIComponent(id)}`)),
    "Failed to load the conversation",
  )
}

/** Owner only. One thread is opened per recipient. */
export async function openMessageThreads(
  memberIds: string[],
  subject: string,
  body: string,
): Promise<OpenThreadsResult> {
  const res = await apiFetch(apiPath("/api/messages/threads"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberIds, subject, body }),
  })
  return unwrap(res, "Failed to send the message")
}

export async function replyToMessageThread(id: string, body: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/messages/threads/${encodeURIComponent(id)}/reply`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  })
  await unwrap(res, "Failed to send the reply")
}

export async function markMessageThreadRead(id: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/messages/threads/${encodeURIComponent(id)}/read`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  })
  await unwrap(res, "Failed to mark the conversation read")
}
