// The Time & Activity report as a viewer uses it: the real container and view rendered in jsdom,
// the app's real API client talking to a stand-in backend, and the files it hands over to save read
// back. Replaces source-text checks in time-activity-export, time-activity-xlsx,
// time-activity-pdf-documents and pdf-core.
import test, { after } from "node:test"
import assert from "node:assert/strict"
import {
  installDom, createLoader, framerMotionStub, mount, click, settle, type, waitFor, React, signedInStubs, fakeBackend, captureDownloads, selectStub,
} from "./helpers/render.mjs"

const env = installDom()
after(() => env.restore())
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1600 })
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })

const Pass = ({ children }) => React.createElement(React.Fragment, null, children)
let auth = { memberId: "owner-1", memberRole: "Owner", user: { uid: "u-1" } }
const loader = createLoader({
  stubs: {
    ...signedInStubs,
    "framer-motion": framerMotionStub,
    "@/shared/providers/app": { useAuth: () => auth, useTheme: () => ({ isDark: false }) },
    "@/shared/ui/select": selectStub,
    // Menus as plain buttons: what they offer and do is the point, not the dropdown widget.
    "@/shared/ui/dropdown-menu": {
      DropdownMenu: Pass,
      DropdownMenuTrigger: Pass,
      DropdownMenuContent: ({ children }) => React.createElement("div", { role: "menu" }, children),
      DropdownMenuItem: ({ children, onClick, disabled }) => React.createElement("button", { role: "menuitem", onClick, disabled }, children),
      DropdownMenuSeparator: () => null,
      DropdownMenuLabel: Pass,
    },
  },
})
const { TimeAndActivityReport } = loader.load("features/reports/components/app/TimeAndActivity.tsx")
const reportApi = loader.load("features/reports/api/time-and-activity-api.ts")
const { toDateParam } = loader.load("features/reports/utils/time-and-activity/date-range.ts")

const today = toDateParam(new Date())
const report = {
  days: [
    {
      date: today,
      members: [
        { memberId: "ann", name: "Ann Lee", avatarUrl: "https://stale.example/ann.png", activeSeconds: 3600, idleSeconds: 600, activitySum: 70, activityCount: 1, spentAmount: 20, currency: "USD", projectNames: ["Website"] },
        { memberId: "bob", name: "Bob Ray", avatarUrl: null, activeSeconds: 7200, idleSeconds: 0, activitySum: 50, activityCount: 1, spentAmount: 40, currency: "USD", projectNames: ["Shop"] },
      ],
    },
  ],
  entries: [
    { date: today, memberId: "ann", memberName: "Ann Lee", projectId: "p-1", projectName: "Website", clientName: "", teamName: "", activeSeconds: 3600, idleSeconds: 600, activitySum: 70, activityCount: 1, spentAmount: 20, currency: "USD" },
    { date: today, memberId: "bob", memberName: "Bob Ray", projectId: "p-2", projectName: "Shop", clientName: "", teamName: "", activeSeconds: 7200, idleSeconds: 0, activitySum: 50, activityCount: 1, spentAmount: 40, currency: "USD" },
  ],
  members: [{ id: "ann", name: "Ann Lee", avatarUrl: "https://cdn.example/ann-profile.png" }, { id: "bob", name: "Bob Ray", avatarUrl: null }],
  billingIncluded: true,
}
const pdfBase64 = Buffer.from("%PDF-1.7 test").toString("base64")
let deleteAnswer = { sessions: 0, entries: 0 }
const calls = fakeBackend((call) => {
  if (call.path === "/api/reports/time-and-activity") return { body: { success: true, data: report } }
  if (call.path === "/api/reports/time-and-activity/pdf") return { body: { success: true, data: { filename: "report.pdf", contentType: "application/pdf", contentBase64: pdfBase64 } } }
  if (call.path === "/api/reports/pdf-settings") return { body: { success: true, data: call.method === "PUT" ? call.body : null } }
  if (call.path === "/api/reports/time-and-activity/day" && call.method === "DELETE") return { body: { success: true, data: deleteAnswer } }
  return { body: { success: true, data: [] } }
})
const downloads = captureDownloads()

async function openReport() {
  const view = await mount(React.createElement(TimeAndActivityReport))
  await waitFor(() => view.container.textContent.includes("Bob Ray") || view.container.textContent.includes("To CSV"))
  return view
}
const button = (root, text) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text))

test("avatars come from the report's member list, not the row's stale copy", async () => {
  const data = await reportApi.fetchTimeAndActivityReport({ from: today, to: today })
  const rows = data.memberRows[today]
  assert.equal(rows.find((r) => r.memberId === "ann").avatarUrl, "https://cdn.example/ann-profile.png")
  assert.equal(rows.find((r) => r.memberId === "bob").avatarUrl, null)
})

test("To CSV saves the table on screen, with its own grouping in the header and every member's row", async () => {
  downloads.length = 0
  const view = await openReport()
  await click(button(view.container, "To CSV"))
  await waitFor(() => downloads.length === 1)
  const file = downloads[0]
  assert.match(file.filename, /^time-and-activity_.*_by-[a-z-]+-\d{4}-\d{2}-\d{2}\.csv$/)
  const bytes = await file.bytes()
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "a BOM, so Excel reads names right")
  const text = await file.text()
  const [header, ...lines] = text.trim().split("\r\n")
  assert.match(header, /,Members,/)
  assert.ok(lines.some((l) => l.includes("Ann Lee")) && lines.some((l) => l.includes("Bob Ray")), text)
  await view.unmount()
})

test("To Excel saves a real workbook named for the range and grouping", async () => {
  downloads.length = 0
  const view = await openReport()
  await click(button(view.container, "To Excel"))
  await waitFor(() => downloads.length === 1, 10000)
  const file = downloads[0]
  assert.match(file.filename, /^time-and-activity_.*\.xlsx$/)
  const bytes = await file.bytes()
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK", "an xlsx is a zip")
  await view.unmount()
})

const pdfRequests = () => calls.filter((c) => c.path === "/api/reports/time-and-activity/pdf")
const documentSelect = (root) => [...root.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "payslip"))

test("the PDF dialog asks the server for the document, sending choices - only the team report sends the page's table", async () => {
  calls.length = 0
  downloads.length = 0
  const view = await openReport()
  await click(button(view.container, "To PDF"))
  await waitFor(() => pdfRequests().length >= 1)
  const preview = pdfRequests().at(-1)
  assert.equal(preview.method, "POST")
  assert.equal(preview.body.preview, true)
  assert.equal(preview.body.pdfOptions.document, "report")
  assert.ok(preview.body.team && Array.isArray(preview.body.team.table.rows), "the team report describes the table on screen")
  for (const figures of ["entries", "payload", "days"]) assert.equal(figures in preview.body, false, figures)

  const select = documentSelect(document.body)
  assert.deepEqual([...select.options].map((o) => o.value), ["report", "client", "payslip"], "billing is included, so all three")
  await type(select, "client")
  await waitFor(() => pdfRequests().at(-1).body.pdfOptions.document === "client")
  assert.equal(pdfRequests().at(-1).body.team, undefined, "a client statement is priced by the server, from nothing the page sends")

  await click(button(document.body, "Download PDF"))
  await waitFor(() => downloads.length === 1)
  assert.equal(pdfRequests().at(-1).body.preview, false)
  assert.equal(await downloads[0].text(), "%PDF-1.7 test", "what is saved is what the server built")
  await view.unmount()
})

// A user's press: pointerdown first (what the picker listens to), then the click.
const press = async (el) => {
  await settle(() => el.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true })))
  await click(el)
}
const rangeButton = (root) => [...root.querySelectorAll("div")].find((d) => d.firstElementChild?.textContent === "Date range")?.querySelector("button")
const pickerOpen = (root) => [...root.querySelectorAll("button")].some((b) => b.textContent.trim() === "Apply")

test("the date range closes on a press outside it, and its own button closes it rather than reopening it", async () => {
  const view = await openReport()
  const toggle = rangeButton(view.container)
  await press(toggle)
  assert.equal(pickerOpen(view.container), true)
  await press(view.container.querySelector("table") ?? document.body)
  assert.equal(pickerOpen(view.container), false, "a press outside closes it")
  await press(toggle)
  assert.equal(pickerOpen(view.container), true)
  await press(toggle)
  assert.equal(pickerOpen(view.container), false, "its own button toggles it shut")
  await view.unmount()
})

test("deleting a day that turns out to hold nothing says so instead of silently reloading", async () => {
  window.confirm = () => true
  const view = await openReport()
  const deleteButtons = () => [...view.container.querySelectorAll(`[aria-label="Delete this day's activity"]`)]
  if (deleteButtons().length === 0) {
    const dayRow = [...view.container.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes("2") && tr.querySelector("td"))
    await click(dayRow)
  }
  await waitFor(() => deleteButtons().length > 0)
  calls.length = 0
  deleteAnswer = { sessions: 0, entries: 0 }
  await click(deleteButtons()[0])
  await waitFor(() => /Nothing was found to delete/.test(view.container.textContent))
  const del = calls.find((c) => c.method === "DELETE")
  assert.equal(del.path, "/api/reports/time-and-activity/day")
  assert.equal(del.query.date, today)

  deleteAnswer = { sessions: 1, entries: 0 }
  await click(deleteButtons()[0])
  await waitFor(() => calls.filter((c) => c.method === "DELETE").length === 2)
  await settle(() => new Promise((r) => setTimeout(r, 20)))
  assert.equal(/Nothing was found to delete/.test(view.container.textContent), false, "a real delete clears the notice")
  await view.unmount()
})
