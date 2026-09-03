import { isManagementRole } from "../../http/auth-context.js";
import {
  getCaptureExclusionsPg,
  addCaptureExclusionPg,
  removeCaptureExclusionPg,
  getCaptureMinimizationSettingsPg,
  setCaptureMinimizationSettingsPg,
} from "../../lib/postgres/capture-minimization-postgres.service.js";

function normalizePattern(pattern) {
  return String(pattern ?? "").trim().toLowerCase();
}

function normalizeExclusionRow(row) {
  return {
    id: row.id,
    matchType: row.match_type,
    pattern: row.pattern,
    note: row.note ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  };
}

export async function getCaptureExclusions() {
  const rows = await getCaptureExclusionsPg();
  return rows.map(normalizeExclusionRow);
}

export async function addCaptureExclusion(input, actor) {
  if (!["app", "domain"].includes(input.matchType)) {
    const err = new Error(`matchType must be 'app' or 'domain', got '${input.matchType}'`);
    err.code = "INVALID_MATCH_TYPE";
    throw err;
  }
  const pattern = normalizePattern(input.pattern);
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

export function matchesExclusion(exclusions, matchType, name) {
  const needle = normalizePattern(name);
  if (!needle) return false;
  return exclusions.some((e) => e.matchType === matchType && normalizePattern(e.pattern) === needle);
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
