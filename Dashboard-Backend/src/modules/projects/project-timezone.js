import { rolePrivilegeRank } from "../members/services/relation-sync.js";
import { canonicalizeTimeZone } from "../../lib/time/timezone-utils.js";

/** Manager (60) and Enterprise Manager (60) and above. */
const MIN_RANK = 60;

export function canSetProjectTimezone(roleName) {
  return rolePrivilegeRank(roleName) >= MIN_RANK;
}

/**
 * `undefined` leaves the stored value alone; null or "" clears it back to
 * "use the member's own zone". Anything else must be a zone this runtime can
 * actually resolve, because resolveProjectTimeZone silently falls back to the
 * member's zone for one it cannot - which would look like the setting being
 * ignored rather than rejected.
 */
export function resolveProjectTimezoneInput(value, actorRoleName) {
  if (value === undefined) return undefined;
  if (!canSetProjectTimezone(actorRoleName)) {
    const err = new Error("Only a Manager or Enterprise Manager and above may set a project time zone.");
    err.code = "FORBIDDEN";
    throw err;
  }
  if (value === null || String(value).trim() === "") return null;

  const declared = String(value).trim();
  const canonical = canonicalizeTimeZone(declared);
  if (canonical === "UTC" && declared.toUpperCase() !== "UTC") {
    const err = new Error(`'${declared}' is not a time zone this server recognizes.`);
    err.code = "INVALID_TIMEZONE";
    throw err;
  }
  return canonical;
}
