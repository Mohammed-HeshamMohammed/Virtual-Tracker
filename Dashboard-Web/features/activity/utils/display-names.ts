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

function isInvalidAppToken(name: string): boolean {
  const text = name.trim()
  if (!text || text.toLowerCase() === "unknown") return true
  const lower = text.toLowerCase()
  return lower.includes("://") || lower.includes("media-stream") || lower.startsWith("current-web-contents")
}

/** Friendly label for activity app rows (also cleans legacy web-capture stream IDs). */
export function formatActivityAppName(raw: string): string {
  const name = (raw || "").trim()
  if (!name || name.toLowerCase() === "unknown") return "Unknown app"
  if (isInvalidAppToken(name)) return "Unknown app"

  const mapped = EXE_DISPLAY_NAMES[name.toLowerCase()]
  if (mapped) return mapped

  if (name.toLowerCase().endsWith(".exe")) {
    const stem = name.slice(0, -4).replace(/\./g, " ").trim()
    return stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : "Unknown app"
  }

  return name
}
