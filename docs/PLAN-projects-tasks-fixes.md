# Plan — Projects & Tasks fixes

**Status: shipped.** All items below are live on `main`.

Three reported issues in `Dashboard-Web`:

1. Budget column on the Projects page only shows hours (never money).
2. Saving an edited project through the Add/Edit Project modal is slow.
3. Batch actions don't do anything on the Projects page, and the Tasks page has no batch/multi-delete at all.

Guiding principle for every fix below: **do the least that actually works** — reuse the mutations, endpoints, and selection state that already exist; wire dead UI to live handlers; don't rebuild. Each section lists the symptom, the root cause (with file references), the minimal fix, and the risks to watch.

---

## Issue 1 — Budget column shows hours only

### Where it renders
- Formatter: [`formatProjectBudget`](Dashboard-Web/features/projects/components/project-table-cells.tsx:6) — `type: "hours"` → `"40h"`, `type: "cost"` → `"$5.0k"`.
- Cell: [`projects-tab.tsx:227`](Dashboard-Web/features/projects/components/tables/projects-tab.tsx:227) renders `<BudgetBar type={project.budget.type} />` / `formatProjectBudget(spent, type)`.
- The `type` and `total` come from [`mapApiProject`](Dashboard-Web/features/projects/pages/projects-page.tsx:63):
  ```ts
  budget: budgetRow ? {
    spent: budgetRow.spent ?? 0,
    total: budgetRow.cost,                                  // <-- see below
    type: budgetRow.type === "Hours based" ? "hours" : "cost",
  } : null
  ```

### Root cause — two things to confirm/fix
The type string is only `"hours"` when the DB row's `type` is exactly `"Hours based"`. So "everything shows hours" means budget rows are reaching the mapper with `type === "Hours based"` when they shouldn't. Two concrete suspects, in priority order:

1. **`total: budgetRow.cost` ignores the server-computed `target`.** The backend already returns a correct `target` and `spent` for every row ([`routes.js:763`](Dashboard-Backend/src/modules/projects/routes.js:763)); for `scope === "per_person"` rows, `cost` is *hours-per-member*, not a real total. Using `cost` instead of `target` makes per-person cost budgets render a tiny/wrong hours-looking number. **Fix: use `budgetRow.target ?? budgetRow.cost` for `total`.**
2. **Client-budget aggregation can overwrite `budgetType` to "Hours based".** [`aggregate-client-budgets.ts:15`](Dashboard-Web/features/projects/utils/aggregate-client-budgets.ts:15) maps an `hourly` client budget to `"Hours based"`, and the modal applies this on client select ([`project-modal.tsx:578`](Dashboard-Web/features/projects/components/modals/project-modal.tsx:578)). If projects are created with an hourly client linked, they persist as `"Hours based"` regardless of the user's Cost/Hours toggle. Confirm at runtime whether the affected projects have an hourly client attached.

### Minimal fix
- In `mapApiProject`, change `total: budgetRow.cost` → `total: budgetRow.target ?? budgetRow.cost`. (`target` already equals `cost` for `per_project`, so this is safe for both scopes.)
- Verify the DB `type` values for the affected projects (quick `SELECT id, type, scope, cost FROM project_budgets`). If they're wrongly `"Hours based"`, decide whether the aggregation override in `aggregate-client-budgets.ts` should stop forcing `budgetType`, or only pre-fill it when the user hasn't chosen.

### Risks / edge cases (review lens)
- `budgetRow.spent` is real but the list fetch requests a narrow `fields` list ([`project-details-api.ts:794`](Dashboard-Web/features/projects/api/project-details-api.ts:794)); the GET route ignores `fields` and always attaches `spent`/`target`, so this works today — but if that route is ever changed to honor `fields`, `spent`/`target` must stay in the projection. Add `target` to the requested `fields` list defensively.
- `BudgetBar` divides by `total`; guard against `total === 0` (already handled — falls back to plain `formatProjectBudget`).

---

## Issue 2 — Slow "Save changes" on project edit

### The chain
`handleSubmit` awaits `onSave` before closing ([`project-modal.tsx:730`](Dashboard-Web/features/projects/components/modals/project-modal.tsx:730)) → [`saveProject`](Dashboard-Web/features/projects/hooks/use-project-mutations.ts:77) → [`updateProjectWithDetails`](Dashboard-Web/features/projects/api/project-details-api.ts:685) → then `refetchProjects({ forceRefetch: true })`.

### Root cause
The **edit path runs everything serially**, and each sync does a read-then-diff:
- `updateProject` (1 write)
- `syncClientLinks` — **2 GETs** + deletes/posts ([`:183`](Dashboard-Web/features/projects/api/project-details-api.ts:183))
- `syncProjectMembers` — GET + deletes/posts ([`:549`](Dashboard-Web/features/projects/api/project-details-api.ts:549))
- `syncTeamLinks` — **2 GETs** + deletes/posts ([`:514`](Dashboard-Web/features/projects/api/project-details-api.ts:514))
- budget update/create
- then a **full `forceRefetch`** that re-pulls every project + budgets + members + team links + limits + overview ([`loadProjectListContext`](Dashboard-Web/features/projects/api/project-details-api.ts:792)).

The create path was already optimized to run these concurrently ([`createProjectWithDetails:766`](Dashboard-Web/features/projects/api/project-details-api.ts:766)); the edit path never got the same treatment. That's ~8–13 sequential round-trips plus a full-page refetch on every save.

### Minimal fix (in order of payoff, each independent)
1. **Parallelize the independent syncs.** `syncClientLinks`, `syncProjectMembers`, `syncTeamLinks`, and the budget write only depend on `projectId` (already known) — wrap them in `Promise.all` exactly like the create path. Keep the initial `updateProject` first if any sync needs the fresh row (it doesn't today).
2. **Drop the redundant second GET** in `syncClientLinks` and `syncTeamLinks` (the `existingAfterDelete` re-fetch). Compute the "already linked" set from the first fetch minus the ones just deleted.
3. **Stop doing a full `forceRefetch` on save.** The mutation already has the new form values; update the single row in `setProjects` optimistically (like `deleteProject` does at [`:59`](Dashboard-Web/features/projects/hooks/use-project-mutations.ts:59)) and let the normal staleness refetch reconcile. If a refetch is still wanted for derived fields (member counts, spent), do it in the background without blocking modal close.

### Risks / edge cases
- Parallelizing means one failed sub-request no longer short-circuits the rest; surface a partial-failure message and refetch on error (the create path swallows member-limit errors with `.catch` — mirror that intent deliberately, don't hide real failures).
- Optimistic row update must recompute `type`/`total` the same way `mapApiProject` does, or the row will briefly disagree with the server until the next refetch.

---

## Issue 3 — Batch actions

### 3a. Projects page — dead buttons
The Batch-actions dropdown renders `PROJECT_BATCH_ACTIONS` but every item's `onClick` is just `setBatchOpen(false)` ([`projects-toolbar.tsx:217`](Dashboard-Web/features/projects/components/projects-toolbar.tsx:217)). The page **already** has everything needed:
- `selected: Set<string>` and `setSelected` ([`projects-page.tsx:93`](Dashboard-Web/features/projects/pages/projects-page.tsx:93))
- single-item `archiveProject` / `deleteProject` in the mutations hook.

Config actions: `"Archive selected"`, `"Delete selected"`, `"Set member limit"` ([`project-management-config.ts:9`](Dashboard-Web/features/projects/config/project-management-config.ts:9)).

**Minimal fix:**
- Add `batchArchive(ids)` / `batchDelete(ids)` to [`use-project-mutations.ts`](Dashboard-Web/features/projects/hooks/use-project-mutations.ts) that `Promise.all` over the existing single-item API calls, then clear `selected` and refetch once (not per item).
- Pass typed handlers into `ProjectsToolbar` instead of the string list, and give each dropdown button a real `onClick`. Keep "Delete selected" behind a confirm.
- `"Set member limit"` needs a tiny prompt/modal for the limit value; if that's more than a quick add, ship Archive + Delete first and stub "Set member limit" as a follow-up (member limits are already gated/"coming soon" elsewhere).

### 3b. Tasks page — no multi-select
Single-task delete already works ([`deleteTask`](Dashboard-Web/features/tasks/hooks/use-task-mutations.ts:124), optimistic + rollback) and is wired to the row menu. There is **no multi-select state** — the page only tracks `selectedTaskId` (one) ([`tasks-page.tsx:67`](Dashboard-Web/features/tasks/pages/tasks-page.tsx:67)).

**Minimal fix:**
- Add a `selectedTaskIds: Set<string>` to `tasks-page.tsx` and pass it + a toggle down to `ListView`/`BoardView` (add a checkbox per row, mirroring the Projects table's `toggleOne`/`toggleAll`).
- Add a small batch bar (reuse the Projects dropdown pattern) with **Delete selected** and **Change status**; back them with `Promise.all` over the existing `deleteTask` / `updateTask`.
- There's already a `/api/tasks/batch/reorder` endpoint ([`task-api.ts:415`](Dashboard-Web/features/tasks/api/task-api.ts:415)); a real `/api/tasks/batch/delete` would be nicer but is **not required** — looping the existing single delete is the lazy path and is fine for typical selection sizes.

### Risks / edge cases
- Board view groups by status; a batch status change must move cards across columns and keep optimistic state consistent.
- Deleting the currently-selected/previewed task must clear `selectedTaskId`/`taskPreview` (single delete already does this — batch must too).
- Permission gates: Projects batch actions must respect `canManageProjects`; Tasks status→done is management-only ([`use-task-mutations.ts:154`](Dashboard-Web/features/tasks/hooks/use-task-mutations.ts:154)).

---

## Architecture note
Two small, reusable pieces would keep this DRY without over-building:
- **A shared `batchRun(ids, fn)` helper** (Promise.all + single post-refetch + error surface) used by both Projects and Tasks batch handlers.
- **A shared selection/batch-bar UI** — the Projects toolbar dropdown and the Tasks batch bar are the same widget; extract once, reuse twice. Don't generalize further than these two call sites (YAGNI).

No schema or endpoint changes are required for a first pass; everything reuses existing single-item APIs.

---

## Task checklist
- [x] **#1** `mapApiProject`: `total: budgetRow.target ?? budgetRow.cost`; add `target` to requested budget `fields`; confirm DB `type` values and decide on the client-aggregation override.
- [x] **#2** Parallelize `updateProjectWithDetails` syncs (`Promise.all`); remove redundant second GETs in `syncClientLinks`/`syncTeamLinks`; replace blocking `forceRefetch` with optimistic row update + background reconcile.
- [x] **#3a** Add `batchArchive`/`batchDelete` to project mutations; wire `ProjectsToolbar` dropdown to real handlers with confirm-on-delete; decide scope of "Set member limit".
- [x] **#3b** Add `selectedTaskIds` + row checkboxes to Tasks list/board; add batch bar with Delete / Change status backed by looped existing mutations.
- [ ] Extract shared `batchRun` helper + batch-bar component. (still duplicated between Projects/Tasks handlers — not blocking, YAGNI until a third call site shows up)

## Verification
- Budget: create one Cost-based per-project, one Cost-based per-person, one Hours-based project; confirm the column shows `$` vs `h` correctly and per-person shows the scaled total.
- Save speed: edit a project with several members/teams/clients; confirm the modal closes fast and the row reflects changes (watch the network panel for the round-trip count dropping).
- Batch: select multiple projects → Archive/Delete; select multiple tasks → Delete/Change status; confirm selection clears and permissions are enforced.
