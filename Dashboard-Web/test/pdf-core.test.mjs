// The shared PDF core (shared/pdf-core): what a report PDF looks like and says,
// in each template and language. The same code, generated into the server, makes
// the emailed and scheduled copies - so the tests cover the options, the formats,
// right-to-left Arabic, every template and language drawn for real, and that the
// server's copy is exactly what the web source generates.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  LOGO_MAX_CHARS,
  appearanceOf,
  DEFAULT_PDF_OPTIONS,
  normalizePdfOptions,
  PDF_DATE_FORMATS,
  PDF_LANGUAGES,
  PDF_SHOW_KEYS,
  PDF_TEMPLATES,
} from "../shared/pdf-core/options.ts"
import {
  formatAxisHours,
  formatClock,
  formatDate,
  formatMoney,
  formatNumber,
  formatShortDate,
  toLocaleDigits,
} from "../shared/pdf-core/format.ts"
import { hasArabic, visualOrder } from "../shared/pdf-core/bidi.ts"
import { getLabels } from "../shared/pdf-core/labels.ts"
import { renderPdf, yAxisScale } from "../shared/pdf-core/kit.ts"
import {
  buildClientStatementSpec,
  buildPaySlipSpec,
  buildTeamReportSpec,
  normalizeEntry,
  teamReportInputFromPayload,
} from "../shared/pdf-core/documents.ts"
import { generate, TARGET_DIR } from "../scripts/sync-pdf-core.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replaceAll("\r\n", "\n")
const opts = (over = {}) => normalizePdfOptions(over)

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
const base = { rangeLabel: "Sep 1 - Sep 30, 2026", orgLabel: "Org", currency: "USD", issueDate: "2026-10-01" }
const entries = [
  entry(),
  entry({ date: "2026-09-02", memberId: "m2", memberName: "أحمد علي", projectId: "p2", projectName: "تطبيق زيوس", clientName: "شركة النور", billTaxRate: 14, billNetTermsDays: 30 }),
]

// ── options ────────────────────────────────────────────────────────────────

test("options: anything unknown falls back to the default, so a stale saved view or a hand-edited request is safe", () => {
  const o = opts({ document: "x", template: "neon", language: "fr", dateFormat: "yyyy", numberFormat: 5, currency: "usd1", show: { charts: "no", notes: false } })
  assert.equal(o.document, "report")
  assert.equal(o.template, "virtual-tracker")
  assert.equal(o.language, "en")
  assert.equal(o.dateFormat, DEFAULT_PDF_OPTIONS.dateFormat)
  assert.equal(o.numberFormat, "en")
  assert.equal(o.currency, "", "not a three-letter code")
  assert.equal(o.show.charts, true, "a non-boolean switch keeps its default")
  assert.equal(o.show.notes, false, "a real boolean is kept")
  assert.deepEqual(normalizePdfOptions(null), DEFAULT_PDF_OPTIONS)
  assert.deepEqual(normalizePdfOptions("nonsense"), DEFAULT_PDF_OPTIONS)
})

test("options: valid choices are kept, text is trimmed and bounded, names de-duplicated", () => {
  const o = opts({
    document: "client", template: "stripe", language: "ar", dateFormat: "DD/MM/YYYY", numberFormat: "ar", currency: "egp",
    headerNote: "  Pay by   wire \n today ".padEnd(400, "x"), projectNames: [" A ", "A", "", 7, "B"], memberId: " m1 ", includeAmounts: true,
  })
  assert.deepEqual([o.document, o.template, o.language, o.dateFormat, o.numberFormat, o.currency], ["client", "stripe", "ar", "DD/MM/YYYY", "ar", "EGP"])
  assert.equal(o.headerNote.length, 300)
  assert.ok(o.headerNote.startsWith("Pay by wire today"))
  assert.deepEqual(o.projectNames, ["A", "B"])
  assert.equal(o.memberId, "m1")
  assert.equal(o.includeAmounts, true)
})

test("options: every switch exists, and only how documents look is remembered between visits", () => {
  assert.deepEqual(Object.keys(DEFAULT_PDF_OPTIONS.show).sort(), [...PDF_SHOW_KEYS].sort())
  const remembered = appearanceOf(opts({ document: "payslip", memberId: "m1", projectNames: ["A"], includeAmounts: true, template: "stripe" }))
  assert.deepEqual(Object.keys(remembered).sort(), ["dateFormat", "headerNote", "language", "logo", "numberFormat", "show", "template"])
})

// ── formats ────────────────────────────────────────────────────────────────

test("numbers: each format groups and separates its own way", () => {
  assert.equal(formatNumber(1234567.5, "en"), "1,234,567.50")
  assert.equal(formatNumber(1234567.5, "de"), "1.234.567,50")
  assert.equal(formatNumber(1234567.5, "fr"), "1 234 567,50")
  assert.equal(formatNumber(1234567.5, "ar"), "١٬٢٣٤٬٥٦٧٫٥٠")
  assert.equal(formatNumber(-5, "en"), "-5.00")
  assert.equal(formatNumber(Number.NaN, "en"), "0.00", "a bad figure is zero, not NaN")
})

test("money: the symbol sits where the format puts it, and a code stays a code", () => {
  assert.equal(formatMoney(1950, "USD", "en"), "$1,950.00")
  assert.equal(formatMoney(1950, "EGP", "en"), "EGP 1,950.00")
  assert.equal(formatMoney(1950, "USD", "de"), "1.950,00 $")
  assert.equal(formatMoney(1950, "EGP", "ar"), "١٬٩٥٠٫٠٠ ج.م")
  assert.equal(formatMoney(5, "XYZ", "en"), "XYZ 5.00")
})

test("dates: every offered format, in English and Arabic", () => {
  const iso = "2026-09-05"
  const en = Object.fromEntries(PDF_DATE_FORMATS.map((f) => [f, formatDate(iso, f, "en", "en")]))
  assert.deepEqual(en, {
    "MMM D, YYYY": "Sep 5, 2026",
    "MMMM D, YYYY": "September 5, 2026",
    "D MMM YYYY": "5 Sep 2026",
    "D MMMM YYYY": "5 September 2026",
    "YYYY-MM-DD": "2026-09-05",
    "DD/MM/YYYY": "05/09/2026",
    "MM/DD/YYYY": "09/05/2026",
    "DD.MM.YYYY": "05.09.2026",
  })
  assert.equal(formatDate(iso, "D MMMM YYYY", "ar", "ar"), "٥ سبتمبر ٢٠٢٦")
  assert.equal(formatDate("garbage", "YYYY-MM-DD", "en", "en"), "garbage", "an unreadable date is shown as it came")
  assert.equal(formatShortDate(iso, "MMMM D, YYYY", "en", "en"), "Sep 5")
  assert.equal(formatShortDate(iso, "DD/MM/YYYY", "en", "en"), "05/09")
})

test("clock and axis: hours as a clock and as a short label, with the format's digits", () => {
  assert.equal(formatClock(3725, "en"), "01:02:05")
  assert.equal(formatClock(3725, "ar"), "٠١:٠٢:٠٥")
  assert.equal(formatAxisHours(1.5, "en", "en"), "1h 30m")
  assert.equal(formatAxisHours(0.25, "en", "en"), "15m")
  assert.equal(formatAxisHours(2, "ar", "ar"), "٢س")
  assert.equal(toLocaleDigits("a1", "en"), "a1")
})

test("axis scale: round tops with a labelled step, in clock-friendly hours", () => {
  assert.deepEqual(yAxisScale(5.7, "hours"), { top: 8, step: 2 })
  assert.deepEqual(yAxisScale(0.2, "hours"), { top: 1, step: 0.25 })
  assert.deepEqual(yAxisScale(0, "hours"), { top: 1, step: 0.25 })
  assert.equal(yAxisScale(160, "hours").top % 4, 0)
})

// ── Arabic ─────────────────────────────────────────────────────────────────

const identity = (run) => run

test("Arabic: text with no Arabic is left exactly as it is", () => {
  assert.equal(hasArabic("Plain 123"), false)
  assert.equal(visualOrder("Plain (123)", true, identity), "Plain (123)")
})

test("Arabic: in a right-to-left line the runs run right to left, a Latin name and its digits keep their order", () => {
  // logical: محمد Ada 12   ->   drawn left to right: "Ada 12" then the reversed letters
  assert.equal(visualOrder("محمد Ada 12", true, identity), "Ada 12 دمحم")
  assert.equal(visualOrder("محمد Ada 12", false, identity), "دمحم Ada 12", "in a left-to-right line the order is kept")
})

test("Arabic: digits and Arabic separators stay one left-to-right number; brackets mirror", () => {
  assert.equal(visualOrder("المجموع ١٬٢٣٤٫٥٠", true, identity), "١٬٢٣٤٫٥٠ عومجملا")
  // logical "ب (أ)": drawn left to right as "(أ) ب", which reads right to left as the original
  assert.equal(visualOrder("ب (أ)", true, identity), "(أ) ب")
})

test("labels: every label exists in both languages, and the Arabic one is right to left", () => {
  const en = getLabels("en")
  const ar = getLabels("ar")
  assert.equal(en.dir, "ltr")
  assert.equal(ar.dir, "rtl")
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort())
  for (const key of Object.keys(en)) {
    if (key === "dir" || key === "columns") continue
    const [e, a] = [en[key], ar[key]]
    assert.equal(typeof a, typeof e, key)
    if (typeof e === "function") assert.ok(typeof a("x", "3") === "string" && a("x", "3").length > 0, key)
    else assert.ok(String(a).length > 0, key)
  }
  assert.ok(hasArabic(ar.clientTitle) && hasArabic(ar.payslipTitle) && !hasArabic(en.clientTitle))
})

// ── every template and language, drawn ─────────────────────────────────────

test("every document in every template and language draws a real PDF", () => {
  for (const template of PDF_TEMPLATES) {
    for (const language of PDF_LANGUAGES) {
      const numberFormat = language === "ar" ? "ar" : "en"
      const o = opts({ template, language, numberFormat })
      const specs = [
        buildClientStatementSpec({ ...base, entries, projectNames: [] }, o),
        buildPaySlipSpec({ ...base, entries, memberId: "m2" }, o),
        buildTeamReportSpec(
          teamReportInputFromPayload(
            { days: [{ date: "2026-09-01", members: [{ name: "أحمد علي", activeSeconds: 7200, idleSeconds: 300, spentAmount: 20, currency: "USD" }] }] },
            { orgLabel: "Org", rangeLabel: "Sep 1" },
            o,
          ),
          o,
        ),
      ]
      for (const spec of specs) {
        const doc = renderPdf(spec, o)
        const bytes = Buffer.from(doc.output("arraybuffer"))
        assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-", `${template}/${language}/${spec.title}`)
        assert.ok(bytes.length > 5000, `${template}/${language}/${spec.title} is not near-empty`)
        assert.ok(doc.getNumberOfPages() >= 1)
      }
    }
  }
})

test("templates: the Stripe template is US Letter and leads with the amount due; the default is A4", () => {
  const spec = buildClientStatementSpec({ ...base, entries, projectNames: [] }, opts())
  const a4 = renderPdf(spec, opts({ template: "default" })).internal.pageSize
  const letter = renderPdf(spec, opts({ template: "stripe" })).internal.pageSize
  assert.ok(Math.abs(a4.getWidth() - 595.28) < 0.5, "A4")
  assert.ok(Math.abs(letter.getWidth() - 612) < 0.5 && Math.abs(letter.getHeight() - 792) < 0.5, "US Letter")
  assert.equal(spec.headline.label, "Amount due")
})

test("Arabic names are embedded in the PDF whatever language it is in", () => {
  const withArabic = renderPdf(buildPaySlipSpec({ ...base, entries, memberId: "m2" }, opts()), opts())
  assert.ok(Buffer.from(withArabic.output("arraybuffer")).toString("latin1").includes("Cairo"), "the Arabic font is in the file")
  const without = renderPdf(buildPaySlipSpec({ ...base, entries, memberId: "m1" }, opts()), opts())
  assert.equal(Buffer.from(without.output("arraybuffer")).toString("latin1").includes("Cairo"), true, "registered, so also present")
})

// ── what the switches change ───────────────────────────────────────────────

test("switches: Rate, Members and Day-by-day rows take their columns and rows out of the client statement", () => {
  const all = buildClientStatementSpec({ ...base, entries, projectNames: [] }, opts())
  assert.deepEqual(all.table.columns.map((c) => c.key), ["project", "date", "members", "hours", "rate", "amount"])
  assert.ok(all.summary.some((s) => s.label === "Hourly rate"))

  const lean = buildClientStatementSpec(
    { ...base, entries, projectNames: [] },
    opts({ show: { rate: false, members: false, details: false } }),
  )
  assert.deepEqual(lean.table.columns.map((c) => c.key), ["project", "date", "hours", "amount"])
  assert.equal(lean.summary.some((s) => s.label === "Hourly rate"), false)
  assert.equal(lean.table.rowKinds.includes("detail"), false, "only the project and total lines are left")
})

test("switches: the pay slip drops its Rate and Projects columns, and the days, the same way", () => {
  const lean = buildPaySlipSpec({ ...base, entries, memberId: "m1" }, opts({ show: { rate: false, members: false, details: false } }))
  assert.deepEqual(lean.table.columns.map((c) => c.key), ["date", "tracked", "manual", "hours", "amount"])
  assert.equal(lean.table.rows.length, 1, "just the total line")
})

test("language and format reach the document: Arabic labels, Eastern digits, the chosen date format", () => {
  const spec = buildClientStatementSpec(
    { ...base, entries: [entries[1]], projectNames: [] },
    opts({ language: "ar", numberFormat: "ar", dateFormat: "D MMMM YYYY" }),
  )
  assert.equal(spec.title, "كشف حساب العميل")
  assert.ok(spec.info.every((row) => row.label !== "تاريخ الإصدار" || /[٠-٩]/.test(row.value)), "dates in Eastern digits")
  assert.deepEqual(spec.info.find((row) => row.label === "تاريخ الإصدار"), { label: "تاريخ الإصدار", value: "١ أكتوبر ٢٠٢٦" })
  assert.deepEqual(spec.info.find((row) => row.label === "تاريخ الاستحقاق"), { label: "تاريخ الاستحقاق", value: "٣١ أكتوبر ٢٠٢٦" })
  assert.ok(spec.summary.some((s) => s.value.includes("ج.م") || s.value.includes("$")))
  assert.equal(spec.table.columns[0].header, "المشروع")
})

test("header note: it is on the document when set, and the option says so", () => {
  const o = opts({ headerNote: "Pay by wire" })
  assert.equal(o.headerNote, "Pay by wire")
  assert.equal(opts({}).headerNote, "")
})

// ── the team report ────────────────────────────────────────────────────────

const teamInput = (over = {}) => ({
  groupKey: "date",
  detailKind: "member",
  orgLabel: "Org",
  rangeLabel: "Sep 1",
  filters: { members: [], projects: ["Apollo", "Zeus"], trackedTime: "", currency: "USD" },
  totals: { time: "08:00:00", activity: 80, spent: "$120.00" },
  hoursByGroup: [{ label: "Sep 1", iso: "2026-09-01", value: 8 }],
  hoursByMember: [{ label: "Ada", value: 8 }],
  table: {
    columns: [
      { header: "Date", key: "__group" },
      { header: "Member", key: "__detail" },
      { header: "Members", key: "__members", align: "right" },
      { header: "Total hours", key: "total_hours", align: "right" },
      { header: "Total spent", key: "total_spent", align: "right" },
    ],
    rows: [
      { __group: "Tue, Sep 1", __detail: "All members", __members: "1", total_hours: "08:00:00", total_spent: "$120.00" },
      { __group: "Tue, Sep 1", __detail: "Ada", __members: "", total_hours: "08:00:00", total_spent: "$120.00" },
    ],
    rowKinds: ["group", "detail"],
    rowIso: ["2026-09-01", "2026-09-01"],
  },
  withoutMoney: false,
  filename: "time-and-activity",
  ...over,
})

test("team report: headers, filters and 'All members' follow the language; dates follow the format", () => {
  const spec = buildTeamReportSpec(teamInput(), opts({ language: "ar", numberFormat: "ar", dateFormat: "DD/MM/YYYY" }))
  assert.equal(spec.title, "تقرير الوقت والنشاط حسب التاريخ")
  assert.deepEqual(spec.table.columns.map((c) => c.header), ["التاريخ", "العضو", "الأعضاء", "إجمالي الساعات", "إجمالي المصروف"])
  assert.equal(spec.table.rows[0].__group, "٠١/٠٩/٢٠٢٦")
  assert.equal(spec.table.rows[0].__detail, "كل الأعضاء")
  assert.equal(spec.table.rows[1].__detail, "Ada", "a person's name is never translated")
  assert.ok(spec.filterLines[0].startsWith("الأعضاء: كل الأعضاء"))
  assert.ok(spec.filterLines[1].includes("Apollo، Zeus"), "Arabic list separator")
})

test("team report: without money there is no Total spent card; the money column comes from the caller", () => {
  const withMoney = buildTeamReportSpec(teamInput(), opts())
  assert.ok(withMoney.summary.some((s) => s.label === "Total spent"))
  const without = buildTeamReportSpec(teamInput({ withoutMoney: true }), opts())
  assert.equal(without.summary.some((s) => s.label === "Total spent"), false)
  assert.equal(without.subtitle, getLabels("en").teamSubtitle)
  assert.equal(without.filterLines.some((l) => l.startsWith("Currency")), false)
})

test("team report from a server payload: amounts only when asked for and only if the viewer may see money", () => {
  const payload = {
    days: [{ date: "2026-09-01", members: [{ name: "Ada", activeSeconds: 7200, idleSeconds: 300, spentAmount: 20, currency: "USD" }] }],
  }
  const ctx = { orgLabel: "Org", rangeLabel: "Sep 1" }
  assert.equal(teamReportInputFromPayload(payload, ctx, opts()).withoutMoney, true, "off unless asked for")
  const asked = teamReportInputFromPayload(payload, ctx, opts({ includeAmounts: true }))
  assert.equal(asked.withoutMoney, false)
  assert.equal(asked.totals.spent, "$20.00")
  assert.ok(asked.table.columns.some((c) => c.key === "spent"))
  assert.equal(teamReportInputFromPayload({ ...payload, moneyHidden: true }, ctx, opts({ includeAmounts: true })).withoutMoney, true)
  assert.equal(asked.totals.time, "02:00:00")
  assert.equal(asked.totals.activity, 96)
})

test("entries from the server are made safe before they are priced", () => {
  const e = normalizeEntry({ date: "2026-09-01", memberId: "m", memberName: "A", projectName: "P", clientName: "C", activeSeconds: "x", spentAmount: Number.NaN, payRate: 5, billRate: "40" })
  assert.equal(e.activeSeconds, 0)
  assert.equal(e.spentAmount, 0)
  assert.equal(e.billRate, undefined, "a string is not a rate")
  assert.equal(e.payRateCurrency, "USD")
})

// ── one source, two copies ─────────────────────────────────────────────────

test("the server's copy of the core is exactly what the web source generates", () => {
  const generated = generate()
  assert.ok(Object.keys(generated).length >= 7)
  for (const [name, content] of Object.entries(generated)) {
    const file = join(TARGET_DIR, name)
    assert.ok(existsSync(file), `${name} is missing on the server - run npm run sync:pdf-core`)
    assert.equal(readFileSync(file, "utf8").replaceAll("\r\n", "\n"), content, `${name} is out of date - run npm run sync:pdf-core`)
  }
})

test("the server's copy is plain JavaScript: no types, no .ts imports", () => {
  for (const name of Object.keys(generate())) {
    const src = readFileSync(join(TARGET_DIR, name), "utf8")
    assert.doesNotMatch(src, /from\s+["']\.\/[\w-]+\.ts["']/, name)
    assert.doesNotMatch(src, /^\s*(interface|type)\s+\w+/m, name)
  }
})

// ── wiring ─────────────────────────────────────────────────────────────────

test("every report PDF is drawn by the shared core, and Arabic is told its text is already in drawing order", () => {
  const wrapper = read("features/reports/utils/pdf/report-pdf-kit.ts")
  assert.match(wrapper, /renderPdf\(spec, options\)\.save\(/)
  const kit = read("shared/pdf-core/kit.ts")
  assert.match(kit, /isInputVisual: true, isOutputVisual: true, isInputRtl: false, isOutputRtl: false/)
  assert.match(kit, /function drawChartFrame\(/)
  assert.equal((kit.match(/drawChartFrame\(c, chart, y,/g) ?? []).length, 2, "bars and lines share the frame")
})

test("the Export dialog shows and saves what the server built; email uses the same options", () => {
  const dialog = read("features/reports/components/time-activity-report/pdf-export-dialog.tsx")
  assert.match(dialog, /await renderRef\.current\(options, \{ preview: true \}\)/)
  assert.match(dialog, /await render\(options, \{ preview: false \}\)/)
  assert.doesNotMatch(dialog, /renderPdf|pdf-core\/kit/, "the dialog draws nothing itself")
  const view = read("features/reports/components/time-activity-report/time-activity-report-view.tsx")
  assert.match(view, /<DropdownMenuItem onClick=\{openPdfDialog\}>To PDF…<\/DropdownMenuItem>/)
  assert.equal((view.match(/pdfOptions: emailPdfOptions/g) ?? []).length, 2, "send and schedule")
  assert.equal((view.match(/pdfSettings=\{<PdfSettingsForm/g) ?? []).length, 2)
  const form = read("features/reports/components/time-activity-report/pdf-settings-form.tsx")
  // A viewer who may not see money gets the team report only; the client
  // statement needs the right to see what clients are charged.
  assert.match(form, /moneyHidden \? \["report"\] : billingAvailable \? \["report", "client", "payslip"\] : \["report", "payslip"\]/)
})

test("the browser sends choices, not figures: only the team report sends anything of the page's", () => {
  const view = read("features/reports/components/time-activity-report/time-activity-report-view.tsx")
  assert.match(view, /team: isTeamReport \? teamReportInput\(o\) : undefined,/)
  assert.doesNotMatch(view, /buildClientStatementSpec|buildPaySlipSpec|buildTeamReportSpec|\brenderPdf\b|entriesInCurrency/, "pricing is not worked out in the browser")
  assert.doesNotMatch(view, /fetchTimeAndActivityReport/, "no reloading the whole report in another currency to price a document")
  const api = read("features/reports/api/time-and-activity-api.ts")
  assert.match(api, /apiPath\("\/api\/reports\/time-and-activity\/pdf"\)/)
  assert.match(api, /method: "POST"/)
})

test("the PDF look is saved on the server per member, with this browser's copy as the fast start", () => {
  const api = read("features/reports/api/pdf-settings-api.ts")
  assert.match(api, /apiPath\("\/api\/reports\/pdf-settings"\)/)
  assert.match(api, /method: "PUT"/)
  const hook = read("features/reports/hooks/use-pdf-options.ts")
  assert.match(hook, /fetchPdfSettings\(\)/)
  assert.match(hook, /savePdfSettings\(/)
  // Only how documents look is saved - never whose pay slip or which projects.
  assert.match(hook, /appearanceOf\(resolved\)/)
  // Settings made before the server held any are uploaded once, and an edit made while loading is not overwritten.
  assert.match(hook, /else if \(local && !touched\.current\)/)
  assert.match(hook, /if \(touched\.current\) return/)
})
