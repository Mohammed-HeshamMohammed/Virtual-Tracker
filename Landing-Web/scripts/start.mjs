/**
 * Local production server after `npm run build` (not used in Docker — image runs server.js).
 */
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const buildId = path.join(root, ".next", "BUILD_ID")

if (!existsSync(buildId)) {
  console.error("No production build found. Run: npm run build")
  process.exit(1)
}

const require = createRequire(import.meta.url)
const nextBin = require.resolve("next/dist/bin/next")
const port = (process.env.PORT ?? "3001").trim() || "3001"

const result = spawnSync(process.execPath, [nextBin, "start", "-p", port], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: process.env.HOSTNAME ?? "0.0.0.0",
  },
})

process.exit(result.status ?? 1)
