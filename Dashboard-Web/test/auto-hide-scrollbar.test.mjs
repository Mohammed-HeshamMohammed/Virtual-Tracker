// The main pane's scrollbar: invisible until used, and never with arrow buttons.
import test, { mock } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { JSDOM } from "jsdom"
import { attachAutoHideScrollbar, EDGE_PX, HIDE_AFTER_MS } from "../shared/ui/layout/auto-hide-scrollbar.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replaceAll("\r\n", "\n")

function pane() {
  const { window } = new JSDOM("<!doctype html><body><div id=p></div></body>")
  const el = window.document.getElementById("p")
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 500, bottom: 300, width: 500, height: 300 })
  const move = (clientX) => el.dispatchEvent(new window.MouseEvent("pointermove", { clientX }))
  const scroll = () => el.dispatchEvent(new window.Event("scroll"))
  return { el, move, scroll }
}
const active = (el) => el.dataset.scrollActive === "true"

test("the scrollbar is not there until something asks for it", () => {
  const { el } = pane()
  attachAutoHideScrollbar(el)
  assert.equal(active(el), false)
})

test("scrolling brings it up, and it goes again after a moment", () => {
  mock.timers.enable({ apis: ["setTimeout"] })
  const { el, scroll } = pane()
  attachAutoHideScrollbar(el)
  scroll()
  assert.equal(active(el), true)
  mock.timers.tick(HIDE_AFTER_MS - 1)
  assert.equal(active(el), true)
  mock.timers.tick(1)
  assert.equal(active(el), false)
  mock.timers.reset()
})

test("scrolling again keeps it up for another full moment", () => {
  mock.timers.enable({ apis: ["setTimeout"] })
  const { el, scroll } = pane()
  attachAutoHideScrollbar(el)
  scroll()
  mock.timers.tick(HIDE_AFTER_MS - 100)
  scroll()
  mock.timers.tick(HIDE_AFTER_MS - 100)
  assert.equal(active(el), true, "the second scroll restarted the wait")
  mock.timers.tick(100)
  assert.equal(active(el), false)
  mock.timers.reset()
})

test("going to the right edge brings it up so it can be grabbed; the middle of the pane does not", () => {
  mock.timers.enable({ apis: ["setTimeout"] })
  const { el, move } = pane()
  attachAutoHideScrollbar(el)
  move(250)
  assert.equal(active(el), false)
  move(500 - EDGE_PX - 1)
  assert.equal(active(el), false)
  move(500 - EDGE_PX)
  assert.equal(active(el), true)
  mock.timers.reset()
})

test("detaching removes it and stops listening", () => {
  mock.timers.enable({ apis: ["setTimeout"] })
  const { el, scroll } = pane()
  const detach = attachAutoHideScrollbar(el)
  scroll()
  detach()
  assert.equal(active(el), false)
  scroll()
  assert.equal(active(el), false)
  mock.timers.reset()
})

test("the shell hands its scrolling pane to the helper", () => {
  const shell = read("app/dashboard-shell.tsx")
  assert.match(shell, /useAutoHideScrollbar\(\)/)
  assert.match(shell, /ref=\{pageScrollRef\}/)
})

test("the scrollbar CSS has no arrow buttons and starts invisible", () => {
  const css = read("app/globals.css")
  const block = css.slice(css.indexOf("/* Page scrollbar:"), css.indexOf("/* Horizontal variant"))
  assert.match(block, /\.page-custom-scrollbar::-webkit-scrollbar-button[^}]*display: none/)
  assert.match(block, /::-webkit-scrollbar-thumb \{[^}]*background-color: transparent/)
  assert.match(block, /\[data-scroll-active="true"\]::-webkit-scrollbar-thumb/)
})

test("scrollbar-width and scrollbar-color are only ever a fallback, never on the element itself", () => {
  // Either one on the element makes current Chrome ignore ::-webkit-scrollbar entirely, which
  // is what brought the arrow buttons back.
  const css = read("app/globals.css")
  const block = css.slice(css.indexOf("/* Page scrollbar:"), css.indexOf("/* Horizontal variant"))
  const outsideFallback = block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@supports not selector\(::-webkit-scrollbar\) \{[\s\S]*?\n\}/, "")
  assert.doesNotMatch(outsideFallback, /scrollbar-width|scrollbar-color/)
})
