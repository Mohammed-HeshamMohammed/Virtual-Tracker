// The guided tour: the geometry, the order it visits things in, and the structural facts that
// keep it working. Source-level for the wiring, matching the rest of this folder: the app has
// no component test setup, and these are rules about specific lines rather than rendered
// behaviour.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { placeCallout } from "../shared/ui/help/help-geometry.ts"
import { orderForTour, rankOf, TOUR_REGIONS } from "../shared/ui/help/help-tour.ts"

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

test("a target too big to sit beside gets the callout at the foot of the window, with no arrow", () => {
  const whole = placeCallout({ left: 0, top: 0, bottom: 300, width: 400 }, CALLOUT, VIEW)
  assert.equal(whole.arrow, null)
  assert.equal(whole.below, false)
  assert.equal(whole.top, 246)
})

const item = (rank, order, group = `g${order}`) => ({ rank, order, group })

test("the tour visits the sidebar first, then the top bar, then the page, whatever the page order", () => {
  const shuffled = [item(2, 1), item(1, 2), item(0, 3), item(3, 4), item(2, 5)]
  assert.deepEqual(orderForTour(shuffled).map((i) => i.rank), [0, 1, 2, 2, 3])
})

test("inside a region it goes top to bottom", () => {
  assert.deepEqual(orderForTour([item(0, 9), item(0, 2), item(0, 5)]).map((i) => i.order), [2, 5, 9])
})

test("a long run of named rows is shown by its first row only, a short run in full", () => {
  const rows = [1, 2, 3, 4, 5, 6].map((n) => item(0, n, "rows"))
  assert.deepEqual(orderForTour(rows).map((i) => i.order), [1])
  assert.equal(orderForTour([1, 2].map((n) => item(0, n, "pair"))).length, 2)
})

test("regions are the sidebar, the top bar and the page, in that order", () => {
  assert.deepEqual([...TOUR_REGIONS], ["aside", "header", "main"])
  const within = (matching) => ({ closest: (selector) => (selector === matching ? {} : null) })
  assert.equal(rankOf(within("aside")), 0)
  assert.equal(rankOf(within("header")), 1)
  assert.equal(rankOf(within("main")), 2)
  assert.equal(rankOf({ closest: () => null }), 3)
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

test("the tour is mounted once for the whole dashboard and the topbar button starts and ends it", () => {
  assert.match(read("app/dashboard-shell.tsx"), /<HelpLayer \/>/)
  const topbar = read("shared/ui/layout/components/topbar/topbar.tsx")
  assert.match(topbar, /data-help-toggle/)
  assert.match(topbar, /onClick=\{\(\) => setHelpMode\(!helping\)\}/)
})

test("while it runs only its own controls and the help button can be clicked", () => {
  const layer = read("shared/ui/help/help-layer.tsx")
  assert.match(layer, /OWN_UI = "\.help-tour, \[data-help-toggle\]"/)
  assert.match(layer, /document\.addEventListener\("click", block, true\)/)
  assert.match(layer, /event\.preventDefault\(\)/)
})

test("Escape and Skip end the tour, and the arrow keys move through it", () => {
  const layer = read("shared/ui/help/help-layer.tsx")
  assert.match(layer, /event\.key === "Escape"\) finish\(\)/)
  assert.match(layer, /event\.key === "ArrowRight"\) step\(1\)/)
  assert.match(layer, /event\.key === "ArrowLeft"\) step\(-1\)/)
  assert.match(layer, /className="help-tour-skip" onClick=\{finish\}/)
})

test("the tour keeps the topbar button and its own controls out of its steps", () => {
  assert.match(read("shared/ui/help/help-collect.ts"), /el\.closest\(OWN_UI\)/)
})

test("every form field with a hint explains itself with it", () => {
  assert.match(read("shared/ui/forms/form-field.tsx"), /data-help=\{help \?\? hint\}/)
})

test("the project form's break setting explains itself, like idle time", () => {
  const modal = read("features/projects/components/modals/project-modal.tsx")
  assert.match(modal, /help="Disable break limit:/)
  assert.match(modal, /help="Disable idle time:/)
})
