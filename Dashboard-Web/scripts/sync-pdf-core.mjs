// Generates Dashboard-Backend/src/lib/pdf-core from Dashboard-Web/shared/pdf-core.
//
// The PDF code is written once, in TypeScript, in the web app, and the server
// gets a plain-JavaScript copy of it (its Node 20 cannot run .ts). Nothing in
// the copy is edited by hand: change the web files, run
//
//     npm run sync:pdf-core
//
// and commit both. A test fails if the committed copy is behind.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
export const SOURCE_DIR = join(HERE, "..", "shared", "pdf-core")
export const TARGET_DIR = join(HERE, "..", "..", "Dashboard-Backend", "src", "lib", "pdf-core")

const BANNER =
  "// GENERATED from Dashboard-Web/shared/pdf-core - do not edit by hand.\n" +
  "// Change the TypeScript there and run `npm run sync:pdf-core` in Dashboard-Web.\n"

/** The file contents the server copy should have, keyed by file name. */
export function generate() {
  const out = {}
  for (const name of readdirSync(SOURCE_DIR)) {
    if (!name.endsWith(".ts")) continue
    const source = readFileSync(join(SOURCE_DIR, name), "utf8").replaceAll("\r\n", "\n")
    const js = stripTypeScriptTypes(source, { mode: "strip" }).replace(/(from\s+["']\.\/[\w-]+)\.ts(["'])/g, "$1.js$2")
    out[name.replace(/\.ts$/, ".js")] = BANNER + js
  }
  // The font's licence travels with the font.
  return out
}

export function write() {
  const files = generate()
  mkdirSync(TARGET_DIR, { recursive: true })
  // A file the source no longer has must not linger on the server.
  for (const name of readdirSync(TARGET_DIR)) {
    if (name.endsWith(".js") && !(name in files)) rmSync(join(TARGET_DIR, name))
  }
  for (const [name, content] of Object.entries(files)) writeFileSync(join(TARGET_DIR, name), content)
  const licence = join(SOURCE_DIR, "fonts", "OFL.txt")
  if (existsSync(licence)) {
    mkdirSync(join(TARGET_DIR, "fonts"), { recursive: true })
    writeFileSync(join(TARGET_DIR, "fonts", "OFL.txt"), readFileSync(licence))
  }
  return Object.keys(files)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log("wrote", write().join(", "))
}
