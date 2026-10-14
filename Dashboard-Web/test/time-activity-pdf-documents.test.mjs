// The two documents the Time & Activity report exports besides its own table:
// a client statement (hours at each project's client rate) and a pay slip
// (one member's hours at their pay rate). Both are plain descriptions of a
// PDF, so what they will say is checked here without drawing anything.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import * as core from "../shared/pdf-core/documents.ts"
import { normalizePdfOptions } from "../shared/pdf-core/options.ts"

const { billableProjectNames, projectsWithoutClientRate } = core
const buildClientStatementSpec = (input, options = {}) => core.buildClientStatementSpec(input, normalizePdfOptions(options))
const buildPaySlipSpec = (input, options = {}) => core.buildPaySlipSpec(input, normalizePdfOptions(options))

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replaceAll("\r\n", "\n")

const entry = (over = {}) => ({
  date: "2026-09-01",
  memberId: "m1",
  memberName: "Ada Lovelace",
  projectId: "p1",
  projectName: "Apollo",
  clientName: "Acme",
  teamName: "Core",
  activeSeconds: 3600,
  idleSeconds: 0,
  manualSeconds: 0,
  spentAmount: 10,
  currency: "USD",
  payRate: 10,
  payRateCurrency: "USD",
  billRate: 40,
  billRateCurrency: "USD",
  billAmount: 40,
  billCurrency: "USD",
  ...over,
})
const base = { rangeLabel: "Sep 1 - Sep 30, 2026", orgLabel: "Org", currency: "USD" }
const summary = (spec, label) => spec.summary.find((s) => s.label === label)?.value
const totalRow = (spec) => spec.table.rows[spec.table.rows.length - 1]

// ── client statement ───────────────────────────────────────────────────────

test("client statement: hours at the project's client rate, never the member's pay", () => {
  const spec = buildClientStatementSpec({
    ...base,
    projectNames: ["Apollo"],
    entries: [
      entry(),
      entry({ date: "2026-09-02", memberId: "m2", memberName: "Grace Hopper", activeSeconds: 1800, manualSeconds: 1800, spentAmount: 99, billAmount: 40 }),
    ],
  })
  assert.equal(spec.title, "Client statement")
  assert.equal(summary(spec, "Total hours"), "02:00:00")
  assert.equal(summary(spec, "Hourly rate"), "$40.00 / hour")
  assert.equal(summary(spec, "Amount due"), "$80.00")
  assert.equal(JSON.stringify(spec).includes("99"), false, "what the member is paid appears nowhere")
  assert.equal(JSON.stringify(spec).includes("Pay rate"), false)
})

test("client statement: only the chosen projects, each with its days and a total", () => {
  const entries = [
    entry(),
    entry({ projectId: "p2", projectName: "Zeus", billRate: 25, billAmount: 25 }),
    entry({ projectId: "p3", projectName: "Hermes", billAmount: 500 }),
  ]
  const spec = buildClientStatementSpec({ ...base, projectNames: ["Apollo", "Zeus"], entries })
  assert.deepEqual(
    spec.table.rows.filter((_, i) => spec.table.rowKinds[i] === "group").map((r) => r.project),
    ["Apollo", "Zeus"],
  )
  assert.equal(spec.table.rowKinds[spec.table.rowKinds.length - 1], "total", "the total line is marked, so invoice templates can set it out as a block")
  assert.deepEqual(
    spec.table.rows.filter((_, i) => spec.table.rowKinds[i] === "total").map((r) => r.project),
    ["Total"],
  )
  assert.equal(totalRow(spec).amount, "$65.00")
  assert.equal(summary(spec, "Hourly rate"), "Varies")
  assert.equal(spec.table.rows.some((r) => r.project === "Hermes"), false)
  // Nothing ticked means every project.
  const all = buildClientStatementSpec({ ...base, projectNames: [], entries })
  assert.equal(totalRow(all).amount, "$565.00")
})

test("client statement: a project with no rate is listed, not billed at zero, and the document says why", () => {
  const entries = [entry(), entry({ projectId: "p2", projectName: "Zeus", billRate: undefined, billAmount: undefined, billCurrency: undefined })]
  assert.deepEqual(projectsWithoutClientRate(entries, []), ["Zeus"])
  assert.deepEqual(projectsWithoutClientRate(entries, ["Apollo"]), [])
  const spec = buildClientStatementSpec({ ...base, projectNames: [], entries })
  const zeus = spec.table.rows.find((r) => r.project === "Zeus")
  assert.equal(zeus.rate, "Not set")
  assert.equal(zeus.amount, "-")
  assert.equal(zeus.hours, "01:00:00")
  assert.ok(spec.notes.some((n) => n.includes("No client hourly rate is set for: Zeus")))
})

test("client statement: amounts are in the currency the report was loaded in", () => {
  const spec = buildClientStatementSpec({
    ...base,
    currency: "EGP",
    projectNames: [],
    entries: [entry({ billAmount: 1950, billCurrency: "EGP" })],
  })
  assert.equal(summary(spec, "Amount due"), "EGP 1,950.00")
  // The rate is quoted as it was agreed, in its own currency.
  assert.equal(summary(spec, "Hourly rate"), "$40.00 / hour")
  assert.ok(spec.filterLines.includes("Currency: EGP"))
})

test("a document that would add two currencies together is refused", () => {
  const entries = [entry(), entry({ date: "2026-09-02", billAmount: 1950, billCurrency: "EGP", spentAmount: 480, currency: "EGP" })]
  assert.throws(() => buildClientStatementSpec({ ...base, projectNames: [], entries }), /more than one currency \(EGP, USD\)/)
  assert.throws(() => buildPaySlipSpec({ ...base, memberId: "m1", entries }), /more than one currency/)
})

test("the projects offered for a statement are the ones with time, most hours first", () => {
  const names = billableProjectNames([
    entry(),
    entry({ projectName: "Zeus", activeSeconds: 7200 }),
    entry({ projectName: "", projectId: null }),
  ])
  assert.deepEqual(names, ["Zeus", "Apollo"])
})

// ── pay slip ───────────────────────────────────────────────────────────────

test("pay slip: one member's days at their pay rate, with tracked and manual time apart", () => {
  const spec = buildPaySlipSpec({
    ...base,
    memberId: "m1",
    entries: [
      entry({ manualSeconds: 1800, spentAmount: 15 }),
      entry({ projectName: "Zeus", projectId: "p2", spentAmount: 10 }),
      entry({ date: "2026-09-02", spentAmount: 10 }),
      entry({ memberId: "m2", memberName: "Grace Hopper", spentAmount: 777 }),
    ],
  })
  assert.equal(spec.title, "Pay slip")
  assert.ok(spec.filterLines.includes("Employee: Ada Lovelace"))
  assert.equal(summary(spec, "Total hours"), "03:30:00")
  assert.equal(summary(spec, "Pay rate"), "$10.00 / hour")
  assert.equal(summary(spec, "Gross pay"), "$35.00")
  assert.equal(spec.table.rows.length, 3, "two days and the total")
  assert.deepEqual(
    { projects: spec.table.rows[0].projects, tracked: spec.table.rows[0].tracked, manual: spec.table.rows[0].manual, amount: spec.table.rows[0].amount },
    { projects: "Apollo, Zeus", tracked: "02:00:00", manual: "00:30:00", amount: "$25.00" },
  )
  assert.equal(totalRow(spec).date, "Total")
  assert.equal(JSON.stringify(spec).includes("777"), false, "nobody else's pay is in it")
  assert.equal(JSON.stringify(spec).includes("$40.00"), false, "nor what the client is charged")
})

test("pay slip: a changed rate and a missing rate are both said out loud", () => {
  const changed = buildPaySlipSpec({
    ...base,
    memberId: "m1",
    entries: [entry(), entry({ date: "2026-09-15", payRate: 12, spentAmount: 12 })],
  })
  assert.equal(summary(changed, "Pay rate"), "Varies")
  assert.ok(changed.notes.some((n) => n.includes("pay rate changed")))

  const unset = buildPaySlipSpec({ ...base, memberId: "m1", entries: [entry({ payRate: 0, spentAmount: 0 })] })
  assert.equal(summary(unset, "Pay rate"), "Not set")
  assert.ok(unset.notes.some((n) => n.includes("No pay rate is set")))
})

test("both documents plot hours by date against a labelled hours axis", () => {
  for (const spec of [
    buildClientStatementSpec({ ...base, projectNames: [], entries: [entry()] }),
    buildPaySlipSpec({ ...base, memberId: "m1", entries: [entry()] }),
  ]) {
    const chart = spec.charts[0]
    assert.equal(chart.title, "Hours by date")
    assert.equal(chart.yLabel, "Hours")
    assert.equal(chart.yUnit, "hours")
    assert.deepEqual(chart.points, [{ label: "Sep 1", value: 1 }])
  }
})

// ── wiring ─────────────────────────────────────────────────────────────────

test("Members and Projects take several picks, and a project filter counts only that project's hours", () => {
  const view = read("features/reports/components/time-activity-report/time-activity-report-view.tsx")
  assert.equal((view.match(/<ReportToolbarMultiSelect/g) ?? []).length, 2)
  const rows = read("features/reports/utils/time-and-activity/row-aggregate.ts")
  assert.match(rows, /memberFilter\.length > 0 && !memberFilter\.includes\(r\.name\)/)
  assert.match(rows, /projectFilter\.length > 0 && !r\.projectNames\.some\(\(name\) => projectFilter\.includes\(name\)\)/)
  const hook = read("features/reports/hooks/use-time-and-activity-report.ts")
  assert.match(hook, /buildDayMemberRows\(\s*entries\.filter\(\(e\) => projectFilter\.includes\(e\.projectName\)\)/)
  // A view saved when the filter held one name still loads.
  assert.match(hook, /typeof saved === "string" && saved && saved !== allValue \? \[saved\] : \[\]/)
})

test("the date range closes on a click outside it, but not on the button that opened it", () => {
  const picker = read("features/reports/components/time-activity-report/date-range-picker.tsx")
  assert.match(picker, /if \(root\.contains\(target\) \|\| root\.parentElement\?\.contains\(target\)\) return\n\s+dismissRef\.current\(\)/)
  assert.match(picker, /document\.addEventListener\("pointerdown", onPointerDown, true\)/)
})

test("avatars come from the report's member list, and a delete that removed nothing says so", () => {
  const api = read("features/reports/api/time-and-activity-api.ts")
  assert.match(api, /avatarUrl: photos\.get\(member\.memberId\) \?\? member\.avatarUrl/)
  const view = read("features/reports/components/time-activity-report/time-activity-report-view.tsx")
  assert.match(view, /if \(deleted\.sessions \+ deleted\.entries === 0\)/)
})

// ── invoice-style terms on the statement ───────────────────────────────────

test("client statement: tax on the client's own rate, a due date from its net terms, and its note", () => {
  const taxed = entry({ billTaxRate: 14, billNetTermsDays: 45, billNotes: "Pay by wire." })
  const spec = buildClientStatementSpec({
    ...base,
    projectNames: [],
    issueDate: "2026-10-01",
    entries: [taxed, entry({ date: "2026-09-02", ...{ billTaxRate: 14, billNetTermsDays: 45 } })],
  })
  assert.equal(summary(spec, "Subtotal"), "$80.00")
  assert.equal(summary(spec, "Tax (14%)"), "$11.20")
  assert.equal(summary(spec, "Amount due"), "$91.20")
  assert.deepEqual(
    spec.table.rows.slice(-3).map((r) => [r.project, r.amount]),
    [["Subtotal", "$80.00"], ["Tax (14%)", "$11.20"], ["Total", "$91.20"]],
  )
  assert.deepEqual(spec.info.find((row) => row.label === "Date of issue"), { label: "Date of issue", value: "Oct 1, 2026" })
  assert.deepEqual(spec.info.find((row) => row.label === "Date due"), { label: "Date due", value: "Nov 15, 2026" })
  assert.equal(spec.headline.due, "Nov 15, 2026")
  assert.ok(spec.notes.includes("Pay by wire."))
})

test("client statement: a client with no terms gets no tax lines and no due date", () => {
  const spec = buildClientStatementSpec({ ...base, projectNames: [], issueDate: "2026-10-01", entries: [entry()] })
  assert.equal(summary(spec, "Tax"), undefined)
  assert.equal(summary(spec, "Subtotal"), undefined)
  assert.equal(totalRow(spec).project, "Total")
  assert.equal(spec.info.some((row) => row.label === "Date due"), false)
  assert.equal(summary(spec, "Amount due"), "$40.00")
})

test("client statement: clients on different payment terms get no single due date, and different tax rates are just 'Tax'", () => {
  const spec = buildClientStatementSpec({
    ...base,
    projectNames: [],
    issueDate: "2026-10-01",
    entries: [
      entry({ billTaxRate: 14, billNetTermsDays: 30 }),
      entry({ projectId: "p2", projectName: "Zeus", clientName: "Globex", billTaxRate: 10, billNetTermsDays: 60 }),
    ],
  })
  assert.equal(spec.info.some((row) => row.label === "Date due"), false)
  assert.ok(spec.notes.some((n) => n.includes("different payment terms")))
  assert.equal(summary(spec, "Tax"), "$9.60", "5.60 on the first and 4.00 on the second")
})

test("one bad figure cannot turn a total into NaN", () => {
  const spec = buildClientStatementSpec({
    ...base,
    projectNames: [],
    entries: [entry(), entry({ date: "2026-09-02", billAmount: Number.POSITIVE_INFINITY }), entry({ date: "2026-09-03", billAmount: undefined })],
  })
  assert.equal(summary(spec, "Amount due"), "$40.00")
})

test("client statement: a client without payment terms does not inherit another client's due date", () => {
  const spec = buildClientStatementSpec({ ...base, projectNames: [], issueDate: "2026-10-01", entries: [
    entry({ billNetTermsDays: 30 }),
    entry({ projectId: "p2", projectName: "Zeus", clientName: "Other client" }),
  ] })
  assert.equal(spec.info.some((row) => row.label === "Date due"), false)
})

// ── Activity and Task Approvals ────────────────────────────────────────────

test("Activity: members can be picked several at a time, as one comma-joined id", async () => {
  const { splitSelectedMemberIds, joinSelectedMemberIds } = await import("../features/activity/utils/activity-scope-preferences.ts")
  assert.deepEqual(splitSelectedMemberIds("all"), [])
  assert.deepEqual(splitSelectedMemberIds("a, b ,,c"), ["a", "b", "c"])
  assert.equal(joinSelectedMemberIds([]), "all")
  assert.equal(joinSelectedMemberIds(new Set(["a", "b", "a"])), "a,b")
  const select = read("features/activity/components/activity-member-select.tsx")
  assert.match(select, /<ReportToolbarMultiSelect/)
  assert.match(select, /<ReportMemberAvatar initials=\{m\.initials\} imageUrl=\{m\.avatarUrl\} \/>/)
  // Unticking the last member is "all" where that is allowed, ignored where it is not.
  assert.match(select, /if \(next\.size === 0\) \{\n\s+if \(allowAll\) setSelectedMemberId\("all"\)\n\s+return/)
})

test("Activity: each feed can be narrowed to several projects, and the choice is part of the cache key and the request", () => {
  const bar = read("features/activity/components/activity-control-bar.tsx")
  assert.match(bar, /<ActivityProjectSelect \/>/)
  const api = read("features/activity/services/activity-api.ts")
  assert.match(api, /query\.projectIds\?\.length\) params\.set\("projectIds"/)
  assert.match(api, /\(query\.projectIds \?\? \[\]\)\.join\(","\)/)
  const cache = read("features/activity/utils/activity-feed-cache.ts")
  assert.match(cache, /\(query\.projectIds \?\? \[\]\)\.join\(","\)/)
  const ctx = read("features/activity/components/activity-feed-context.tsx")
  assert.match(ctx, /selectedProjectIds\.length > 0 \? \{ projectIds: selectedProjectIds \}/)
})

test("Task Approvals: employee and project filters take several picks and are applied to the rows", () => {
  const table = read("features/timesheets/components/view-edit/components/ReviewQueueTable.tsx")
  assert.equal((table.match(/<ReportToolbarMultiSelect/g) ?? []).length, 2)
  assert.match(table, /\(memberFilter\.size === 0 \|\| memberFilter\.has\(row\.userId\)\)/)
  assert.match(table, /\(projectFilter\.size === 0 \|\| \(row\.projectId !== null && projectFilter\.has\(row\.projectId\)\)\)/)
  // The server only takes one of each, so neither is sent.
  assert.doesNotMatch(table, /projectId: projectFilter|memberId: memberFilter/)
})
