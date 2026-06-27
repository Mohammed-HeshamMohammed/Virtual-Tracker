export function isEmailLikeNamePart(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed.includes("@")) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function validateMemberNamePart(value, fieldLabel) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  if (isEmailLikeNamePart(trimmed)) return `${fieldLabel} cannot be an email address.`;
  if (trimmed.includes("@")) return `${fieldLabel} cannot contain @.`;
  return null;
}

export function assertValidMemberNamePart(value, fieldLabel) {
  const err = validateMemberNamePart(value, fieldLabel);
  if (err) throw new Error(err);
}

export function sanitizeMemberNamePart(value, workEmail = "") {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const email = typeof workEmail === "string" ? workEmail.trim().toLowerCase() : "";
  if (isEmailLikeNamePart(trimmed)) return "";
  if (email && trimmed.toLowerCase() === email) return "";
  return trimmed;
}

export function resolveMemberDisplayName(data) {
  if (!data || typeof data !== "object") return "Unknown";

  const workEmail =
    typeof data.work_email === "string"
      ? data.work_email
      : typeof data.workEmail === "string"
        ? data.workEmail
        : "";

  const first = sanitizeMemberNamePart(
    typeof data.first_name === "string"
      ? data.first_name
      : typeof data.firstName === "string"
        ? data.firstName
        : "",
    workEmail,
  );
  const last = sanitizeMemberNamePart(
    typeof data.last_name === "string"
      ? data.last_name
      : typeof data.lastName === "string"
        ? data.lastName
        : "",
    workEmail,
  );

  const combined = `${first} ${last}`.trim();
  if (combined) return combined;

  const legacy = typeof data.name === "string" ? data.name.trim() : "";
  if (legacy && !isEmailLikeNamePart(legacy)) return legacy;

  const emailPrefix = workEmail.includes("@") ? workEmail.split("@")[0] : "";
  if (emailPrefix) return emailPrefix;

  return "Unknown";
}

export function memberDisplayLabel(data) {
  const name = resolveMemberDisplayName(data);
  const initials =
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "??";
  return { name, initials };
}
