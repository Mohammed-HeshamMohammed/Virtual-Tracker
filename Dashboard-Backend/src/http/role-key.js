
const LEGACY_ROLE_KEY_ALIASES = new Map([
  ["supermanger", "supermanager"],
  ["manger", "manager"],
]);

export function normalizeRoleKey(roleName) {
  if (typeof roleName !== "string") return "";
  const key = roleName.trim().toLowerCase().replace(/\s+/g, "");
  return LEGACY_ROLE_KEY_ALIASES.get(key) ?? key;
}
