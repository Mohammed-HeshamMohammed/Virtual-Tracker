"use client"

import { useRef, useState, useEffect, useMemo } from "react"
import { Mail, KeyRound, Trash2, ImageIcon } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import { UserAvatarImage } from "@/shared/ui/user-avatar-image"
import { clearUploadedProfileAvatarWithBackend, uploadProfileAvatarWithBackend } from "@/features/auth/api/profile-avatar-api"
import { hasUploadedProfileImage, resolveProfileAvatarUrl } from "@/features/auth/services/profile-image"
import { TARGET_MAX_BYTES } from "@/features/auth/services/compress-profile-image"
import { clearAllListCaches } from "@/shared/tables/hooks/list-cache-registry"
import { normalizeMemberRole } from "@/features/auth"
import {
  AccountActionDialog,
  clearLocalSessionAfterAccountDeletion,
} from "@/features/profile/components/account-action-dialog"
import type { User } from "firebase/auth"
import type { AuthProfileSnapshot } from "@/features/auth/services/verify-session"

const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"])

function hostnameIs(url: string, host: string): boolean {
  try {
    return new URL(url).hostname === host
  } catch {
    return false
  }
}

function withCacheBust(url: string): string {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return url
  // Hostname equality, not a substring: "https://evil.example/?x=api.dicebear.com"
  // would otherwise match. No security consequence here - the only effect is a
  // skipped cache-buster - but the pattern is wrong wherever it appears.
  if (hostnameIs(url, "api.dicebear.com")) return url
  const separator = url.includes("?") ? "&" : "?"
  return `${url}${separator}v=${Date.now()}`
}

export function SidebarSection({
  user,
  profile,
  displayName,
  memberRole,
  isDark,
  refreshProfile,
  isEmailPasswordUser,
  getInitials,
  onFocusEmail,
  onChangePassword,
}: {
  user: User | null
  profile: AuthProfileSnapshot | null
  displayName: string
  memberRole: string
  isDark: boolean
  refreshProfile: () => Promise<void>
  isEmailPasswordUser: boolean
  getInitials: (name: string | null) => string
  onFocusEmail: () => void
  onChangePassword: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isViewer = normalizeMemberRole(memberRole) === "viewer"

  const fallbackAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${getInitials(displayName)}`
  const defaultAvatar = useMemo(
    () => resolveProfileAvatarUrl(profile, user, fallbackAvatar),
    [profile, user, fallbackAvatar],
  )
  const [avatarUrl, setAvatarUrl] = useState(defaultAvatar)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarMessage, setAvatarMessage] = useState<string | null>(null)
  const [avatarSuccess, setAvatarSuccess] = useState(false)
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const canDeleteUploaded = hasUploadedProfileImage(profile)

  useEffect(() => {
    setAvatarUrl(withCacheBust(defaultAvatar))
  }, [defaultAvatar])

  async function onAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file || !user) return

    const contentType = file.type.toLowerCase()
    if (!ALLOWED_AVATAR_TYPES.has(contentType)) {
      setAvatarMessage("Unsupported file type. Use JPEG, PNG, or WebP.")
      setAvatarSuccess(false)
      return
    }
    if (file.size > TARGET_MAX_BYTES * 2) {
      setAvatarMessage("Image is too large. Choose a photo under 1 MB — it will be compressed automatically.")
      setAvatarSuccess(false)
      return
    }

    setAvatarBusy(true)
    setAvatarMessage(null)
    setAvatarSuccess(false)
    const preview = URL.createObjectURL(file)
    setAvatarUrl(preview)
    try {
      const uploaded = await uploadProfileAvatarWithBackend(user, file)
      await refreshProfile()
      clearAllListCaches()
      const nextUrl = resolveProfileAvatarUrl(uploaded, user, fallbackAvatar)
      setAvatarUrl(withCacheBust(nextUrl))
      setAvatarSuccess(true)
      setAvatarMessage("Profile picture updated.")
    } catch (err) {
      setAvatarUrl(withCacheBust(defaultAvatar))
      setAvatarMessage(err instanceof Error ? err.message : "Could not upload picture.")
      setAvatarSuccess(false)
    } finally {
      URL.revokeObjectURL(preview)
      setAvatarBusy(false)
    }
  }

  async function onDeleteUploadedAvatar() {
    if (!user || !canDeleteUploaded) return
    setAvatarBusy(true)
    setAvatarMessage(null)
    setAvatarSuccess(false)
    try {
      const cleared = await clearUploadedProfileAvatarWithBackend(user)
      await refreshProfile()
      clearAllListCaches()
      const nextUrl = resolveProfileAvatarUrl(cleared, user, fallbackAvatar)
      setAvatarUrl(withCacheBust(nextUrl))
      setAvatarMessage("Uploaded picture removed.")
      setAvatarSuccess(true)
    } catch (err) {
      setAvatarMessage(err instanceof Error ? err.message : "Could not remove picture.")
      setAvatarSuccess(false)
    } finally {
      setAvatarBusy(false)
    }
  }

  async function handleAccountDeleted() {
    await clearLocalSessionAfterAccountDeletion()
  }

  const sideBtn = cn(
    "w-full rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2",
    isDark
      ? "border-white/10 bg-[#151b2d] text-[#dce1fb] hover:bg-[#252b3d]"
      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  )

  return (
    <>
      <aside className="flex w-full shrink-0 flex-col items-center justify-start lg:w-72 lg:justify-center">
        <div className="flex flex-col items-center gap-4 w-full">
          <div
            className={cn(
              "relative flex h-[clamp(10rem,34vw,12rem)] w-[clamp(10rem,34vw,12rem)] items-center justify-center overflow-hidden rounded-full border-4 shadow-md sm:h-[clamp(11.5rem,30vw,14rem)] sm:w-[clamp(11.5rem,30vw,14rem)] lg:h-[clamp(12rem,30vh,15rem)] lg:w-[clamp(12rem,30vh,15rem)]",
              isDark ? "border-[#3d4a3d]/50 bg-[#6b38d4]/30" : "border-white bg-violet-100",
            )}
          >
            <UserAvatarImage src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
            {avatarBusy ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-semibold text-white">
                Uploading…
              </div>
            ) : null}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onAvatarFile}
            aria-label="Choose profile picture"
          />

          <button
            type="button"
            disabled={avatarBusy || !user}
            onClick={() => fileInputRef.current?.click()}
            className="text-sm font-semibold text-blue-500 hover:text-blue-600 disabled:pointer-events-none disabled:opacity-50"
          >
            {avatarBusy ? "Working…" : "Change picture"}
          </button>

          {avatarMessage ? (
            <p
              className={cn(
                "text-center text-xs",
                avatarSuccess
                  ? isDark
                    ? "text-emerald-300/90"
                    : "text-emerald-700"
                  : isDark
                    ? "text-amber-200/90"
                    : "text-amber-700",
              )}
            >
              {avatarMessage}
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex w-full max-w-sm flex-col gap-2.5 sm:mt-6">
          {!canDeleteUploaded ? (
            <IconTooltip
              text="Only pictures you uploaded here can be removed."
              placement="right"
              multiline
            >
              <button
                type="button"
                disabled={avatarBusy || !user || !canDeleteUploaded}
                onClick={() => void onDeleteUploadedAvatar()}
                className={cn(sideBtn, "disabled:pointer-events-none disabled:opacity-50")}
              >
                <ImageIcon className="h-4 w-4 opacity-70" />
                Delete uploaded picture
              </button>
            </IconTooltip>
          ) : (
            <button
              type="button"
              disabled={avatarBusy || !user || !canDeleteUploaded}
              onClick={() => void onDeleteUploadedAvatar()}
              className={cn(sideBtn, "disabled:pointer-events-none disabled:opacity-50")}
            >
              <ImageIcon className="h-4 w-4 opacity-70" />
              Delete uploaded picture
            </button>
          )}
          <button type="button" className={sideBtn} onClick={onFocusEmail}>
            <Mail className="h-4 w-4 opacity-70" />
            Change email
          </button>
          {!isEmailPasswordUser ? (
            <IconTooltip
              text="Password changes are only available for email and password accounts."
              placement="right"
              multiline
            >
              <button
                type="button"
                className={cn(sideBtn, "pointer-events-none opacity-50")}
                disabled={!isEmailPasswordUser}
                onClick={onChangePassword}
              >
                <KeyRound className="h-4 w-4 opacity-70" />
                Change password
              </button>
            </IconTooltip>
          ) : (
            <button
              type="button"
              className={sideBtn}
              disabled={!isEmailPasswordUser}
              onClick={onChangePassword}
            >
              <KeyRound className="h-4 w-4 opacity-70" />
              Change password
            </button>
          )}
          <button
            type="button"
            onClick={() => setAccountDialogOpen(true)}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
          >
            <Trash2 className="h-4 w-4" />
            {isViewer ? "Delete account" : "Request account deactivation"}
          </button>
        </div>
      </aside>

      <AccountActionDialog
        open={accountDialogOpen}
        onOpenChange={setAccountDialogOpen}
        mode={isViewer ? "delete" : "request"}
        user={user}
        isEmailPasswordUser={isEmailPasswordUser}
        isDark={isDark}
        onDeleted={() => void handleAccountDeleted()}
      />
    </>
  )
}
