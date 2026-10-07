// The Buzz row action is the Owner's alone, never aimed at oneself, and the modal says what it
// does - the server enforces the same rules, this only keeps the button from being offered.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replaceAll("\r\n", "\n")

test("the Buzz row action needs the Owner role and is never offered on yourself", () => {
  const menu = read("features/members/components/menus/member-row-menu.tsx")
  assert.match(menu, /const canBuzz = isOwnerRoleName\(memberRole \?\? ""\) && !isSelf/)
  assert.match(menu, /\{canBuzz \? \(/)
  assert.match(menu, /<BuzzModal memberId=\{member\.id\}/)
})

test("the client posts to the buzz endpoint with a style and a message", () => {
  const api = read("features/messages/api/messages-api.ts")
  assert.match(api, /apiPath\("\/api\/messages\/buzz"\)/)
  assert.match(api, /JSON\.stringify\(\{ memberId, style, message \}\)/)
})

test("the modal offers a nudge and a blue screen, defaults the message, and says it can be closed at once", () => {
  const modal = read("features/messages/components/buzz-modal.tsx")
  assert.match(modal, /value: "nudge"/)
  assert.match(modal, /value: "bluescreen"/)
  assert.match(modal, /Dude\. Focus on work\./)
  assert.match(modal, /close it with one click/)
})
