const APP_EXE_DISPLAY_NAMES = {
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
};

function isInvalidAppName(name) {
  const text = String(name || "").trim();
  if (!text || text.toLowerCase() === "unknown") return true;
  const lower = text.toLowerCase();
  return lower.includes("://") || lower.includes("media-stream") || lower.startsWith("current-web-contents");
}

export function isBrowserAppName(name) {
  return /chrome|firefox|edge|opera|brave|safari|vivaldi|browser|chromium/i.test(String(name || ""));
}

export function normalizeAppName(raw) {
  const name = String(raw || "").trim();
  if (isInvalidAppName(name)) return null;
  const mapped = APP_EXE_DISPLAY_NAMES[name.toLowerCase()];
  if (mapped) return mapped;
  if (name.toLowerCase().endsWith(".exe")) {
    const stem = name.slice(0, -4).replace(/\./g, " ").trim();
    return stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : null;
  }
  return name;
}
