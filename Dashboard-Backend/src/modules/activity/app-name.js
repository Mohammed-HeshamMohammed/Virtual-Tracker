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
  "zen.exe": "Zen Browser",
  "waterfox.exe": "Waterfox",
  "librewolf.exe": "LibreWolf",
  "arc.exe": "Arc",
  "whale.exe": "Naver Whale",
  "yandex.exe": "Yandex Browser",
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

/**
 * Mirrors the agent's browser table (Tauri-App-Extension/src-tauri/src/capture/
 * browsers.rs). Word-anchored on purpose: a bare substring match turned
 * "Research" and "Monarch" into browsers via "arc", and "Operator" via "opera".
 */
const BROWSER_NAME_PATTERN =
  /(^|[^a-z])(chrome|chromium|firefox|edge|msedge|opera|operagx|brave|safari|vivaldi|arc|yandex|whale|waterfox|librewolf|zen|browser)([^a-z]|$)/i;

export function isBrowserAppName(name) {
  return BROWSER_NAME_PATTERN.test(String(name || ""));
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
