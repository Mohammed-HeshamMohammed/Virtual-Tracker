// Password deny-lists — never expose via public APIs.

/** @type {readonly string[]} */
export const COMMON_PASSWORDS = [
  "password",
  "password123",
  "password123!",
  "admin123",
  "admin12345",
  "admin123!",
  "qwerty123",
  "qwerty123!",
  "welcome123",
  "welcome123!",
  "letmein123",
  "123456789",
  "1234567890",
  "1234567890!",
  "qwertyuiop",
  "abc123456",
  "letmein",
  "monkey",
  "dragon",
  "master",
  "sunshine",
  "princess",
  "football",
  "iloveyou",
];

/** @type {readonly string[]} */
export const EXAMPLE_PASSWORDS = [
  "password123!",
  "qwerty123!",
  "admin123!",
  "welcome123!",
  "bluecoffee!train2026",
  "password123",
  "admin123",
  "letmein123",
];

/** @type {readonly string[]} */
export const SEQUENTIAL_PATTERNS = [
  "0123456789",
  "9876543210",
  "abcdefghijklmnopqrstuvwxyz",
  "zyxwvutsrqponmlkjihgfedcba",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "123456",
  "123456789",
  "abcdef",
  "qwerty",
  "asdfgh",
  "zxcvbn",
];

export const COMMON_PASSWORD_SET = new Set(COMMON_PASSWORDS.map((p) => p.toLowerCase()));
export const EXAMPLE_PASSWORD_SET = new Set(EXAMPLE_PASSWORDS.map((p) => p.toLowerCase()));
