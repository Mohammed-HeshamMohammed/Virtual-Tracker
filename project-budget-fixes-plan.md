# Project Budget Fixes — Implementation Plan

Scope: `Dashboard-Web` + `Dashboard-Backend`. Six reported items, root-caused against the
current code. Ordered by dependency, not by the order they were reported.

Guiding rule for every item below: smallest change at the point all callers route
through. No new abstractions, no new tables unless the data genuinely has nowhere to live.

---

## Item 1 — Budget shows no progress even while work is happening

### Root cause (confirmed)

`computeProjectSpentPg` ([projects-postgres.service.js:407](Dashboard-Backend/src/lib/postgres/projects-postgres.service.js:407))
derives spend **only** from the `time_entries` table:

- Hours-based → `getProjectTrackedSecondsPg` → `SELECT SUM(duration) FROM time_entries`
- Cost-based → `computeProjectSpentCostPg` → same table × a rate

`time_entries` has exactly one writer in the whole backend:
[postgres-crud.service.js:217](Dashboard-Backend/src/modules/schema/services/postgres-crud.service.js:217),
the **manual timesheet entry form**. The column `source VARCHAR(20) ... CHECK (source IN ('manual','tracked'))`
exists, but nothing has ever written `'tracked'`.

Real tracked work lands in two other places:

| Store | Written by | Has `project_id`? |
|---|---|---|
| `activity_sessions` | timer start/idle/stop, [activity/routes.js:285+](Dashboard-Backend/src/modules/activity/routes.js:285) | yes (`ALTER TABLE ... ADD COLUMN project_id` — added for calling projects) |
| `task_member_progress` | task timer sync, `task-time-tracking.js` | no — only `task_id` |
| `daily_member_active_seconds` | agent sync rollup | no — member/day only |

So: timers run, `activity_sessions.active_seconds` climbs, `time_entries` stays empty,
budget spend stays `0`. Every budget bar in the screenshot is correct given its input —
the input is the wrong table.

### ADR-001: Which table is the source of truth for "project spend"

**Status:** Proposed
**Date:** 2026-07-30
**Deciders:** backend owner

#### Context

Tracked time is fragmented across three stores. Budget spend must cover both `normal`
projects (time attributed via tasks) and `calling` projects (task-less timers), and must
keep working alongside manually entered timesheet rows, which are real billable time.

#### Options considered

**Option A — Read `activity_sessions` (+ manual `time_entries`)**

| Dimension | Assessment |
|---|---|
| Complexity | Low — one query change, no writes, no migration |
| Correctness | Covers task timers *and* calling timers (both write `project_id`) |
| Risk | Sessions with `project_id IS NULL` (legacy task sessions before the column existed) are missed |

**Pros:** no new writer, no backfill, no dual-write drift, works for calling projects on day one.
**Cons:** legacy rows with a null `project_id` (sessions written before that column existed)
are simply not counted — accepted, not backfilled, per the no-data-migration direction for
this plan.

**Option B — Backfill `time_entries` with `source='tracked'` rows on timer stop**

| Dimension | Assessment |
|---|---|
| Complexity | Medium — new writer, idempotency on resume/stop, retro-backfill job |
| Correctness | One table for all time; timesheets and budgets agree by construction |
| Risk | Double-count if a member also files a manual entry for the same work |

**Pros:** single canonical time table long-term.
**Cons:** builds a second writer and a reconciliation problem to fix a read bug. The
`'tracked'` enum value's existence is not evidence anyone designed this flow.

**Option C — Materialize `project_spent` as a stored column**

Rejected outright. Rates change; the file's existing comment already states the
compute-at-read-time philosophy, and a cached number silently drifts.

#### Decision

**Option A.** Change the reader, not the writers. One `SUM` over `activity_sessions`
`UNION ALL` the manual `time_entries` rows, grouped by `project_id`.

#### Consequences

- Easier: calling projects get real spend with zero extra code.
- Harder: `time_entries` remains a partial view of time — accepted; it is the *manual entry*
  table and always was.
- Revisit if/when timesheet approval is supposed to gate budget spend (today
  `status != 'rejected'` is the only filter, and sessions have no approval concept).

> Dialect: PostgreSQL (this backend's only store). No backfill step in this plan — test
> environment, existing rows are disposable, so every fix below is a pure read/query change
> with no data-preservation step attached.

### Changes

1. **`Dashboard-Backend/src/lib/postgres/projects-postgres.service.js`**
   Rewrite `getProjectTrackedSecondsPg` (single project) to sum both sources:
   ```sql
   -- Real tracked seconds for one project = timer sessions + manually filed
   -- entries. Two different tables because they're two different sources of
   -- truth (live timer vs. hand-entered time), not two representations of the
   -- same fact -- so UNION ALL, not a join.
   SELECT COALESCE(SUM(secs), 0) AS total_seconds
   FROM (
     SELECT active_seconds AS secs
     FROM activity_sessions
     WHERE project_id = $1
     UNION ALL
     SELECT duration AS secs
     FROM time_entries
     WHERE project_id = $1
       AND status != 'rejected'
   ) tracked
   ```
   Keep the existing `fromDate` / `toDate` / `includeNonBillable` options as extra `WHERE`
   clauses on each leg. Note: `activity_sessions` has no `billable` flag — treat sessions as
   billable (matches how the timer is used) and apply the billable filter only to the
   `time_entries` leg.

   Legacy caveat, accepted rather than backfilled: rows in `activity_sessions` written before
   the `project_id` column existed are `NULL` there and won't be counted. Fine for a test
   environment; if this ever runs against real historical data, that's the one gap to revisit.

2. **Kill the N+1.** [overview-service.js:113](Dashboard-Backend/src/modules/projects/services/overview-service.js:113)
   and [projects/routes.js:687](Dashboard-Backend/src/modules/projects/routes.js:687) both call
   `computeProjectSpentPg` **per project inside a loop** — for cost-based budgets that also
   fires a Firestore read per member for pay rates. Replace with one grouped query for the
   whole project set:
   ```sql
   -- One pass over both time sources for every project in the overview,
   -- instead of the current per-project round trip in a loop. Aggregation
   -- happens once, in tracked_seconds, before the join back to projects --
   -- not per-row on the join -- so this stays one seq scan of each source
   -- table regardless of how many projects are requested.
   WITH tracked_seconds AS (
     SELECT project_id, SUM(secs) AS total_seconds
     FROM (
       SELECT project_id, active_seconds AS secs
       FROM activity_sessions
       WHERE project_id = ANY($1::uuid[])
       UNION ALL
       SELECT project_id, duration AS secs
       FROM time_entries
       WHERE project_id = ANY($1::uuid[])
         AND status != 'rejected'
     ) combined
     GROUP BY project_id
   )
   SELECT
     p.id AS project_id,
     pb.type,
     pb.based_on,
     pb.cost,
     COALESCE(ts.total_seconds, 0) AS total_seconds
   FROM projects p
   LEFT JOIN project_budgets pb ON pb.project_id = p.id
   LEFT JOIN tracked_seconds ts ON ts.project_id = p.id
   WHERE p.id = ANY($1::uuid[])
   ```
   `$1` is the same project-id array `overview-service.js` already builds for
   `OVERVIEW_CORE_SQL` — this can run alongside it in the same `Promise.all`, not after it.

   Cost-based `based_on = 'pay_rate'` still needs one rate per member, and `pay_rates` is
   Firestore (see Open Questions) — that part can't fold into this SQL. Batch it instead of
   looping it: collect the distinct `member_id`s across *all* projects' tracked rows first,
   fetch `pay_rates` once for that batch, then apply rates in JS. One Firestore batch read
   for the whole overview, not one per member per project.

   Expose this as `computeProjectSpentForAllPg(projectIds)` returning a `Map<projectId, spent>`;
   both call sites switch to it.

3. **`num()` guard.** [overview-service.js:21](Dashboard-Backend/src/modules/projects/services/overview-service.js:21)
   only accepts `typeof v === "number"`. `node-postgres` returns `NUMERIC` as a **string**
   and no `setTypeParser` is registered anywhere in this backend. Any code path reading
   `pb.cost` through `num()` silently yields `0`. Make `num()` accept numeric strings.

### Verification

One check, not a suite: seed a project + one `activity_sessions` row with known
`active_seconds`, assert `computeProjectSpentPg` returns the expected hours. Add to
`Dashboard-Backend/test/`.

---

## Item 2 — Calling projects use hourly budgets only

Calling projects have no tasks and no bill/pay-rate anchor per task, so a Cost-based
budget has nothing coherent to multiply. Force `Hours based`.

- **Web** — [project-modal.tsx:888](Dashboard-Web/features/projects/components/modals/project-modal.tsx:888):
  when `addForm.type === "calling"`, render the Type field as a static "Hours based" label
  (not a select) and drop the "Based on" field. In the type-step handler, set
  `budgetType: "Hours based", budgetBasedOn: ""` when calling is chosen.
- **Backend** — in the `/api/project-budgets` POST and PATCH handlers
  ([routes.js:697](Dashboard-Backend/src/modules/projects/routes.js:697),
  [routes.js:734](Dashboard-Backend/src/modules/projects/routes.js:734)), look up the project
  and reject `type !== "Hours based"` for `project.type === "calling"`. Server-side is the
  real gate — the UI change alone is cosmetic.

---

## Item 3 — "Add project" submit takes far too long

### Root cause

`createProjectWithDetails` ([project-details-api.ts:610](Dashboard-Web/features/projects/api/project-details-api.ts:610))
is a fully **sequential** client-side waterfall. For one project with one client, one team
and three members that is roughly:

```
POST /api/projects
GET  /api/client-projects?project_id=…     ← syncClientLinks
GET  /api/client-projects?project_id=…     ← again, after the (zero) deletes
POST /api/client-projects
POST /api/project-budgets
GET  /api/project-budgets?project_id=…     ← createProjectBudget refetches to return a row nobody reads
GET  /api/project-members                  ← syncProjectMembers
POST /api/project-members  × N             ← one round-trip per member, awaited in a loop
GET  /api/team-projects?project_id=…       ← syncTeamLinks
GET  /api/team-projects?project_id=…       ← again
POST /api/team-projects   × N
POST /api/project-member-limits × N
```

…then `refetchProjects({ forceRefetch: true })`, which re-runs `loadProjectListContext` —
including the now-N+1 `/api/project-budgets` spend computation from item 1. And when the
user pastes multiple names, `saveProject` runs this **entire chain once per name, serially**.

### Fix — three edits, no new endpoint

1. **Create path never needs the read-then-diff.** `syncClientLinks` / `syncProjectMembers` /
   `syncTeamLinks` exist to diff against existing links. On a project created milliseconds
   ago there are none. Add `createProjectLinks(projectId, payload, actorMemberId)` that skips
   every GET and every delete and just POSTs. Edit path keeps the sync functions unchanged.
2. **Parallelize.** Budget, client links, member links, team links and member limits are
   independent once the project id exists — one `Promise.all`, and `Promise.all` the
   per-member/per-team POSTs inside each. (The `async-await-in-loop` eslint disables at the
   top of that file are the symptom.)
3. **Drop the dead refetch** in `createProjectBudget` ([project-details-api.ts:286](Dashboard-Web/features/projects/api/project-details-api.ts:286))
   — the returned row is discarded by the only caller on the create path.

Multi-name creates: `Promise.all` over names in `saveProject`
([use-project-mutations.ts:93](Dashboard-Web/features/projects/hooks/use-project-mutations.ts:93)).

Expected: ~13 sequential round-trips → 2 sequential steps (create, then one parallel batch).

> Skipped: a transactional `POST /api/projects/full` backend endpoint. Add it when partial
> failure (project created, members not) becomes a real support issue — the batching above
> removes the latency without inventing a second write path to keep in sync with the
> existing one.

---

## Item 4 — Budget switches must actually gate their fields

### Current behaviour

- **Notify switch** — `budgetNotifyMembers` ([project-modal.tsx:948](Dashboard-Web/features/projects/components/modals/project-modal.tsx:948)).
  "Notify at" and "Who to notify" render and save **regardless** of the switch.
- **Stop-timer switch** — bound to `addForm.hasBudget`
  ([project-modal.tsx:987](Dashboard-Web/features/projects/components/modals/project-modal.tsx:987)),
  a badly named field that also gates budget-total validation. "Stop timers at" renders and
  saves regardless.
- **Nothing enforces either flag.** `stop_timers_when_reached` is written by
  `upsertProjectBudgetPg` and read back by the edit-state route — grep finds **no consumer**
  in the timer path. [timer-limit.service.js](Dashboard-Backend/src/modules/tasks/timer-limit.service.js)
  enforces only per-member daily/weekly hour caps. And there is no project-budget notifier at
  all: `Dashboard-Backend/src/modules/projects/services/` contains only `overview-service.js`
  and `project-budget-from-clients.js` — the client-side equivalent
  (`clients/services/client-budget-notify.js`) exists, the project-side one was never written.

### Changes

**UI**
- Rename `hasBudget` → `budgetStopTimers` across the form state, payload and
  `shared/validation/project-form.ts`. It currently means two different things.
- Gate the dependent fields: notify switch off → "Notify at" + "Who to notify" hidden
  (not merely disabled — a disabled field the user cannot reach still saves a stale value);
  stop-timer switch off → "Stop timers at" hidden.
- On toggle-off, clear the dependent state so the cleared value is what gets submitted.

**Persistence** — `buildBudgetFields` ([project-details-api.ts:444](Dashboard-Web/features/projects/api/project-details-api.ts:444))
must send `notifyAtPct: null` / `whoToNotify: ""` when notify is off, and `stopTimersAtPct: null`
when stop-timers is off. Note `stopTimersWhenReached: payload.hasBudget` there — that is the
existing conflation; it becomes `payload.budgetStopTimers`.

**Validation** — `getProjectBudgetFieldErrors` should skip the threshold validators when the
owning switch is off, mirroring how `validateBudgetTotalValue` already takes `hasBudget`.

**Enforcement** (the part that makes the switches mean something):
- *Stop timers* — in [activity/routes.js](Dashboard-Backend/src/modules/activity/routes.js),
  next to the existing `computeTimerAllowance` / `computeMemberTimerAllowance` checks on
  `start`/`resume`: load the project budget, compute spend (item 1), and if
  `stop_timers_when_reached` and `usage_pct >= stop_timers_at_pct`, return 403 with a
  budget-specific message. This is the one place both task and calling timers pass through.
- *Notify* — new `projects/services/project-budget-notify.js` modelled directly on
  `clients/services/client-budget-notify.js` (same threshold + period-key dedupe shape),
  fired from the same timer-sync path. Gate on `notify_project_members`, recipients from
  `who_to_notify`.

> The notifier is the largest single piece of new code in this plan. If it needs to be cut
> for scope, cut it and ship the UI gating + stop-timer enforcement — but say so explicitly,
> because a notify switch that notifies nobody is what item 4 is reporting in the first place.

---

## Item 5 — Optional project end date

`projects` has no date columns at all ([ensure-lookup-schema.js:392](Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js:392)).
`project_budgets.start_date` exists but is the *budget period* start, not the project's.

- **Schema** — `ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date DATE` in the same
  statement array. Nullable, no default, no constraint. (Deliberately not adding `start_date`
  — not requested, and `created_at` already answers "when did this start".)
- **Backend** — thread `endDate` through `createProjectPg` / `updateProjectPg`
  (`dateOrNull` helper already exists in that file), the POST/PATCH handlers in
  `projects/routes.js`, the `/edit-state` response, and
  `modules/schema/catalog/projects/index.js` so the field catalog stays accurate.
- **Web** — one `DatePickerField` on the GENERAL tab. Not required, no validation beyond
  "if set, must parse". Purely informational for now — nothing archives on it.

---

## Item 6 — No project of any type may be created without a name and a budget

### Current gaps

- Names: validated ([project-form.ts:3](Dashboard-Web/shared/validation/project-form.ts:3)) — this half works.
- Budget: `validateBudgetTotalValue` returns `null` for an **empty** value. And
  `shouldPersistBudget` ([project-details-api.ts:437](Dashboard-Web/features/projects/api/project-details-api.ts:437))
  only checks that a *type* is set — with the defaults `budgetType: "Cost based"` and
  `budgetBasedOn: "Bill rate"` ([project-modal.tsx:131](Dashboard-Web/features/projects/components/modals/project-modal.tsx:131)),
  a user who never opens the BUDGET tab creates a row with `cost = 0`. That is exactly the
  `0h/1h`-with-no-real-cap state in the screenshot.
- Backend: `validateProjectDomainBody("projects", …)` does not require a budget to exist, and
  `/api/project-budgets` accepts `cost: 0` (`data.cost ?? 0`).

### Changes

- **`shared/validation/project-form.ts`** — make budget total required and `> 0`:
  empty or `0` → `"Enter a budget greater than zero."` Drop the `hasBudget` short-circuit;
  that flag is the stop-timer switch (item 4), not "has a budget".
- **`project-modal.tsx`** — surface the error on the BUDGET tab and switch to that tab on a
  failed submit, otherwise the user sees an error for a field on a tab they never opened.
  Disable Submit while either name or budget total is empty.
- **Backend, the real gate** — reject `cost <= 0` in the `/api/project-budgets` POST/PATCH
  handlers. Separately, `POST /api/projects` currently creates a project with no budget row
  at all if the client simply never calls the budget endpoint; add the budget fields to the
  create-project contract, or (simpler) have the create path call both and let the client
  batching from item 3 keep it one round-trip.

> Not enforced with a DB `NOT NULL` FK from `projects` to `project_budgets` — existing rows
> would fail the constraint, and circular required-FKs are a migration trap.

---

## Suggested order

1. Item 1 (spend source + N+1) — every other budget behaviour reads this number.
2. Item 6 (required name + budget) — stops new zero-budget rows while the rest lands.
3. Item 4 UI gating + item 2 (calling → hourly) — pure form work, no backend dependency.
4. Item 3 (submit batching) — benefits from item 1's N+1 fix already being in.
5. Item 5 (end date) — independent, small.
6. Item 4 enforcement (stop-timer 403 + notifier) — depends on item 1 being trustworthy.

## Open questions

- **Rate source for cost-based spend.** `computeProjectSpentCostPg` reads `pay_rates` and
  `client_budgets` from **Firestore**, against the standing direction to keep new and migrated
  storage in Postgres. Item 1 folds `client_budgets` + `pay_rates` into its own fix (small,
  narrow, blocks the N+1). Full `clients` domain is the separate, larger migration below.
- **Does approval gate spend?** `time_entries` filters `status != 'rejected'`;
  `activity_sessions` has no approval concept. Current plan treats all session time as spent.

---

# Phase 7+ — Clients domain migration to Postgres

Same shape as the Projects migration already shipped (commit `847e6da`, "complete
implementation.md Phase 3/3.5/4 + legacy Firestore cleanup") minus the backfill step —
per direction, no data migration in this plan. Schema, then direct backend cutover, then
legacy cleanup. Existing Firestore rows are not carried over; new tables start empty.

Full-domain audit (not just the two collections item 1 touches):

| Firestore collection | Reader/writer | Notes |
|---|---|---|
| `clients` | [client-service.js](Dashboard-Backend/src/modules/clients/services/client-service.js) | core record |
| `client_budgets` | same + `project-budget-from-clients.js`, `overview-service.js` | already flagged in item 1 |
| `client_invoicing` | same | auto-invoicing config, untouched by budget work |
| `client_automation_state` (`AUTOMATION_COLLECTION`) | [client-budget-notify.js](Dashboard-Backend/src/modules/clients/services/client-budget-notify.js) | threshold/period dedupe state |
| `client_projects` | [schema/catalog/clients/index.js](Dashboard-Backend/src/modules/schema/catalog/clients/index.js) generic-CRUD entry only | **dead** — the real junction is already the Postgres `client_projects` table (`linkClientProjectPg`/`unlinkClientProjectPg`). This Firestore entry is leftover cascade-delete metadata, not a live writer. Confirm zero live docs, then delete the catalog entry — no migration needed, just cleanup. |

`clients/routes.js` also reads Firestore `members` and `roles` directly (form-config,
client-budget-notify recipient lookup) — those stay Firestore; members migration is its own,
much bigger, out of scope here.

### Phase 7 — Schema

Add to `ensure-lookup-schema.js`, mirroring `project_budgets`' shape and the existing
`clients/services/budget-logic.js` field semantics (`type: hourly|fixed|retainer|none`,
`based_on: per_person|per_project|total` — note these differ from `project_budgets`' own
`Cost based|Hours based` enum; keep them separate, don't unify the two budget shapes as part
of this move):

```sql
CREATE TABLE IF NOT EXISTS clients (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id      UUID,
  name           VARCHAR(200) NOT NULL,
  street_address TEXT NOT NULL DEFAULT '',
  city           VARCHAR(120) NOT NULL DEFAULT '',
  state          VARCHAR(120) NOT NULL DEFAULT '',
  zip            VARCHAR(20)  NOT NULL DEFAULT '',
  country        VARCHAR(120) NOT NULL DEFAULT '',
  phone_number   VARCHAR(40)  NOT NULL DEFAULT '',
  email_addresses TEXT NOT NULL DEFAULT '',
  status         VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID, updated_by UUID
);

CREATE TABLE IF NOT EXISTS client_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('hourly','fixed','retainer','none')),
  based_on VARCHAR(20) NOT NULL DEFAULT 'per_project'
    CHECK (based_on IN ('per_person','per_project','total')),
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  notify_at_pct NUMERIC(5,2),
  resets VARCHAR(20) NOT NULL DEFAULT 'never'
    CHECK (resets IN ('monthly','quarterly','yearly','never')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID, updated_by UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cb_client ON client_budgets (client_id);

CREATE TABLE IF NOT EXISTS client_invoicing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  custom_for_client BOOLEAN NOT NULL DEFAULT false,
  notes TEXT NOT NULL DEFAULT '',
  net_terms_days INT NOT NULL DEFAULT 30,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  auto_invoicing BOOLEAN NOT NULL DEFAULT false,
  auto_invoice_amount_based_on VARCHAR(20) NOT NULL DEFAULT 'hourly',
  auto_fixed_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  auto_invoice_frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
  auto_invoice_delay_days INT NOT NULL DEFAULT 0,
  auto_invoice_reminder_days INT NOT NULL DEFAULT 7,
  auto_invoice_line_items VARCHAR(60) NOT NULL DEFAULT 'detailed_project_user_date',
  include_non_billable_time BOOLEAN NOT NULL DEFAULT false,
  include_expenses BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID, updated_by UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_client ON client_invoicing (client_id);

CREATE TABLE IF NOT EXISTS client_automation_state (
  client_id UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`client_projects` needs no new table — the Postgres one already exists and is already the
live junction.

### Phase 8 — Backend cutover

New `Dashboard-Backend/src/lib/postgres/clients-postgres.service.js`, same shape as
`projects-postgres.service.js`: `getClientPg`, `listClientsPg`, `createClientPg`,
`updateClientPg`, `upsertClientBudgetPg`, `upsertClientInvoicingPg`. Port the field-mapping
logic already in `client-service.js` (`parseClientDetailsBody`, `mapClientResponse`,
validators) as-is — that logic is storage-agnostic, only the `db.collection(...).doc(...)`
calls change to `query(...)`.

Rewrite `client-budget-notify.js`'s three Firestore calls
([lines 55, 129, 149, 165](Dashboard-Backend/src/modules/clients/services/client-budget-notify.js:55))
to read/write `client_automation_state` and `client_budgets` via Postgres; its `members`/`roles`
lookups (lines 78, 87) stay Firestore — unrelated to this migration.

`routes.js` and `schema/routes.js`'s generic-CRUD path for `clients`/`client-budgets`/
`client-invoicing` swap their Firestore catalog entries for direct service calls, matching how
`projects/routes.js` already bypasses the generic catalog for projects.

**No web changes expected.** `Dashboard-Web/features/clients/api/client-api.ts` and
`client-form-api.ts` already talk to `/api/clients/*` REST endpoints — same contract precedent
as the Projects migration, where the web layer needed zero changes because the HTTP shape
didn't move, only what was behind it. Confirm this holds by diffing response shapes before/after
per endpoint, not by assuming it.

Cutover is direct: once Phase 8's Postgres-backed handlers are live, the Firestore code paths
in `client-service.js` and `client-budget-notify.js` are simply deleted, not dual-run. No
transition window, no reconciliation job — matches the "no data migration" direction for this
plan.

### Phase 9 — Legacy Firestore cleanup

- Delete `clients`, `client_budgets`, `client_invoicing`, and the automation-state collection
  from Firestore.
- Remove the four client entries from `schema/catalog/clients/index.js` (including the already-
  dead `client-projects` entry from Phase 7's audit).
- Remove `Dashboard-Backend/src/modules/clients/migrate-remove-budget-start-date.js` — it's a
  one-time job against a Firestore collection that no longer exists once this lands.

### Sequencing vs. Phase 1

Item 1 already migrates `client_budgets` reads (via the new `computeProjectSpentCostPg` query)
ahead of this. When Phase 8 lands, that becomes redundant — the whole `clients` table read moves
to Postgres and item 1's `client_budgets`-specific query folds into the general `clientsPg`
service. Not a conflict, just do item 1's narrow fix first and let this phase absorb it later.
