import { getEnv } from "../../config/env.js";
import { applyCors, corsHeaders } from "../../http/cors.js";
import { getSecurityHeaders } from "../../http/security-headers.js";
import { getLatestRelease } from "../download/download-routes.js";

const UPDATE_PATH_RE = /^\/api\/agent\/update\/([^/]+)\/([^/]+)\/([^/]+)$/;

let cachedManifest = null;
const MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000;

function assetFileName(downloadUrl) {
  const path = new URL(downloadUrl).pathname;
  return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
}

async function fetchManifest(release, pat) {
  const now = Date.now();
  if (cachedManifest && cachedManifest.releaseId === release.id && now - cachedManifest.fetchedAt < MANIFEST_CACHE_TTL_MS) {
    return cachedManifest.data;
  }

  const asset = release.assets.find((a) => a.name.toLowerCase() === "latest.json");
  if (!asset) {
    throw new Error("Release has no latest.json asset");
  }

  const headers = {
    "User-Agent": "VirtualTracker-LandingBackend",
    "Accept": "application/octet-stream",
  };
  if (pat) {
    headers["Authorization"] = `Bearer ${pat}`;
  }

  const res = await fetch(asset.url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch latest.json (${res.status})`);
  }

  const data = await res.json();
  cachedManifest = { releaseId: release.id, data, fetchedAt: now };
  return data;
}

export async function routeUpdateFeed(req, res, url, origin) {
  const match = UPDATE_PATH_RE.exec(url.pathname);
  if (!match) return false;

  if (req.method !== "GET") {
    applyCors(res, origin);
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin), ...getSecurityHeaders(req) });
    res.end(JSON.stringify({ success: false, error: "Method not allowed" }));
    return true;
  }

  const [, target, arch] = match;
  const env = getEnv();
  const pat = env.github.pat;

  try {
    const release = await getLatestRelease(env.github.repoOwner, env.github.repoName, pat);
    const manifest = await fetchManifest(release, pat);
    const platform = manifest.platforms?.[`${target}-${arch}`];

    if (!platform) {
      applyCors(res, origin);
      res.writeHead(204, { ...corsHeaders(origin), ...getSecurityHeaders(req) });
      res.end();
      return true;
    }

    const forwardedProto = typeof req.headers["x-forwarded-proto"] === "string" ? req.headers["x-forwarded-proto"] : "";
    const scheme = forwardedProto || (env.isProduction ? "https" : "http");
    const downloadUrl = `${scheme}://${req.headers.host}/api/download-agent?asset=${encodeURIComponent(assetFileName(platform.url))}`;

    const body = JSON.stringify({
      version: manifest.version,
      notes: manifest.notes ?? "",
      pub_date: manifest.pub_date,
      url: downloadUrl,
      signature: platform.signature,
    });

    applyCors(res, origin);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      ...corsHeaders(origin),
      ...getSecurityHeaders(req),
    });
    res.end(body);
    return true;
  } catch (err) {
    applyCors(res, origin);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin), ...getSecurityHeaders(req) });
    res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Update feed proxy error" }));
    return true;
  }
}
