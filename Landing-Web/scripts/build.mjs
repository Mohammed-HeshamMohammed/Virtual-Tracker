/**
 * Production build — local and Docker/Coolify.
 * Clears NODE_ENV / NPM_CONFIG_PRODUCTION so Next.js owns the build environment.
 */
import { spawnSync } from "node:child_process"
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

process.exit(result.status ?? 1)
