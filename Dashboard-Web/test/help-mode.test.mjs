// Help mode: the geometry and wording rules, and the structural facts that keep it working.
// Source-level for the wiring, matching the rest of this folder: the app has no component
// test setup, and these are rules about specific lines rather than rendered behaviour.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { helpTextOf, placeCallout } from "../shared/ui/help/help-geometry.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replaceAll("\r\n", "\n")

const VIEW = { width: 400, height: 300 }
const CALLOUT = { width: 100, height: 30 }
const target = (left, top, width = 40, height = 20) => ({ left, top, bottom: top + height, width })

test("the callout sits below the target, centred, its arrow pointing up at the middle", () => {
  assert.deepEqual(placeCallout(target(150, 50), CALLOUT, VIEW), { left: 120, top: 82, below: true, arrow: 50 })
})

test("it flips above when there is no room below", () => {
  assert.deepEqual(placeCallout(target(150, 270), CALLOUT, VIEW), { left: 120, top: 228, below: false, arrow: 50 })
})

test("it stays inside the window at either edge and the arrow still points at the target", () => {
  const left = placeCallout(target(0, 50, 10), CALLOUT, VIEW)
  assert.equal(left.left, 8)
  assert.equal(left.arrow, 14)
  const right = placeCallout(target(395, 50, 10), CALLOUT, VIEW)
  assert.equal(right.left, 292)
  assert.equal(right.arrow, 86)
})

test("it never goes above the window when it fits nowhere", () => {
  assert.ok(placeCallout(target(150, 5), CALLOUT, { width: 400, height: 40 }).top >= 8)
})

const el = (attrs) => ({ getAttribute: (name) => attrs[name] ?? null })

test("an explanation beats a tooltip, a title and an accessible name, in that order", () => {
  assert.equal(helpTextOf(el({ "data-help": "H", "data-tip": "T", title: "X", "aria-label": "A" })), "H")
  assert.equal(helpTextOf(el({ "data-tip": "T", title: "X", "aria-label": "A" })), "T")
  assert.equal(helpTextOf(el({ title: "X", "aria-label": "A" })), "X")
  assert.equal(helpTextOf(el({ "aria-label": "A" })), "A")
})

test("an element with nothing to say says nothing, and blanks are not text", () => {
  assert.equal(helpTextOf(el({})), "")
  assert.equal(helpTextOf(el({ "data-help": "   ", title: "Real" })), "Real")
})

test("every sidebar section explains itself", () => {
  const nav = read("shared/ui/layout/config/nav-sections.ts")
  const ids = [...nav.matchAll(/^    id: "([a-z-]+)",\n    label:/gm)].map((m) => m[1])
  assert.ok(ids.length >= 8, "expected the eight sections")
  for (const id of ids) {
    assert.match(nav, new RegExp(`    id: "${id}",\\n    label: "[^"]+",\\n    help: "[^"]{20,}",`), `section ${id} has no help text`)
  }
})

test("the sidebar hands each section's explanation to its button, collapsed or not", () => {
  const sidebar = read("shared/ui/layout/components/sidebar/sidebar.tsx")
  assert.equal(sidebar.split("data-help={section.help}").length - 1, 2)
})

test("help mode is mounted once for the whole dashboard and the topbar button toggles it", () => {
  assert.match(read("app/dashboard-shell.tsx"), /<HelpLayer \/>/)
  const topbar = read("shared/ui/layout/components/topbar/topbar.tsx")
  assert.match(topbar, /data-help-toggle/)
  assert.match(topbar, /onClick=\{\(\) => setHelpMode\(!helping\)\}/)
})

test("the layer lets only the help button through while help mode is on", () => {
  const layer = read("shared/ui/help/help-layer.tsx")
  assert.match(layer, /closest\("\[data-help-toggle\]"\)/)
  assert.match(layer, /document\.addEventListener\("click", block, true\)/)
  assert.match(layer, /event\.preventDefault\(\)/)
})

test("Escape only hides the callout on screen: it does not leave help mode", () => {
  const layer = read("shared/ui/help/help-layer.tsx")
  assert.doesNotMatch(layer, /setHelpMode/)
})

test("every form field with a hint explains itself with it", () => {
  assert.match(read("shared/ui/forms/form-field.tsx"), /data-help=\{help \?\? hint\}/)
})

test("the project form's break setting explains itself, like idle time", () => {
  const modal = read("features/projects/components/modals/project-modal.tsx")
  assert.match(modal, /help="Disable break limit:/)
  assert.match(modal, /help="Disable idle time:/)
})
