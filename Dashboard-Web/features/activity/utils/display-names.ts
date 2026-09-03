import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"

const EXE_DISPLAY_NAMES: Record<string, string> = {
  "chrome.exe": "Google Chrome",
  "msedge.exe": "Microsoft Edge",
  "firefox.exe": "Mozilla Firefox",
  "brave.exe": "Brave",
  "opera.exe": "Opera",
  "cursor.exe": "Cursor",
  "code.exe": "VS Code",
  "explorer.exe": "File Explorer",
  "python.exe": "Python",
  "pythonw.exe": "Python",
}

let serverDisplayNames: Record<string, string> | null = null
let serverDisplayNamesFetchStarted = false

type ActivityCategoryRow = {
  matchType: "app" | "domain"
  pattern: string
  displayName?: string | null
}

function ensureServerDisplayNamesLoading(): void {
  if (serverDisplayNamesFetchStarted) return
  serverDisplayNamesFetchStarted = true
  apiFetch(apiPath("/api/classification/categories"))
    .then((res) => (res.ok ? res.json() : null))
    .then((json: { data?: ActivityCategoryRow[] } | null) => {
      if (!json?.data) return
      const map: Record<string, string> = {}
      for (const row of json.data) {
        if (row.matchType === "app" && row.displayName) {
          map[row.pattern.toLowerCase()] = row.displayName
        }
      }
      serverDisplayNames = map
    })
    .catch(() => {
      // Best-effort - serverDisplayNames stays null, every lookup falls
      // through to EXE_DISPLAY_NAMES below.
    })
}

function isInvalidAppToken(name: string): boolean {
  const text = name.trim()
  if (!text || text.toLowerCase() === "unknown") return true
  const lower = text.toLowerCase()
  return lower.includes("://") || lower.includes("media-stream") || lower.startsWith("current-web-contents")
}

export function formatActivityAppName(raw: string): string {
  ensureServerDisplayNamesLoading()

  const name = (raw || "").trim()
  if (!name || name.toLowerCase() === "unknown") return "Unknown app"
  if (isInvalidAppToken(name)) return "Unknown app"

  const key = name.toLowerCase()
  const serverMapped = serverDisplayNames?.[key]
  if (serverMapped) return serverMapped

  const mapped = EXE_DISPLAY_NAMES[key]
  if (mapped) return mapped

  if (name.toLowerCase().endsWith(".exe")) {
    const stem = name.slice(0, -4).replace(/\./g, " ").trim()
    return stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : "Unknown app"
  }

  return name
}
