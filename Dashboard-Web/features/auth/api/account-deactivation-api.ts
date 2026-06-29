import { apiPath } from "@/infrastructure/api/path"
import { apiFetch } from "@/infrastructure/api/http"
import { EmailAuthProvider, reauthenticateWithCredential, type User } from "firebase/auth"
import { formatPasswordChangeError } from "@/features/auth/services/change-password"

function normalizeAccountApiError(message: string): string {
  if (message.includes("ECONNRESET") || message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return "Could not reach the server. Ensure Auth-Backend is running on port 5712."
  }
  return message
}

export async function reauthenticateEmailPasswordUser(user: User, password: string): Promise<void> {
  const email = user.email
  if (!email) {
    throw new Error("Your account has no email address for re-authentication.")
  }
  if (!password.trim()) {
    throw new Error("Password is required to confirm this action.")
  }
  try {
    const credential = EmailAuthProvider.credential(email, password)
    await reauthenticateWithCredential(user, credential)
  } catch (err) {
    throw new Error(formatPasswordChangeError(err))
  }
}

export async function submitAccountDeactivationRequest(): Promise<{ id: string; alreadyPending: boolean }> {
  let res: Response
  try {
    res = await apiFetch(apiPath("/api/auth/deactivation-request"), {
      method: "POST",
      body: JSON.stringify({}),
    })
  } catch (err) {
    throw new Error(normalizeAccountApiError(err instanceof Error ? err.message : "Request failed"))
  }
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${res.status}`
    throw new Error(normalizeAccountApiError(err))
  }
  if (!data || typeof data !== "object" || (data as { success?: unknown }).success !== true) {
    throw new Error("Invalid deactivation request response")
  }
  const payload = (data as { data?: { id?: string; alreadyPending?: boolean } }).data
  const id = typeof payload?.id === "string" ? payload.id : ""
  if (!id) throw new Error("Missing request id")
  return { id, alreadyPending: Boolean(payload?.alreadyPending) }
}

export async function deleteViewerAccountWithBackend(): Promise<void> {
  let res: Response
  try {
    res = await apiFetch(apiPath("/api/auth/delete-account"), {
      method: "POST",
      body: JSON.stringify({}),
    })
  } catch (err) {
    throw new Error(normalizeAccountApiError(err instanceof Error ? err.message : "Delete failed"))
  }
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${res.status}`
    throw new Error(normalizeAccountApiError(err))
  }
  if (!data || typeof data !== "object" || (data as { success?: unknown }).success !== true) {
    throw new Error("Invalid delete account response")
  }
}
