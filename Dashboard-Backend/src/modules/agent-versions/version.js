const SEMVER_RE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function normalizeAgentVersion(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 32) return null;
  const match = SEMVER_RE.exec(trimmed);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  return parts.join(".");
}

export function compareAgentVersions(left, right) {
  const a = normalizeAgentVersion(left);
  const b = normalizeAgentVersion(right);
  if (!a || !b) return null;
  const aa = a.split(".").map(Number);
  const bb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (aa[i] !== bb[i]) return aa[i] < bb[i] ? -1 : 1;
  }
  return 0;
}

export function classifyAgentVersion(version, latestVersion) {
  if (version === null || version === undefined || String(version).trim() === "") return "unknown";
  const comparison = compareAgentVersions(version, latestVersion);
  if (comparison === null) return "unrecognized";
  return comparison < 0 ? "outdated" : "latest";
}
