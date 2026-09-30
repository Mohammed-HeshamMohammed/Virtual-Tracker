// The Time & Activity workbook: a Summary and one sheet per group, bordered cells and a
// coloured header, rows that need a second look shaded and named - checked by building a real
// workbook, writing it out and reading it back, not by trusting the calls that made it.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import ExcelJS from "exceljs"
import { buildTimeActivityExportTable } from "../features/reports/utils/time-and-activity/export-model.ts"
import { buildTimeActivityWorkbook, sheetNameFor, MAX_GROUP_SHEETS } from "../features/reports/utils/time-and-activity/xlsx-export.ts"
import { evaluateRowFlags, describeRiskRules, hmsToSeconds, RISK_RULES } from "../features/reports/utils/time-and-activity/export-flags.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replaceAll("\r\n", "\n")

// ── the rules ──────────────────────────────────────────────────────────────

const m = (activeHours, idleHours = 0, manualHours = 0) => ({ activeHours, idleHours, manualHours })
const member = { memberDay: true }
const elsewhere = { memberDay: false }

test("idle time: a third is a warning, half is critical, less is left alone", () => {
  assert.equal(evaluateRowFlags(m(7, 0.5), member).severity, "none")
  assert.equal(evaluateRowFlags(m(7, 3), member).severity, "warning") // exactly 30%
  assert.equal(evaluateRowFlags(m(5, 5), member).severity, "critical") // exactly 50%
  assert.equal(evaluateRowFlags(m(4, 6), member).reasons[0], "High idle time: 60% of tracked time")
})

test("a short session is never judged on idle time", () => {
  assert.equal(evaluateRowFlags(m(0.1, 0.3), member).severity, "none")
  assert.equal(evaluateRowFlags(m(0.2, 0.3), member).severity, "critical") // 0.5 h: enough to judge
})

test("the idle flag marks the idle and activity cells, not the hours", () => {
  const f = evaluateRowFlags(m(4, 6), member)
  assert.deepEqual(Object.keys(f.cells).sort(), ["activity_pct", "idle_hr", "idle_pct"])
  assert.ok(Object.values(f.cells).every((s) => s === "critical"))
})

test("a long day is flagged for one member's day only", () => {
  assert.equal(evaluateRowFlags(m(10), member).reasons[0], "Long day: 10.0 h")
  assert.equal(evaluateRowFlags(m(14.5), member).severity, "critical")
  assert.equal(evaluateRowFlags(m(9.9), member).severity, "none")
  assert.equal(evaluateRowFlags(m(40), elsewhere).severity, "none", "a weekly or per-member total says nothing about one day")
  assert.equal(evaluateRowFlags(m(8, 0, 4), member).reasons[0], "Long day: 12.0 h", "manual hours count toward the day")
})

test("mostly manual time is a review, and needs an hour of it", () => {
  const f = evaluateRowFlags(m(1, 0, 3), member)
  assert.equal(f.severity, "review")
  assert.equal(f.reasons[0], "Mostly manual time: 75% of hours (3.0 h)")
  assert.deepEqual(Object.keys(f.cells), ["manual_hours"])
  assert.equal(evaluateRowFlags(m(0.1, 0, 0.9), member).severity, "none")
})

test("several findings are all listed, the worst first, and the worst sets the severity", () => {
  const f = evaluateRowFlags(m(11, 13, 0), member)
  assert.equal(f.severity, "critical")
  assert.equal(f.reasons.length, 2)
  assert.match(f.reasons[0], /^High idle time/)
  assert.match(f.reasons[1], /^Long day/)
})

test("nothing is said about money, so a viewer who cannot see pay sees the same flags", () => {
  const f = evaluateRowFlags(m(4, 6, 2), member)
  assert.ok(!JSON.stringify(f).includes("$"))
  assert.ok(!Object.keys(f.cells).includes("total_spent"))
})

test("hours and minutes parse, anything else does not", () => {
  assert.equal(hmsToSeconds("07:30:15"), 27015)
  assert.equal(hmsToSeconds("123:00:00"), 442800)
  assert.equal(hmsToSeconds("-"), null)
  assert.equal(hmsToSeconds("12%"), null)
})

test("the legend is worded from the thresholds, so it cannot drift from them", () => {
  const text = describeRiskRules().map((r) => r.text).join(" ")
  assert.match(text, new RegExp(`${RISK_RULES.idle.criticalShare * 100}%`))
  assert.match(text, new RegExp(`${RISK_RULES.longDay.warningHours} h`))
  assert.match(text, new RegExp(`${RISK_RULES.idle.minSampleHours} h`))
})

// ── the workbook ───────────────────────────────────────────────────────────

const dayRow = (date, dateLabel, over = {}) => ({
  date,
  dateLabel,
  memberCount: 4,
  projectCount: 2,
  client: "Acme",
  team: "Core",
  todo: "-",
  regularHours: "22:00:00",
  breakTime: "00:00:00",
  totalHours: "25:00:00",
  activityPct: 70,
  idlePct: "30%",
  idleHr: "10:00:00",
  totalSpent: "$900.00",
  trackedHours: 22,
  manualHours: 3,
  ...over,
})
const hms = (h) => {
  const s = Math.round(h * 3600)
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":")
}
const person = (name, active, idle, manual = 0) => ({
  memberId: name,
  name,
  avatar: name[0],
  regularHours: hms(active),
  totalHours: hms(active + manual),
  breakTime: "00:00:00",
  activityPct: Math.round((active / (active + idle || 1)) * 100),
  idlePct: active + idle > 0 ? `${Math.round((idle / (active + idle)) * 100)}%` : "-",
  idleHr: hms(idle),
  totalSpent: "$100.00",
  trackedHours: active,
  manualHours: manual,
  projectNames: ["Apollo"],
})

const DAY1 = [person("Ann", 4, 6), person("Bo", 6.5, 3.5), person("Cy", 7, 0.5), person("Di", 1, 0, 3)]
const DAY2 = [person("Ed", 14.5, 0.5), person("Fay", 10.5, 0.2)]
const metricColumns = [
  { key: "project", label: "Project" },
  { key: "regular_hours", label: "Regular hours" },
  { key: "manual_hours", label: "Manual hours" },
  { key: "total_hours", label: "Total hours" },
  { key: "activity_pct", label: "Activity %" },
  { key: "idle_pct", label: "Idle (%)" },
  { key: "idle_hr", label: "Idle (hr)" },
  { key: "total_spent", label: "Total spent" },
]
const subs = { "2026-09-01": DAY1, "2026-09-02": DAY2 }
const tableOf = (over = {}) =>
  buildTimeActivityExportTable({
    rows: [dayRow("2026-09-01", "Tue, Sep 1"), dayRow("2026-09-02", "Wed, Sep 2", { memberCount: 2 })],
    getSubRows: (key) => subs[key] ?? [],
    groupBy: "date_per_day",
    groupColumnLabel: "Date",
    metricColumns,
    moneyHidden: false,
    formatManualHours: hms,
    ...over,
  })
const META = { title: "Time & Activity by Date", rangeLabel: "Sep 1 – Sep 2, 2026", filterLines: ["Members: All members", "Grouped by: Date"], generatedAt: new Date(2026, 8, 30, 22, 40) }

async function roundTrip(table = tableOf(), meta = META) {
  const buffer = await buildTimeActivityWorkbook(ExcelJS, table, meta).xlsx.writeBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  return wb
}

/** The row on a sheet whose first cell says `name`. */
function rowOf(sheet, name) {
  let found
  sheet.eachRow((row) => {
    const v = row.getCell(1).value
    if ((v?.text ?? v) === name) found = row
  })
  assert.ok(found, `no row for ${name} on ${sheet.name}`)
  return found
}
const cellOf = (sheet, row, header) => {
  const headerRow = sheet.getRow(4)
  let col = 0
  headerRow.eachCell((c, n) => {
    if (c.value === header) col = n
  })
  assert.ok(col, `no column ${header}`)
  return row.getCell(col)
}
const argb = (cell) => cell.fill?.fgColor?.argb

test("one sheet for the summary and one for every day, in order", async () => {
  const wb = await roundTrip()
  assert.deepEqual(wb.worksheets.map((s) => s.name), ["Summary", "Tue, Sep 1", "Wed, Sep 2"])
})

test("the header is a coloured band with bold white text, and every cell has a border", async () => {
  const sheet = (await roundTrip()).getWorksheet("Tue, Sep 1")
  const head = sheet.getRow(4).getCell(1)
  assert.equal(argb(head), "FF1E293B")
  assert.equal(head.font.bold, true)
  assert.equal(head.font.color.argb, "FFFFFFFF")
  const body = rowOf(sheet, "Cy").getCell(2)
  assert.equal(body.border.top.style, "thin")
  assert.equal(body.border.left.style, "thin")
})

test("a risky row is shaded, its offending cells darker, and the reason is written out", async () => {
  const sheet = (await roundTrip()).getWorksheet("Tue, Sep 1")
  const ann = rowOf(sheet, "Ann")
  assert.equal(argb(ann.getCell(1)), "FFFEE2E2", "critical rows are red")
  assert.equal(argb(cellOf(sheet, ann, "Idle (%)")), "FFFCA5A5")
  assert.equal(cellOf(sheet, ann, "Idle (%)").font.bold, true)
  assert.match(cellOf(sheet, ann, "Flags").value, /High idle time: 60% of tracked time/)
})

test("a warning is amber, and a healthy row is left plain", async () => {
  const sheet = (await roundTrip()).getWorksheet("Tue, Sep 1")
  assert.equal(argb(rowOf(sheet, "Bo").getCell(1)), "FFFEF3C7")
  const cy = rowOf(sheet, "Cy")
  assert.equal(argb(cy.getCell(1)), undefined)
  assert.equal(cellOf(sheet, cy, "Flags").value, "")
})

test("mostly manual time marks only the manual cell - the row stays plain", async () => {
  const sheet = (await roundTrip()).getWorksheet("Tue, Sep 1")
  const di = rowOf(sheet, "Di")
  assert.equal(argb(di.getCell(1)), undefined)
  assert.equal(argb(cellOf(sheet, di, "Manual hours")), "FFDDD6FE")
  assert.match(cellOf(sheet, di, "Flags").value, /Mostly manual time/)
})

test("a long day is flagged on the day sheet that has it", async () => {
  const sheet = (await roundTrip()).getWorksheet("Wed, Sep 2")
  assert.equal(argb(rowOf(sheet, "Ed").getCell(1)), "FFFEE2E2")
  assert.match(cellOf(sheet, rowOf(sheet, "Ed"), "Flags").value, /Very long day: 14\.5 h/)
  assert.equal(argb(rowOf(sheet, "Fay").getCell(1)), "FFFEF3C7")
})

test("the long-day rule does not fire when the table is not one row per member-day", async () => {
  const table = buildTimeActivityExportTable({
    rows: [dayRow("m", "Ed")],
    getSubRows: () => [person("Apollo", 40, 1)],
    groupBy: "member",
    groupColumnLabel: "Member",
    metricColumns,
    moneyHidden: false,
    formatManualHours: hms,
  })
  const sheet = (await roundTrip(table)).getWorksheet("Ed")
  assert.equal(cellOf(sheet, rowOf(sheet, "Apollo"), "Flags").value, "")
})

test("hours and percentages are real numbers, so they sort and sum in Excel", async () => {
  const sheet = (await roundTrip()).getWorksheet("Tue, Sep 1")
  const ann = rowOf(sheet, "Ann")
  const idlePct = cellOf(sheet, ann, "Idle (%)")
  assert.equal(idlePct.value, 0.6)
  assert.equal(idlePct.numFmt, "0%")
  const idleHr = cellOf(sheet, ann, "Idle (hr)")
  // ExcelJS hands a duration-formatted number back as a Date counted from Excel's day zero.
  const serial = idleHr.value instanceof Date ? (idleHr.value.getTime() - Date.UTC(1899, 11, 30)) / 86400000 : idleHr.value
  assert.ok(Math.abs(serial - 0.25) < 1e-9, `6 h is a quarter of a day, got ${serial}`)
  assert.equal(idleHr.numFmt, "[h]:mm:ss")
})

test("the day's own total closes its sheet, outside the filter range", async () => {
  const sheet = (await roundTrip()).getWorksheet("Tue, Sep 1")
  const total = rowOf(sheet, "Total")
  assert.equal(total.number, 4 + 4 + 1, "header row 4, four members, then the total")
  assert.equal(argb(total.getCell(1)), "FFE2E8F0")
  assert.equal(total.getCell(1).font.bold, true)
  assert.match(JSON.stringify(sheet.autoFilter), /8/, "the filter stops at the last member, above the total")
})

test("headers stay in view and the sheet prints landscape on one page wide", async () => {
  const sheet = (await roundTrip()).getWorksheet("Tue, Sep 1")
  assert.equal(sheet.views[0].state, "frozen")
  assert.equal(sheet.views[0].ySplit, 4)
  assert.equal(sheet.views[0].showGridLines, false)
  assert.equal(sheet.pageSetup.orientation, "landscape")
  assert.equal(sheet.pageSetup.fitToWidth, 1)
})

test("a tab is coloured by its worst row, so a risky day stands out among many", async () => {
  const wb = await roundTrip()
  assert.equal(wb.getWorksheet("Tue, Sep 1").properties.tabColor.argb, "FFDC2626")
  assert.equal(wb.getWorksheet("Wed, Sep 2").properties.tabColor.argb, "FFDC2626")
  const calm = await roundTrip(
    buildTimeActivityExportTable({
      rows: [dayRow("x", "Thu, Sep 3", { idleHr: "00:10:00" })],
      getSubRows: () => [person("Cy", 7, 0.5)],
      groupBy: "date_per_day",
      groupColumnLabel: "Date",
      metricColumns,
      moneyHidden: false,
      formatManualHours: hms,
    }),
  )
  assert.equal(calm.getWorksheet("Thu, Sep 3").properties.tabColor, undefined)
})

test("the summary links to every day and every day links back", async () => {
  const wb = await roundTrip()
  const summary = wb.getWorksheet("Summary")
  assert.equal(rowOf(summary, "Tue, Sep 1").getCell(1).value.hyperlink, "#'Tue, Sep 1'!A1")
  assert.equal(wb.getWorksheet("Wed, Sep 2").getCell("A2").value.hyperlink, "#'Summary'!A1")
})

test("the summary says what was exported and explains every colour", async () => {
  const summary = (await roundTrip()).getWorksheet("Summary")
  assert.equal(summary.getCell("A1").value, "Time & Activity by Date")
  assert.match(summary.getCell("A2").value, /Range: Sep 1 – Sep 2, 2026 {3}· {3}Generated 2026-09-30 22:40/)
  assert.match(summary.getCell("A3").value, /Filters: Members: All members/)
  const text = []
  summary.eachRow((r) => text.push(String(r.getCell(1).value?.text ?? r.getCell(1).value ?? "")))
  for (const label of ["How rows are marked", "Critical", "Warning", "Review", "Not judged"]) assert.ok(text.includes(label), label)
})

test("money never reaches the workbook when the viewer may not see it", async () => {
  const wb = await roundTrip(tableOf({ moneyHidden: true, metricColumns }))
  let every = ""
  wb.eachSheet((s) => s.eachRow((r) => r.eachCell((c) => (every += ` ${JSON.stringify(c.value)}`))))
  assert.ok(!every.includes("$"))
  assert.ok(!every.includes("Total spent"))
})

test("sheet names follow Excel's rules", () => {
  const used = new Set(["summary"])
  assert.equal(sheetNameFor("Mon: Sep/7 [am]?", used), "Mon- Sep-7 -am--")
  assert.equal(sheetNameFor("x".repeat(40), used).length, 31)
  assert.equal(sheetNameFor("Summary", used), "Summary (2)")
  assert.equal(sheetNameFor("summary", used), "summary (3)")
  assert.equal(sheetNameFor("History", used), "History (2)")
  assert.equal(sheetNameFor("'quoted'", used), "quoted")
  assert.equal(sheetNameFor("", used), "Sheet")
  const a = sheetNameFor("Same", used)
  const b = sheetNameFor("same", used)
  assert.notEqual(a.toLowerCase(), b.toLowerCase())
  const long = "y".repeat(31)
  assert.equal(sheetNameFor(long, used).length, 31)
  assert.equal(sheetNameFor(long, used).length, 31, "a clash on a full-length name still fits in 31")
})

test("two groups with the same label still get a sheet each", async () => {
  const table = buildTimeActivityExportTable({
    rows: [dayRow("a", "Apollo"), dayRow("b", "Apollo")],
    getSubRows: () => [person("Cy", 7, 0.5)],
    groupBy: "project",
    groupColumnLabel: "Project",
    metricColumns,
    moneyHidden: false,
    formatManualHours: hms,
  })
  const wb = await roundTrip(table)
  assert.deepEqual(wb.worksheets.map((s) => s.name), ["Summary", "Apollo", "Apollo (2)"])
})

test("a huge range keeps the workbook usable: the rest are on the summary only, and it says so", async () => {
  const rows = Array.from({ length: MAX_GROUP_SHEETS + 5 }, (_, i) => dayRow(`d${i}`, `Day ${i + 1}`))
  const table = buildTimeActivityExportTable({
    rows,
    getSubRows: () => [person("Cy", 7, 0.5)],
    groupBy: "date_per_day",
    groupColumnLabel: "Date",
    metricColumns,
    moneyHidden: false,
    formatManualHours: hms,
  })
  const wb = await roundTrip(table)
  assert.equal(wb.worksheets.length, 1 + MAX_GROUP_SHEETS)
  const summary = wb.getWorksheet("Summary")
  assert.equal(rowOf(summary, `Day ${MAX_GROUP_SHEETS + 5}`).getCell(1).value.hyperlink, undefined)
  let said = false
  summary.eachRow((r) => {
    if (String(r.getCell(1).value).startsWith(`Only the first ${MAX_GROUP_SHEETS}`)) said = true
  })
  assert.ok(said)
})

test("an empty report is an honest workbook, not a crash", async () => {
  const wb = await roundTrip(tableOf({ rows: [] }))
  assert.deepEqual(wb.worksheets.map((s) => s.name), ["Summary"])
  assert.equal(wb.getWorksheet("Summary").getCell(6, 1).value, "Nothing to show for these filters.")
})

test("a day with nobody on it still gets its sheet", async () => {
  const wb = await roundTrip(tableOf({ getSubRows: () => [] }))
  const sheet = wb.getWorksheet("Tue, Sep 1")
  assert.equal(sheet.getRow(5).getCell(1).value, "Total")
})

test("the existing exports are untouched by the flags", () => {
  const view = read("features/reports/components/time-activity-report/time-activity-report-view.tsx")
  assert.match(view, /onClick=\{downloadCsv\}/)
  assert.match(view, /onClick=\{downloadXlsx\}/)
  assert.match(view, /exportError/)
})
