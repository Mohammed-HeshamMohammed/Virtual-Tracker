/**
 * Whether this browser is on Windows 7, 8 or 8.1 ("legacy"), Windows 10 or 11 ("modern"), or not
 * on Windows at all (null). The agent has a separate build for the old systems
 * (Tauri-App-Extension/PLAN-windows-7-legacy-build.md); this decides which one the page marks
 * as "Your computer". Both are always listed, so a wrong guess costs one extra click.
 *
 * In order:
 * 1. Chromium browsers (Chrome, Edge, Brave) give the real Windows version through the
 *    platform-version hint: "0.0.0" on Windows 7, 8 and 8.1, 1 or more on Windows 10 and 11.
 * 2. Firefox has no hint but still reports the real version in its User-Agent ("Windows NT 6.1"
 *    is 7, "6.2" is 8, "6.3" is 8.1).
 * 3. Chromium's User-Agent says "Windows NT 10.0" on every Windows since version 107, but 109 is
 *    the last version old Windows gets, so 109 or below means old Windows. Wrong only for a
 *    Windows 10 machine held on an old browser, which then gets the legacy build: it runs
 *    there too.
 */
export async function detectWindowsGeneration(): Promise<"legacy" | "modern" | null> {
  if (typeof navigator === "undefined") return null
  const ua = navigator.userAgent || ""
  if (!/Windows NT/i.test(ua)) return null

  const hints = (navigator as Navigator & {
    userAgentData?: { getHighEntropyValues?: (keys: string[]) => Promise<{ platformVersion?: string }> }
  }).userAgentData
  if (hints?.getHighEntropyValues) {
    try {
      const { platformVersion } = await hints.getHighEntropyValues(["platformVersion"])
      const major = Number.parseInt(String(platformVersion ?? "").split(".")[0], 10)
      if (Number.isFinite(major)) return major >= 1 ? "modern" : "legacy"
    } catch {
      /* The hint was refused; the User-Agent below still answers. */
    }
  }

  if (/Windows NT 6\.[123]\b/i.test(ua)) return "legacy"
  const chromium = ua.match(/\bChrom(?:e|ium)\/(\d+)/)
  if (chromium && Number(chromium[1]) <= 109) return "legacy"
  return "modern"
}
