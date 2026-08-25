// Canonical role-name normalization. Deliberately a leaf module with no
// imports: nearly every policy/scope module needs this, and relation-sync.js
// (its previous home) imports activity-scope.js, so importing the canonical
// helper back out of relation-sync would close an import cycle.
//
// This exists because hand-rolled local copies of "lowercase and strip
// spaces" kept diverging from it by omitting the alias fold below. That is
// not cosmetic: a member whose stored role is the legacy-misspelled
// "Super Manger" fails every `=== "supermanager"` check written against a
// non-folding normalizer, which silently costs them their privileges while
// looking correct in code review. Route every role-string comparison through
// this function rather than re-implementing it.

/**
 * Misspelled role names that exist in older `roles` rows. Folded onto the
 * canonical key so every policy check and rank lookup sees one spelling.
 */
const LEGACY_ROLE_KEY_ALIASES = new Map([
  ["supermanger", "supermanager"],
  ["manger", "manager"],
]);

/**
 * @param {string} roleName
 * @returns {string}
 */
export function normalizeRoleKey(roleName) {
  if (typeof roleName !== "string") return "";
  const key = roleName.trim().toLowerCase().replace(/\s+/g, "");
  return LEGACY_ROLE_KEY_ALIASES.get(key) ?? key;
}
