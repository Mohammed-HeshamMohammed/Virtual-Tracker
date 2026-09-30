// The Time & Activity exports: one table model behind both the CSV and the PDF,
// so they carry the same columns, the same grouping and the people under each
// group, and never a money column for a viewer who may not see money.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildTimeActivityExportTable,
  describeExportFilters,
  detailKindLabel,
  timeActivityFilename,
  timeActivityReportTitle,
  timeActivityTableToCsv,
} from "../features/reports/utils/time-and-activity/export-model.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replaceAll("\r\n", "\n")

const day = {
  date: "2026-09-01",
  dateLabel: "Tue, Sep 1",
  memberCount: 2,
  projectCount: 3,
  client: "Acme",
  team: "Core",
  todo: "-",
  regularHours: "07:00:00",
  breakTime: "00:30:00",
  totalHours: "08:00:00",
  activityPct: 80,
  idlePct: "20%",
  idleHr: "01:00:00",
  totalSpent: "$120.00",
  trackedHours: 8,
  manualHours: 0.5,
}
const sub = (name, extra = {}) => ({
  memberId: name,
  name,
  avatar: name[0],
  regularHours: "04:00:00",
  totalHours: "04:00:00",
  breakTime: "00:10:00",
  activityPct: 75,
  idlePct: "25%",
  idleHr: "01:00:00",
  totalSpent: "$60.00",
  trackedHours: 4,
  manualHours: 0,
  projectNames: ["Apollo", "Zeus"],
  ...extra,
})
const metricColumns = [
  { key: "project", label: "Project" },
  { key: "total_hours", label: "Total hours" },
  { key: "total_spent", label: "Total spent" },
]
const build = (over = {}) =>
  buildTimeActivityExportTable({
    rows: [day],
    getSubRows: () => [sub("Ann"), sub("Bo, Jr.")],
    groupBy: "date_per_day",
    groupColumnLabel: "Date",
    metricColumns,
    moneyHidden: false,
    formatManualHours: (h) => `${h}h`,
    ...over,
  })

test("a group line is followed by one line per person, each carrying its group", () => {
  const t = build()
  assert.deepEqual(t.rows.map((r) => r.kind), ["group", "detail", "detail"])
  assert.deepEqual(t.columns.map((c) => c.header), ["Date", "Member", "Members", "Project", "Total hours", "Total spent"])
  assert.equal(t.rows[1].cells.__group, "Tue, Sep 1")
  assert.equal(t.rows[1].cells.__detail, "Ann")
  assert.equal(t.rows[1].cells.project, "Apollo; Zeus")
  assert.equal(t.rows[0].cells.project, "3")
  assert.equal(t.rows[0].cells.total_spent, "$120.00")
})

test("under a member or a week the rows beneath are projects", () => {
  assert.equal(detailKindLabel("member"), "Project")
  assert.equal(detailKindLabel("date_per_week"), "Project")
  assert.equal(detailKindLabel("project"), "Member")
  assert.equal(build({ groupBy: "member", groupColumnLabel: "Member" }).columns[1].header, "Project")
})

test("money never reaches an export when the viewer may not see it", () => {
  const t = build({ moneyHidden: true })
  assert.ok(!t.columns.some((c) => c.key === "total_spent"))
  assert.ok(!t.rows.some((r) => "total_spent" in r.cells))
  assert.ok(!timeActivityTableToCsv(t).includes("$"))
  assert.ok(!timeActivityTableToCsv(t).includes("Total spent"))
})

test("csv quotes commas, starts with a BOM and uses CRLF", () => {
  const csv = timeActivityTableToCsv(build())
  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.ok(csv.includes('"Bo, Jr."'))
  assert.ok(csv.includes("\r\n"))
  assert.equal(csv.split("\r\n")[0].slice(1), "Date,Member,Members,Project,Total hours,Total spent")
})

test("manual hours go through the injected formatter", () => {
  const t = build({ metricColumns: [{ key: "manual_hours", label: "Manual hours" }] })
  assert.equal(t.rows[0].cells.manual_hours, "0.5h")
})

test("filters that are not applied are not printed; money currency is dropped when hidden", () => {
  const base = {
    memberLabel: "All members",
    projectLabel: "Apollo",
    groupColumnLabel: "Project",
    trackedTime: "",
    manualTime: "",
    activityLevel: "Under 50%",
    currency: "USD",
    moneyHidden: false,
  }
  const lines = describeExportFilters(base)
  assert.deepEqual(lines, ["Members: All members", "Projects: Apollo", "Grouped by: Project", "Activity level: Under 50%", "Currency: USD"])
  assert.ok(!describeExportFilters({ ...base, moneyHidden: true }).some((l) => l.startsWith("Currency")))
})

test("title and filename follow the grouping", () => {
  assert.equal(timeActivityReportTitle("Project"), "Time & Activity by Project")
  assert.equal(timeActivityFilename("Sep 1 – Sep 30, 2026", "date_per_week"), "time-and-activity_sep-1-sep-30-2026_by-date-per-week")
})

test("the view exports through the shared model, not a second hand-built table", () => {
  const view = read("features/reports/components/time-activity-report/time-activity-report-view.tsx")
  assert.match(view, /buildTimeActivityExportTable/)
  assert.match(view, /onClick=\{downloadCsv\}/)
  assert.match(view, /filterLines: exportFilterLines\(\)/)
  assert.doesNotMatch(view, /title: "Time & Activity Report"/)
})

test("the pdf kit aligns headers with their columns", () => {
  const kit = read("features/reports/utils/pdf/report-pdf-kit.ts")
  assert.match(kit, /section === "head"[\s\S]*?halign = align/)
})
