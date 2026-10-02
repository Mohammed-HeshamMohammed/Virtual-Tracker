import { createHash } from "node:crypto";
import { getEnv } from "../../config/env.js";
import { applyCors, corsHeaders } from "../../http/cors.js";
import { getSecurityHeaders } from "../../http/security-headers.js";
import { logSafeError } from "../../http/sanitize-error.js";
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

/**
 * Picks the manifest entry for this agent, preferring the installer format
 * the download page actually hands out.
 *
 * A Windows manifest carries three keys: `windows-x86_64`, and the explicit
 * `-nsis` and `-msi` variants. Which format the bare key aliases is the
 * bundler's choice, and it currently points at the MSI - while
 * /api/download serves the NSIS `.exe`. So every Windows member installed
 * one format and auto-updated into the other.
 *
 * That is not merely untidy. The two register separately - NSIS under its
 * product name, MSI under a GUID - so the machine ends up with two entries
 * in Apps & Features and two startup entries, and the MSI carries none of
 * installer-hooks.nsh: not the legacy-install cleanup, not the logon-task
 * removal on uninstall.
 *
 * Falls back to the bare key so a platform that publishes only one artifact
 * (macOS, Linux) is unaffected.
 */
export function selectPlatformEntry(platforms, target, arch) {
  const base = `${target}-${arch}`;
  if (target === "windows") {
    return platforms?.[`${base}-nsis`] ?? platforms?.[base] ?? null;
  }
  return platforms?.[base] ?? null;
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

export function rolloutBucket(rolloutId, salt = "") {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(rolloutId || ""))) return null;
  const digest = createHash("sha256").update(`${salt}:${rolloutId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export function shouldOfferUpdate({ currentVersion, rolloutId, rolloutPercent = 100, forceUpdateBelowVersion = "", salt = "" }) {
  const validForcedFloor = /^\d+\.\d+\.\d+$/.test(String(forceUpdateBelowVersion || "").trim());
  const forced = validForcedFloor && compareVersions(currentVersion, forceUpdateBelowVersion) < 0;
  if (forced) return true;
  const percent = Math.max(0, Math.min(100, Number(rolloutPercent) || 0));
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  const bucket = rolloutBucket(rolloutId, salt);
  return bucket != null && bucket < percent;
}

function requiredPlatforms(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^(windows|linux|darwin)-(x86_64|aarch64|i686|armv7)$/.test(item));
}

export function validateUpdateManifest(manifest, required = []) {
  if (!manifest || typeof manifest !== "object" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(manifest.version || ""))) {
    return { ok: false, error: "Manifest version is missing or invalid", platforms: [] };
  }
  const verified = [];
  for (const key of required) {
    const separator = key.indexOf("-");
    const target = key.slice(0, separator);
    const arch = key.slice(separator + 1);
    const entry = selectPlatformEntry(manifest.platforms, target, arch);
    if (!entry || typeof entry.url !== "string" || !entry.url || typeof entry.signature !== "string" || !entry.signature) {
      return { ok: false, error: `Manifest is missing a signed ${key} updater`, platforms: verified };
    }
    verified.push(key);
  }
  return { ok: true, error: null, platforms: verified };
}

export function availableSignedPlatforms(manifest) {
  const candidates = ["windows-x86_64", "linux-x86_64", "darwin-aarch64", "darwin-x86_64"];
  return candidates.filter((key) => {
    const separator = key.indexOf("-");
    const target = key.slice(0, separator);
    const arch = key.slice(separator + 1);
    const entry = selectPlatformEntry(manifest?.platforms, target, arch);
    return Boolean(entry && typeof entry.url === "string" && entry.url && typeof entry.signature === "string" && entry.signature);
  });
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
  const isHealth = url.pathname === "/api/agent/update/health";
  if (!match && !isLatestMetadata && !isHealth) return false;

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
    const expectedPlatforms = requiredPlatforms(env.agent.requiredUpdatePlatforms);
    const manifestHealth = validateUpdateManifest(manifest, expectedPlatforms);
    if (isHealth) {
      const body = JSON.stringify({
        ok: manifestHealth.ok,
        version: manifest.version,
        releaseTag: release.tag_name,
        platforms: availableSignedPlatforms(manifest),
        policy: {
          minimumSupportedVersion: env.agent.minimumSupportedVersion,
          minSelfUpdateVersion: minSelfUpdatableVersion(),
          rolloutPercent: env.agent.updateRolloutPercent,
          forceUpdateBelowVersion: env.agent.forceUpdateBelowVersion || null,
        },
        ...(manifestHealth.error ? { error: manifestHealth.error } : {}),
      });
      applyCors(res, origin);
      res.writeHead(manifestHealth.ok ? 200 : 503, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        ...corsHeaders(origin),
        ...getSecurityHeaders(req),
      });
      res.end(body);
      return true;
    }
    // The latest-version metadata only reports a version number, so it needs a
    // valid version, not every platform's signed updater. Requiring all of them
    // made one platform's failed build (e.g. macOS) take the dashboard's
    // "latest published tracker" view down for Windows and Linux too. Per-platform
    // gaps are still enforced where an installer is actually served, below.
    if (isLatestMetadata) {
      const versionCheck = validateUpdateManifest(manifest, []);
      if (!versionCheck.ok) throw new Error(versionCheck.error);
      const body = JSON.stringify({
        version: manifest.version,
        notes: manifest.notes ?? "",
        pub_date: manifest.pub_date,
        rollout_percent: env.agent.updateRolloutPercent,
        minimum_supported_version: env.agent.minimumSupportedVersion,
        force_update_below_version: env.agent.forceUpdateBelowVersion || null,
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

    if (!shouldOfferUpdate({
      currentVersion,
      rolloutId: req.headers["x-agent-rollout-id"],
      rolloutPercent: env.agent.updateRolloutPercent,
      forceUpdateBelowVersion: env.agent.forceUpdateBelowVersion,
      salt: env.agent.updateRolloutSalt,
    })) {
      applyCors(res, origin);
      res.writeHead(204, {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        ...corsHeaders(origin),
        ...getSecurityHeaders(req),
      });
      res.end();
      return true;
    }

    const platform = selectPlatformEntry(manifest.platforms, target, arch);

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
    logSafeError("[agent-update-feed]", err);
    applyCors(res, origin);
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin), ...getSecurityHeaders(req) });
    res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Update feed proxy error" }));
    return true;
  }
}
