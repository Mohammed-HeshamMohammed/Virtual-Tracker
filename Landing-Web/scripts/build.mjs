// Production build — clears NODE_ENV so Next owns the build env.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)
const nextBin = require.resolve("next/dist/bin/next")

const env = { ...process.env }
delete env.NODE_ENV
delete env.NPM_CONFIG_PRODUCTION

const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: root,
  stdio: "inherit",
  env,
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

// Standalone output omits static/public — copy them in for Nixpacks/Coolify (node index.js).
const standaloneDir = path.join(root, ".next", "standalone")
if (existsSync(standaloneDir)) {
  const staticSrc = path.join(root, ".next", "static")
  if (existsSync(staticSrc)) {
    cpSync(staticSrc, path.join(standaloneDir, ".next", "static"), { recursive: true })
  }
  const publicSrc = path.join(root, "public")
  if (existsSync(publicSrc)) {
    cpSync(publicSrc, path.join(standaloneDir, "public"), { recursive: true })
  }
}

process.exit(0)
