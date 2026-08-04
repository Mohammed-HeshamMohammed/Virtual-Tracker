# Reports — What It Takes to Activate Each One

[FEATURES.md](FEATURES.md) lists the whole Reports section as "not yet connected to real data." That's true for 7 of the 8 report types, but not all 7 need the same amount of work — some can be wired up with data that already exists in the database today, others are genuinely blocked on backend work that hasn't started. This document breaks down each report by how ready its data actually is, checked directly against the Postgres tables and existing endpoints in the codebase.

**Correction to FEATURES.md first:** Time & Activity is *not* in the "not yet connected" bucket — it already has a full, working backend (`Dashboard-Backend/src/modules/reports/routes.js`): real Postgres data via `getTimeAndActivityReportRowsPg` (`Dashboard-Backend/src/lib/postgres/time-and-activity-report-postgres.service.js`), CSV/PDF export (`Dashboard-Backend/src/modules/reports/build-report-files.js`), email sending via `sendEmailViaNotify`, and scheduled delivery runner (`Dashboard-Backend/src/modules/reports/report-schedule-runner.js`). `FEATURES.md` should be updated to move it into the main feature list; it's listed as "coming soon" there by mistake. This doc covers what it takes to bring the other 7 up to the same level.

---

## Tier 1 — Data already exists, this is a wiring job

### Project Budgets
**Current state:** `Dashboard-Web/features/reports/components/project-budgets/project-budgets-report.tsx` renders entirely from `PROJECT_BUDGETS_DEMO_SECTIONS`, a hardcoded constant defined in `Dashboard-Web/features/reports/components/shared/constants.ts`.

**What it needs:** Section, Project, Spent, Budget, Remaining, % used — every one of those columns is already returned by the existing `GET /api/project-budgets` endpoint (`Dashboard-Backend/src/modules/projects/routes.js:734`), which uses the real batched calculators `computeProjectSpentForAllPg` and `computeProjectBudgetTargetForAllPg` (`Dashboard-Backend/src/lib/postgres/projects-postgres.service.js:480,620`).

**To activate:** Replace the `PROJECT_BUDGETS_DEMO_SECTIONS` import with a `fetch("/api/project-budgets")` call in `project-budgets-report.tsx`, group the results by client/section client-side (or add a `?groupBy=client` param backend-side if that grouping is easier to do in SQL). No new backend logic needed — this endpoint already exists and is already used by the live Projects/Budgets page.

**Effort:** Low. Frontend-only change, reusing an endpoint that's already fully correct (once the [budget bug fixes](LOGIC-REVIEW-billing-budgets.md) land).

---

### Daily Totals
**Current state:** `Dashboard-Web/features/reports/components/daily-totals/daily-totals-report.tsx` renders from hardcoded demo datasets (`AMOUNTS_OWED_DEMO_GROUPS` and `AMOUNTS_OWED_CHART_LABELS` in `Dashboard-Web/features/reports/components/shared/constants.ts`).

**What it needs:** Total tracked hours per member per day. This is *already computed* — `Dashboard-Backend/src/modules/reports/build-time-and-activity-rows.js` takes raw `activity_sessions` and `time_entries` rows and produces exactly this shape: active/idle seconds bucketed per member per local calendar day, with per-member timezone handling (`Dashboard-Backend/src/modules/reports/member-timezones.js`) and correct midnight-spanning session splitting already solved. It's the same aggregation Time & Activity already displays, just needs a per-day total view instead of the full per-member breakdown.

**To activate:** Add a thin new route (e.g. `GET /api/reports/daily-totals`) that calls the existing `loadTimeAndActivityReportPayloadForMemberIds` (already exported from `Dashboard-Backend/src/modules/reports/routes.js:61`) and reshapes the response into daily totals, or — if consuming existing rollups — just have the frontend consume the *existing* `GET /api/reports/time-and-activity` endpoint and roll it up to daily totals client-side. Either way, no new data collection, no new tables.

**Effort:** Low. The hard part (correct per-timezone day-bucketing of session data) is already solved and tested by Time & Activity; this is reusing it.

---

### Work Breaks
**Current state:** `Dashboard-Web/features/reports/components/app/work-breaks-report.tsx` is a literal empty-state placeholder — `<ReportEmptyState />` inside `<StandardReportLayout>`. No demo data or table columns have been written for this component yet.

**What it needs:** Idle/break time per member per session or per day. `activity_sessions` table already has an `idle_seconds` column, tracked per session, and `build-time-and-activity-rows.js` already separates `activeSeconds`/`idleSeconds` per day per member — the exact data this report needs is already flowing through the Time & Activity pipeline, just discarded on the frontend (Time & Activity currently surfaces active time; idle/break time is computed but not shown as its own report).

**To activate:** Build the UI table component first in `work-breaks-report.tsx` (columns: Member, Date/Session, Idle Time, Total Duration, Break Ratio). Backend-side, expose a query or rollup summing `idle_seconds` from `getTimeAndActivityReportRowsPg` rows, grouped by member/session instead of discarded.

**Effort:** Low-Medium. Data collection is fully solved in `activity_sessions`; this is "design the report UI, then point it at a reshaped version of data already being computed."

---

## Tier 2 — Data exists, but needs a new query or endpoint (not just new tables)

### Work Sessions
**Current state:** `Dashboard-Web/features/reports/components/work-sessions/work-sessions-report.tsx` and its hook `Dashboard-Web/features/reports/hooks/use-work-sessions-report.ts` render from `WORK_SESSIONS_DEMO_ROWS` in `Dashboard-Web/features/reports/components/shared/constants.ts`.

**What it needs:** Client, Project, Member, To-do/Job, Manual, Started, Stopped, Duration, Activity — a per-session (not per-day-aggregate) log. Every piece of this exists in the database already: `activity_sessions` has `member_id`, `project_id`, `task_id`, `started_at`, `ended_at`, `active_seconds` (for Duration/Activity); `tasks` gives the To-do/Job title; `client_projects` gives the Client for a given project (same join `Dashboard-Backend/src/lib/postgres/time-and-activity-report-postgres.service.js:47-49` already does for tasks/projects). `time_entries.source` (`'manual'` vs agent-tracked) is the source for the "Manual" column.

**To activate:** Write a new backend query joining `activity_sessions` → `tasks` → `projects` → `client_projects` (one query, no new tables — same join pattern used in `time-and-activity-report-postgres.service.js`), expose it via a new endpoint (`GET /api/reports/work-sessions`), and wire `use-work-sessions-report.ts` to fetch from the endpoint instead of `WORK_SESSIONS_DEMO_ROWS`.

**Effort:** Medium. No new tables, but it's a genuinely new endpoint (not a reuse of an existing one) and needs a product decision on how manual time entries are represented alongside agent sessions.

---

### Manual Time Edits
**Current state:** `Dashboard-Web/features/reports/components/app/manual-time-edits-report.tsx` is an empty-state placeholder — `<ReportEmptyState />` inside `<StandardReportLayout>`. No table columns or filters are built yet.

**What it needs:** A log of time entries that were manually created or edited (as opposed to agent-tracked). `time_entries.source` already distinguishes `'manual'` entries (confirmed in `Dashboard-Backend/src/modules/schema/services/postgres-crud.service.js:215` — "Manual Time form, not from the agent/timer, so `'manual'` is a fact, not a default guess") and the table has `updated_by`/`updated_at`.

**Important limitation to flag before building this:** `time_entries` stores only the *current* value of each row — there is no edit-history table. This report can show "which entries are manual, who created/last-edited them, and their current values" but it **cannot** show a true before/after diff of what changed on an edit (e.g. old duration → new duration), because that history was never captured. If a real audit trail of edits is the actual product requirement, that needs a new `time_entries_history` table (or similar) capturing a row on every update — a small, well-scoped addition, but it's new schema, not just a new query.

**To activate (current-state version, no history):** Design the UI table in `manual-time-edits-report.tsx`, write a new query filtering `time_entries WHERE source = 'manual'`, joined with `members`/`projects`/`tasks` for display names, and expose it via a new route `GET /api/reports/manual-edits`.

**Effort:** Medium for the "who/what/current-value" version described above. Higher if a real edit-history/diff view is actually required — that needs new schema plus instrumenting every place `time_entries` gets updated to write a history row, which nothing in the codebase does today.

---

## Tier 3 — Genuinely blocked, needs new infrastructure

### Amounts Owed
**Current state:** `Dashboard-Web/features/reports/components/amounts-owed/amounts-owed-report.tsx` renders from `AMOUNTS_OWED_DEMO_GROUPS`.

**Why it's blocked:** "Amounts owed" means unpaid invoiced amounts — that requires the Billing module (Invoices, Payments) to actually exist. Per [FEATURES.md](FEATURES.md) and [FINANCIALS-ACTIVATION.md](FINANCIALS-ACTIVATION.md), Billing is fully designed in the UI but has **zero backend routes**; there is no `invoices` or `payments` table, no way to know what's been invoiced vs. paid. This report can't be built correctly until Billing has a real backend, because "owed" is fundamentally an invoicing-and-payments concept, not a time-tracking one.

**Possible partial version, if useful as an interim:** An *estimate* of "unbilled tracked value" could be computed today from `time_entries`/`activity_sessions` × the client's budget rate (`client_budgets.cost`/`based_on`, already used in [the budget logic reviewed here](LOGIC-REVIEW-billing-budgets.md)) — but that's "value of work done that hasn't been invoiced yet," not "amount actually owed on a sent invoice," and shouldn't be labeled the same way in the UI if shipped as a stopgap. Worth confirming with product whether that distinction matters before building an approximation that might get read as more authoritative than it is.

**Effort:** Blocked on Billing backend (separate, larger effort — see [FEATURES.md](FEATURES.md) "Billing" entry). Not fixable by wiring alone.

---

### Audit Log
**Current state:** `Dashboard-Web/features/reports/components/audit-log/audit-log-report.tsx` renders from `AUDIT_LOG_DEMO_ROWS` in `Dashboard-Web/features/reports/components/shared/constants.ts`.

**Why it's blocked:** There is no audit/event log table anywhere in the schema (confirmed — no `audit_log`, `audit_events`, or equivalent exists in `Dashboard-Backend`). Nothing in the codebase currently records "who did what, when" as a queryable log; individual features track their own `updated_by`/`updated_at` on their own rows (members, tasks, time entries, etc.), but there is no unified action log to query across all of them.

**What it would take:** A new `audit_log` table (actor, action, object type/id, timestamp, detail — matching the columns the UI already expects: Date & Logs, Author, Time, Action, Object, Member, Detail) plus instrumentation added to every mutation route across the app (members, projects, tasks, clients, hierarchy, etc.) to write a row on every meaningful change. That's not a report-wiring task — it's a cross-cutting infrastructure addition that touches most of the backend.

**Effort:** Highest of all 8. New schema plus instrumentation across the entire mutation surface, not a self-contained change. Worth scoping as its own project rather than folding into "activate the Reports section."

---

## Summary

| Report | Status today | Blocker | Effort to activate |
|---|---|---|---|
| Time & Activity | ✅ Already live | — | Done (fix FEATURES.md) |
| Project Budgets | Demo data | None — reuse `/api/project-budgets` | Low |
| Daily Totals | Demo data | None — reuse Time & Activity's rollup | Low |
| Work Breaks | Empty state | UI not designed yet; data ready | Low-Medium |
| Work Sessions | Demo data | New endpoint (data all exists) | Medium |
| Manual Time Edits | Empty state | New endpoint; no edit-history table | Medium |
| Amounts Owed | Demo data | Billing/Invoices backend doesn't exist | Blocked |
| Audit Log | Demo data | No audit table or instrumentation anywhere | Blocked (largest lift) |
