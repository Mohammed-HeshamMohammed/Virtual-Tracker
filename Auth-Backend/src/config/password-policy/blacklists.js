/**
 * Custom blacklists injected into zxcvbn as a user-supplied dictionary.
 *
 * zxcvbn already ships with tens of thousands of common English passwords,
 * l33t-speak tables, keyboard spatial maps, and date patterns. The lists
 * below add *application-specific* terms an attacker would try first:
 * brand names, product terms, and example passwords shown in the UI.
 *
 * All entries are lowercased at init time and matched case-insensitively
 * by zxcvbn's dictionary matcher.
 */

/** Application-specific terms that should never appear as passwords. */
export const CUSTOM_DICTIONARY = [
  /* Brand / product terms */
  "virtualtracker",
  "virtual-tracker",
  "virtualcallers",
  "virtual-callers",
  "thevirtualcallers",

  /* Example passwords shown in the UI or documentation */
  "bluecoffee!train2026",
  "password123!",
  "qwerty123!",
  "admin123!",
  "welcome123!",
];
