
import { getEnv } from "../../config/env.js";
import { applyCors, corsHeaders } from "../../http/cors.js";
import { getSecurityHeaders } from "../../http/security-headers.js";

let cachedRelease = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

const AGENT_TAG_RE = /^agent-v(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * The highest published agent version, not the first one GitHub lists.
 *
 * GitHub's release list is not in version order: it follows how the releases were created, so
 * deleting and recreating a release (or retrying one on an existing tag) can leave an older
 * version at the top. Taking the first match then pinned the whole update feed to 1.1.9 while
 * 1.1.10 was already published, and the release's own verification failed on it. Ties keep
 * GitHub's order.
 */
export function selectLatestAgentRelease(releases) {
  if (!Array.isArray(releases)) return null;
  let best = null;
  let bestKey = null;
  for (const release of releases) {
    if (!release || release.draft === true || release.prerelease === true) continue;
    const match = AGENT_TAG_RE.exec(String(release.tag_name || ""));
    if (!match) continue;
    const key = [Number(match[1]), Number(match[2]), Number(match[3])];
    const newer =
      !bestKey ||
      key[0] > bestKey[0] ||
      (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])));
    if (newer) {
      best = release;
      bestKey = key;
    }
  }
  return best;
}

export async function getLatestRelease(repoOwner, repoName, pat) {
  const now = Date.now();
  if (cachedRelease && now - cachedRelease.fetchedAt < CACHE_TTL_MS) {
    return cachedRelease.data;
  }

  // `/releases/latest` is repository-wide. A future dashboard/backend release
  // must never silently replace the agent feed, so select only `agent-v*`.
  const url = `https://api.github.com/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/releases?per_page=30`;
  const headers = {
    "User-Agent": "VirtualTracker-LandingBackend",
    "Accept": "application/vnd.github+json",
  };
  if (pat) {
    headers["Authorization"] = `Bearer ${pat}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`GitHub API error (${res.status}): ${errText || res.statusText}`);
  }

  const releases = await res.json();
  const data = selectLatestAgentRelease(releases);
  if (!data) throw new Error("GitHub has no published agent-v* release");
  cachedRelease = { data, fetchedAt: now };
  return data;
}

/**
 * The right .dmg for this Mac. A release carries two - `..._darwin_aarch64.dmg` (Apple
 * Silicon) and `..._darwin_x64.dmg` (Intel) - and the page used to hand out whichever GitHub
 * listed first, which was the Apple Silicon one: an Intel Mac opening it is told "this
 * application is not supported on this Mac".
 *
 * With no architecture given, the Intel build is the safe answer: it also runs on Apple
 * Silicon (through Rosetta), where the Apple Silicon build cannot run on an Intel Mac.
 */
export function pickMacDmg(assets, arch = "") {
  const dmgs = (Array.isArray(assets) ? assets : []).filter((a) => String(a?.name || "").toLowerCase().endsWith(".dmg"));
  if (dmgs.length === 0) return null;
  const wantsAppleSilicon = /^(arm64|aarch64|apple|silicon|m\d)/i.test(String(arch || "").trim());
  const isAppleSilicon = (a) => /aarch64|arm64/i.test(a.name);
  const isIntel = (a) => /x64|x86_64|x86-64|intel/i.test(a.name);
  const wanted = wantsAppleSilicon ? dmgs.find(isAppleSilicon) : dmgs.find(isIntel);
  return wanted ?? dmgs[0];
}

/** The installer of the build for Windows 7, 8 and 8.1 (the release job names it
 *  `..._windows-legacy_x86-setup.exe`; Tauri-App-Extension/PLAN-windows-7-legacy-build.md). */
export const isLegacyWindowsAsset = (asset) => /windows-legacy/i.test(String(asset?.name || ""));

const LEGACY_PLATFORMS = new Set(["windows-legacy", "win7", "win8", "legacy"]);
export const isLegacyWindowsPlatform = (platform) => LEGACY_PLATFORMS.has(String(platform || "").toLowerCase());

/**
 * Whether a browser is on Windows 7, 8 or 8.1, judged from its User-Agent alone. Used only
 * for a download link opened directly; the download pages decide in the browser first, with
 * the platform-version hint, and ask for `platform=windows-legacy` themselves.
 *
 * - Firefox still reports the real version: "Windows NT 6.1" (7), "6.2" (8), "6.3" (8.1).
 * - Chromium browsers (Chrome, Brave, Opera) report "Windows NT 10.0" on every Windows since
 *   version 107, so the version tells nothing. But 109 is the last version Windows 7, 8 and
 *   8.1 get, and a Windows 10 browser updates past it, so a Chromium browser at 109 or below
 *   on Windows is taken to be old Windows. When that is wrong (a Windows 10 machine held on an
 *   old browser) the member gets the legacy build, which also runs on Windows 10: the safe way
 *   to be wrong.
 */
export function wantsLegacyWindows(userAgent) {
  const ua = String(userAgent || "");
  if (!/Windows NT/i.test(ua)) return false;
  if (/Windows NT 6\.[123]\b/i.test(ua)) return true;
  const chromium = ua.match(/\bChrom(?:e|ium)\/(\d+)/);
  return chromium ? Number(chromium[1]) <= 109 : false;
}

export function findAsset(assets, platform, assetName, arch = "") {
  if (!Array.isArray(assets) || assets.length === 0) return null;

  if (assetName) {
    const match = assets.find((a) => a.name.toLowerCase() === assetName.toLowerCase());
    if (match) return match;
  }

  const p = (platform || "windows").toLowerCase();

  // Only ever the legacy installer: never the normal one, which cannot start on those systems.
  if (isLegacyWindowsPlatform(p)) {
    return assets.find((a) => isLegacyWindowsAsset(a) && a.name.endsWith(".exe")) ?? null;
  }

  if (p === "win" || p === "windows" || p === "exe" || p === "msi") {
    // The legacy installer is also an .exe; it must never be handed to a normal download.
    const normal = assets.filter((a) => !isLegacyWindowsAsset(a));
    return (
      normal.find((a) => a.name.endsWith("-setup.exe") || a.name.endsWith(".exe")) ||
      normal.find((a) => a.name.endsWith(".msi"))
    );
  }

  if (p === "mac" || p === "macos" || p === "dmg" || p === "darwin") {
    return (
      pickMacDmg(assets, arch) ||
      assets.find((a) => a.name.endsWith(".app.tar.gz") || a.name.endsWith(".tar.gz") || a.name.endsWith(".zip"))
    );
  }

  if (p === "linux" || p === "ubuntu" || p === "appimage" || p === "deb") {
    return (
      assets.find((a) => a.name.endsWith(".AppImage")) ||
      assets.find((a) => a.name.endsWith(".deb"))
    );
  }

  return assets[0];
}

export async function routeDownload(req, res, url, origin) {
  if (url.pathname !== "/api/download" && url.pathname !== "/api/download-agent") {
    return false;
  }

  if (req.method !== "GET") {
    applyCors(res, origin);
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin), ...getSecurityHeaders(req) });
    res.end(JSON.stringify({ success: false, error: "Method not allowed" }));
    return true;
  }

  const env = getEnv();
  const pat = env.github.pat;
  const repoOwner = env.github.repoOwner;
  const repoName = env.github.repoName;

  let platform = url.searchParams.get("platform") || url.searchParams.get("os") || "windows";
  const assetName = url.searchParams.get("asset") || "";
  const arch = url.searchParams.get("arch") || "";

  try {
    const release = await getLatestRelease(repoOwner, repoName, pat);
    // A plain Windows link opened on Windows 7, 8 or 8.1 gets the build that runs there, when
    // this release has one. (The download pages normally ask for it by name already.)
    if (!assetName && platform.toLowerCase() === "windows" && wantsLegacyWindows(req.headers["user-agent"]) && release.assets?.some(isLegacyWindowsAsset)) {
      platform = "windows-legacy";
    }
    const asset = findAsset(release.assets, platform, assetName, arch);

    if (!asset && isLegacyWindowsPlatform(platform)) {
      applyCors(res, origin);
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin), ...getSecurityHeaders(req) });
      res.end(JSON.stringify({ success: false, error: "The version for Windows 7, 8 and 8.1 is not published for the latest release yet. Please try again later." }));
      return true;
    }

    if (!asset) {
      applyCors(res, origin);
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin), ...getSecurityHeaders(req) });
      res.end(JSON.stringify({ success: false, error: `No release asset found for platform: ${platform}` }));
      return true;
    }

    const headers = {
      "User-Agent": "VirtualTracker-LandingBackend",
      "Accept": "application/octet-stream",
    };
    if (pat) {
      headers["Authorization"] = `Bearer ${pat}`;
    }

    const assetRes = await fetch(asset.url, {
      headers,
      redirect: "manual",
    });

    const redirectUrl = assetRes.headers.get("location");
    if (redirectUrl) {
      applyCors(res, origin);
      res.writeHead(302, {
        Location: redirectUrl,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        ...corsHeaders(origin),
        ...getSecurityHeaders(req),
      });
      res.end();
      return true;
    }

    if (asset.browser_download_url) {
      applyCors(res, origin);
      res.writeHead(302, {
        Location: asset.browser_download_url,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        ...corsHeaders(origin),
        ...getSecurityHeaders(req),
      });
      res.end();
      return true;
    }

    applyCors(res, origin);
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin), ...getSecurityHeaders(req) });
    res.end(JSON.stringify({ success: false, error: "Failed to retrieve download link from GitHub" }));
    return true;
  } catch (err) {
    applyCors(res, origin);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin), ...getSecurityHeaders(req) });
    res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Download proxy error" }));
    return true;
  }
}
