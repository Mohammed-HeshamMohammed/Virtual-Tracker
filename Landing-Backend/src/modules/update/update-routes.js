import { getEnv } from "../../config/env.js";
import { applyCors, corsHeaders } from "../../http/cors.js";
import { getSecurityHeaders } from "../../http/security-headers.js";
import { getLatestRelease } from "../download/download-routes.js";

const UPDATE_PATH_RE = /^\/api\/agent\/update\/([^/]+)\/([^/]+)\/([^/]+)$/;

let cachedManifest = null;
const MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * The first agent version whose updater can be trusted to survive an update
 * (PLAN-notifications-and-owner-messaging.md Part C3).
 *
 * Up to and including 1.0.26 the agent installed updates unattended: it handed
 * over to the Windows installer and exited immediately, so when the installer
 * then needed an administrator it could not have (a per-machine install, a
 * standard user), the update failed with the agent already gone and nothing to
 * restart it.
 *
 * A fix in the agent cannot help those installs, because the update is carried
 * out by the copy already on the machine - the OLD, broken one. So they are not
 * offered an update at all: a 204 leaves them running, which is strictly better
 * than a silent death, and the dashboard's Agent Versions view is where those
 * machines get picked up for a manual reinstall.
 *
 * Agents at or above this version apply updates safely and are served normally.
 */
const DEFAULT_MIN_SELF_UPDATABLE_VERSION = "1.0.27";

function minSelfUpdatableVersion() {
  try {
    return getEnv().agent?.minSelfUpdateVersion || DEFAULT_MIN_SELF_UPDATABLE_VERSION;
  } catch {
    return DEFAULT_MIN_SELF_UPDATABLE_VERSION;
  }
}

/** Numeric semver compare. Returns <0, 0, >0. Unparseable sorts lowest, so an
 *  unreadable version is treated as old rather than assumed safe. */
export function compareVersions(a, b) {
  const parse = (v) =>
    String(v ?? "")
      .trim()
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10));
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const l = Number.isFinite(left[i]) ? left[i] : -1;
    const r = Number.isFinite(right[i]) ? right[i] : -1;
    if (l !== r) return l - r;
  }
  return 0;
}

/** Whether this agent may be handed an update at all. */
export function canSelfUpdate(currentVersion) {
  return compareVersions(currentVersion, minSelfUpdatableVersion()) >= 0;
}

/** Whether there is actually something newer to offer. Without this the feed
 *  answered 200 with the agent's own version, and every agent downloaded a
 *  manifest describing the build it was already running - harmless, because
 *  the updater compares versions itself and ignores it, but a payload and a
 *  signature sent on every check to say nothing. 204 is what the updater
 *  means by "no update available". */
export function hasNewerVersion(currentVersion, manifestVersion) {
  return compareVersions(manifestVersion, currentVersion) > 0;
}

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
  const isLatestMetadata = url.pathname === "/api/agent/update/latest";
  if (!match && !isLatestMetadata) return false;

  if (req.method !== "GET") {
    applyCors(res, origin);
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin), ...getSecurityHeaders(req) });
    res.end(JSON.stringify({ success: false, error: "Method not allowed" }));
    return true;
  }

  const env = getEnv();
  const pat = env.github.pat;

  try {
    const release = await getLatestRelease(env.github.repoOwner, env.github.repoName, pat);
    const manifest = await fetchManifest(release, pat);
    if (isLatestMetadata) {
      const body = JSON.stringify({
        version: manifest.version,
        notes: manifest.notes ?? "",
        pub_date: manifest.pub_date,
      });
      applyCors(res, origin);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=240",
        ...corsHeaders(origin),
        ...getSecurityHeaders(req),
      });
      res.end(body);
      return true;
    }

    const [, target, arch, currentVersion] = match;

    // C3: an agent too old to update itself safely is left alone. 204 is the
    // updater's own "no update available", so this needs no agent-side change
    // and reaches every already-installed copy.
    if (!canSelfUpdate(currentVersion)) {
      applyCors(res, origin);
      res.writeHead(204, {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        ...corsHeaders(origin),
        ...getSecurityHeaders(req),
      });
      res.end();
      return true;
    }

    if (!hasNewerVersion(currentVersion, manifest.version)) {
      applyCors(res, origin);
      res.writeHead(204, {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        ...corsHeaders(origin),
        ...getSecurityHeaders(req),
      });
      res.end();
      return true;
    }

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
