
import { getEnv } from "../../config/env.js";
import { applyCors, corsHeaders } from "../../http/cors.js";
import { getSecurityHeaders } from "../../http/security-headers.js";

let cachedRelease = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getLatestRelease(repoOwner, repoName, pat) {
  const now = Date.now();
  if (cachedRelease && now - cachedRelease.fetchedAt < CACHE_TTL_MS) {
    return cachedRelease.data;
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/releases/latest`;
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

  const data = await res.json();
  cachedRelease = { data, fetchedAt: now };
  return data;
}

function findAsset(assets, platform, assetName) {
  if (!Array.isArray(assets) || assets.length === 0) return null;

  if (assetName) {
    const match = assets.find((a) => a.name.toLowerCase() === assetName.toLowerCase());
    if (match) return match;
  }

  const p = (platform || "windows").toLowerCase();

  if (p === "win" || p === "windows" || p === "exe" || p === "msi") {
    return (
      assets.find((a) => a.name.endsWith("-setup.exe") || a.name.endsWith(".exe")) ||
      assets.find((a) => a.name.endsWith(".msi"))
    );
  }

  if (p === "mac" || p === "macos" || p === "dmg" || p === "darwin") {
    return (
      assets.find((a) => a.name.endsWith(".dmg")) ||
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

  const platform = url.searchParams.get("platform") || url.searchParams.get("os") || "windows";
  const assetName = url.searchParams.get("asset") || "";

  try {
    const release = await getLatestRelease(repoOwner, repoName, pat);
    const asset = findAsset(release.assets, platform, assetName);

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
