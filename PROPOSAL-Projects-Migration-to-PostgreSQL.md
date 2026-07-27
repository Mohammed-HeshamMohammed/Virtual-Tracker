# Proposal: Migrate Projects from Firestore to PostgreSQL

Architectural proposal to move the `projects` domain (and its satellite collections) from Firestore (NoSQL) to PostgreSQL (SQL), aligning with the migration trajectory the codebase has already established for activity data.

Every claim below is backed by file references traced through the `Dashboard-Backend` and `Dashboard-Web` codebases. This revision incorporates a review pass: the original schema section was checked against the actual field catalog (`Dashboard-Backend/src/modules/schema/catalog/`) and several real code paths, and corrected where it didn't match reality.

---

## Executive Summary

Projects are **relational data living in a document store**. They have many-to-many and one-to-many relationships with members, tasks, budgets, clients, and teams — all modeled as separate Firestore collections that the backend manually joins in JavaScript. Meanwhile, PostgreSQL already holds transactional data (`time_entries`, `activity_sessions`) that references `project_id` **without FK constraints** because the source of truth lives in Firestore.

Moving Projects to PostgreSQL would:
- Enable proper foreign key integrity with existing SQL tables
- Replace manual in-memory joins with native SQL JOINs
- Simplify dashboard aggregation queries
- Align with the migration direction the project is already heading

**This revision's headline finding:** the project/client budget system has a real, already-shipping correctness bug independent of the storage engine — the UI cannot currently tell an hourly budget from a dollar budget, and "amount spent" is not computed from real data at all. Migrating the current schema as-is would carry this bug into PostgreSQL under a permanent column name instead of fixing it. See [Related Bug](#related-bug-budget-display-is-already-broken-today) below.

---

## Related Bug: Budget Display Is Already Broken Today

Independently confirmed by tracing the Project overview and Project table rendering paths. This is a live bug, not a migration risk — it affects Firestore today and would carry over unchanged if the schema below were copied as originally drafted.

### 1. Budget type is never fetched

`Dashboard-Backend/src/modules/projects/services/overview-service.js:52`:

```js
db.collection("project_budgets").select("project_id","projectId","cost","seedBudgetSpentPct","_seedBudgetSpentPct")
```

No `type` or `basedOn` field is selected. The overview query is physically blind to cost-vs-hours from the start — it cannot distinguish the two even in principle.

### 2. `cost` is treated as a dollar total unconditionally

`overview-service.js:115`: `budgetTotal = num(budgetRow, "cost")`.

But `cost` just holds whatever number the user typed into the Budget tab's total input, regardless of budget type (`Dashboard-Web/features/projects/api/project-details-api.ts:441`: `cost: parseOptionalNumber(payload.budgetTotal) ?? 0`). An Hours-based project where someone types "40" gets stored as `cost: 40` and is read back everywhere as if it were $40.

### 3. "Spent" is fabricated for real data

`overview-service.js:38-42`:

```js
function budgetSpent(total, row) {
  const pct = num(row, "_seedBudgetSpentPct", "seedBudgetSpentPct");
  if (pct > 0 && total > 0) return Math.round(total * Math.min(pct, 1));
  return 0;
}
```

This only returns a nonzero value via a demo/seed field (`_seedBudgetSpentPct`). For every real, non-seeded project, "spent" is hardcoded `0`. Nothing here reads actual tracked time or actual billable cost from `time_entries` / `activity_sessions`.

### 4. Frontend hardcodes currency and drops `type` entirely

`Dashboard-Web/features/projects/mappers/project-mapper.ts:62`:

```js
budget: row.b ? { spent: row.b.sp, total: row.b.tot, currency: "$" } : null,
```

`currency: "$"` is unconditional. Worse, the frontend types don't even have a slot for budget type — `ProjectListItem` (`Dashboard-Web/features/projects/models/list.ts:10`) and `OverviewSortableProject` (`Dashboard-Web/features/projects/utils/overview-sort.ts:8`) both declare `budget` as `{ spent: number; total: number | null; currency: string } | null`, with no `type` field. Even if the backend started sending it tomorrow, these types would drop it.

### 5. The format function assumes dollars always

`Dashboard-Web/features/projects/components/project-table-cells.tsx:6-9`:

```js
export function formatProjectBudget(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n}`
}
```

No branch for hours. Every budget renders with a `$` prefix.

**Net effect:** the Project table and Project overview both mislabel hours-based budgets as dollar amounts, and the "spent" figure shown is fabricated (either `0` or a seeded percentage), never a real tracked number. This is true right now, on Firestore, before any migration work starts.

**Why this matters for the migration:** the schema originally proposed below (see git history) copied `cost` and `seed_budget_spent_pct` forward as the only budget columns — i.e. it would have moved this exact bug into PostgreSQL under a permanent name. The corrected schema in this revision keeps the real `type`/`based_on` fields (they already exist in Firestore, just aren't read), and calls out `spent` as something that needs an actual implementation, not a column to copy.

### 6. `project_member_limits` is a mislabeled headcount cap, not enforcement

Grepped `Dashboard-Backend/src/modules/tasks/timer-limit.service.js` and `task-workload-validation.js` — zero references to `project_member_limits`. It is only read in `overview-service.js:77-78`:

```js
const cost = num(row, "cost");
if (pid && cost > 0) memberLimitByProject.set(pid, cost);
```

That value becomes the Project table's "Member limits" column, compared against member *count* (`members >= limit` in `MemberLimit`) — a max-members-on-this-project cap, not an hours or dollar limit. The table's own columns (`type`, `based_on`, `cost`, `resets`) are budget-shaped, which is the wrong shape for a headcount. Real per-member hour limits are enforced by an entirely separate system — the Postgres `limits` table (`member-data-store.js`, `getMemberLimitHours()`) already used by the desktop agent's timer enforcement. This table does something different from what its schema implies. Worth deciding in Phase 0 whether to carry the budget-shaped columns forward as-is or collapse it to what it actually is: `project_id`, `member_id`, `max_members`.

### 7. Client-budget resync only fires on link changes, not on budget edits

`syncProjectBudgetFromClients` (the write path already noted under Phase 1) is called from exactly two places in `schema/routes.js` — `:821` when a `client_projects` link is **created**, and `:1071` on a generic entity **delete** that resolves back to a project. There is no call site triggered by editing a client's budget *value* directly. If a client's budget changes without the link being re-created, the project's derived `cost` in `project_budgets` goes stale silently. Pre-existing bug, independent of storage engine — flagging here since Phase 1's backfill will otherwise copy already-stale numbers forward as if they were correct.

### 8. `firestore.indexes.json` only covers `project_members`

Two composite indexes, both on `project_members` (`project_id` + one other field). Nothing indexed for `project_budgets`, `client_projects`, or `team_projects`. Cheap Phase-3-equivalent cleanup item, wasn't previously called out.

---

## Current State: Where Project Data Lives

### Firestore (NoSQL) — Source of Truth Today

| Collection               | Doc ID Key | Description                                              |
| :----------------------- | :--------- | :------------------------------------------------------- |
| `projects_VirtualTacker` | UUID v4    | Core project records (name, status, timestamps)          |
| `project_members`        | UUID v4    | Junction table: which members belong to which projects   |
| `project_budgets`        | UUID v4    | Cost limitations and budget tracking per project         |
| `project_member_limits`  | UUID v4    | Individual member budget caps enforced per-project       |
| `client_projects`        | UUID v4    | Junction table: which clients are linked to projects     |
| `team_projects`          | UUID v4    | Junction table: project visibility by team               |

**References:**
- `Dashboard-Backend/NONSQL-TableNames.md` — Section 5: Clients, Projects & Tasks
- `Dashboard-Backend/src/modules/schema/catalog/projects/index.js` — declared field list (authoritative for this revision's schema corrections)
- `Dashboard-Backend/src/modules/schema/catalog/clients/index.js`, `.../teams/index.js` — `client_projects`, `team_projects` field lists

> **Caveat:** the schema catalog declares fields for generic CRUD validation, but Firestore is schemaless — service code can and does write undeclared fields directly (e.g. `_seedBudgetSpentPct` on `project_budgets`, or `updated_at` written by `syncProjectBudgetFromClients` but not in the catalog list). Treat the catalog as a strong starting point, not a guarantee of completeness. **Phase 1 must include scanning live documents**, not just trusting the catalog, before finalizing DDL.

### PostgreSQL (SQL) — Already References `project_id`

| Table                  | Column       | Constraint | Notes                                      |
| :---------------------- | :----------- | :--------- | :----------------------------------------- |
| `time_entries`         | `project_id` | **None**   | No FK — project lives in Firestore         |
| `activity_sessions`    | (via task)   | **None**   | Indirect reference through task → project  |
| `activity_screenshots` | (via task)   | **None**   | Indirect reference through task → project  |
| `activity_app_logs`    | (via task)   | **None**   | Indirect reference through task → project  |

**References:**
- `Dashboard-Backend/SQL-RT-TableNames.md` — `time_entries` schema
- `Dashboard-Backend/src/lib/postgres/activity-events-postgres.service.js`

---

## Why Projects Should Move to PostgreSQL

### 1. Projects Are Fundamentally Relational

Projects have classic relational patterns that Firestore works against:

```
projects  ←—M:N—→  members        (via project_members)
projects  ←—1:N—→  budgets        (via project_budgets)
projects  ←—M:N—→  clients        (via client_projects, PLUS a direct client_id on the project row itself — see schema note below)
projects  ←—M:N—→  teams          (via team_projects)
projects  ←—1:N—→  tasks          (via tasks collection)
projects  ←—1:N—→  time_entries   (already in PostgreSQL)
```

Every one of these is a junction or foreign-key relationship — the bread and butter of a relational database.

### 2. The Dashboard Is Doing SQL's Job in JavaScript

In `Dashboard-Backend/src/modules/dashboard/dashboard-base-loader.js`, the `fetchFreshBase()` function fetches projects, budgets, project_members, and tasks from Firestore as **four separate queries**, then the service files manually correlate them:

```js
// dashboard-base-loader.js — four parallel Firestore queries
const [projectsSnap, budgetsSnap, projectMembersSnap, tasksSnap] = await Promise.all([
  db.collection(COLLECTIONS.projects).select(...).limit(300).get(),
  db.collection("project_budgets").select(...).limit(300).get(),
  db.collection("project_members").select(...).limit(3000).get(),
  db.collection("tasks").select(...).limit(800).get(),
]);
```

Then in both `general-dashboard-service.js` and `command-center-service.js`, the data is manually joined:

```js
// general-dashboard-service.js — manual JOIN in JavaScript
const memberCountByProject = new Map();
for (const doc of projectMembersSnap.docs) {
  const pid = str(row, "project_id", "projectId");
  memberCountByProject.set(pid, (memberCountByProject.get(pid) ?? 0) + 1);
}

const budgetByProject = new Map();
for (const doc of budgetsSnap.docs) {
  const pid = str(row, "project_id", "projectId");
  if (pid && !budgetByProject.has(pid)) budgetByProject.set(pid, row);
}
```

**In PostgreSQL, this entire block becomes one query:**

```sql
SELECT
  p.id,
  p.name,
  p.status,
  COUNT(DISTINCT pm.member_id) AS member_count,
  pb.type AS budget_type,
  pb.cost AS budget_total
FROM projects p
LEFT JOIN project_members pm ON pm.project_id = p.id
LEFT JOIN project_budgets pb ON pb.project_id = p.id
WHERE p.status != 'archived'
GROUP BY p.id, pb.type, pb.cost
ORDER BY p.updated_at DESC
LIMIT 300;
```

(Note: `pb.type` is now selected — the original draft of this query dropped it, which is exactly how the budget-type bug above went unnoticed at the query level.)

### 3. Cross-Store Orphans Are a Real Risk

`time_entries` in PostgreSQL stores `project_id` as a UUID, but there is **no foreign key constraint** because the canonical project record lives in Firestore. If a project is deleted in Firestore:

- Time entries referencing that `project_id` become orphans
- No database-level check catches this
- The application must handle cleanup manually (and currently doesn't enforce it)

With projects in PostgreSQL:
```sql
ALTER TABLE time_entries
  ADD CONSTRAINT fk_te_project FOREIGN KEY (project_id) REFERENCES projects(id);
```

### 4. The Migration Trend Already Points This Way

The codebase has a clear historical pattern of moving data from Firestore to PostgreSQL:

| Entity                | Original Store | Current Store  | Notes                                     |
| :--------------------- | :------------- | :-------------- | :------------------------------------------ |
| `activity_sessions`   | Firestore      | **PostgreSQL** | "Moved off Firestore" per NONSQL docs     |
| `activity_screenshots`| Firestore      | **PostgreSQL** | "Moved off Firestore" per NONSQL docs     |
| `activity_app_logs`   | Firestore      | **PostgreSQL** | "Moved off Firestore" per NONSQL docs     |
| `activity_url_logs`   | Firestore      | **PostgreSQL** | "Moved off Firestore" per NONSQL docs     |
| `notifications`       | Firestore      | **PostgreSQL** | "Moved off Firestore" per NONSQL docs     |
| `time_entries`        | —              | **PostgreSQL** | Born in PG (canonical source of truth)    |
| `timesheets`          | —              | **PostgreSQL** | Born in PG (canonical source of truth)    |
| **`projects`**        | **Firestore**  | **Firestore**  | ← Next logical candidate                 |

### 5. Firestore's Strengths Aren't Being Used

Firestore's killer features are **real-time listeners** (`onSnapshot`) and **offline sync**. However, the Dashboard-Web fetches project data via REST polling:

```typescript
// Dashboard-Web/features/dashboard/api/general-dashboard-api.ts
const res = await apiFetch(apiPath("/api/dashboard/general"), {
  headers: { Accept: "application/json" },
  signal: options?.signal,
});
```

No `onSnapshot` listeners. No offline-first patterns. The frontend treats Firestore-sourced data identically to PostgreSQL-sourced data — as JSON from a REST endpoint.

---

## What Should Move

### Migrate to PostgreSQL

| Current Collection         | Proposed Table       | Rationale                                            |
| :-------------------------- | :-------------------- | :------------------------------------------------------ |
| `projects_VirtualTacker`   | `projects`           | Core entity, referenced by PG tables already         |
| `project_members`          | `project_members`    | Classic junction table                               |
| `project_budgets`          | `project_budgets`    | 1:N with projects, used in budget aggregations       |
| `project_member_limits`    | `project_member_limits` | Per-member caps, relational by nature             |
| `client_projects`          | `client_projects`    | Junction table linking clients ↔ projects            |
| `team_projects`            | `team_projects`      | Junction table for visibility scoping                |

### Keep in Firestore

| Collection               | Reason                                                        |
| :------------------------ | :--------------------------------------------------------------- |
| `members`                | Tightly coupled to Firebase Auth UID lookups                  |
| `User_profiles`          | Synced from Firebase Auth (avatars, settings)                 |
| `member_auth_index`      | O(1) Firebase UID → member UUID mapping                       |
| `teams`                  | Low-volume, document-shaped, no SQL cross-references          |
| `invites` / onboarding   | Low-volume, self-contained lifecycle                          |
| `presence/` (RTDB)       | Real-time websocket — exactly what RTDB was built for         |
| `member_tree_cache`      | Denormalized read-heavy cache, fits document model            |
| `tasks`                  | **Future candidate**, but migrate projects first              |

> **Note:** `tasks` is a strong candidate for a follow-up migration since they reference `project_id` and `assigned_to` (both relational), but coupling it with the projects migration increases risk. Migrate projects first, then evaluate tasks separately.

> **Note on `clients`:** `clients` stays in Firestore per this table, but `projects.client_id` (see schema below) is a direct foreign-key-shaped field on the project row pointing at a Firestore-only document. This is the same cross-store-orphan risk described in "Cross-Store Orphans Are a Real Risk" above, just in the other direction, and it will **not** be fixable with a Postgres FK constraint unless/until `clients` also migrates. Worth stating explicitly rather than leaving as an implicit gap.

---

## Proposed PostgreSQL Schema

**Revised.** The original draft of this section invented a simplified schema (a `description`/`color_index` on `projects`, a bare `daily_limit`/`weekly_limit` on `project_member_limits`, `cost` + `seed_budget_spent_pct` only on `project_budgets`) that did not match any real, live field set. The columns below are pulled directly from `Dashboard-Backend/src/modules/schema/catalog/{projects,clients,teams}/index.js`, the codebase's own declared field catalog, cross-checked against the write paths in `project-details-api.ts` and `project-budget-from-clients.js`.

```sql
-- ─── Core Projects ──────────────────────────────────────────────────────
CREATE TABLE projects (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    VARCHAR(200) NOT NULL,
  status                  VARCHAR(20) NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'paused', 'archived')),
  billable                BOOLEAN NOT NULL DEFAULT true,
  disable_activity        BOOLEAN NOT NULL DEFAULT false,
  allow_project_tracking  BOOLEAN NOT NULL DEFAULT true,
  disable_idle_time       BOOLEAN NOT NULL DEFAULT false,
  -- Direct client link, separate from the client_projects M:N junction below.
  -- No FK: clients remain in Firestore (see "Note on clients" above).
  client_id               UUID,
  managers_notes          TEXT,
  users_notes             TEXT,
  viewers_notes           TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID,
  updated_by              UUID,
  archived_by             UUID,
  archived_at             TIMESTAMPTZ
);

CREATE INDEX idx_projects_status ON projects (status);
CREATE INDEX idx_projects_updated ON projects (updated_at DESC);
CREATE INDEX idx_projects_client ON projects (client_id);

-- Project color in the UI is NOT a stored field today - Dashboard-Backend
-- assigns it at query time (`colorIndex % 10` in overview-service.js) and
-- Dashboard-Web maps that index into a fixed palette (project-mapper.ts).
-- Deliberately not adding a color_index column here; if row order becomes
-- unstable enough to make colors flicker, that's a real follow-up decision,
-- not something to bake in as a guess now.

-- ─── Project Members (junction) ─────────────────────────────────────────
CREATE TABLE project_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL,
  project_role  VARCHAR(40),
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by   UUID,
  updated_by    UUID,
  UNIQUE (project_id, member_id)
);

CREATE INDEX idx_pm_project ON project_members (project_id);
CREATE INDEX idx_pm_member ON project_members (member_id);

-- ─── Project Budgets ────────────────────────────────────────────────────
-- type/based_on/resets etc. already exist in Firestore today - they're just
-- never SELECTed by overview-service.js (see "Related Bug" section above).
-- Carrying them forward here is what actually fixes that, not a guess about
-- future need.
CREATE TABLE project_budgets (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type                        VARCHAR(20) NOT NULL DEFAULT 'fixed'
                                CHECK (type IN ('hourly', 'fixed', 'retainer', 'none')),
  based_on                    VARCHAR(20),
  cost                        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notify_project_members      BOOLEAN NOT NULL DEFAULT false,
  notify_at_pct               NUMERIC(5, 2),
  who_to_notify                VARCHAR(255),
  stop_timers_when_reached    BOOLEAN NOT NULL DEFAULT false,
  stop_timers_at_pct          NUMERIC(5, 2),
  resets                      VARCHAR(20) NOT NULL DEFAULT 'never'
                                CHECK (resets IN ('monthly', 'quarterly', 'yearly', 'never')),
  start_date                  DATE,
  include_non_billable_time   BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                  UUID,
  updated_by                  UUID
);

CREATE UNIQUE INDEX idx_pb_project ON project_budgets (project_id);

-- "Spent" is NOT a stored column. Today it's fabricated (0, or a demo seed
-- percentage - see budgetSpent() in overview-service.js). This migration is
-- the natural point to replace it with a real query against time_entries /
-- activity_sessions instead of adding a column and leaving it unfilled.
-- Deliberately left as an open decision, not shipped as a guess:
--   - cost-type budgets: SUM(time_entries.duration-derived cost) WHERE project_id = $1
--   - hours-type budgets: SUM(active_seconds) from activity_sessions joined through tasks
-- Needs product sign-off on the exact billable-time definition before writing this query.

-- ─── Project Member Limits ──────────────────────────────────────────────
-- Real shape mirrors project_budgets (type/based_on/cost/resets), NOT a
-- bare daily_limit/weekly_limit integer pair as originally drafted.
-- BUT (see "Related Bug" #6): the only real reader of this table treats
-- `cost` as a plain max-members headcount, not a budget amount - nothing
-- in the codebase enforces it as an hours/dollar limit despite the shape.
-- Carrying the budget-shaped columns forward here is what today's Firestore
-- doc actually has, but Phase 0 should decide whether that's still right or
-- whether this collapses to (project_id, member_id, max_members) instead.
CREATE TABLE project_member_limits (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id              UUID NOT NULL,
  type                   VARCHAR(20),
  based_on               VARCHAR(20),
  cost                   NUMERIC(12, 2),
  resets                 VARCHAR(20) NOT NULL DEFAULT 'never',
  start_date             DATE,
  notify_at_pct          NUMERIC(5, 2),
  notify_project_members BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             UUID,
  updated_by             UUID,
  UNIQUE (project_id, member_id)
);

CREATE INDEX idx_pml_project ON project_member_limits (project_id);
CREATE INDEX idx_pml_member ON project_member_limits (member_id);

-- ─── Client-Project Mapping ────────────────────────────────────────────
CREATE TABLE client_projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by   UUID,
  UNIQUE (client_id, project_id)
);

CREATE INDEX idx_cp_client ON client_projects (client_id);
CREATE INDEX idx_cp_project ON client_projects (project_id);

-- ─── Team-Project Visibility ───────────────────────────────────────────
CREATE TABLE team_projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by   UUID,
  UNIQUE (team_id, project_id)
);

CREATE INDEX idx_tp_team ON team_projects (team_id);
CREATE INDEX idx_tp_project ON team_projects (project_id);

-- ─── Add FK to existing time_entries ───────────────────────────────────
ALTER TABLE time_entries
  ADD CONSTRAINT fk_te_project FOREIGN KEY (project_id) REFERENCES projects(id);
```

---

## Migration Strategy: Direct Cutover

**Revised.** The original draft used a 3-phase dual-write pattern (Firestore + PostgreSQL written in parallel for weeks, a drift-detection cron, gradual read-switch) — the same pattern proven for the activity-data migration. That pattern exists to protect a **live system with real production volume** from a slow, risky cutover. Confirmed with the project owner that current project data volume is low. Running weeks of dual-write, drift-checking, and parallel-output comparison to migrate a small dataset is solving a problem that doesn't exist here — it adds real engineering time (the write-path fan-out, the cron, the comparison tooling) for a safety margin a small dataset doesn't need.

Instead: **backfill once, cut over in a single maintenance window, keep Firestore collections read-only as a fallback for a short retention period.**

> **⚠️ Still true regardless of data volume:** Projects touch almost every read/write path in the system — tasks, budgets, clients, teams, activity, time entries, dashboards, and the Tauri agent. The *cutover* can be simple; the *set of things that need updating in the same change* is not smaller just because the dataset is small. Every file listed below still needs touching.

### Phase 0: Decide Real "Spent" Semantics

**Goal:** before any schema work, get product sign-off on how `spent` should actually be computed per budget type (cost vs hours), since today it's `0` or a demo percentage — there is no existing correct behavior to preserve. Also decide `project_member_limits`' real shape (see "Related Bug" #6 — headcount cap, not a budget).

**Files affected:** none yet — this is a decision, not code.

### Phase 1: Backfill + Cutover

**Goal:** PostgreSQL becomes the sole source of truth for the projects domain in one change, not a gradual read-switch.

1. Create the PostgreSQL tables (schema above)
2. Write a one-time migration script that **scans live documents**, not just the schema catalog (see caveat above — undeclared fields like `_seedBudgetSpentPct` exist in real data) and backfills every row into PG
3. In the same change: repoint every write path (project CRUD, `project-budget-from-clients.js`'s client-sync trigger, member/team link management) to write PostgreSQL only
4. Repoint every read path (`dashboard-base-loader.js`, `general-dashboard-service.js`, `command-center-service.js`, `activity-scope.js`) to PostgreSQL, including `budget.type`/`based_on` so the frontend can finally render it correctly
5. Add FK constraint on `time_entries.project_id`
6. Rework `dashboard-base-loader.js`'s snapshot cache (`system_meta` / `dashboard_aggregates` doc, 5-minute TTL, kicks in at 100+ projects — `LARGE_ORG_PROJECT_THRESHOLD`). It serializes raw Firestore `.data()` shape via `serializeDoc()`/`pseudoDocsFromSerialized()`; Postgres rows won't round-trip through that unchanged. With low volume, simplest fix is likely dropping this cache layer entirely rather than porting it — it exists specifically for the 100+ project case.
7. Ship in one deploy. Keep the Firestore collections **read-only, untouched, for N days** (pick a retention window) as the actual rollback plan — cheaper than a drift cron for a small dataset, and just as real a safety net.

**Risk:** Low-medium — no parallel-write complexity to get wrong, but it's a real cutover, not a passive replica step. Test the backfill script against a copy of production data before the maintenance window, not against it live.

**Files affected:**
- `Dashboard-Backend/src/modules/schema/services/` — generic CRUD services for projects, project_members, project_budgets
- `Dashboard-Backend/src/modules/projects/routes.js` — the actual project CRUD endpoints (create/update/archive/delete), not just the generic schema layer
- `Dashboard-Backend/src/modules/projects/services/project-budget-from-clients.js` — the client-link-triggered write path into `project_budgets`
- `Dashboard-Backend/src/modules/dashboard/dashboard-base-loader.js` (incl. snapshot-cache removal/rework)
- `Dashboard-Backend/src/modules/dashboard/general-dashboard-service.js`
- `Dashboard-Backend/src/modules/dashboard/command-center-service.js`
- `Dashboard-Backend/src/modules/activity/activity-scope.js`
- `Dashboard-Web/features/projects/mappers/project-mapper.ts` — add `type` to the mapped budget object, stop hardcoding `currency: "$"`
- `Dashboard-Web/features/projects/models/list.ts`, `Dashboard-Web/features/projects/utils/overview-sort.ts` — add `type` to the `budget` type shape
- `Dashboard-Web/features/projects/components/project-table-cells.tsx` — `formatProjectBudget()` needs an hours-vs-currency branch
- New migration script in `Dashboard-Backend/scripts/`

### Phase 2: Firestore Cleanup

**Goal:** After the retention window passes with no rollback needed, remove the fallback and dead code.

1. Delete the Firestore collections (or archive to GCS first, if a permanent record is wanted beyond the retention window)
2. Remove the 2 composite indexes on `project_members` from `firestore.indexes.json` (see "Related Bug" #8)
3. Clean up `NONSQL-TableNames.md` and `SQL-RT-TableNames.md` documentation
4. Update `DatabaseScheme.md` and `entity-diagram.md`

**Risk:** Low — Phase 1's retention window is the actual safety check; this step is just deleting what's already unused.

---

## Impact on Dashboard Pages

### General Dashboard (`/api/dashboard/general`)

| Current | After Migration |
|---|---|
| 4 Firestore queries + 2 PG queries in `fetchFreshBase()` | 1-2 PG queries replacing Firestore for projects/budgets/members |
| Manual Map-based joins in JS | SQL JOINs in the query layer |
| ~300 doc limit per Firestore collection scan | PG handles this natively with indexes |
| Budget type never read (bug, see above) | Budget type read and threaded through to the frontend |

### Command Center (`/api/dashboard/command-center`)

| Current | After Migration |
|---|---|
| Same 4 Firestore queries via shared `loadDashboardBase()` | Same PG queries (shared loader) |
| Manual budget-per-project correlation | `LEFT JOIN project_budgets` in one query |

### Project Table & Project Overview (`Dashboard-Web/features/projects`)

Not in the original draft — added because these are the two surfaces where the budget-type bug is actually visible to users, and they need frontend changes regardless of when/whether the storage migration happens.

| Current | After Fix |
|---|---|
| `formatProjectBudget()` always prepends `$` | Branches on `budget.type` (hourly → `Xh`, cost-based → `$X`) |
| `ProjectListItem.budget` has no `type` field | `type`/`basedOn` added to the shape, threaded from the API |
| "Spent" always `0` or a seed percentage | Real query against tracked time/cost (Phase 0 decision) |

---

## What This Does NOT Cover

- **Tasks migration** — tasks are a follow-up candidate but should be evaluated separately after projects are stable in PG
- **Clients migration** — `clients` and `client_budgets` remain in Firestore (no PG cross-references today, **except** the direct `projects.client_id` field noted in the schema section, which stays an unconstrained cross-store reference even after this migration)
- **Teams migration** — `teams` and `team_members` remain in Firestore (low-volume, self-contained)
- **Frontend changes for the storage migration itself** — Dashboard-Web only consumes the REST API envelope, never Firestore directly, so swapping the backend's storage engine alone needs no frontend changes. **This does not extend to the budget-type bug** — that requires real frontend changes (`project-mapper.ts`, `list.ts`, `overview-sort.ts`, `project-table-cells.tsx`) independent of and in addition to the storage migration, listed under Phase 1 above.

---

## Verification Plan

**Revised.** No dual-write drift check or cross-source output comparison — those existed to validate a parallel-run that this revision no longer does. The real check for a direct cutover is: does the backfill script produce a PG row for every live Firestore doc, and does the app work correctly reading only from PG.

### Automated
- **Backfill completeness check:** one-time script comparing Firestore doc count vs PG row count per collection immediately after the cutover, not an ongoing cron
- **Existing backend tests** in `Dashboard-Backend/test/` should pass without modification

### Manual
- Test the backfill script against a copy of production data before the real maintenance window (see Phase 1, risk note)
- Verify General Dashboard and Command Center render identically before/after cutover
- Verify project CRUD operations (create, update, archive, delete) from the web UI
- Test edge cases: owner vs manager scope, empty projects, projects with no budget
- Verify an Hours-based project renders as hours (not `$`) in both the Project table and Project overview after the budget-type fix lands
- Verify "spent" reflects a real number for at least one project with actual tracked time, not just `0` or a seeded demo value
- Confirm the Firestore collections are genuinely untouched (no writes) during the retention window — that's what makes the rollback real

---

## Estimated Effort

The original 6-9 day estimate assumed a dual-write/parallel-run pattern sized for a live, high-volume system, and didn't include the schema corrections, the real "spent" implementation, the `syncProjectBudgetFromClients` write path, or the dashboard snapshot-cache rework found during this review. This revision drops the dual-write machinery (low data volume doesn't need it) but keeps the fixes, which is why the range below is close to the previous one despite cutting a whole phase — the two roughly cancel out.

| Phase | Scope | Estimate |
|---|---|---|
| Phase 0 (Spent semantics + member-limits shape) | Product decisions, no code | 0.5-1 day |
| Phase 1 (Backfill + Cutover) | Schema + migration script (incl. live-document scan) + all write/read paths in one change (incl. client-budget sync trigger, snapshot-cache removal, frontend budget-type/spent fix) + FK constraint | 6-9 days |
| Phase 2 (Cleanup) | Delete/archive Firestore collections, drop unused indexes, update docs — after retention window | 0.5-1 day |
| **Total** | | **7-11 days** |

---

*Proposal created: 2026-07-27*
*Revised: 2026-07-27 — schema corrected against live field catalog, budget-display bug folded in, migration strategy simplified from 3-phase dual-write to direct cutover (low data volume), effort re-estimated*
*Status: Draft — awaiting review*
