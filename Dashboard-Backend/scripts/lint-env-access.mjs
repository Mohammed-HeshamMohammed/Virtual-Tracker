#!/usr/bin/env node
/**
 * Enforces centralized env access — fails if src/ uses process.env outside config/.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

const ALLOWED_PREFIXES = [
  path.join(SRC, "config") + path.sep,
];

const ALLOWED_FILES = new Set([
  path.join(ROOT, "index.js"),
]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  /** @type {string[]} */
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile() && full.endsWith(".js")) files.push(full);
  }
  return files;
}

function isAllowed(file) {
  if (ALLOWED_FILES.has(file)) return true;
  return ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

const files = await walk(SRC);
/** @type {{ file: string; line: number; text: string }[]} */
const violations = [];

for (const file of files) {
  if (isAllowed(file)) continue;
  const content = await readFile(file, "utf8");
  const lines = content.split(/\r?\n/);
  lines.forEach((text, index) => {
    if (/\bprocess\.env\b/.test(text)) {
      violations.push({ file, line: index + 1, text: text.trim() });
    }
  });
}

if (violations.length === 0) {
  console.log("lint-env-access: OK (no process.env usage outside src/config/)");
  process.exit(0);
}

console.error("lint-env-access: direct process.env usage is not allowed outside src/config/\n");
for (const v of violations) {
  console.error(`  ${path.relative(ROOT, v.file)}:${v.line}`);
  console.error(`    ${v.text}`);
}
console.error("\nUse getEnv() from src/config/env.js instead.");
process.exit(1);
