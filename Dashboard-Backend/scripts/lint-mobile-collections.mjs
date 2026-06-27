#!/usr/bin/env node
/**
 * Fails if src/ hardcodes legacy mobile-app Firestore collection names.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MOBILE_APP_COLLECTIONS } from "../src/lib/firestore/collections.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

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

const collectionPattern = new RegExp(
  `\\.collection\\(\\s*["'](${MOBILE_APP_COLLECTIONS.join("|")})["']\\s*\\)`,
  "g",
);

const files = await walk(SRC);
/** @type {{ file: string; line: number; text: string; collection: string }[]} */
const violations = [];

for (const file of files) {
  if (file.endsWith(`${path.sep}lib${path.sep}firestore${path.sep}collections.js`)) continue;
  const content = await readFile(file, "utf8");
  const lines = content.split(/\r?\n/);
  lines.forEach((text, index) => {
    for (const match of text.matchAll(collectionPattern)) {
      violations.push({
        file,
        line: index + 1,
        text: text.trim(),
        collection: match[1],
      });
    }
  });
}

if (violations.length === 0) {
  console.log("lint-mobile-collections: OK (no hardcoded mobile-app collection access in src/)");
  process.exit(0);
}

console.error("lint-mobile-collections: legacy mobile-app Firestore collections must not be accessed in src/\n");
for (const v of violations) {
  console.error(`  ${path.relative(ROOT, v.file)}:${v.line} -> ${v.collection}`);
  console.error(`    ${v.text}`);
}
console.error("\nUse COLLECTIONS from src/lib/firestore/collections.js instead.");
process.exit(1);
