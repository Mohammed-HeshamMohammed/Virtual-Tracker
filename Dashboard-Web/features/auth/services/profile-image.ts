import type { AuthProfileSnapshot } from "@/features/auth/services/verify-session"
import type { User } from "firebase/auth"

export type ProfileImageSource = {
  profileImageData?: string | null
  profileImageMimeType?: string | null
  photoURL?: string | null
}

export function resolveProfileAvatarUrl(
  profile?: ProfileImageSource | AuthProfileSnapshot | null,
  user?: Pick<User, "photoURL"> | null,
  fallback = "",
): string {
  const data = typeof profile?.profileImageData === "string" ? profile.profileImageData.trim() : ""
  const mime =
    typeof profile?.profileImageMimeType === "string" ? profile.profileImageMimeType.trim().toLowerCase() : ""
  if (data && mime.startsWith("image/")) {
    return `data:${mime};base64,${data}`
  }

  const photo = profile?.photoURL || user?.photoURL || ""
  if (typeof photo === "string" && photo.trim()) return photo.trim()
  return fallback
}

export function hasUploadedProfileImage(profile?: ProfileImageSource | AuthProfileSnapshot | null): boolean {
  const data = typeof profile?.profileImageData === "string" ? profile.profileImageData.trim() : ""
  const mime = typeof profile?.profileImageMimeType === "string" ? profile.profileImageMimeType.trim() : ""
  if (data && mime) return true
  return Boolean(profile && "avatarStoragePath" in profile && typeof profile.avatarStoragePath === "string" && profile.avatarStoragePath)
}
