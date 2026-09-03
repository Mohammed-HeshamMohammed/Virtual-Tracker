const LAUNCHER_QUERY = "vt_launcher"
const OAUTH_QUERY = "vt_oauth"

export const GOOGLE_OAUTH_REDIRECT_MESSAGE = "Redirecting to Google..."

export function isLauncherHost(): boolean {
  if (typeof window === "undefined") return false
  if (window.pywebview?.api) return true
  return new URLSearchParams(window.location.search).get(LAUNCHER_QUERY) === "1"
}

export function isEmbeddedInLauncherFrame(): boolean {
  if (typeof window === "undefined") return false
  try {
    if (window.self === window.top) return false
    return window.parent.location.origin !== window.location.origin
  } catch {
    return true
  }
}

export function shouldUseGoogleRedirect(): boolean {
  return isLauncherHost() || isEmbeddedInLauncherFrame()
}

export function withLauncherQuery(url: string): string {
  try {
    const next = new URL(url)
    next.searchParams.set(LAUNCHER_QUERY, "1")
    return next.toString()
  } catch {
    const join = url.includes("?") ? "&" : "?"
    return `${url}${join}${LAUNCHER_QUERY}=1`
  }
}

export function buildLauncherGoogleOAuthUrl(): string {
  const url = new URL(window.location.href)
  url.searchParams.set(LAUNCHER_QUERY, "1")
  url.searchParams.set(OAUTH_QUERY, "google")
  return url.toString()
}

export function navigateLauncherHost(url: string): void {
  try {
    window.top!.location.href = url
  } catch {
    window.location.href = url
  }
}

export function consumeLauncherOAuthIntent(): "google" | null {
  if (typeof window === "undefined") return null
  const params = new URLSearchParams(window.location.search)
  const intent = params.get(OAUTH_QUERY)
  if (intent !== "google") return null
  params.delete(OAUTH_QUERY)
  const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`
  window.history.replaceState({}, document.title, next)
  return "google"
}

export function isLauncherPywebviewWindow(): boolean {
  if (typeof window === "undefined") return false
  return isLauncherHost() && Boolean(window.pywebview?.api)
}

export function closeLauncherAppWindow(): void {
  window.pywebview?.api?.close_app_window?.()
}

export function maximizeLauncherAppWindow(): void {
  window.pywebview?.api?.maximize_app_window?.()
}

export function minimizeLauncherAppWindow(): void {
  window.pywebview?.api?.minimize_app_window?.()
}
