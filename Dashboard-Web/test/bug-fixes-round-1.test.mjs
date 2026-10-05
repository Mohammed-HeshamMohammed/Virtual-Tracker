// Regression guards for PLAN-bug-fixes-round-1.md. Each of these was a real
// shipped bug with a one-or-two-line cause, which is exactly the kind that
// comes back silently during a later refactor.
//
// Source-level on purpose, matching timer-stop-contract.test.mjs: this app
// has no component-test setup, and these are structural rules about specific
// lines rather than rendered behaviour.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8")
}

/** Comments removed, so an explanation that quotes the old buggy line does
 *  not itself trip these assertions. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

test("Work Sessions: Clear all does not re-select everything (item 9)", () => {
  const src = code(read("features/reports/hooks/use-work-sessions-report.ts"))

  // The bug: clearProjects/clearMembers were copy-pasted from selectAll*,
  // both setting null. null means "no filter - show everything", so Clear
  // selected everything instead of deselecting it. An empty Set is what
  // utils/work-sessions.ts reads as "nothing selected".
  assert.match(src, /clearProjects\s*=\s*useCallback\(\(\)\s*=>\s*setProjectFilter\(new Set/)
  assert.match(src, /clearMembers\s*=\s*useCallback\(\(\)\s*=>\s*setMemberFilter\(new Set/)

  assert.doesNotMatch(
    src,
    /clearProjects\s*=\s*useCallback\(\(\)\s*=>\s*setProjectFilter\(null\)/,
    "clearProjects must not set null - that is Select all",
  )
  assert.doesNotMatch(
    src,
    /clearMembers\s*=\s*useCallback\(\(\)\s*=>\s*setMemberFilter\(null\)/,
    "clearMembers must not set null - that is Select all",
  )
})

test("Work Sessions: an empty filter Set still means 'show nothing' (item 9)", () => {
  // The fix above only holds while the consumer treats an empty Set as
  // "nothing selected" rather than falling back to "everything".
  const src = code(read("features/reports/utils/work-sessions.ts"))
  assert.match(src, /projectNames\.size\s*===\s*0\s*\)?\s*return false/)
  assert.match(src, /memberNames\.size\s*===\s*0\s*\)?\s*return false/)
})

test("Time & Activity chart: tooltip is positioned off the hovered bar, not pinned (item 2)", () => {
  const src = code(read("features/reports/components/time-activity-report/report-chart.tsx"))

  // The bug: the tooltip was `absolute top-3`, a fixed offset from the top of
  // the chart, so any bar tall enough to reach it got covered.
  assert.doesNotMatch(
    src,
    /className="pointer-events-none absolute top-3/,
    "tooltip must not be pinned to a fixed top offset",
  )
  assert.match(src, /barTopVb/, "tooltip position must derive from the hovered bar's top")
  // When there is no room above a tall bar it goes BESIDE the bar. An
  // earlier fallback put it "just below the bar's top" - on the bar again,
  // which only showed up when measured in a browser.
  assert.match(src, /barRightVb \+ TOOLTIP_GAP/, "tall bars get a side placement")
  assert.doesNotMatch(src, /barTopVb \+ TOOLTIP_GAP/, "never placed below a bar's top, i.e. on the bar")
})

test("Time & Activity chart: manual time is stacked, not left out (item 6)", () => {
  const src = code(read("features/reports/components/time-activity-report/report-chart.tsx"))
  // getMetricNumeric("total_hours") is trackedHours alone, while the
  // table's Total hours is tracked + manual - the chart had been silently
  // dropping manual time.
  assert.match(src, /manualSeries/)
  assert.match(src, /MANUAL_BAR_COLOR/)
  // The split tooltip's Tracked row must be the tracked part only, not
  // totalHours (which already includes the Manual row beneath it).
  assert.match(src, /formatHoursClock\(d\.trackedHours/)
})

test("Time & Activity chart: the peak keeps real headroom (item 7)", () => {
  const src = code(read("features/reports/utils/time-and-activity/chart-utils.ts"))

  // 8% left the tallest bar touching the ceiling - worst on a one-day range,
  // and it left the repositioned tooltip above nowhere to sit.
  assert.doesNotMatch(src, /maxVal\s*\*\s*0\.08/, "8% headroom is the bug being fixed")
  const padMatch = src.match(/const pad = maxVal \* (0\.\d+)/)
  assert.ok(padMatch, "buildYTicks should still scale headroom from maxVal")
  assert.ok(
    Number(padMatch[1]) >= 0.15,
    `headroom should be a visible fraction of the peak, got ${padMatch[1]}`,
  )
})

test("PDF line chart: every point is labelled, not just the last (item 3)", () => {
  const src = code(read("features/reports/utils/pdf/report-pdf-kit.ts"))

  // The bug: one value printed at the far-right point, so the reader could
  // see that the line moved without being able to read between what.
  assert.match(src, /valueStep/, "point values should be thinned by a step, not reduced to one")
  assert.doesNotMatch(
    src,
    /^\s*doc\.text\(fmt\(points\[n - 1\]\.value\), xAt\(n - 1\)[^\n]*\)\s*$/m,
    "a single last-point label is the bug being fixed",
  )
})

test("TopBar search: width is not pinned to a fixed size (item 1)", () => {
  const src = code(read("shared/ui/layout/components/topbar/global-search-bar.tsx"))

  assert.doesNotMatch(
    src,
    /className="relative w-72"/,
    "the search widget must not be hardcoded to w-72",
  )
  assert.match(src, /relative w-full max-w-/, "it should grow with the space the topbar gives it")
  // The results menu carries a title, a path and a description per row, so
  // it needs a readable floor rather than inheriting a narrow input's width.
  assert.match(src, /min-w-\[\d+rem\]/)
})

test("Command Center feed: the dead '...' control is gone (item 21)", () => {
  const src = code(read("features/dashboard/components/command-center/components/activity-feed-section.tsx"))

  // It rendered as an interactive button with no onClick and no menu.
  assert.doesNotMatch(src, /MoreHorizontal/, "the no-op '...' button should not be back")
})

test("Team Utilization: members with no weekly limit are still surfaced (item 20)", () => {
  const src = code(read("features/dashboard/components/command-center/components/team-utilization-section.tsx"))

  // They used to be skipped entirely server-side, so a workspace that sets
  // no weekly caps saw 0% and zero members everywhere and read it as broken.
  assert.match(src, /noLimit/, "the No limit set bucket must be rendered")
  assert.match(src, /utilizationCounted/, "the ring must distinguish 'no limits set' from 0%")
  assert.doesNotMatch(src, /Optimal Load/, "renamed to 'On track'")
})

test("Time & Activity table uses the same widths for fitting and rendering", () => {
  const view = code(read("features/reports/components/time-activity-report/time-activity-report-view.tsx"))
  const constants = code(read("features/reports/components/shared/constants.ts"))

  // The auto-hide hook used to budget narrow abstract widths while the
  // browser's auto table layout expanded the real headers and activity bar.
  // That mismatch clipped Total spent at the right edge of the report card.
  assert.match(view, /const fittedTableMinWidth\s*=/)
  assert.match(view, /table-fixed.*minWidth: fittedTableMinWidth/)
  assert.match(view, /<colgroup>/)
  assert.match(view, /TIME_ACTIVITY_TABLE_COL_MIN_WIDTH\[col\.key\]/)
  assert.match(view, /max-w-full overflow-x-auto custom-scrollbar-x/)

  const activityWidth = constants.match(/activity_pct:\s*(\d+)/)
  const spentWidth = constants.match(/total_spent:\s*(\d+)/)
  assert.ok(activityWidth && Number(activityWidth[1]) >= 140, "Activity % must fit its bar, value and cell padding")
  assert.ok(spentWidth && Number(spentWidth[1]) >= 120, "Total spent must fit its label, value and cell padding")
})

test("Dashboard sorting remains compatible with the Windows 7 and Windows 8 browser ceiling", () => {
  const runtimeFiles = [
    "shared/ui/layout/config/nav-sections.ts",
    "shared/tables/hooks/use-responsive-row-cap.ts",
    "features/projects/utils/overview-sort.ts",
    "features/clients/components/tables/clients-tab.tsx",
    "features/projects/components/tables/projects-tab.tsx",
  ]

  for (const file of runtimeFiles) {
    const src = code(read(file))
    assert.doesNotMatch(src, /\.toSorted\s*\(/, `${file} must not require Array.prototype.toSorted`)
    assert.match(src, /\[\.\.\.[^\]]+\]\.sort\s*\(/, `${file} must retain non-mutating sort behavior`)
  }
})

test("Dashboard explicitly targets and bootstraps Chromium 109", () => {
  const pkg = JSON.parse(read("package.json"))
  const bootstrap = code(read("instrumentation-client.ts"))

  assert.deepEqual(pkg.browserslist, ["chrome 109", "edge 109"])
  assert.equal(pkg.dependencies["core-js"], "^3.50.0")
  for (const feature of ["to-reversed", "to-sorted", "to-spliced", "array/with", "promise/with-resolvers"]) {
    assert.match(bootstrap, new RegExp(`core-js/features/(?:array/)?${feature}`))
  }
})

test("Project archive uses the member UUID and restore clears archive metadata", () => {
  const hook = code(read("features/projects/hooks/use-project-mutations.ts"))
  const api = code(read("features/projects/api/project-api.ts"))

  assert.match(hook, /archiveProjectApi\(id, nextArchived, memberId \?\? undefined\)/)
  assert.doesNotMatch(hook, /archiveProjectApi\(id, nextArchived, user\?\.uid\)/)
  assert.match(api, /archivedBy: null/)
  assert.match(api, /archivedAt: null/)
})

test("Command Center productivity chart separates active and idle and has an honest empty state", () => {
  const src = code(read("features/dashboard/components/command-center/components/productivity-trends-section.tsx"))

  assert.match(src, /areaBetween\(totalValues, activeValues/)
  assert.match(src, /No tracked time yet this week/)
  assert.match(src, /Activity rate/)
})

test("Report pages share the Time and Activity control bar and card treatment", () => {
  const layout = code(read("features/reports/components/app/standard-report-layout.tsx"))
  const cards = code(read("features/reports/components/shared/report-ui.tsx"))

  assert.match(layout, /max-w-\[1400px\].*space-y-6.*px-6 py-6/)
  assert.match(layout, /Members/)
  assert.match(layout, /Projects/)
  assert.match(layout, /Date range/)
  assert.match(layout, /Data grouped by/)
  assert.match(layout, /ReportToolbarMultiSelect/)
  assert.match(layout, /rounded-lg bg-blue-500/)
  assert.match(cards, /dark:border-slate-700 dark:bg-slate-900/)
})

test("Bespoke reports use the same compact control-bar grammar", () => {
  const workSessions = code(read("features/reports/components/work-sessions/work-sessions-report.tsx"))
  const amountsOwed = code(read("features/reports/components/amounts-owed/amounts-owed-report.tsx"))
  const dailyTotals = code(read("features/reports/components/daily-totals/daily-totals-report.tsx"))
  const auditLog = code(read("features/reports/components/audit-log/audit-log-report.tsx"))

  for (const src of [workSessions, amountsOwed, dailyTotals]) {
    assert.match(src, /ReportToolbarMultiSelect/)
    assert.match(src, /Date range/)
    assert.match(src, /Filter\s*<\/button>/)
    assert.match(src, /aria-label="Export"/)
  }
  assert.match(auditLog, /Search events/)
  assert.match(auditLog, /Data grouped by/)
  assert.match(auditLog, /Filter\s*<\/button>/)
  assert.match(auditLog, /aria-label="Export"/)
})
