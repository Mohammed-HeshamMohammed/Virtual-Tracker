// The guided tour: the geometry, the order it visits things in, and - rendered in jsdom - what the
// sidebar, the top bar, form fields and the tour itself do. The dashboard shell's part (one tour
// for the whole dashboard) is in dashboard-shell.test.mjs, and the project form's in
// project-modal.test.mjs. That the tour never steps onto its own controls or the help button is
// checked against a real DOM in help-collect.test.mjs.
import test from "node:test"
import assert from "node:assert/strict"
import { after } from "node:test"
import { placeCallout } from "../shared/ui/help/help-geometry.ts"
import { orderForTour, rankOf, TOUR_REGIONS } from "../shared/ui/help/help-tour.ts"
import { installDom, createLoader, framerMotionStub, mount, click, press, settle, React, Nothing } from "./helpers/render.mjs"


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

const item = (rank, order, group = `g${order}`, repeat = false) => ({ rank, order, group, repeat })

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

test("a known repeated table group is collapsed even when only two rows are visible", () => {
  const rows = [1, 2].map((n) => item(0, n, "table-actions", true))
  assert.deepEqual(orderForTour(rows).map((i) => i.order), [1])
})

test("regions are the sidebar, the top bar and the page, in that order", () => {
  assert.deepEqual([...TOUR_REGIONS], ["aside", "header", "main"])
  const within = (matching) => ({ closest: (selector) => (selector === matching ? {} : null) })
  assert.equal(rankOf(within("aside")), 0)
  assert.equal(rankOf(within("header")), 1)
  assert.equal(rankOf(within("main")), 2)
  assert.equal(rankOf({ closest: () => null }), 3)
})

// ── rendered ───────────────────────────────────────────────────────────────

const env = installDom()
after(() => env.restore())
// jsdom has no layout: give every element a size so the tour treats it as on screen.
window.Element.prototype.getBoundingClientRect = function () {
  return { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20, x: 10, y: 10 }
}

const base = createLoader({ stubs: { "framer-motion": framerMotionStub } })
const nav = base.load("shared/ui/layout/config/nav-sections.ts")
const roleAccess = createLoader({ stubs: { "@/shared/ui/layout": nav } }).load("features/auth/permissions/member-role-access.ts")
const loader = createLoader({
  stubs: {
    "framer-motion": framerMotionStub,
    "@/shared/providers/app": { useTheme: () => ({ isDark: false }), useAuth: () => ({ memberRole: "Owner" }) },
    "@/app": { prefetchChunkForPage: () => {} },
    "@/features/auth": { visibleNavSections: roleAccess.visibleNavSections },
    "shared/ui/layout/components/sidebar/sidebar-user-card": { SidebarUserCard: Nothing },
    "shared/ui/layout/components/topbar/global-search-bar": { GlobalSearchBar: Nothing },
    "shared/ui/layout/components/topbar/notifications-bell": { NotificationsBell: Nothing },
    "shared/ui/layout/components/topbar/breadcrumbs": { Breadcrumbs: Nothing },
    "shared/ui/layout/components/topbar/timer-button": { TimerButton: Nothing },
  },
})
const { Sidebar } = loader.load("shared/ui/layout/components/sidebar/sidebar.tsx")
const { Topbar } = loader.load("shared/ui/layout/components/topbar/topbar.tsx")
const { HelpLayer, setHelpMode, isHelpMode } = loader.load("shared/ui/help/index.ts")
const { FormField } = loader.load("shared/ui/forms/form-field.tsx")

test("every sidebar section carries an explanation of its own", () => {
  assert.ok(nav.NAV_SECTIONS.length >= 8, "expected the eight sections")
  for (const section of nav.NAV_SECTIONS) {
    assert.equal(typeof section.help, "string", section.id)
    assert.ok(section.help.length >= 20, `section ${section.id} has no real help text`)
  }
})

test("the sidebar hands each section's explanation to its button, collapsed or not", async () => {
  const sections = roleAccess.visibleNavSections("Owner").filter((s) => s.id !== "favorites")
  for (const isCollapsed of [false, true]) {
    const view = await mount(
      React.createElement(Sidebar, { isCollapsed, onToggleCollapse: () => {}, activeItem: "command-center", onNavigate: () => {} }),
    )
    const helps = [...view.container.querySelectorAll("nav button[data-help]")].map((b) => b.getAttribute("data-help"))
    assert.deepEqual(helps, sections.map((s) => s.help), `collapsed: ${isCollapsed}`)
    await view.unmount()
  }
})

test("the top bar's help button starts the tour and ends it", async () => {
  const view = await mount(React.createElement(Topbar, { activeItem: "command-center", onNavigate: () => {} }))
  const button = view.container.querySelector("[data-help-toggle]")
  assert.equal(isHelpMode(), false)
  await click(button)
  assert.equal(isHelpMode(), true)
  assert.equal(button.getAttribute("aria-pressed"), "true")
  await click(button)
  assert.equal(isHelpMode(), false)
  await view.unmount()
})

/** A page shaped like the dashboard: a sidebar, a top bar with the help button, and the page. */
async function tourPage() {
  const clicks = []
  const h = React.createElement
  const view = await mount(
    h(React.Fragment, null,
      h("aside", null, h("button", { "data-help": "Sidebar section one: what it holds." }, "One")),
      h("header", null, h("button", { "data-help-toggle": true, "data-help": "Help: a guided tour.", onClick: () => clicks.push("help") }, "?")),
      h("main", null,
        h("button", { "data-help": "Save: saves the page.", onClick: () => clicks.push("page") }, "Save"),
        h("button", { "data-help": "Export: saves it as a file." }, "Export")),
      h(HelpLayer),
    ),
  )
  const tour = () => view.container.querySelector(".help-tour")
  const text = () => tour()?.querySelector(".help-tour-text")?.textContent ?? null
  const count = () => tour()?.querySelector(".help-tour-count")?.textContent ?? null
  return { view, clicks, tour, text, count }
}

test("the arrow keys move through the tour and Escape ends it", async () => {
  const page = await tourPage()
  await settle(() => setHelpMode(true))
  assert.equal(page.text(), "Sidebar section one: what it holds.", "it starts in the sidebar")
  assert.equal(page.count(), "1 of 3")
  await press("ArrowRight")
  assert.equal(page.count(), "2 of 3")
  await press("ArrowLeft")
  assert.equal(page.count(), "1 of 3")
  await press("Escape")
  assert.equal(page.tour(), null)
  assert.equal(isHelpMode(), false)
  await page.view.unmount()
})

test("Skip ends the tour, and Next on the last step finishes it", async () => {
  const page = await tourPage()
  await settle(() => setHelpMode(true))
  await click(page.tour().querySelector(".help-tour-skip"))
  assert.equal(isHelpMode(), false)
  await settle(() => setHelpMode(true))
  for (let i = 0; i < 3; i++) await click(page.tour().querySelector(".help-tour-next"))
  assert.equal(isHelpMode(), false)
  await page.view.unmount()
})

test("while it runs only its own controls and the help button can be clicked", async () => {
  const page = await tourPage()
  await settle(() => setHelpMode(true))
  await click(page.view.container.querySelector("main button"))
  assert.deepEqual(page.clicks, [], "the page's own button did nothing")
  await click(page.view.container.querySelector("[data-help-toggle]"))
  assert.deepEqual(page.clicks, ["help"], "the help button still works")
  await settle(() => setHelpMode(false))
  await click(page.view.container.querySelector("main button"))
  assert.deepEqual(page.clicks, ["help", "page"], "and the page works again once it ends")
  await page.view.unmount()
})

test("a form field explains itself with its hint, or with its own help when it has one", async () => {
  const field = async (props) => {
    const view = await mount(React.createElement(FormField, { label: "Name", ...props }, React.createElement("input")))
    const help = view.container.firstElementChild.getAttribute("data-help")
    await view.unmount()
    return help
  }
  assert.equal(await field({ hint: "As it appears on invoices." }), "As it appears on invoices.")
  assert.equal(await field({ hint: "Short.", help: "Name: what the client is called." }), "Name: what the client is called.")
  assert.equal(await field({}), null)
})
