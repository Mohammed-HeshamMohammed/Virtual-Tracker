// CQ-4: this is the *third* independent copy of this mapping found in this
// codebase (window.rs's overrides(), display-names.ts's EXE_DISPLAY_NAMES,
// and this one) - and the most important one, since normalizeAppName() below
// runs at ingest and determines what actually gets stored in apps.name. Kept
// in sync with activity_categories' seeded app patterns (CLS-1,
// ensure-lookup-schema.js) by hand for now: a mismatch here means a
// correctly-classified pattern silently never matches the stored name (e.g.
// "explorer.exe" was classified but nothing normalized to it - the stored
// name was the generic stem-titlecase fallback "Explorer" instead). The real
// fix is making this function read activity_categories directly instead of
// a fourth hardcoded copy; deferred because it's a per-ingested-event lookup
// that would need a cache to avoid a DB round trip per event, same shape as
// the Rust/frontend caches already built for MAC-3 - worth doing, not free.
const APP_EXE_DISPLAY_NAMES = {
  "chrome.exe": "Google Chrome",
  "msedge.exe": "Microsoft Edge",
  "firefox.exe": "Mozilla Firefox",
  "brave.exe": "Brave",
  "opera.exe": "Opera",
  "operagx.exe": "Opera GX",
  "vivaldi.exe": "Vivaldi",
  "chromium.exe": "Chromium",
  "iexplore.exe": "Internet Explorer",
  "zen.exe": "Zen",
  "waterfox.exe": "Waterfox",
  "cursor.exe": "Cursor",
  "code.exe": "VS Code",
  "devenv.exe": "Visual Studio",
  "pycharm64.exe": "PyCharm",
  "idea64.exe": "IntelliJ IDEA",
  "explorer.exe": "File Explorer",
  "python.exe": "Python",
  "pythonw.exe": "Python",
  "windowsterminal.exe": "Windows Terminal",
  "wt.exe": "Windows Terminal",
  "powershell.exe": "PowerShell",
  "cmd.exe": "Command Prompt",
  "winword.exe": "Microsoft Word",
  "excel.exe": "Microsoft Excel",
  "powerpnt.exe": "PowerPoint",
  "outlook.exe": "Outlook",
  "slack.exe": "Slack",
  "discord.exe": "Discord",
  "discord_ptb.exe": "Discord PTB",
  "teams.exe": "Microsoft Teams",
  "zoom.exe": "Zoom",
  "spotify.exe": "Spotify",
  "steam.exe": "Steam",
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
