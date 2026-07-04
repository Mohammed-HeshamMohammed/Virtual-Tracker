import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"


export interface TransferRequestPreview {
  requester_name: string
  target_email_masked: string
  expires_at: string
  status: string
}

export interface CreateTransferRequestResult {
  id: string
  token?: string
  transfer_url: string
  status: string
  expires_at?: string
  existing?: boolean
}

/** Create member transfer request. */
export async function createMemberTransferRequest(targetEmail: string): Promise<CreateTransferRequestResult> {
  const res = await apiFetch(apiPath("/api/member-transfer-requests"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_email: targetEmail }),
  })
  const json = await res.json()
  if (!res.ok || !json.success) {
    throw new Error(json.error || `Failed to create transfer request: ${res.status}`)
  }
  return json.data
}

/** Public transfer preview by token. */
export async function getTransferRequestPreview(token: string): Promise<TransferRequestPreview> {
  const res = await apiFetch(apiPath(`/api/public/member-transfer-requests/${encodeURIComponent(token)}`))
  const json = await res.json()
  if (!res.ok || !json.success) {
    throw new Error(json.error || "Invalid or expired transfer invitation.")
  }
  return json.data
}

/** Accept transfer (auth required). */
export async function acceptMemberTransferRequest(token: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/public/member-transfer-requests/${encodeURIComponent(token)}/accept`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  })
  const json = await res.json()
  if (!res.ok || !json.success) {
    throw new Error(json.error || "Could not accept invitation.")
  }
}

/** Decline transfer (auth required). */
export async function declineMemberTransferRequest(token: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/public/member-transfer-requests/${encodeURIComponent(token)}/decline`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  })
  const json = await res.json()
  if (!res.ok || !json.success) {
    throw new Error(json.error || "Could not decline invitation.")
  }
}

/** Hierarchy audit report (admin only). */
export async function getHierarchyAuditReport(): Promise<Record<string, unknown>> {
  const res = await apiFetch(apiPath("/api/member-relationships/audit"))
  const json = await res.json()
  if (!res.ok || !json.success) {
    throw new Error(json.error || "Audit failed.")
  }
  return json.data
}
