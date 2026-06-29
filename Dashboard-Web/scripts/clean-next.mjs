import { rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const frontendRoot = fileURLToPath(new URL("..", import.meta.url))
const nextDir = join(frontendRoot, ".next")

try {
  rmSync(nextDir, { recursive: true, force: true })
  console.log(`Removed ${nextDir}`)
} catch (error) {
  console.error("Failed to remove .next cache. Stop `npm run dev` and try again.")
  console.error(error)
  process.exit(1)
}
