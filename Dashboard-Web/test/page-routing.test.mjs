// Every navigable page has to resolve to the chunk that renders it. A page id missing from
// the chunk table silently falls back to the Dashboard chunk, so "Customer accounts" (added
// to the nav, the People button and PeopleSectionContent, but not to the route tables) opened
// the Dashboard instead of the page.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replaceAll("\r\n", "\n")

const nav = read("shared/ui/layout/config/nav-sections.ts")
const navIds = [...nav.matchAll(/\bid:\s*"([a-z0-9-]+)"\s*(?:,|\})/g)]
  .map((m) => m[1])
  // section ids ("people", "reports"...) are not pages; pages always carry a label beside them
  .filter((id) => new RegExp(`label:\\s*"[^"]+",\\s*id:\\s*"${id}"`).test(nav))

const resolver = read("app/routes/resolve-chunk.ts")
const chunkTable = new Set([...resolver.matchAll(/^\s*"?([a-z0-9-]+)"?:\s*"[a-z]+",?$/gm)].map((m) => m[1]))

test("the nav has pages to check", () => {
  assert.ok(navIds.length > 30, `found ${navIds.length}`)
  assert.ok(navIds.includes("people-customer-accounts"))
})

test("every nav page resolves to a chunk explicitly, never by falling back to the Dashboard", () => {
  const missing = navIds.filter((id) => !id.startsWith("reports-") && !chunkTable.has(id))
  assert.deepEqual(missing, [])
})

test("Customer accounts is rendered by the People section, guarded by PeopleSectionContent", () => {
  assert.match(resolver, /"people-customer-accounts":\s*"people"/)
  assert.match(read("app/page-content.tsx"), /activeItem === "people-customer-accounts"/)
  assert.match(read("app/routes/chunks/people-chunk.tsx"), /case "people-customer-accounts":/)
  assert.match(read("app/page-layout.ts"), /"people-customer-accounts"/)
})
