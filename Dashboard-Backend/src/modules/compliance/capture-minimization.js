import { isManagementRole } from "../../http/auth-context.js";
import {
  getCaptureExclusionsPg,
  getOwnCaptureExclusionsPg,
  countOwnCaptureExclusionsPg,
  addCaptureExclusionPg,
  removeCaptureExclusionPg,
  getCaptureMinimizationSettingsPg,
  setCaptureMinimizationSettingsPg,
} from "../../lib/postgres/capture-minimization-postgres.service.js";

// Trims and lowercases, then drops a trailing ".exe" - an admin may type an
// "app" exclusion as either the display name ("Notion") or the raw
// executable ("notion.exe"), and matchesExclusion only ever gets one spelling
// of the running app from the server's side of an event (an up-to-date agent
// already checks all three of its own candidate spellings client-side before
// this is even reached - see Tauri-App-Extension's is_capture_excluded - so
// this is purely a backstop for a stale or bypassed agent). Without this,
// "notion.exe" and "Notion" never normalize to the same string and the
// backstop silently fails to match depending on which one the admin picked.
function normalizePattern(pattern) {
  return String(pattern ?? "").trim().toLowerCase().replace(/\.exe$/, "");
}

/**
 * A domain rule is typed as whatever the person had in front of them - a full
 * address, "www.bank.com", a bare host - while ingest compares against
 * parseDomain's hostname-without-www. Reduce every spelling to that form when
 * the rule is stored, or "https://www.bank.com/login" is saved and never
 * matches anything.
 */
function normalizeDomain(pattern) {
  const raw = String(pattern ?? "").trim().toLowerCase();
  if (!raw) return "";
  let host;
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    host = raw.split(/[/?#]/)[0];
  }
  return host.replace(/^www\./, "").replace(/\.$/, "");
}

function normalizeFor(matchType, pattern) {
  return matchType === "domain" ? normalizeDomain(pattern) : normalizePattern(pattern);
}

const MAX_MEMBER_EXCLUSIONS = 100;

function normalizeExclusionRow(row) {
  return {
    id: row.id,
    matchType: row.match_type,
    pattern: row.pattern,
    note: row.note ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    memberId: row.member_id ?? null,
  };
}

export async function getCaptureExclusions(memberId = null) {
  const rows = await getCaptureExclusionsPg(memberId);
  return rows.map(normalizeExclusionRow);
}

export async function addCaptureExclusion(input, actor) {
  if (!["app", "domain"].includes(input.matchType)) {
    const err = new Error(`matchType must be 'app' or 'domain', got '${input.matchType}'`);
    err.code = "INVALID_MATCH_TYPE";
    throw err;
  }
  const pattern = normalizeFor(input.matchType, input.pattern);
  if (!pattern) {
    const err = new Error("pattern is required");
    err.code = "PATTERN_REQUIRED";
    throw err;
  }
  if (!isManagementRole(actor?.roleName)) {
    const err = new Error("Only management may change capture exclusions.");
    err.code = "FORBIDDEN";
    throw err;
  }
  const row = await addCaptureExclusionPg({
    matchType: input.matchType,
    pattern,
    note: input.note ?? null,
    createdBy: actor.memberId,
  });
  return row ? normalizeExclusionRow(row) : null;
}

export async function removeCaptureExclusion(id, actor) {
  if (!isManagementRole(actor?.roleName)) {
    const err = new Error("Only management may change capture exclusions.");
    err.code = "FORBIDDEN";
    throw err;
  }
  await removeCaptureExclusionPg(id);
}

function invalid(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** A member's own list - never the org-wide one, never anyone else's. */
export async function listOwnCaptureExclusions(memberId) {
  if (!memberId) return [];
  return (await getOwnCaptureExclusionsPg(memberId)).map(normalizeExclusionRow);
}

/**
 * Anyone may exclude things from their own capture; no management role is
 * needed and none would be right, since the point is that it is theirs. It can
 * only ever narrow what is collected about them, never widen it, so there is
 * nothing here for an approver to gate.
 */
export async function addOwnCaptureExclusion(input, memberId) {
  if (!memberId) throw invalid("Sign in to manage your exclusions.", "FORBIDDEN");
  if (!["app", "domain"].includes(input.matchType)) {
    throw invalid(`matchType must be 'app' or 'domain', got '${input.matchType}'`, "INVALID_MATCH_TYPE");
  }
  const pattern = normalizeFor(input.matchType, input.pattern);
  if (!pattern) throw invalid("pattern is required", "PATTERN_REQUIRED");
  if (pattern.length > 255) throw invalid("pattern is too long", "PATTERN_TOO_LONG");
  if ((await countOwnCaptureExclusionsPg(memberId)) >= MAX_MEMBER_EXCLUSIONS) {
    throw invalid(`You can exclude up to ${MAX_MEMBER_EXCLUSIONS} items.`, "EXCLUSION_LIMIT");
  }
  const row = await addCaptureExclusionPg({
    matchType: input.matchType,
    pattern,
    createdBy: memberId,
    memberId,
  });
  return row ? normalizeExclusionRow(row) : null;
}

export async function removeOwnCaptureExclusion(id, memberId) {
  if (!memberId) throw invalid("Sign in to manage your exclusions.", "FORBIDDEN");
  return removeCaptureExclusionPg(id, memberId);
}

export function matchesExclusion(exclusions, matchType, name) {
  const needle = normalizeFor(matchType, name);
  if (!needle) return false;
  return exclusions.some((e) => {
    if (e.matchType !== matchType) return false;
    const rule = normalizeFor(matchType, e.pattern);
    if (rule === needle) return true;
    // Excluding a domain excludes its subdomains: "bank.com" has to cover
    // "online.bank.com", or the rule stops protecting the moment the site
    // serves the login page from a different host.
    return matchType === "domain" && Boolean(rule) && needle.endsWith(`.${rule}`);
  });
}

export async function isCaptureExcluded(matchType, name) {
  return matchesExclusion(await getCaptureExclusions(), matchType, name);
}

function normalizeSettingsRow(row) {
  return {
    urlDomainOnly: row.url_domain_only === true,
    screenshotBlurDefault: row.screenshot_blur_default === true,
    updatedBy: row.updated_by ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export async function getCaptureMinimizationSettings() {
  return normalizeSettingsRow(await getCaptureMinimizationSettingsPg());
}

export async function setCaptureMinimizationSettings(input, actor) {
  if (!isManagementRole(actor?.roleName)) {
    const err = new Error("Only management may change capture minimization settings.");
    err.code = "FORBIDDEN";
    throw err;
  }
  const row = await setCaptureMinimizationSettingsPg({
    urlDomainOnly: typeof input.urlDomainOnly === "boolean" ? input.urlDomainOnly : undefined,
    screenshotBlurDefault: typeof input.screenshotBlurDefault === "boolean" ? input.screenshotBlurDefault : undefined,
    updatedBy: actor.memberId,
  });
  return normalizeSettingsRow(row);
}
