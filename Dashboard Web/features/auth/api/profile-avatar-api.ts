import { apiFetch } from "@/infrastructure/api/http"
import { getApiBaseUrl, getDirectApiBaseUrl } from "@/infrastructure/api/url"
import { prepareProfileImageForUpload } from "@/features/auth/services/compress-profile-image"
import type { User } from "firebase/auth"
import { parseAuthProfileSnapshot, type AuthProfileSnapshot } from "@/features/auth/services/verify-session"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTransientUploadError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed")
  )
}

function normalizeAvatarApiError(message: string): string {
  if (isTransientUploadError(message)) {
    return "Upload failed — could not reach the server. Ensure the Backend is running (port 5712). If you use `npm run dev` in Backend, wait for it to finish restarting and try again."
  }
  if (message.toLowerCase().includes("request body too large")) {
    return "Image is too large after encoding. Try a smaller photo."
  }
  return message
}

function avatarUploadUrls(): string[] {
  const urls: string[] = []
  if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
    urls.push("/api/auth/profile-avatar")
  }
  const configured = getApiBaseUrl()
  if (configured) {
    urls.push(`${configured}/api/auth/profile-avatar`)
  }
  urls.push(`${getDirectApiBaseUrl()}/api/auth/profile-avatar`)
  return [...new Set(urls)]
}

async function postProfileAvatarOnce(
  url: string,
  body: Record<string, unknown>,
): Promise<AuthProfileSnapshot | undefined> {
  const res = await apiFetch(url, {
    method: "POST",
    body: JSON.stringify(body),
  })
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const raw =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${res.status}`
    throw new Error(normalizeAvatarApiError(raw))
  }
  if (!data || typeof data !== "object" || (data as { success?: unknown }).success !== true) {
    throw new Error("Invalid profile-avatar response")
  }
  return parseAuthProfileSnapshot((data as { profile?: unknown }).profile)
}

async function postProfileAvatar(
  body: Record<string, unknown>,
): Promise<AuthProfileSnapshot | undefined> {
  const urls = avatarUploadUrls()
  let lastError: Error | null = null

  for (const url of urls) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await postProfileAvatarOnce(url, body)
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Upload failed")
        lastError = error
        if (!isTransientUploadError(error.message) || attempt >= 1) {
          break
        }
        await sleep(500 * (attempt + 1))
      }
    }
  }

  throw lastError ?? new Error("Upload failed")
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "")
    r.onerror = () => reject(r.error ?? new Error("Could not read file"))
    r.readAsDataURL(file)
  })
}

/**
 * Uploads a profile image to `User_profiles/{uid}` via Backend (base64 in Firestore).
 */
export async function uploadProfileAvatarWithBackend(
  user: User,
  file: File,
): Promise<AuthProfileSnapshot | undefined> {
  void user
  const prepared = await prepareProfileImageForUpload(file)
  const contentType = prepared.type.toLowerCase()
  const imageBase64 = await readFileAsDataUrl(prepared)
  if (!imageBase64) {
    throw new Error("Could not read image file.")
  }
  return postProfileAvatar({ imageBase64, contentType })
}

/**
 * Removes an uploaded profile image stored in Firestore (OAuth provider photos are preserved).
 */
export async function clearUploadedProfileAvatarWithBackend(user: User): Promise<AuthProfileSnapshot | undefined> {
  void user
  return postProfileAvatar({ clear: true })
}
