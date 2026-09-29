// What the dashboard's guided tour says and where it goes: the control describer, the page
// explanations, and the collector run against a real DOM (jsdom).
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { JSDOM } from "jsdom"
import { describeControl } from "../shared/ui/help/describe-control.ts"
import { PAGE_HELP, pageHelp } from "../shared/ui/help/page-help.ts"
import { collectTourSteps, MAX_STEPS } from "../shared/ui/help/help-collect.ts"
import { isShowable } from "../shared/ui/help/help-tour.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replaceAll("\r\n", "\n")

// ── describeControl ────────────────────────────────────────────────────────

test("a button is explained from its own verb", () => {
  assert.equal(describeControl({ kind: "button", text: "Export" }), "Export: saves what you are looking at as a file.")
  assert.equal(describeControl({ kind: "button", text: "Approve" }), "Approve: approves it.")
  assert.equal(describeControl({ kind: "button", text: "Save changes" }), "Save changes: saves your changes.")
  assert.equal(describeControl({ kind: "button", text: "Cancel" }), "Cancel: closes this without saving.")
})

test("adding and creating name what they make", () => {
  assert.equal(describeControl({ kind: "button", text: "+ Add project" }), "Add project: creates a new project.")
  assert.equal(describeControl({ kind: "button", text: "New task" }), "New task: creates a new task.")
  assert.equal(describeControl({ kind: "button", text: "Add" }), "Add: adds a new item.")
  assert.equal(describeControl({ kind: "button", text: "Invite member" }), "Invite member: invites a member.")
})

test("the wider run of dashboard verbs is explained too", () => {
  const said = (text) => describeControl({ kind: "button", text })
  assert.equal(said("Assign"), "Assign: assigns it to someone.")
  assert.equal(said("Generate report"), "Generate report: builds it from your current choices.")
  assert.equal(said("Unban"), "Unban: lifts the ban.")
  assert.equal(said("Restore"), "Restore: brings it back.")
  assert.equal(said("Manage payroll"), "Manage payroll: opens its settings.")
  assert.equal(said("Log time"), "Log time: adds time that was not tracked.")
})

test("date presets, previews and the like are explained too", () => {
  const said = (text) => describeControl({ kind: "button", text })
  assert.equal(said("Last 7 days"), "Last 7 days: shows that period.")
  assert.equal(said("Today"), "Today: shows that period.")
  assert.equal(said("Preview invoice"), "Preview invoice: shows how it will look before it is sent.")
  assert.equal(said("Schedule report"), "Schedule report: sets it to happen later or on repeat.")
  assert.equal(said("Show all days"), "Show all days: shows everything instead of a shortened list.")
  assert.equal(said("Upgrade"), "Upgrade: opens the plans you can move to.")
})

test("a button whose wording does not say what it is for gets no explanation", () => {
  assert.equal(describeControl({ kind: "button", text: "Quarterly wrap-up" }), "")
  assert.equal(describeControl({ kind: "button", text: "" }), "")
  assert.equal(describeControl({ kind: "button", text: "3" }), "")
  assert.equal(describeControl({ kind: "button", text: "→" }), "")
})

test("an icon button is explained from its accessible name", () => {
  assert.equal(describeControl({ kind: "button", text: "", label: "Close" }), "Close: closes this.")
})

test("a very long label is not treated as a name", () => {
  assert.equal(describeControl({ kind: "button", text: "Export ".repeat(20) }), "")
})

test("a search box says so, however it is worded", () => {
  assert.equal(describeControl({ kind: "field", type: "search" }), "Search: type to narrow what is listed.")
  assert.equal(describeControl({ kind: "field", type: "text", placeholder: "Filter members…" }), "Search: type to narrow what is listed.")
})

test("a field is explained by its label and its kind", () => {
  assert.equal(describeControl({ kind: "field", type: "date", label: "Start date" }), "Start date: pick a date.")
  assert.equal(describeControl({ kind: "field", type: "number", label: "Hours" }), "Hours: enter a number.")
  assert.equal(describeControl({ kind: "field", type: "textarea", label: "Note" }), "Note: write it here.")
  assert.equal(describeControl({ kind: "field", type: "text", placeholder: "Project name" }), "Project name: type it here.")
})

test("a field with no name gets no explanation", () => {
  assert.equal(describeControl({ kind: "field", type: "text" }), "")
})

test("a select says what it is for and what it is set to", () => {
  assert.equal(describeControl({ kind: "select", label: "Status", value: "Active" }), "Status: choose a value (now: Active).")
  assert.equal(describeControl({ kind: "select" }), "Choose a value.")
})

test("a switch says which way it is set", () => {
  assert.equal(describeControl({ kind: "switch", label: "Billable", on: true }), "Billable: turn it on or off (it is on now).")
  assert.equal(describeControl({ kind: "switch", label: "Billable", on: false }), "Billable: turn it on or off (it is off now).")
  assert.equal(describeControl({ kind: "switch", on: true }), "")
})

test("a table is explained by its columns, without repeats, and a long one is cut short", () => {
  assert.equal(describeControl({ kind: "table", headers: ["Name", "Budget", "", "Name"] }), "A list with the columns Name, Budget.")
  const many = Array.from({ length: 12 }, (_, i) => `C${i}`)
  assert.match(describeControl({ kind: "table", headers: many }), /C7, …\.$/)
  assert.equal(describeControl({ kind: "table", headers: [] }), "")
})

test("tabs are listed", () => {
  assert.equal(
    describeControl({ kind: "tabs", headers: ["Active", "Archived"] }),
    "Tabs: Active, Archived. Pick one to change what this page shows.",
  )
})

// ── the page explanations ──────────────────────────────────────────────────

test("every page in the navigation has an explanation", () => {
  const nav = read("shared/ui/layout/config/nav-sections.ts")
  const ids = [...nav.matchAll(/\{ label: "[^"]+",\s+id: "([a-z-]+)"/g)].map((m) => m[1])
  assert.ok(ids.length >= 50, `expected the whole navigation, found ${ids.length} pages`)
  const missing = ids.filter((id) => !PAGE_HELP[id] || PAGE_HELP[id].length < 20)
  assert.deepEqual(missing, [])
})

test("an unknown page has no explanation rather than a wrong one", () => {
  assert.equal(pageHelp("does-not-exist"), "")
  assert.match(pageHelp("settings-compliance"), /monitoring notice/)
})

test("the shell puts the current page's explanation on the page container", () => {
  const shell = read("app/dashboard-shell.tsx")
  assert.match(shell, /data-page=\{activeItem\}/)
  assert.match(shell, /data-help=\{pageHelp\(activeItem\) \|\| undefined\}/)
})

// ── the collector, against a page shaped like the dashboard's ─────────────

function page(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`)
  return dom.window.document
}
const texts = (doc, options) => collectTourSteps(doc, () => true, options).map((s) => s.text)

const DASHBOARD = `
  <main>
    <div data-page="pm-projects" data-help="Projects: create, edit and archive projects.">
      <button>Add project</button>
      <button>Export</button>
      <div role="tablist"><button role="tab">Active</button><button role="tab">Archived</button></div>
      <label for="st">Status</label><select id="st"><option>Active</option><option>Paused</option></select>
      <div data-help="Time zone: which calendar this project's days are counted in."><select><option>UTC</option></select></div>
      <table><thead><tr><th>Name</th><th>Budget</th></tr></thead>
        <tbody>${[1, 2, 3, 4, 5].map((n) => `<tr><td>P${n}</td><td><button>View</button></td></tr>`).join("")}</tbody>
      </table>
    </div>
  </main>
  <header><input type="search" placeholder="Search pages, buttons, reports..."></header>
  <aside><button data-help="Dashboard: an overview.">Dashboard</button><button data-help="Timesheets: tracked time.">Timesheets</button></aside>`

test("the tour visits the sidebar, then the top bar, then the page", () => {
  const steps = texts(page(DASHBOARD))
  assert.deepEqual(steps.slice(0, 3), [
    "Dashboard: an overview.",
    "Timesheets: tracked time.",
    "Search: type to narrow what is listed.",
  ])
  assert.equal(steps[3], "Projects: create, edit and archive projects.")
})

test("the page's own controls follow the page explanation, in page order", () => {
  const steps = texts(page(DASHBOARD)).slice(3)
  assert.deepEqual(steps, [
    "Projects: create, edit and archive projects.",
    "Add project: creates a new project.",
    "Export: saves what you are looking at as a file.",
    "Tabs: Active, Archived. Pick one to change what this page shows.",
    "Status: choose a value (now: Active).",
    "Time zone: which calendar this project's days are counted in.",
    "A list with the columns Name, Budget.",
    "View: opens it.",
  ])
})

test("a field inside something that already explains it is not visited twice", () => {
  assert.equal(texts(page(DASHBOARD)).filter((t) => /choose a value/.test(t)).length, 1)
})

test("a row button repeated down a table is visited once", () => {
  assert.equal(texts(page(DASHBOARD)).filter((t) => t === "View: opens it.").length, 1)
})

test("an explicitly titled row action is visited once, even with only two rows", () => {
  const rows = [1, 2]
    .map((n) => `<tr><td>Member ${n}</td><td><button title="Row actions" aria-label="Row actions">...</button></td></tr>`)
    .join("")
  assert.deepEqual(texts(page(`<main><table><tbody>${rows}</tbody></table></main>`)), ["Row actions"])
})

test("matching explicit controls outside table rows remain separate", () => {
  const doc = page('<main><button data-help="Close this panel.">Close</button><button data-help="Close this panel.">Close</button></main>')
  assert.equal(texts(doc).length, 2)
})

test("tabs are explained as a group, not one by one", () => {
  const all = texts(page(DASHBOARD))
  assert.ok(!all.some((t) => t.startsWith("Active:")))
})

test("a control that says nothing about what it is for is left out", () => {
  const doc = page('<main><button>Quarterly wrap-up</button><button>Export</button></main>')
  assert.deepEqual(texts(doc), ["Export: saves what you are looking at as a file."])
})

test("something written for an element beats what its wording would give", () => {
  const doc = page('<main><button data-help="Sends the invoice to the client.">Export</button></main>')
  assert.deepEqual(texts(doc), ["Sends the invoice to the client."])
})

test("a title is used as it stands", () => {
  const doc = page('<main><button title="Get My Virtual Tracker">Start</button></main>')
  assert.deepEqual(texts(doc), ["Get My Virtual Tracker"])
})

test("a dialog on top is the only thing the tour is about", () => {
  const doc = page(`${DASHBOARD}<div role="dialog"><label for="n">Name</label><input id="n" type="text"><button>Save</button></div>`)
  assert.deepEqual(texts(doc), ["Name: type it here.", "Save: saves your changes."])
})

test("a closed or aria-hidden popup is not treated as the active dialog", () => {
  const doc = page(`<main><button>Export</button></main>
    <div role="dialog" data-slot="dialog-content" data-state="closed"><button aria-label="Close"></button></div>
    <div aria-hidden="true"><form><button>Save</button></form></div>`)
  assert.deepEqual(texts(doc), ["Export: saves what you are looking at as a file."])
})

test("controls inside a transparent closed popup are not showable", () => {
  const doc = page('<main><div style="opacity: 0"><form><button aria-label="Close"></button></form></div></main>')
  const close = doc.querySelector("button")
  close.getBoundingClientRect = () => ({ width: 24, height: 24 })
  assert.equal(isShowable(close), false)
})

test("the tour's own controls and the help button are never steps", () => {
  const doc = page(`<main><button>Export</button></main>
    <header><button data-help-toggle data-help="Help.">?</button></header>
    <div class="help-tour"><button>Next</button></div>`)
  assert.deepEqual(texts(doc), ["Export: saves what you are looking at as a file."])
})

test("a checkbox and a switch say how they are set", () => {
  const doc = page('<main><input type="checkbox" aria-label="Billable only" checked><button role="switch" aria-checked="false" aria-label="Notify me"></button></main>')
  assert.deepEqual(texts(doc), [
    "Billable only: turn it on or off (it is on now).",
    "Notify me: turn it on or off (it is off now).",
  ])
})

test("hidden inputs and radio buttons are skipped", () => {
  const doc = page('<main><input type="hidden" aria-label="Token"><input type="radio" aria-label="Choice"><button>Export</button></main>')
  assert.equal(texts(doc).length, 1)
})

test("elements that cannot be pointed at are skipped", () => {
  const doc = page("<main><button>Export</button></main>")
  assert.deepEqual(collectTourSteps(doc, () => false), [])
})

test("a huge page still ends: the tour stops at its cap", () => {
  const many = Array.from({ length: MAX_STEPS + 40 }, (_, i) => `<button data-help="Item ${i}">x</button>`).join("")
  assert.equal(collectTourSteps(page(`<main>${many}</main>`), () => true).length, MAX_STEPS)
})

test("repeated rows the page names are shown once, even a short run", () => {
  const rows = [1, 2, 3, 4].map((n) => `<button data-tour-repeat="rows" data-help="Row ${n}">r</button>`).join("")
  assert.deepEqual(texts(page(`<main>${rows}</main>`)), ["Row 1"])
})
