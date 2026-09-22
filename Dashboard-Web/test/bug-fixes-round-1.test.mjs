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
  assert.match(src, /top:\s*`\$\{topPx\}px`/)
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
