"use client"

import { GOOGLE_OAUTH_REDIRECT_MESSAGE, isLauncherPywebviewWindow } from "@/features/auth/services/launcher-runtime"

type LauncherGoogleOAuthBannerProps = {
  message: string | null
  onCancel: () => void
}

/** Inline cancel shown on the login page while Google redirect is starting in the launcher dashboard window. */
export function LauncherGoogleOAuthBanner({ message, onCancel }: LauncherGoogleOAuthBannerProps) {
  if (!isLauncherPywebviewWindow()) return null
  if (message !== GOOGLE_OAUTH_REDIRECT_MESSAGE) return null

  return (
    <div className="launcher-google-oauth-banner" role="status" aria-live="polite">
      <p className="launcher-google-oauth-banner-text">{message}</p>
      <button type="button" className="launcher-google-oauth-banner-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
