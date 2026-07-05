const NOTIFY_PREF_KEY = "vt_landing_notify_prefs"

export function isNotificationsBellEnabled(): boolean {
  if (typeof window === "undefined") return true
  return window.localStorage.getItem(NOTIFY_PREF_KEY) !== "off"
}

export function setNotificationsBellEnabled(enabled: boolean): void {
  window.localStorage.setItem(NOTIFY_PREF_KEY, enabled ? "on" : "off")
}
