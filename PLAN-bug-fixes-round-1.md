# Bug Fixes Round 1 — Plan

Source: `X:\Bugs Pics\Errors Per Pages.txt` + 5 screenshots. 21 items in the original list; **item 19 (Customer Accounts tab) is removed from this plan — already built** on `feat/customer-accounts-tenancy` (Customer Accounts tab in Add Members, email-code gate, isolated tenant tree, Owner/Super-Admin-only management, Enterprise Super Manager/Manager roles). That leaves **20 items**.

Every item below was checked against the actual code before being written up. Where I found the exact line and can state the fix with confidence, it says so plainly. Where I only confirmed the right file and the fix needs a design decision or on-screen verification, it says that instead — not padded to look more finished than it is.

---

## How this is organized

Items are grouped by page, matching the source file, and numbered the same way (skipping 19). Each item has:
- **What's broken** — the complaint, in short.
- **Root cause** — what I found in the code, with file:line.
- **Fix** — what changes, concretely.

---

## Global

### 1. TopBar search bar too small, dropdown too small

**File:** [global-search-bar.tsx](Dashboard-Web/shared/ui/layout/components/topbar/global-search-bar.tsx), used from [topbar.tsx:35-41](Dashboard-Web/shared/ui/layout/components/topbar/topbar.tsx:35).

**Root cause, confirmed:** the whole search widget is hardcoded to `w-72` (288px) at [global-search-bar.tsx:112](Dashboard-Web/shared/ui/layout/components/topbar/global-search-bar.tsx:112):
```tsx
<motion.div ref={rootRef} layout="position" className="relative w-72">
```
It sits in the **center column of a 3-column grid** header (`grid-cols-3`, [topbar.tsx:30](Dashboard-Web/shared/ui/layout/components/topbar/topbar.tsx:30)), centered within that column (`justify-center`), so the fixed 288px never grows even though the center column is often much wider than that. The results dropdown is `absolute left-0 right-0` ([global-search-bar.tsx:146](Dashboard-Web/shared/ui/layout/components/topbar/global-search-bar.tsx:146)) — it inherits exactly the search bar's own width, which is why it reads as "too small based on the search bar": result rows carry a title, a path, and a description on one line each (line 171-177), and at 288px that wraps awkwardly.

**Fix:**
- Replace `w-72` with a responsive width — e.g. `w-full max-w-xl` inside a `flex-1` wrapper in `topbar.tsx`'s center column, so it grows with available space instead of being pinned.
- Make the dropdown **wider than the input** once open (e.g. `min-w-[28rem]`, still `left-0` but not `right-0`-locked to the input's own edge) so result rows have room, matching the item's literal ask ("dimensions of the dropdown too small based on the search bar").
- Keep `max-h-80` on the dropdown as-is; only width changes.

---

## Time & Activity Reports

### 2. Chart tooltip covers the chart instead of appearing above it

**File:** [report-chart.tsx:270-298](Dashboard-Web/features/reports/components/time-activity-report/report-chart.tsx:270).

**Root cause, confirmed:** the tooltip is unconditionally pinned near the top of the chart container:
```tsx
<div className="pointer-events-none absolute top-3 z-20" style={{ left: `calc(${pct * 100}% - 80px)` }}>
```
`top-3` never changes with the hovered bar's height — for a bar that's tall (near the chart's max), the tooltip sits directly on top of it. This is exactly what *Screenshot 190816.png* and *194614.png* show.

**Fix:** compute the tooltip's vertical position from the hovered bar's own top (`yTop` from `singleBar.yAt(val)` / the multi-bar equivalent), placed a fixed offset **above** that point, clamped so it never goes above `padT` (the chart's own top padding) — i.e. flip to sit *below* the bar's top when there isn't enough headroom, rather than always `top-3`. This needs the tooltip's own render block to receive the hovered bar's computed `yTop`, which today only the SVG bar-drawing code computes — a small refactor to lift that value out per hovered index.

### 3. Members PDF: line chart has no point markers; "Tracked hours by member" shows one member instead of all

**File:** [time-activity-report-view.tsx:202-260](Dashboard-Web/features/reports/components/time-activity-report/time-activity-report-view.tsx:202) (builds the export payload) → [report-pdf-kit.ts](Dashboard-Web/features/reports/utils/pdf/report-pdf-kit.ts) (draws it).

**Root cause — point markers:** confirmed by inspection of *Screenshot 191050.png* — the line chart renders a polyline with no marker dots at each data point, making a 3-point line read as an arbitrary shape rather than 3 distinct days. This is a rendering gap in `report-pdf-kit.ts`'s line-chart drawer (needs a small circle drawn at each `(x, y)` alongside the existing line segments — I did not find a reason this was intentionally omitted).

**Root cause — single member instead of all:** `downloadPdf()` builds `byMemberHours` by summing `member.trackedHours` from `getSubRowsForDay(day.date)` for every day ([time-activity-report-view.tsx:203-208](Dashboard-Web/features/reports/components/time-activity-report/time-activity-report-view.tsx:203)). `getSubRowsForDay` is defined in [use-time-and-activity-report.ts:389-399](Dashboard-Web/features/reports/hooks/use-time-and-activity-report.ts:389):
```ts
getSubRowsForDay: (date: string) =>
  groupedResult
    ? (groupedResult.subRowsByKey[date] ?? [])
    : getFilteredSubRows(date, memberFilter, memberRows, ...)
```
When the table is grouped (`groupBy` set to something other than the default), `subRowsByKey[date]` is whatever the grouping logic put there — **if the report is grouped by date rather than by member**, that bucket may hold one aggregated row rather than one row per member, which would explain a PDF exported while grouped a certain way showing only one bar. **This needs runtime verification**: reproduce with 2+ members tracked in the range, try each `groupBy` mode, and confirm which mode(s) collapse `subRowsByKey` to fewer than the real member count. The fix, once confirmed, is either in `groupedResult`'s construction (wherever `subRowsByKey` is built) or in `getSubRowsForDay` falling back to the ungrouped per-member expansion specifically for the PDF export path, regardless of the on-screen `groupBy` state.

### 4. Onboarding/update email — wrong or broken link

**Complaint:** email sent to members who need to update their app should link to `app.myvirtualtracker.com` correctly.

**Not yet located precisely.** Candidates, from the earlier session's work on agent version tracking: `Dashboard-Backend/src/modules/agent-versions/` and `Notify-backend/src/modules/email/email-builders.js`'s `sendAgentUpdateReminderEmail`/`sendAgentInstallInstructionsEmail` (both exist per the email-builders file explored in the previous session). **Needs a quick grep for the literal URL construction** in those two builders — likely either a hardcoded wrong domain, or a `resolveAppPublicUrl`-style helper not being used consistently (the same class of bug fixed for invite links in the customer-accounts work). Flagging for a first-pass grep before estimating effort; this is likely a small, contained fix once located.

### 5. Click/navigation errors switching between filters (members, projects, date range, group-by)

**Files:** [filters-panel.tsx](Dashboard-Web/features/reports/components/time-activity-report/filters-panel.tsx), [filter-dropdown.tsx](Dashboard-Web/features/reports/components/time-activity-report/filter-dropdown.tsx), [date-range-picker.tsx](Dashboard-Web/features/reports/components/time-activity-report/date-range-picker.tsx), [use-time-and-activity-report.ts](Dashboard-Web/features/reports/hooks/use-time-and-activity-report.ts).

**Not yet reproduced or root-caused** — "clicking errors when switching between them" is vague enough (console errors? dropdown not closing? stale selection state? a thrown exception?) that it needs to be reproduced in the running app before a fix can be scoped. **This is the one item in this plan I'd want you to describe more precisely** (what actually happens — does it throw, does the UI freeze, does a filter silently reset?) or let me drive the browser against a running dev server to reproduce it directly.

### 6. Manual time edits don't reflect in total hours / project hours; no budget-limit restriction; no distinct chart color

**Files:** [add-manual-entry-dialog.tsx](Dashboard-Web/features/reports/components/time-activity-report/add-manual-entry-dialog.tsx) (entry UI) → `Dashboard-Backend/src/lib/postgres/time-and-activity-report-postgres.service.js` + `Dashboard-Backend/src/modules/reports/routes.js` (report aggregation).

**Root cause, confirmed — the "doesn't reflect in totals" half:** [routes.js:223-228](Dashboard-Backend/src/modules/reports/routes.js:223):
```js
const [rawRows, manualRows] = await Promise.all([
  getTimeAndActivityReportRowsPg({ memberIds, fromDay: from, toDay: to, projectIds }),   // from activity_sessions
  getManualTimeEntryRowsPg({ memberIds, fromDay: from, toDay: to, projectIds }),          // from time_entries WHERE source='manual'
]);
const memberIdsInResult = [...new Set(rawRows.map((r) => r.member_id))];   // <-- built from rawRows ONLY
```
`memberIdsInResult` — which feeds the name/timezone/pay-rate maps the aggregation needs — is computed **only from `rawRows`** (the tracked-session rows), never from `manualRows`. A member who has **only** a manual entry in the range (the exact case manual time exists for: covering a day nothing was tracked) has no row in `rawRows`, so they're absent from `nameMap`/`tzMap`/`rateMap`, and their manual entry has nowhere correct to land when `buildTimeAndActivityReportPayload` bucket it in. This is a real, well-isolated bug.

**Fix:** `memberIdsInResult` must be the union of both: `[...new Set([...rawRows, ...manualRows].map((r) => r.member_id))]`.

**Root cause — no budget-limit restriction:** not yet located. Needs: does `add-manual-entry-dialog.tsx` (or its submit handler) check the target project's remaining budget/hours before allowing a manual entry to be saved? A quick read of that dialog's submit path will confirm; if there's no check today, one needs adding against the same `computeProjectSpentPg`/budget-row data the project page already uses.

**Root cause — no distinct chart color for manual time:** `report-chart.tsx` ([above](#2-chart-tooltip-covers-the-chart-instead-of-appearing-above-it)) draws bars from `TimeActivityDayRow` values with no concept of a "manual" sub-segment at all — there's no second color in `BAR_COLORS`. *Screenshot 194505.png* shows the **target** look (a lighter "Manual" segment stacked on a darker "Tracked" segment, with the tooltip breaking the two out separately) — this appears to be a reference mockup or a different, already-working chart elsewhere, not what `report-chart.tsx` currently renders. **Fix:** extend `TimeActivityDayRow` (or the chart's per-day data) to carry `trackedSeconds`/`manualSeconds` separately, and stack two bar segments per day/member the way the reference screenshot shows, with `renderBar` called twice per bar (tracked color + manual color) instead of once.

### 7. Single-day chart looks broken; peak should sit higher than the chart

**File:** [chart-utils.ts:4-14](Dashboard-Web/features/reports/utils/time-and-activity/chart-utils.ts:4) (`buildYTicks`), used by [report-chart.tsx:75-83](Dashboard-Web/features/reports/components/time-activity-report/report-chart.tsx:75).

**Root cause, confirmed:**
```ts
const pad = maxVal * 0.08;   // only 8% headroom above the tallest value
const top = maxVal + pad;
```
8% headroom is too tight when there's only one bar (or one dominant bar) — the bar nearly touches the top of the plot area, which is exactly what *Screenshot 194614.png* shows, and it's also *why* item 2's tooltip-cutoff is worst on a single-day chart: there's no room above the bar for the tooltip to sit in even once item 2 is fixed.

**Fix:** increase the padding factor (e.g. to 20-25%, or a fixed minimum headroom in absolute units so a very small `maxVal` still gets visible breathing room), and/or special-case `days.length === 1` to guarantee a fixed minimum multiple of headroom regardless of the value. Do this fix **together with item 2** — raising the peak is what actually gives the repositioned tooltip somewhere to go.

### 8. PDF currency doesn't match

**Files:** `Dashboard-Backend/src/modules/reports/build-report-files.js:61` and `Dashboard-Backend/src/modules/reports/report-currency.js`.

**Root cause, confirmed — for scheduled/emailed report PDFs:**
```js
{ label: "Total spent", value: `$${totalSpent.toFixed(2)}` },
```
This is a **literal hardcoded dollar sign**, in the server-side PDF builder used for scheduled report delivery (`buildTimeAndActivityPdf`, called from the report-schedule path — distinct from the browser's "Download PDF" button). The workspace has a whole currency-resolution system (`resolveReportCurrency` in `report-currency.js`, picking the viewer's currency when available and falling back to the org's display currency) that this line completely bypasses.

**Fix:** thread the resolved `displayCurrency` (already computed by `resolveReportCurrency` for the same request) into `buildTimeAndActivityPdf`'s `opts`, and format `totalSpent` with the same money formatter the rest of the report uses, instead of a hardcoded `$`.

**Separate, unconfirmed half:** *Screenshot 191050.png* — which is the **browser-downloaded** PDF (`downloadPdf()` in `time-activity-report-view.tsx`, a different code path that already passes `totals.spent`/`d.totalSpent` and does *not* hardcode `$`) — shows `$0.00` in the header summary next to what looks like `E£0.00` (an EGP glyph, possibly a font/encoding artifact) in the table rows. Since this path doesn't have the hardcoded-`$` bug, the header and the table must be pulling the currency-formatted string from two different `totals`/`d.totalSpent` computations that disagree, or the PDF font (`report-pdf-kit.ts`) doesn't render the EGP `£` glyph correctly. **Needs a side-by-side read of how `totals.spent` and `d.totalSpent` are each formatted** in `use-time-and-activity-report.ts` to find where they diverge — I traced the hardcoded-`$` bug fully but did not trace this second one to a line.

---

## Work Sessions Reports

### 9. Filter popup — selections and Select all / Clear all buttons

**Files:** [work-sessions-filters-panel.tsx](Dashboard-Web/features/reports/components/work-sessions/work-sessions-filters-panel.tsx) (UI) → [use-work-sessions-report.ts:311-314](Dashboard-Web/features/reports/hooks/use-work-sessions-report.ts:311) (handlers).

**Root cause, confirmed — and this is the standout bug in this whole list:**
```ts
const selectAllProjects = useCallback(() => setProjectFilter(null), [])
const selectAllMembers = useCallback(() => setMemberFilter(null), [])
const clearProjects = useCallback(() => setProjectFilter(null), [])   // <-- identical to selectAll
const clearMembers = useCallback(() => setMemberFilter(null), [])     // <-- identical to selectAll
```
`projectFilter === null` means **"nothing excluded, show everything"** per the checkbox render logic two lines up in the panel (`const on = projectFilter === null ? true : projectFilter.has(p)`). So **"Clear projects" and "Select all" currently do exactly the same thing** — clicking "Clear" re-selects every project instead of deselecting them. This is a straight copy-paste bug, not a design ambiguity.

**Fix:**
```ts
const clearProjects = useCallback(() => setProjectFilter(new Set()), [])
const clearMembers = useCallback(() => setMemberFilter(new Set()), [])
```
One-line fix each, once the empty-Set semantics are confirmed to mean "show nothing" consistently elsewhere in this hook (worth a quick check of how `projectFilter` is consumed downstream to make sure an empty Set is handled as "none selected" rather than accidentally falling back to "all" the same way `null` does).

### 10. Table needs: column customization, max-rows setting, internal scroll

**File:** [work-sessions-report.tsx](Dashboard-Web/features/reports/components/work-sessions/work-sessions-report.tsx).

Not yet located in detail. This is new functionality, not a bug fix — three separate additions:
- **Column customization**: the Time & Activity report already has this (`column-picker.tsx` in the same `features/reports` tree) — reuse that component/pattern rather than building a new one.
- **Max rows per expandable group**: needs a cap (configurable or fixed) on how many rows render under a group header before the rest require explicit expansion.
- **Internal scrollbar**: wrap the table body in a fixed-height scrollable container instead of letting it grow the page — same pattern already used in `customer-accounts-page.tsx`'s table (`overflow-auto` on a bounded container) from the previous session, or wherever else in this codebase a table already scrolls internally.

---

## Apps & URLs Reports

### 11. Chart needs fixing; row-per-table limit

**File:** [apps-urls-report.tsx](Dashboard-Web/features/reports/components/apps-urls/apps-urls-report.tsx).

**Ambiguous — needs your confirmation.** The live page (*Screenshot 193908.png*) has **no chart at all**, only a table with a truncation banner ("This range holds more activity than the report will read..."). The only chart tied to this report exists in its **PDF export** ([apps-urls-report.tsx:218-231](Dashboard-Web/features/reports/components/apps-urls/apps-urls-report.tsx:218)) — a top-10-apps bar chart built via the same `report-pdf-kit.ts` used everywhere else, so it likely inherits whatever chart issues get found/fixed there (points, scaling — see items 2, 3, 7). Please confirm: is the "chart" in the bug report this PDF chart, or is there an on-screen chart on this page I haven't found? If it's a different chart, I'd need a fresh screenshot or a pointer to where it lives.

**Row-per-table limit:** same ask as item 10 — no client-side max-rows control exists on this table today; the `truncated` flag ([line 158](Dashboard-Web/features/reports/components/apps-urls/apps-urls-report.tsx:158)) is a server-side "there's more data than we read" warning, not a user-configurable display cap. Build alongside item 10 if the same mechanism applies to both reports.

---

## Manual Requests

### 12. Approved manual time requests aren't reflected in project budget, reports, or anywhere else

**Root cause, confirmed:** approving a manual time request ([PendingManualTimeQueue.tsx:51](Dashboard-Web/features/timesheets/components/approvals/components/PendingManualTimeQueue.tsx:51) → `approveTimeEntry` → `updateTimeEntry(id, { status: "approved" })`) only flips the `time_entries.status` column — the row already existed as `status: 'pending'` from the moment it was created.

The project-budget calculation (`computeProjectSpentForAllPg`, `Dashboard-Backend/src/lib/postgres/projects-postgres.service.js:699-727`) already unions `time_entries` into its tracked-seconds total with `WHERE te.status != 'rejected'` — meaning **pending manual entries already count toward budget spend before approval**, and approving doesn't change that number at all. If the actual complaint is "approved requests never show up," the budget path isn't where to look — **this is the same bug as item 6**: `getTimeAndActivityReportRowsPg`/`getManualTimeEntryRowsPg`'s member-union gap in `routes.js:228` means a member whose only activity in a range is a manual entry (pending or approved, doesn't matter) is dropped from the **report**, even though the **budget** calc would have counted them correctly. Fix item 6's `memberIdsInResult` union and re-verify this item — it may resolve without separate work. If it doesn't, the next place to check is whichever specific "Reports, everything else" surface the user has in mind that I haven't covered above.

**Open question worth resolving with the budget logic while touching this:** should a *pending* (not yet approved) manual entry count toward budget spend at all? Today it does (`!= 'rejected'` includes `'pending'`). If the intent is "only approved time counts," that's a one-word change (`= 'approved'`) with real behavioral consequences worth confirming rather than guessing.

---

## Shift Attendance

### 13. Fix based on real-time limits and days of the members

**File:** `Dashboard-Backend/src/lib/postgres/misc-reports-postgres.service.js:519` (`getShiftAttendanceRowsPg`).

This report is **deliberately scoped**, per its own doc comment directly above the function:
> "There is no shift table in this schema — no start or end times anywhere — so this cannot report lateness or an abandoned shift, and does not pretend to. What it can say is whether a day was expected, whether anything was tracked, and whether an empty expected day was excused."

It already uses each member's `work_days` (from `time_settings`) to know which days are expected, and already excuses approved leave and agreed makeup days. **What it does not use at all: the `limits` table (daily/weekly hour caps).** "Real time limits" in the bug report most plausibly means: a day should be judged not just worked/not-worked but against whether the member's configured daily-hours limit was actually met, which this query never references.

**This needs a product decision before implementation, not just a code fix**: does "real time limits" mean (a) flag a day as short/incomplete if tracked hours fell below the member's daily limit, on top of the existing worked/no-show/excused states, or (b) something about actual shift start/end times, which — per the schema's own honest comment — doesn't exist anywhere in this product and would be new scope (a shift-times table), not a bug fix. I'd want this clarified before scoping effort, since (a) is a moderate addition to an existing query and (b) is a new feature.

---

## People Page

### 14. Fix all Batch Actions

**Files:** [batch-actions-dropdown.tsx](Dashboard-Web/features/members/components/menus/batch-actions-dropdown.tsx) (menu, structurally fine — six actions: pay rate, bill rate, pay period, work time & limits, remove from tree, remove member), [batch-edit-modal.tsx](Dashboard-Web/features/members/components/modals/batch-edit-modal.tsx) (the modal each action opens), `Dashboard-Backend/src/http/batch-member-actions.js` (permission gate only — `canUseBatchMemberActions`/`assertMembersRemovable`, no actual mutation logic in this file).

**Not yet reproduced.** "All of them" needs to be broken down per-action to be actionable — I did not find an obvious bug in the menu itself or the permission gate. The actual per-field batch-update mutation logic lives somewhere I haven't traced yet (likely a batch endpoint in `Dashboard-Backend/src/modules/members/routes/`). **This is the item I'd most want to drive interactively** (open the People page, select a few members, run each of the six actions, and see which ones actually fail vs. which "work" but write the wrong thing) rather than guess at six separate root causes from static reading.

### 15. "Organization" filter/scope not working in the members tree list

**File:** [member-tree-page.tsx](Dashboard-Web/features/members/pages/member-tree-page.tsx) — confirmed this is the "Organization" vs "Team" **scope toggle** ([lines 207, 246-249, 317-339](Dashboard-Web/features/members/pages/member-tree-page.tsx:207)), not a filter dropdown field:
```tsx
const organizationTree = useMemberTreeData("organization", handleTreeError)
const activeTree = viewScope === "organization" ? organizationTree : teamTree
```
Located the toggle and its data hook (`useMemberTreeData`); did not trace into that hook or its backend query to find why switching to "Organization" scope doesn't work as expected — needs on-screen reproduction (does it show nothing, show the wrong subset, or error?) to know whether the bug is in `useMemberTreeData`'s query, the `validRootIds` computation used alongside it ([line 293](Dashboard-Web/features/members/pages/member-tree-page.tsx:293)), or something else.

### 16. Add ability to create nodes in the tree

New functionality, not a bug. Needs a design decision on what "create a node" means operationally here (add a placeholder member? add a team/group node distinct from a member? reparent an existing member under a new position?) before scoping — the tree view files ([member-tree-page.tsx](Dashboard-Web/features/members/pages/member-tree-page.tsx), [member-tree-connections-view.tsx](Dashboard-Web/features/members/pages/member-tree-connections-view.tsx)) are read-only rendering today as far as I traced; there's no existing "add node" affordance to extend.

### 17. Fix tree-connection display in both views

**File:** [member-tree-connections-view.tsx](Dashboard-Web/features/members/pages/member-tree-connections-view.tsx) (243 lines) and the tree view inside [member-tree-page.tsx](Dashboard-Web/features/members/pages/member-tree-page.tsx). Not yet root-caused — "both" implies two distinct rendering paths that need the same fix, or two different bugs; needs on-screen reproduction to tell which.

### 18. Seats indicator on the Members table header

**Ask:** show `(Number) Seats || (Number) Occupied || (Number) Open` next to the Members table header.

**No existing concept of a main-org seat limit anywhere in the schema** — confirmed by search. However, the customer-accounts tenancy work from the previous session already built exactly this shape of column onto `tenants` (`tenants.seat_limit INT`), and the main tenant's row already exists with `seat_limit = 2147483647` (effectively unlimited, per `ensure-tenancy-schema.js`'s `CONTROL_PLANE_DDL`) plus a working used-seats query pattern (`assertSeatAvailable` in `Dashboard-Backend/src/modules/customer-accounts/tenant.service.js`, counting `status = 'active'` members + `status = 'pending_signup'` invites).

**Fix, reusing that infrastructure:**
1. Make the main tenant's `seat_limit` a real, settable number (a new small settings surface — likely alongside wherever the org's other plan/subscription-shaped settings live, if any exist, or a new one) instead of the current unlimited placeholder.
2. Add a small backend endpoint (or extend an existing members-list endpoint) returning `{ seatLimit, seatsUsed, seatsOpen }` for the caller's own tenant, using the same counting SQL already proven in `assertSeatAvailable`.
3. Render it next to the "Members" header in `members-page.tsx`, in the format specified.

This is genuinely smaller than it looks because the seat-counting mechanism was already built — it just needs the main tenant's limit to become configurable rather than infinite, and a small UI surface.

---

## Dashboard — Command Center

### 19. Team Utilization needs to actually work; rename the metrics

**Files:** [team-utilization-section.tsx](Dashboard-Web/features/dashboard/components/command-center/components/team-utilization-section.tsx) (UI, real — not a stub) → `Dashboard-Backend/src/modules/dashboard/command-center-service.js:87-133` (`buildUtilization`).

**Root cause, confirmed:**
```js
for (const [memberId, seconds] of memberSeconds.entries()) {
  const capacity = capacityByMember.get(memberId) ?? 0;
  if (capacity <= 0) continue;   // <-- silently skipped
  ...
}
```
`capacityByMember` comes from `getMemberWeeklyCapacityPg(null)` ([line 379](Dashboard-Backend/src/modules/dashboard/command-center-service.js:379)) — almost certainly reading `limits.weekly` per member. Any member with no weekly-hours limit configured (the schema default is `0`, and plenty of orgs run with "no cap" rather than an explicit weekly number — confirmed this is a normal, supported mode elsewhere, e.g. `homeStats.ts`'s `weeklyHours > 0` checks from the earlier session) is **silently excluded from the widget entirely**. For any org that doesn't strictly configure a weekly limit on every member, this reads as "broken" — 0%, 0 members in every bucket — when it's actually "everyone got skipped."

**Fix:** decide what a member with no configured weekly limit should do here — the two honest options are (a) exclude them from the *percentage* but still count them somewhere visible ("no limit set" bucket) rather than vanishing silently, or (b) fall back to a sane default capacity (e.g. 40h) so they're included at all. I'd lean toward (a) — inventing a default capacity for someone who deliberately has none configured would produce numbers nobody asked for.

**"Even change the naming metrics":** the three buckets today are Optimal Load / Over Capacity / Underutilized, at the 60%/100% thresholds hardcoded in `buildUtilization` ([lines 101-110](Dashboard-Backend/src/modules/dashboard/command-center-service.js:101)). This needs you to say what names/thresholds you actually want — I can wire whatever labels and cutoffs you specify, but "even change the naming" isn't itself a spec.

### 20. Recent Activity Feed needs to be recreated so everything works and updates; needs a life-cycle limit

**Files:** [activity-feed-section.tsx](Dashboard-Web/features/dashboard/components/command-center/components/activity-feed-section.tsx) → `Dashboard-Backend/src/modules/dashboard/command-center-service.js:509` (`globalActivityFeed`).

**Confirmed, small bug:** the "..." (`MoreHorizontal`) button on each non-screenshot feed item ([activity-feed-section.tsx:109](Dashboard-Web/features/dashboard/components/command-center/components/activity-feed-section.tsx:109)) has no `onClick` at all — dead UI. Needs either a real menu (matching whatever action the design intends) or removal if nothing is meant to happen there yet.

**Confirmed — no time-based expiry:**
```js
const globalActivityFeed = [...globalFeed, ...doneTaskFeed].slice(0, 8);
```
The feed is capped at a **fixed count of 8**, with no age cutoff. "Limit of life so when cycle passes the notification in it ends" reads as wanting a **time-based** cutoff (e.g., nothing older than today / the last 24h / one work cycle) rather than a count-based one — today, if fewer than 8 things happened recently, older items from a previous day linger to fill the slot. **Fix, pending confirmation of what "cycle" means (a calendar day? a rolling 24h window? a work week?):** add a `WHERE occurred_at >= <cutoff>` alongside the existing `slice(0, 8)`, so both the count cap and the age cap apply together.

**"Needs to be recreated for everything in it to work"** — beyond the dead "..." button and the missing expiry, I did not find further concrete breakage reading the code statically; this needs on-screen reproduction to know what else in the feed doesn't actually update or work as intended.

---

## Summary table

All items are implemented on `fix/bugs-round-1`: round 1 is commit b292891, round 2 is 517b325a, and round 3 is the commit after it (seat enforcement, tenant stamping, the seat-limit editor, and "+" in the chart view).

| # | Area | Status |
|---|---|---|
| 1 | TopBar search | Done (r1): grows to max-w-xl, and the results menu has a minimum width so rows stay readable |
| 2 | T&A tooltip position | Done (r1, r2): anchored above the bar with a CSS transform, and placed beside tall bars; checked in the browser |
| 3 | Members PDF | Done: every point is labelled (r1). The "by member" chart now uses real per-member totals (r2); it had been plotting projects |
| 4 | Onboarding email link | Done (r1): FRONTEND_ORIGIN is trimmed and validated |
| 5 | Filter click errors | Done (r2): full-screen click-catcher overlays swallowed the next click. Removed in favour of an outside-mousedown listener; checked in the browser |
| 6 | Manual time | Done: report totals (r1). Chart stacks manual time in its own colour, and the manual-entry project budget is enforced for hours-based per-project budgets (r2) |
| 7 | Single-day chart | Done: 22% headroom (r1). The axis now rounds up rather than down, and bars are capped at 72px wide (r2) |
| 8 | PDF currency | Done (r1) |
| 9 | Work Sessions Select/Clear all | Done (r1) |
| 10 | Work Sessions table | Done (r2): rows-per-group limit (10/25/50/All) with "Show more", internal scroll, sticky header, "Columns" menu |
| 11 | Apps & URLs row limit | Done (r2): 10 rows per group with "Show more", internal scroll, sticky header. "The chart" was read as the PDF chart, fixed under #3 |
| 12 | Approved manual requests | Fixed by #6: approving only flips the status, and budget/reports already count everything that isn't rejected. Open question: should *pending* manual time count toward the budget? |
| 13 | Shift Attendance | Done (r1): judged against limits.daily, with a new "short" state |
| 14 | Batch Actions | Done (r2): partial pay/bill updates no longer zero the fields they didn't send; counts come from the ids actually submitted; removed "Edit bill rate", which had no backing field |
| 15 | Organization scope in tree | Done (r2): the org tree only loads for roles that are allowed it, and errors are kept per scope |
| 16 | Add nodes to tree | Done (r2, r3): a "+" on each node sends invites that place the new member under that node on acceptance (`invites.tree_parent_member_id`, checked against the inviter's manage scope). In the list view the "+" is a button on each card; in the connections chart it appears on hover (r3). Clients never get one |
| 17 | Tree connection display | Done (r2): one parent per member, stray branches are rendered, and dragging no longer steals clicks (capture starts after a 4px threshold) |
| 18 | Seats indicator | Done (r2, r3): header readout, plus a "Set seat limit" editor for main-org Owners/Super Admins (`PATCH /api/members/seats`; can't go below the seats in use). r3 also made limits actually enforced: `assertSeatAvailable` had never been called, so no limit was enforced anywhere. Every invite/add path now runs `withSeatsAvailable` and stamps the inviter's `tenant_id` (they had defaulted to the main org). A used seat is an active member, a pending invite or a pre-provisioned account |
| 20 | Team Utilization | Done (r1) |
| 21 | Recent Activity Feed | Done (r1) |
