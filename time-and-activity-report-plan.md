# Time & Activity Report — Plan

Goal: pick member X, pick date range (e.g. Day 2 → Day 3), get total hours + per-day hours + idle time.

**Status: Export/Send/Schedule and the report itself are built and wired (see bottom of doc for what shipped).** Remaining work below.

## Known gap: per-member timezone — BUILT

No timezone value exists anywhere in the data model today — not per-member, not per-org. The one place it *appears* in the UI (Settings → Company Information "Time Zone" field, the "MDT" label on report headers) is decorative — hardcoded, no `onChange`, nothing persisted. Postgres connections are pinned to UTC deliberately ([client.js:15](Dashboard-Backend/src/lib/postgres/client.js:15)), so every "day" boundary in this report is currently a UTC day, not the viewed member's actual calendar day.

Considered three options; **decided: per-member timezone** (most accurate, worth the larger change over an org-wide setting).

### Why this is smaller than it sounds
The report reads straight from `activity_sessions`, which stores real per-session `TIMESTAMPTZ` values — not from the `daily_member_active_seconds` rollup (that table intentionally buckets by "the UTC day the sync ran on," a deliberate fix for a *different* bug — midnight-crossing sessions — and is used by other already-shipped features like dashboard widgets). **This fix is scoped to the Time & Activity report only; the rollup table and anything reading it keeps today's UTC-day behavior untouched.**

No new dependency needed — verified Node's built-in `Intl.DateTimeFormat` handles arbitrary IANA timezone conversion natively (`new Intl.DateTimeFormat('en-CA', { timeZone: tz, ... })` gives a clean local `YYYY-MM-DD`), full ICU is present in this Node version. Converting UTC → local is the easy direction; the plan below only ever does that direction, never local → UTC, so no timezone library is required.

### Data model
- `members.timezone` — new Firestore field on the member doc (IANA string, e.g. `"America/Los_Angeles"`), alongside `first_name`/`last_name`/`work_email` which already go through [member-profile.service.js](Dashboard-Backend/src/modules/members/services/member-profile.service.js) — same update path, one more field.
- Missing/unset → treated as `"UTC"`. This is the current behavior, so nothing regresses for a member who hasn't set one — accuracy improves person by person as each member sets theirs, not a hard cutover for the whole org.

### Where it gets set
Self-service on the member's own Profile page — each person knows their own timezone; no admin has to guess it for them. On first save, if empty, default the field client-side to `Intl.DateTimeFormat().resolvedOptions().timeZone` (the browser already knows this) so most members never have to think about it — an editable dropdown lets them override.

### Checked the actual code that was built — found a second, related bug

Went back through [time-and-activity-report-postgres.service.js](Dashboard-Backend/src/lib/postgres/time-and-activity-report-postgres.service.js) with this rework in mind and found the current SQL has its own day-attribution bug, independent of timezone:

```sql
to_char(date_trunc('day', s.started_at), 'YYYY-MM-DD') AS day, ...
SUM(s.active_seconds) ...
GROUP BY day, s.member_id, ...
```

Every `activity_sessions` row is **one continuous session** from `started_at` to `ended_at` — confirmed by reading [activity-events-postgres.service.js:331](Dashboard-Backend/src/lib/postgres/activity-events-postgres.service.js:331) (`createPgSession`/`UPDATE activity_sessions`, one row per session, totals updated in place over the session's life). A session that runs from 11:40pm to 12:20am — anyone working late — gets **100% of its active/idle seconds attributed to the day it started**, none to the day it actually continued into.

This is exactly the bug `daily_member_active_seconds` was already built to avoid, per the comment at [schema.sql:446](Dashboard-Backend/src/lib/postgres/schema.sql:446) ("fixes the midnight-crossing bug where summing a session's active_seconds by started_at attributed a session that crossed midnight entirely to the day it started") — that fix works by recording deltas in real time as the session progresses, not by reconstructing from `started_at` after the fact, which is exactly what my SQL does. I reintroduced the bug the rest of the codebase already solved, just in a new place.

**This turns out to be the same rewrite as the timezone fix, not a second one** — both problems are "day boundaries computed wrong from `started_at`," and both get fixed by moving day-bucketing out of SQL and into a read-time JS step that has the full session interval to work with.

### Backend rework (Time & Activity report only) — revised

1. [time-and-activity-report-postgres.service.js](Dashboard-Backend/src/lib/postgres/time-and-activity-report-postgres.service.js) — drop `GROUP BY`/`date_trunc` entirely. Each `activity_sessions` row is already atomic, so this becomes a plain `SELECT` (with task/project joins) of matching rows — `started_at`, `ended_at`, `active_seconds`, `idle_seconds`, per member/task/project, no day bucket. Widen the `WHERE` window by ±24h on each side (covers every UTC offset, -12 to +14) so a session near a local-day edge isn't excluded before timezone conversion gets to see it.
2. [build-time-and-activity-rows.js](Dashboard-Backend/src/modules/reports/build-time-and-activity-rows.js) — new day-splitting step, one function doing both jobs at once:
   - Look up each member's timezone (new small `getMemberTimezones(db, memberIds)` helper in the reports module — deliberately **not** extending the shared `buildMemberMetaMap` in `activity-scope.js`, which other unrelated features also call; keeping this isolated to reports is a smaller, safer diff than changing a shared utility's output shape for one caller. `ponytail:` costs one extra small Firestore batch-read per report call versus merging into the existing name lookup — fine at this call volume, revisit if reports become hot-path.)
   - For each session row: resolve its local calendar day(s) via `Intl.DateTimeFormat('en-CA', { timeZone })` on `started_at` and `ended_at ?? updated_at` (open/still-running sessions have no `ended_at` yet — `updated_at` reflects the last sync tick, same value the rest of the app already treats as current truth; abandoned sessions get closed by [abandoned-session-sweep.service.js](Dashboard-Backend/src/modules/activity/abandoned-session-sweep.service.js) so this shouldn't see stale multi-day-old open rows in steady state).
   - Single-day session (the common case) → attribute all seconds to that day, no math needed.
   - Multi-day session (spans local midnight) → split `active_seconds`/`idle_seconds` proportionally by each day-segment's share of the session's wall-clock duration. This assumes activity was roughly even through the session — an approximation, not exact — but is a large correctness improvement over all-or-nothing, and it's the only signal available without changing what the tracker records. Only affects sessions that actually straddle a local midnight; most don't.
   - Drop any resulting day outside the requested `[from, to]`, then group by (localDay, memberId) same as before.
3. [date-range-kind.js](Dashboard-Backend/src/modules/reports/date-range-kind.js) — `resolveDateRangeKind` (Schedule runner) resolves "last 7 days" etc. against the schedule's target member's timezone, same `"UTC"` fallback when unset.

One rewrite covers Report view, Send, and Schedule at once — all three already share `loadTimeAndActivityReportPayloadForMemberIds` → `getTimeAndActivityReportRowsPg` + `buildTimeAndActivityReportPayload`, so fixing the source fixes every caller.

### Explicitly out of scope for this pass
- `daily_member_active_seconds` rollup and anything reading it (dashboard widgets, etc.) — keeps current UTC-day, whole-session-bucket semantics. Changing that changes already-shipped behavior elsewhere and is a separate, riskier change. Its own midnight-crossing problem was already solved differently (real-time deltas) and isn't reopened here.
- Org-level timezone setting — not building this now that per-member was chosen; the decorative Company Information field stays decorative for now.
- Exact (non-proportional) session splitting — would need the tracker itself to record activity at finer granularity than one active/idle total per session; not changing the tracker's write path in this pass.

## Current state

### Frontend (Dashboard-Web) — UI built, not wired
Report UI already exists, fully typed, fully rendered:
- [features/reports/components/time-activity-report/](Dashboard-Web/features/reports/components/time-activity-report/) — table, per-day rows, member sub-rows, chart, date-range picker, member filter dropdown, column picker
- [features/reports/models/time-and-activity.ts](Dashboard-Web/features/reports/models/time-and-activity.ts) — `TimeActivityDayRow` / `TimeActivityMemberSubRow` already have `totalHours`, `activityPct`, `idlePct`, `idleHr`, `trackedHours`, `manualHours`
- [features/reports/hooks/use-time-and-activity-report.ts](Dashboard-Web/features/reports/hooks/use-time-and-activity-report.ts) — member filter, sort, column visibility, totals calc, all client-side logic ready

Problem: entry point ships hardcoded empty data, no fetch exists.

```ts
// Dashboard-Web/features/reports/components/app/TimeAndActivity.tsx:39
/** Empty default payload until report data is loaded from the API. */
export function buildDefaultTimeActivityReportData(): TimeActivityReportData {
  return { days: [], memberRows: {} }
}
```

No API client file for this report (compare to [features/reports/hooks/use-work-sessions-report.ts](Dashboard-Web/features/reports/hooks/use-work-sessions-report.ts) which is the sibling "Work Sessions" report — check if that one is wired, could be the pattern to copy).

### Backend (Dashboard-Backend) — no endpoint, but data already tracked
No route matches `time-and-activity` / `time-activity` anywhere in `src/modules`.

Data needed already exists in Postgres:

| Table | Columns | Use |
|---|---|---|
| `activity_sessions` | `member_id, task_id, project_id, started_at, ended_at, active_seconds, idle_seconds` | per-session source of truth, has idle |
| `daily_member_active_seconds` | `member_id, day, active_seconds` | pre-rolled daily total per member, midnight-safe |
| `daily_member_task_active_seconds` | `member_id, task_id, day, active_seconds` | pre-rolled daily total per member+task |
| `task_member_progress` | `member_id, task_id, active_seconds, idle_seconds, last_started_at, last_activity_at` | live per-task tracking row (current/open task state) |

Schema: [Dashboard-Backend/src/lib/postgres/schema.sql:426](Dashboard-Backend/src/lib/postgres/schema.sql:426) (`activity_sessions`), :450 (`daily_member_active_seconds`)

Existing helper to copy the pattern from:
```js
// Dashboard-Backend/src/lib/postgres/activity-events-postgres.service.js:450
export async function sumDailyMemberActiveSeconds(memberId, { fromDay, toDay })
```
Sums active seconds over an inclusive day range for one member. No idle equivalent yet — idle only lives per-session in `activity_sessions`, has to be summed from there (filter `started_at` in range).

No daily idle rollup table exists — fine for range queries (just group `activity_sessions` by day), but note it individually since it's the one piece with no pre-aggregation.

## Gap
1. No backend endpoint that: takes `member_id` + `from`/`to` date range → returns per-day rows (active hours, idle hours, task breakdown) matching `TimeActivityReportData` shape.
2. No frontend fetch/API client wiring `useTimeAndActivityReport` up to real data — currently always empty.

## Proposed approach (minimal)
1. Backend: one route, e.g. `GET /reports/time-and-activity?memberId=&from=&to=`
   - Query `activity_sessions` grouped by day (`date_trunc('day', started_at)`) for the member+range, sum `active_seconds`/`idle_seconds`, join `tasks`/`projects` for labels
   - Reuse `sumDailyMemberActiveSeconds`-style query, extend with idle sum — don't build a new aggregation framework, one SQL query with `GROUP BY` covers day+member+task grouping
   - Shape response to match `TimeActivityDayRow` / `TimeActivityMemberSubRow` directly so frontend mapping is trivial
2. Frontend: add fetch in `features/reports/api/` (mirror `task-time-tracking-api.ts` pattern), call it from wherever `TimeAndActivityReport()` is mounted, pass real `days`/`memberRows` into the existing hook — no changes needed to the hook itself, it already handles filtering/sorting/totals

## Wiring check — backend to frontend, verified against the real request/response convention

Went through the actual plumbing this app uses end to end (not assumed) by reading [handle-request.js](Dashboard-Backend/src/app/handle-request.js), [activity/routes.js](Dashboard-Backend/src/modules/activity/routes.js), [task-time-tracking-api.ts](Dashboard-Web/features/tasks/api/task-time-tracking-api.ts), and [http.ts](Dashboard-Web/infrastructure/api/http.ts). Found the concrete contract, and two real gaps in the "minimal approach" above that would've broken it.

### The contract (confirmed, not guessed)
- **Route registration**: every module route is a `routeX(req, res, url, db, origin)` function, imported and called in sequence inside [handle-request.js](Dashboard-Backend/src/app/handle-request.js) (see `routeActivity`, `routeTasks` — same file, ~line 190-200). New endpoint needs a `routeReports` (or extend an existing reports route file) added to that same import+dispatch list — it does not register itself.
- **Path**: backend strips `/api/v1/` → `/api/...` ([activity/routes.js:177](Dashboard-Backend/src/modules/activity/routes.js:177)), so the route should match on `/api/reports/time-and-activity`, not the bare `/reports/...` used as shorthand earlier in this doc.
- **Auth**: `readIdToken(req, url)` + `resolveMember(db, req)` → `viewer { memberId, roleName }`, same as every other authenticated GET (e.g. [activity/routes.js:187-198](Dashboard-Backend/src/modules/activity/routes.js:187)). 401 if missing/invalid token, 404 if member not found. Frontend side: `apiFetch` ([http.ts](Dashboard-Web/infrastructure/api/http.ts)) already attaches the Firebase ID token automatically via `bearerAuthHeaders` — no extra work needed there, just use `apiFetch`, not raw `fetch`.
- **Permission scoping**: mirror [tasks/routes.js:345](Dashboard-Backend/src/modules/tasks/routes.js:345) `getManagementTaskTrackingRows(db, viewer.memberId, viewer.roleName, filters)` — the query param `memberId` is only honored if `isManagementRole(viewer.roleName)`; otherwise the endpoint silently scopes to `viewer.memberId` regardless of what's in the query string. Without this, any member could pull any other member's hours by editing the URL.
- **Response envelope**: `{ success: true, data: ... }` / `{ success: false, error: ... }` — matches `ApiEnvelope<T>` already defined in [http.ts:38](Dashboard-Web/infrastructure/api/http.ts:38). Frontend unwraps with `json.data ?? null`, same as every existing `*-api.ts` file.
- **Frontend client**: new file `features/reports/api/time-and-activity-api.ts`, same shape as [task-time-tracking-api.ts](Dashboard-Web/features/tasks/api/task-time-tracking-api.ts) — `apiFetch(apiPath("/api/reports/time-and-activity?..."))`, `try/catch` returning `null`/`[]` on failure (existing convention, not a new error-handling pattern).

### Gap #1 (real, would've silently broken): backend should send raw seconds, not formatted strings
`TimeActivityDayRow`/`TimeActivityMemberSubRow` want `totalHours`/`idleHr` as `"H:MM:SS"` strings — but formatting on the backend would create a second formatter to keep in sync with the frontend one. It already exists client-side: `formatSecondsAsHMS` in [row-aggregate.ts:12](Dashboard-Web/features/reports/utils/time-and-activity/row-aggregate.ts:12) (there's also a near-duplicate `formatDurationHms` in [format-duration-hms.ts](Dashboard-Web/features/reports/utils/format-duration-hms.ts) — pick one, don't add a third). Backend returns raw `activeSeconds`/`idleSeconds` per day/member (matches how `TaskTimeTrackingRecord` already does it elsewhere), and the new `time-and-activity-api.ts` client maps seconds → the display-string shape before handing it to the hook. Keeps one formatter, one source of truth, matches existing convention (nothing over the wire is pre-formatted today).

`totalSpent` (dollar amount) needs a billing/pay rate, which isn't part of this feature — out of scope, return `"$0.00"` placeholder until a rate source is picked, don't build billing math into this endpoint.

### Gap #2 (real, blocks the feature outright): the date range picker doesn't actually keep the picked dates
Checked [time-activity-report-view.tsx:108-119](Dashboard-Web/features/reports/components/time-activity-report/time-activity-report-view.tsx:108) — `ReportDateRangePicker` is wired to `onApply={(lbl) => setDateLabel(lbl)}`, which only stores the **formatted label string** ("Mar 16 - Mar 22"), not the actual `Date` objects. The picker component supports an `onApplyRange(start, end)` callback that returns real `Date`s ([date-range-picker.tsx:26](Dashboard-Web/features/reports/components/time-activity-report/date-range-picker.tsx:26)) — `StandardReportLayout` uses it ([standard-report-layout.tsx:271](Dashboard-Web/features/reports/components/app/standard-report-layout.tsx:271)), but `TimeActivityReportView` never wires it up. Right now there is no machine-readable date range anywhere in this component — nothing to send as `from`/`to` even after the fetch exists.

Same issue one level up: `useTimeAndActivityReport({ days, memberRows })` takes `days`/`memberRows` as static props from its parent and only manages *display* state (sort, filter, expanded rows) internally — there's no owner of "what range/member should we fetch for" that a `useEffect` could key off of.

**Fix, scoped minimally**: add `onApplyRange` alongside the existing `onApply` in `time-activity-report-view.tsx` to capture real `start`/`end` Date state. Move that state (and `memberFilter`, which already exists and is fine) up to `TimeAndActivityReport()` in [TimeAndActivity.tsx](Dashboard-Web/features/reports/components/app/TimeAndActivity.tsx) — that's the component that should own the fetch (`useEffect` on `[start, end, memberFilter]` calling the new API client), then pass the resulting `days`/`memberRows` down as props, same as today. No change to the display/sort/filter logic inside the hook — only where the range state lives.

This also means the earlier Phase 2/3 (Send/Schedule) `from`/`to` fields have a real source now — read from this same lifted state instead of re-deriving date range some other way.

## Open questions
- Is "Work Sessions" report ([use-work-sessions-report.ts](Dashboard-Web/features/reports/hooks/use-work-sessions-report.ts)) already wired to a real endpoint? If yes, copy that wiring pattern instead of inventing a new one.
- Multi-task days: does the UI need per-task breakdown within a day, or just per-member? (`daily_member_task_active_seconds` table exists if per-task is needed)
- Manual time entries (`manualHours` field exists in the model) — is manual time entry a real feature yet, or just a placeholder column?

## Add-on: Export / Send / Schedule — current state

Asked directly: none of these do the real thing yet. All UI, no backend.

**Two different header implementations exist**, not shared:

1. [StandardReportLayout](Dashboard-Web/features/reports/components/app/standard-report-layout.tsx:132) — used by `reports-timesheet-approvals` and other simple report pages. Has real-ish Export, decorative Send/Schedule:
   - **Export** ([standard-report-layout.tsx:199](Dashboard-Web/features/reports/components/app/standard-report-layout.tsx:199) `runExport`) — dropdown has "To CSV" (builds a `Blob` client-side, real file download, but of demo placeholder data — `"Report,Range\nDemo,..."`, not the actual rows) and "Print / PDF" (just calls `window.print()` — browser print dialog, not a generated PDF file). **No QuickBooks export anywhere.**
   - **Send** → opens [ReportSendDialog](Dashboard-Web/features/reports/components/amounts-owed/report-send-dialog.tsx) — form UI (emails, subject, message, file type). `handleSend()` validates the fields then just closes the dialog. No fetch call, no email sent.
   - **Schedule** → opens [ReportScheduleDialog](Dashboard-Web/features/reports/components/amounts-owed/report-schedule-dialog.tsx) — form UI (emails, name, date range, frequency, delivery time). `handleSave()` validates then closes the dialog. No fetch call, nothing persisted, no recurring job created anywhere.

2. [TimeActivityReportView](Dashboard-Web/features/reports/components/time-activity-report/time-activity-report-view.tsx:138) — what the actual Time & Activity report mounts — has its **own** separate header row with Export/Share/Schedule icon buttons. These have no `onClick` at all — pure decoration, don't even open a dialog. Not wired to `StandardReportLayout` at all despite the name overlap.

**QuickBooks**: the only mention in the whole repo is a "Connect" card in [Settings → Integrations](Dashboard-Web/features/settings/components/integrations/integrations-page.tsx:258) — a logo + name, not wired to anything, not related to reports.

**Reusable building block found**: real backend email sending already exists — [team-weekly-report.service.js](Dashboard-Backend/src/modules/teams/team-weekly-report.service.js) sends actual emails via `sendEmailViaNotify` for a different feature (weekly team digest). That's the pattern to copy for a real "Send report" — not building an email pipeline from scratch.

Nothing found for actual recurring/scheduled delivery (no cron table, no scheduled-report entity in `schema.sql`) — "Schedule" would need real backend state (what to send, to whom, how often) plus something to run on a timer, e.g. same interval-timer pattern `team-weekly-report.service.js` already uses (`setInterval` + `CHECK_INTERVAL_MS`).

## Export / Send / Schedule — real work plan

**Scope confirmed: CSV + PDF only. No QuickBooks.**

Checked every `package.json` in the repo (`Dashboard-Web`, `Dashboard-Backend`, `Notify-backend`, others) — no PDF library anywhere (no `pdfkit`, `puppeteer`, `jspdf`, `pdf-lib`). One new dependency is unavoidable for server-generated PDF; everything else reuses what's already there.

### Phase 1 — Export (real data, real files)

**CSV** — no new dependency, already the right shape:
- Fix [runExport](Dashboard-Web/features/reports/components/app/standard-report-layout.tsx:199) to build the CSV from `sortedDisplayRows`/`memberRows` instead of the hardcoded demo string. Reuse `registerExportHandler` (already exists in `StandardReportLayoutContext`, just nothing registers a handler today) — `TimeActivityReportView` calls it once with a real CSV-builder function.
- `TimeActivityReportView`'s own Export icon ([time-activity-report-view.tsx:140](Dashboard-Web/features/reports/components/time-activity-report/time-activity-report-view.tsx:140)) needs an actual `onClick` — currently none. Point it at the same CSV-builder.

**PDF (client-side/on-demand)** — no new dependency:
- Keep `window.print()`, but it currently prints the whole app chrome (sidebar, nav). Add a print stylesheet (`@media print`) that hides everything except the report table/chart — this is what turns "browser print dialog" into an actually usable "Save as PDF". Native platform feature, ladder rung 4, zero install.
- Wire the same handler into `TimeActivityReportView`'s decorative Schedule/Share icons is NOT needed here — those become the Send/Schedule buttons below instead of separate no-ops.

### Phase 2 — Send (real email, real attachment)

Current `ReportSendDialog` UI is fine, `handleSend()` just needs to actually call something instead of closing the dialog.

1. **Backend endpoint**: `POST /reports/time-and-activity/send` (Dashboard-Backend) — body: `{ memberId, from, to, emails[], subject, message, fileType: "csv"|"pdf" }`
   - Runs the same aggregation query as the Phase-1 report endpoint (see "Proposed approach" above) to get real rows server-side
   - `fileType: "csv"` → build CSV string in Node, no dependency needed
   - `fileType: "pdf"` → needs a real library since there's no headless browser available server-side to reuse the client's `window.print()` trick. Recommend **`pdfkit`** (pure JS, no Chromium download, good enough for a tabular report) over `puppeteer` (needs a full browser install just to render one table — heavier than the problem). One new backend dependency, nothing else.
   - Calls Notify-Backend the same way [team-weekly-report.service.js](Dashboard-Backend/src/modules/teams/team-weekly-report.service.js) does (`sendEmailViaNotify`) — Dashboard-Backend still never touches SMTP directly, per the existing "must not send email directly" rule in [email-client.js:2](Dashboard-Backend/src/lib/notify/email-client.js:2).

2. **Notify-Backend changes**:
   - [transactional-email.js:47](Notify-backend/src/modules/email/transactional-email.js:47) `sendTransactionalEmail` — add an `attachments` param, nodemailer already supports this natively (`{ filename, content }`), just isn't passed through today.
   - Add one new template, e.g. `"report-delivery"`, to the `ALLOWED_TEMPLATES` set in [routes.js:19](Notify-backend/src/modules/email/routes.js:19) and a builder in [email-builders.js](Notify-backend/src/modules/email/email-builders.js) — takes subject/message as plain text (escaped, same as existing templates do with other dynamic fields — not raw HTML, keeps the "no raw HTML from callers" rule intact) + the attachment buffer/filename from Dashboard-Backend.

3. **Frontend**: `handleSend()` in [report-send-dialog.tsx:41](Dashboard-Web/features/reports/components/amounts-owed/report-send-dialog.tsx:41) — after validation, `POST` to the new endpoint with current report's memberId/date-range instead of just closing.

### Phase 3 — Schedule (real recurring delivery)

Same shape as `team-weekly-report.service.js`'s existing pattern, applied to this report:

1. **New table** (add to [ensure-lookup-schema.js](Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js) — that's the file that actually runs on boot, not just `schema.sql`):
   ```sql
   CREATE TABLE IF NOT EXISTS report_schedules (
     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     report_type     VARCHAR(64) NOT NULL,   -- 'time-and-activity'
     member_id       UUID,                    -- null = all members
     emails          TEXT[] NOT NULL,
     subject         TEXT,
     message         TEXT,
     file_type       VARCHAR(8) NOT NULL DEFAULT 'pdf',  -- 'csv' | 'pdf'
     date_range_kind VARCHAR(32) NOT NULL,   -- 'last_7_days', 'last_30_days', etc.
     frequency       VARCHAR(32) NOT NULL,   -- 'daily' | 'weekly' | 'monthly'
     delivery_time   TIME NOT NULL,
     created_by      UUID NOT NULL,
     last_sent_at    TIMESTAMPTZ,
     created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   ```
2. **Backend**: `POST /reports/time-and-activity/schedule` — validates + inserts a row. `handleSave()` in [report-schedule-dialog.tsx:64](Dashboard-Web/features/reports/components/amounts-owed/report-schedule-dialog.tsx:64) calls it instead of just closing.
3. **Runner**: new function mirroring `isWeeklyReportDue` / the `setInterval` + `CHECK_INTERVAL_MS` pattern already in [team-weekly-report.service.js](Dashboard-Backend/src/modules/teams/team-weekly-report.service.js) — on each tick, find `report_schedules` rows due (`frequency` + `last_sent_at` + `delivery_time`), run the same send logic as Phase 2, update `last_sent_at`. Reuse the interval-timer approach that already exists rather than adding a job-queue dependency (`node-cron`, `bull`, etc.) — one feature doing this today, don't add infrastructure for it yet.

### New dependencies (total: one)
- Backend: `pdfkit` — only for server-generated PDF attachments (Send/Schedule). Client-side PDF export stays free via `window.print()` + print stylesheet.
- Nothing else. CSV needs no library anywhere. Email attachments use nodemailer, already installed.

### Build order
Phase 1 (Export) has no dependency on Phase 2/3 and unblocks immediately once the report-data endpoint from the top of this doc exists. Phase 2 (Send) needs Phase 1's server-side row-fetching logic reused, not rebuilt. Phase 3 (Schedule) needs Phase 2's send logic as its payload — build in that order.

## Add-on: Timesheets tab changes

New ask: rename the Timesheets tab, add a new tab that hosts this same report.

### What's there today
[nav-sections.ts:40](Dashboard-Web/shared/ui/layout/config/nav-sections.ts:40) — `Timesheets` section, two pages:
```ts
{ label: "View & edit", id: "timesheets-view"      },
{ label: "Approvals",   id: "timesheets-approvals" },
```
- `timesheets-view` → [TimesheetsViewEdit](Dashboard-Web/features/timesheets/components/view-edit/index.tsx) — this is **already** a task-approval queue (`Needs Review` + `Priority Monitor` sections, approve/reject assignments via `ReviewQueueTable`). Not a raw "view/edit timesheet" page. Renaming it to **Task Approvals** matches what it actually does — good rename.
- `timesheets-approvals` → placeholder, marked coming-soon ([coming-soon-pages.ts:31](Dashboard-Web/shared/constants/coming-soon-pages.ts:31)), not built yet.

**Flag:** renaming `timesheets-view` to "Task Approvals" puts it right next to the existing "Approvals" tab. Two tabs both saying "Approvals" in the same section reads as duplicate/confusing, even though they're different concepts (task-level approve/reject vs. whatever `timesheets-approvals` ends up being — timesheet/payroll period sign-off, presumably). Worth either renaming the other tab too when it's built, or picking a name for the new one that doesn't collide.

### Proposed nav change
```ts
{
  id: "timesheets",
  label: "Timesheets",
  icon: Clock,
  pages: [
    { label: "Task Approvals",  id: "timesheets-view"       },  // renamed, same id
    { label: "Approvals",       id: "timesheets-approvals"  },  // unchanged, still coming-soon
    { label: "Time & Activity", id: "timesheets-time-activity" },  // new
  ],
},
```
Naming for the new tab: going with **"Time & Activity"** — same label already used in [nav-sections.ts:83](Dashboard-Web/shared/ui/layout/config/nav-sections.ts:83) for the Reports version of this exact page. Reusing the existing name keeps the IA consistent (same content, same label, two entry points) instead of inventing a second name for the same thing. Say so if a Timesheets-flavored name ("Task Timesheets", "Member Timesheets") is preferred instead.

### Wiring (ponytail: reuse, don't duplicate)
"Take a copy of the report page and put it there" — skip the literal copy. Two nav entries can point at the same component. No fork, no second file to maintain, and it means the backend/wiring work above only has to happen once and both tabs get it for free.

1. [coming-soon-pages.ts](Dashboard-Web/shared/constants/coming-soon-pages.ts) / [resolve-chunk.ts:27](Dashboard-Web/app/routes/resolve-chunk.ts:27) — add `"timesheets-time-activity": "timesheets"` to `PAGE_CHUNK`.
2. [timesheets-chunk.tsx](Dashboard-Web/app/routes/chunks/timesheets-chunk.tsx) — add a case:
   ```tsx
   case "timesheets-time-activity":
     return <TimeAndActivityReport />   // same component reports/time-activity-report mounts
   ```
   Import from `@/features/reports` (already exported via [TimeAndActivity.tsx](Dashboard-Web/features/reports/components/app/TimeAndActivity.tsx)).
3. That's it — no new component, no new model, no new hook. Once the backend endpoint + fetch wiring (see above) lands, both `reports-time` and `timesheets-time-activity` show live data automatically.

Note: `reports-time` itself is currently inside the whole `reports` section marked coming-soon ([coming-soon-pages.ts:16](Dashboard-Web/shared/constants/coming-soon-pages.ts:16), `addPagesFromSection("reports")`). The new Timesheets tab id must NOT be swept into that same blanket coming-soon call (it isn't, since it lives under `timesheets`, not `reports`) — so this tab could go live before the Reports section does, once data is wired.
