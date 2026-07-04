const CONSENT_COOKIE_NAME = "vt_cookie_consent"
const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export type CookieConsentValue = "accepted" | "declined"

/**
 * Parent domain for the consent cookie so accepting on one subdomain
 * (e.g. the landing page) is respected on the others (e.g. the dashboard).
 * Returns undefined on localhost/IP hosts, where the cookie stays host-only.
 */
function getCookieDomain(): string | undefined {
  if (typeof window === "undefined") return undefined
  const host = window.location.hostname
  if (host === "localhost" || /^[\d.]+$/.test(host)) return undefined
  const parts = host.split(".")
  if (parts.length <= 2) return undefined
  return `.${parts.slice(-2).join(".")}`
}

export function getCookieConsent(): CookieConsentValue | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE_NAME}=([^;]*)`))
  const value = match ? decodeURIComponent(match[1]) : null
  return value === "accepted" || value === "declined" ? value : null
}

export function setCookieConsent(value: CookieConsentValue): void {
  if (typeof document === "undefined") return
  const domain = getCookieDomain()
  const secure = window.location.protocol === "https:" ? "; Secure" : ""
  const domainPart = domain ? `; Domain=${domain}` : ""
  document.cookie = `${CONSENT_COOKIE_NAME}=${value}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${domainPart}${secure}`
}
