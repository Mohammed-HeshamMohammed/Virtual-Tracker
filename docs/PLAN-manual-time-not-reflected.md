# Plan — Manual time (the "+" and manual edits) doesn't count where it should

Status: **proposal — nothing built.** Every claim below is a direct code
citation, verified 2026-09-29; none of it is inferred from behaviour. No fix
has been applied.

## What was reported

Time added through the timesheets "+" (Add manual time) or a manual edit does
not show up:

- above the tracked time, in charts;
- in report rows;
- reflected as time done in the tracker (the desktop agent).

## The root cause: two disconnected systems, then three separately broken consumers

`time_entries` is a real, purpose-built table (`status`, `source`, review
columns — [ensure-lookup-schema.js:462](Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js:462)) for exactly this feature. Manual time is
correctly written there from **three** places: the Time & Activity Report's
"Add time for someone" dialog ([add-manual-entry-dialog.tsx](Dashboard-Web/features/reports/components/time-activity-report/add-manual-entry-dialog.tsx)), the Timesheets
approvals "Manual time" form ([ManualTimeContent.tsx](Dashboard-Web/features/timesheets/components/approvals/components/ManualTimeContent.tsx)), and the approve/reject queue
([PendingManualTimeQueue.tsx](Dashboard-Web/features/timesheets/components/approvals/components/PendingManualTimeQueue.tsx)). **Writing the row is not the problem.**

The problem is that Virtual Tracker has **three independent places that show
"hours worked"**, each with its own query, and manual time was wired into only
one of them correctly. The other two either silently drop it or corrupt it:

| Surface | Reads manual time? | Verdict |
| --- | --- | --- |
| Time & Activity Report **table rows** | Yes, correctly | Working |
| Time & Activity Report **chart**, single metric | Yes, correctly (already fixed once — see the in-code comment) | Working |
| Time & Activity Report **chart**, comparing 2+ metrics | **No** | **Bug 1** |
| Dashboard / Command Center **"hours worked" sparkline** | Yes, but at **60× the real value**, and it also counts **rejected** entries | **Bug 2** |
| The desktop tracker's own **Today / this week / earnings** | **No — never queried at all** | **Bug 3** (architecture gap, not a one-line fix) |
| Time & Activity Report table rows again | Includable, but also never excludes **rejected** entries | **Bug 4** (smaller, same shape as half of Bug 2) |

Approval status barely matters anywhere it should: `getManualTimeEntryRowsPg`
and `fetchTimeEntriesSinceDate` (below) have **no `status` filter at all** — a
rejected manual entry counts exactly like an approved one, everywhere. This
means "not reflected" and "reflected but wrong" are two symptoms of the same
underlying design gap: nobody decided, in one place, what "manual time counts"
means, so every consumer reinvented it, and two of the three reinvented it
wrong.

---

## Bug 1 — the report's own chart drops manual time when comparing metrics

[report-chart.tsx](Dashboard-Web/features/reports/components/time-activity-report/report-chart.tsx):

- The **single-metric bar chart** (`singleBar`, line ~95) already stacks
  `manualHours` on top of `trackedHours` correctly — the code even carries a
  comment recording that this was fixed once: *"The chart was therefore
  quietly excluding manual time from the very number the table said included
  it."* (lines 102–105). **Not broken today.**
- The **multi-metric comparison chart** (`multiBar`, line 117) calls
  `getMetricNumeric(m, d)` directly, with no manual-hours stacking at all.
  `getMetricNumeric("total_hours", d)` ([row-aggregate.ts:161](Dashboard-Web/features/reports/utils/time-and-activity/row-aggregate.ts:161)) returns
  `d.trackedHours` — tracked seconds only. So the moment a member selects a
  **second** metric to compare against Total hours (a supported, ordinary
  action — `multi = activeMetrics.length > 1`), the exact same regression the
  single-metric chart was already fixed for reappears in the comparison view.

**Fix, refined 2026-09-29 — two changes, not one:**

### 1a. Stack manual time the same way the single-metric chart already does

The single-metric bar (`!multi`, [report-chart.tsx:239-276](Dashboard-Web/features/reports/components/time-activity-report/report-chart.tsx:239)) already draws
exactly the shape asked for: the bar from the axis up to `trackedHours` is the
real, tracked segment (`renderBar(..., trackedTop, ...)`), and a second segment
in a different colour (`MANUAL_BAR_COLOR`) is stacked directly **above** it,
from `trackedHours` to `trackedHours + manualHours` (lines 257–272). That *is*
"point to point is real, then above it is the manually edited time" — bars,
not a line, but the same reading: the real value is the trustworthy part at
the bottom, and manual time is a visibly separate layer on top of it, never
blended in.

Multi-metric mode (`multiBar`, lines 278–301) does not do this — it draws one
plain bar per metric from `renderBar(barX, bW, yAtN(val), ...)` with no manual
segment at all, because `val` comes straight from `getMetricNumeric`. **Fix:**
when the metric being drawn is `"total_hours"`, split it into the same two
`renderBar` calls the single-metric branch already uses (tracked bar, then a
manual bar stacked on top in `MANUAL_BAR_COLOR`), scaled through that metric's
own axis (§1b) instead of one flat bar. Every other metric (`activity`,
`total_spent`) has no manual component and stays a single bar, as today.

### 1b. Stop normalizing to a 0–100% axis; give each metric its own real,
rounded-up-to-a-whole-value scale

Today, multi mode always draws a fixed `[0, 25, 50, 75, 100]` gridline set
([report-chart.tsx:221](Dashboard-Web/features/reports/components/time-activity-report/report-chart.tsx:221)) and positions every bar with
`normalizeSeriesTo01` ([chart-utils.ts:39-47](Dashboard-Web/features/reports/utils/time-and-activity/chart-utils.ts:39)) — each series independently
rescaled to **its own** minimum–maximum span. The axis labels ("25%", "50%"…)
are therefore not a real quantity at all: they say where a value sits
*relative to that series' own biggest value*, not how many hours, percent, or
currency it actually is. Since the three metrics
(`total_hours`/`activity`/`total_spent`, [models/time-and-activity.ts:1](Dashboard-Web/features/reports/models/time-and-activity.ts:1)) are
three different units, comparing them on one shared axis needs *some* form of
relative scaling — but the labels shown don't have to lie about it.

**Fix:** stop using a synthetic percent axis. Reuse `buildYTicks` — which
already does precisely "round up past the real max to the next clean whole
number" ([chart-utils.ts:4-28](Dashboard-Web/features/reports/utils/time-and-activity/chart-utils.ts:4), the function's own comment: *"Ticks run until one
reaches or passes `top`... rounding up keeps the padding real"*) — **per
active metric**, off that metric's own real max (for `total_hours`, the
stacked max, `trackedHours + manualHours`, matching §1a and the single-metric
chart's `rawMax` at line 110), instead of calling it once with a 0–100 stand-in
for "activity" and never calling it at all for the others. Each metric keeps
its own real-value scale for computing bar height (so a bar's height is
`value / thatMetric'sRoundedUpMax`, the same shape of calculation
`normalizeSeriesTo01` did, just anchored to a real rounded ceiling instead of
that series' own peak) — the rendering math barely changes. **What changes is
what's printed on the axis**: instead of one generic "0% / 25% / 50%…" column
that means nothing across three units, show the **primary metric's own real
ticks** (hours, rounded up to the next whole hour/2/4-hour step exactly as
`buildYTicks` already computes) on the left axis, and carry each other
compared metric's real value in its **tooltip row** (which already exists —
see `formatMetricDisplayValue`, [chart-utils.ts:49-58](Dashboard-Web/features/reports/utils/time-and-activity/chart-utils.ts:49) — and the per-metric
hover rows around [report-chart.tsx:397-420](Dashboard-Web/features/reports/components/time-activity-report/report-chart.tsx:397)) rather than on a shared axis
that can't honestly label more than one unit at once.

**Open decision, flagged rather than guessed:** with three genuinely different
units, only one can own the left axis's real numbers at a time. Default:
**whichever metric is first in `activeMetrics`** owns the axis (normally
`total_hours`, since it's first in `CHART_METRIC_ORDER`); the others are still
drawn as bars scaled to their own rounded-up max (so their bars are visually
readable, tall bar = closer to that metric's own peak) with the real number
available on hover. If instead every compared metric should get its own
labelled axis (a small multi-axis chart, one column of ticks per metric), that
is a materially bigger UI change — say so and it becomes its own item.

---

## Bug 2 — the Dashboard/Command Center "hours worked" chart is 60× too large, and counts rejected time

Two independent defects stack in the same code path:

1. **Unit mismatch.** `time_entries.duration` is stored in **seconds** — the
   web dialogs compute `hours * 3600 + minutes * 60` before sending it
   ([add-manual-entry-dialog.tsx:79](Dashboard-Web/features/reports/components/time-activity-report/add-manual-entry-dialog.tsx:79), [ManualTimeContent.tsx:69](Dashboard-Web/features/timesheets/components/approvals/components/ManualTimeContent.tsx:69) via `parseHoursInput`),
   matching the column's own name and the Time & Activity Report's correct
   reading of it (`manual_seconds`, [time-and-activity-report-postgres.service.js:114](Dashboard-Backend/src/lib/postgres/time-and-activity-report-postgres.service.js:114)).
   But [dashboard-base-loader.js:66](Dashboard-Backend/src/modules/dashboard/dashboard-base-loader.js:66) passes that same raw value through
   labelled `duration` and [general-dashboard-service.js:127](Dashboard-Backend/src/modules/dashboard/general-dashboard-service.js:127) reads it as
   **`entry.durationMinutes`** and divides by 60 — treating a value that is
   already in seconds as if it were minutes. A 2-hour manual entry (7,200
   seconds) becomes `7200 / 60 = 120` "hours."
2. **No status filter.** `fetchTimeEntriesSinceDate` ([postgres-crud.service.js:819](Dashboard-Backend/src/modules/schema/services/postgres-crud.service.js:819))
   selects every row in the date range with no `WHERE status = 'approved'` —
   pending and **rejected** manual entries count identically to approved ones.

This feeds `workedByDay`/`workedSparkline` and `spentByDay`/`spentSparkline`
([general-dashboard-service.js:117-193,325-328](Dashboard-Backend/src/modules/dashboard/general-dashboard-service.js:117)) — the Dashboard/Command
Center's own "hours worked this week" chart and today/week totals. So this
surface doesn't under-report manual time at all; it wildly over-reports it,
which likely reads to a member as "the numbers don't make sense" rather than
"my entry is missing" — worth confirming with whoever reported this which
surface they actually looked at.

**Fix (two independent one-liners, same file):**
- `general-dashboard-service.js:127`: `entry.durationSeconds / 3600`, and
  rename the field consistently back through `dashboard-base-loader.js:66`
  (`durationSeconds`, not `duration`) so the unit is unambiguous at the call
  site instead of implicit.
- `fetchTimeEntriesSinceDate`: add `AND status = 'approved'` (matching Bug 4's
  fix — same rule, same place would be even better, see §Recommendation).

---

## Bug 3 — the desktop tracker never learns about manual time at all

`buildAgentWorkspace` → `buildSelfSection` ([workspace.service.js:18](Dashboard-Backend/src/modules/activity/workspace.service.js:18)) computes
`weekActivity`/`monthActivity` (and the derived `weekAmount`/`monthAmount`
earnings estimate) purely from `sumMemberActiveIdleSeconds` — a sum over
tracked sessions. `buildTeamSection` and the pulse/team sections are the same
shape. **`time_entries` is not imported, queried, or referenced anywhere in
`workspace.service.js`.** So whatever a manager backfills for a member on the
web — a day nothing was tracked, specifically what manual time exists to
cover — never appears in that member's own tracker: not in "This week," not
in the earnings estimate, nowhere.

This is not a one-line bug like the other three. It's a real design question:
**should the live desktop tracker's own numbers include time nobody tracked
live on that device at all?** Two honest options:

- **A — include it.** Add a manual-time sum (this week/month, same date range
  as the existing `sumMemberActiveIdleSeconds` calls) to `buildSelfSection`,
  approved-only, and fold it into `weekAmount`/`monthAmount` the same way the
  Time & Activity Report folds it into its totals. Simple, consistent with
  every other surface, but changes what "This week" means in the tracker's own
  UI (it stops being purely "what this device saw").
- **B — leave it out on purpose, but say so.** The tracker's numbers are
  explicitly live/tracked-only; a one-line note under the weekly figure
  ("Live tracking only — manual entries are on your web timesheet") sets the
  right expectation instead of looking broken.

**Recommendation: A**, because the person who filed this report wants manual
time to read as "time done," full stop, wherever they look — a member who
backfilled two hours and later opens the tracker to sanity-check their week
would otherwise see it missing there while the report shows it, which reads as
the same bug all over again. B is the cheaper fallback if A turns out to
conflict with something the tracker's own weekly-ring UI assumes.

---

## Bug 4 — rejected manual time still counts in the Time & Activity Report

`getManualTimeEntryRowsPg` ([time-and-activity-report-postgres.service.js:70](Dashboard-Backend/src/lib/postgres/time-and-activity-report-postgres.service.js:70))
selects `WHERE te.source = 'manual'` with **no `status` condition** — so a
manager rejecting an entry in the approvals queue does not remove it from the
report; it keeps counting in the member's totals, the chart, and every row it
touches. The opposite of the reported symptom, but the same defect shape as
half of Bug 2, and worth fixing in the same pass since it's the same missing
`WHERE` clause in a sibling query.

**Fix:** `AND te.status = 'approved'`.

---

## Recommendation: one source of truth instead of four ad-hoc queries

Bugs 2 and 4 are the *same* missing filter written twice; Bug 1 is the same
"tracked-only" mistake the single-metric chart was already fixed for, made
again in a sibling code path; Bug 3 is the same query never having been
written at a fourth site. That pattern — one concept, four independent
re-implementations, two of them wrong — is the actual root cause, not any one
line.

**Fix once, at the source:** add a single helper —
`getApprovedManualSecondsByMemberDay({ memberIds, fromDay, toDay, projectIds })`
in `time-and-activity-report-postgres.service.js` (or a shared location both
`reports` and `dashboard` modules import) — that is the **one** place
`status = 'approved'` and the seconds unit are decided. Point
`getManualTimeEntryRowsPg`, `fetchTimeEntriesSinceDate`'s manual-time role, and
`buildSelfSection` (Bug 3, option A) all at it. `report-chart.tsx`'s
`multiBar` then just needs the existing `d.manualHours` field it already
receives, added in one place instead of reasoned about per chart.

## Test plan

- **Bug 1a (stacking):** with two or more metrics active including Total
  hours, a day with manual time shows two visibly distinct bar segments for
  Total hours — the real/tracked segment at the bottom, the manual segment
  stacked above it in `MANUAL_BAR_COLOR` — matching the single-metric chart's
  existing behaviour pixel-for-pixel in proportion.
- **Bug 1b (axis):** the Y-axis in multi-metric mode shows real, whole-number
  ticks for the primary metric (e.g. real hours, rounded up past the true max
  the same way `buildYTicks` already does for single-metric mode) — never a
  bare "25% / 50% / 75% / 100%" column that doesn't correspond to any of the
  compared metrics' real units. A non-primary metric's real value is correct
  in its tooltip row even though it isn't the axis's own labelled unit.
- **Bug 2:** seed a manual entry of a known duration (e.g. exactly 2h); assert
  the Command Center's "hours worked" sparkline/today/week figures show 2h, not
  120h; seed a rejected entry and assert it contributes 0.
- **Bug 3:** seed an approved manual entry for a member with no tracked
  sessions that week; assert the agent's `buildAgentWorkspace` response
  includes it in `weekActivity`/`weekAmount` (once Bug 3 is fixed per option A)
  — or, if option B is chosen, assert the new disclaimer text renders.
- **Bug 4:** seed an approved and a rejected manual entry on the same day;
  assert only the approved one appears in `getTimeAndActivityReportRowsPg`'s
  merged payload, the table row, and the chart.
- **Regression:** the existing single-metric chart stacking (already correct)
  stays unchanged; PGlite-backed tests for the new/changed SQL per project
  practice (backend tests mock the DB, so new `WHERE` clauses need a real
  Postgres check, not a mock).

## Out of scope for this plan

- Whether `time_entries` and the schema-catalog generic CRUD (`/api/time-entries`)
  is the right long-term shape for this data — it works and is reused
  correctly in most places; this plan only fixes the four broken readers.
- The Timesheets page's own separate `getTimeEntries`/pay-period rollup
  (`timesheets` table, `total_hours`/`billable_hours`) was not audited here —
  worth a follow-up pass with the same "does it read `time_entries` with the
  right status filter and unit" question if it turns out to have the same
  shape of bug.
