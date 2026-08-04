# Logic Bug Review — Dashboard

Part of the [full logic review](LOGIC-REVIEW.md). Covers the Command Center and general dashboard aggregation.

---

### 🟡 High — "Time Worked" stat is fabricated, not real tracked time
**File:** `Dashboard-Backend/src/modules/dashboard/command-center-service.js:150`

```js
timeWorked: formatDurationHours(scoped.filter((task) => task.status !== "todo").length * 2),
```
`dashboard-base-loader.js` fetches real `timeEntries` and `sessions` specifically for this purpose, but `command-center-service.js` never reads either — `timeWorked` is just `(non-todo task count) × 2 hours`, a constant placeholder.

**Failure scenario:** A project with 3 non-`todo` tasks shows "Time Worked: 6:00" regardless of whether members actually logged 0 hours or 400 hours against those tasks.

**Fix direction:** aggregate `base.timeEntries`/`base.sessions` for the scoped tasks instead of multiplying task count by a fixed constant.

**Solution:**

`dashboard-base-loader.js` already loads `timeEntries` (`duration` in seconds, has `project_id`) and `sessions` (`active_seconds`, has `project_id`) — `command-center-service.js` just needs to sum them per project instead of ignoring them.

```js
// Dashboard-Backend/src/modules/dashboard/command-center-service.js
// — add near the other per-project maps, right after budgetByProject/memberCountByProject:

+ const trackedSecondsByProject = new Map();
+ const timeEntriesSnap = { docs: pseudoDocsFromSerialized(base.timeEntries) };
+ for (const doc of timeEntriesSnap.docs) {
+   const row = doc.data() || {};
+   const pid = str(row, "project_id", "projectId");
+   if (!pid) continue;
+   const seconds = typeof row.duration === "number" ? row.duration : 0;
+   trackedSecondsByProject.set(pid, (trackedSecondsByProject.get(pid) ?? 0) + seconds);
+ }
+ const sessionsSnap = { docs: pseudoDocsFromSerialized(base.sessions) };
+ for (const doc of sessionsSnap.docs) {
+   const row = doc.data() || {};
+   const pid = str(row, "project_id", "projectId");
+   if (!pid) continue;
+   const seconds = typeof row.active_seconds === "number" ? row.active_seconds : 0;
+   trackedSecondsByProject.set(pid, (trackedSecondsByProject.get(pid) ?? 0) + seconds);
+ }

// — inside the projectRows.push({...}) loop, add the field:
    projectRows.push({
      id: doc.id,
      name: str(row, "name") || "Untitled project",
      colorIndex: colorIndex % PROJECT_COLORS,
      health,
      members: members > 0 ? members : 1,
      budgetTotal,
      budgetSpent: spent,
      done: projectTasks.filter((task) => task.status === "done").length,
      total: projectTasks.length,
      inProgress,
+     trackedHours: (trackedSecondsByProject.get(doc.id) ?? 0) / 3600,
    });

// — in the "All Projects" aggregateRow object inside mapProjectPayload, add the sum:
    const aggregateRow = projectId
      ? projectRows.find((row) => row.id === projectId)
      : {
          members: projectRows.reduce((sum, row) => sum + row.members, 0),
          budgetTotal: projectRows.reduce((sum, row) => sum + row.budgetTotal, 0),
          budgetSpent: projectRows.reduce((sum, row) => sum + row.budgetSpent, 0),
+         trackedHours: projectRows.reduce((sum, row) => sum + row.trackedHours, 0),
          done: projectRows.reduce((sum, row) => sum + row.done, 0),
          total: projectRows.reduce((sum, row) => sum + row.total, 0),
          health: "on_track",
        };

// — buildStats: replace the fabricated line with the real value:
function buildStats(projectRow, tasks, projectId, activityPanel) {
  ...
  return {
-   timeWorked: formatDurationHours(scoped.filter((task) => task.status !== "todo").length * 2),
+   timeWorked: formatDurationHours(projectRow?.trackedHours ?? 0),
    ...
  };
}
```
`formatDurationHours` already accepts a raw hour count and formats it `H:MM`, so no change needed there — it was just being fed a fake number. Note `time_entries` are only loaded for the current rolling week in `dashboard-base-loader.js` (`fetchTimeEntriesSinceDate(weekStartKey)`), so this shows week-to-date tracked time, consistent with the rest of the Command Center's weekly framing — call that out in the UI label if a lifetime total was actually intended instead.

**Test to add:** seed a project with one task marked `done` and a `time_entries` row for that project with `duration: 14400` (4 hours), assert Command Center `stats.timeWorked === "4:00"` instead of `"2:00"` (the old `1 task × 2h` placeholder).

---

### 🟡 High — "Budget Used" always shows 0%
**File:** `Dashboard-Backend/src/modules/dashboard/dashboard-utils.js:85-89`

```js
export function budgetSpent(total, row) {
  const pct = num(row, "_seedBudgetSpentPct", "seedBudgetSpentPct");
  if (pct > 0 && total > 0) return Math.round(total * Math.min(pct, 1));
  return 0;
}
```
The real `project_budgets` table has no `_seedBudgetSpentPct` / `seedBudgetSpentPct` column — those are leftover seed-script fields. `num()` returns 0 when the field is absent, so this always returns 0 for real data.

**Failure scenario:** A project with a $10,000 budget and $6,000 actually spent (correctly shown as 60% elsewhere in the app) shows **0%** on the Command Center — actively misleading, not just missing.

**Fix direction:** wire `budgetSpent` to the same `computeProjectSpentPg` calculation used by `/api/project-budgets`.

**Solution:**

Reuse the existing batched spend calculator instead of reading a column that was never populated. `computeProjectSpentForAllPg(db, budgetRows)` (`Dashboard-Backend/src/lib/postgres/projects-postgres.service.js:480`) already does exactly this in one grouped query pass — it's what `/api/project-budgets` uses — but it needs `type`, `based_on`, and `include_non_billable_time` per budget row, and today's dashboard loader only selects `id, project_id, cost, type`.

```js
// Dashboard-Backend/src/modules/dashboard/dashboard-base-loader.js:74
- pgQuery("SELECT id, project_id, cost, type FROM project_budgets LIMIT 300"),
+ pgQuery("SELECT id, project_id, cost, type, based_on, include_non_billable_time FROM project_budgets LIMIT 300"),
```

```js
// Dashboard-Backend/src/modules/dashboard/command-center-service.js
import {
  budgetSpent,
  ...
} from "./dashboard-utils.js";
+ import { computeProjectSpentForAllPg } from "../../lib/postgres/projects-postgres.service.js";

export async function getCommandCenterPayload(db, viewerMemberId) {
  ...
  const budgetByProject = new Map();
  for (const doc of budgetsSnap.docs) {
    const row = doc.data() || {};
    const pid = str(row, "project_id", "projectId");
    if (pid && !budgetByProject.has(pid)) budgetByProject.set(pid, row);
  }

+ const spentByProject = await computeProjectSpentForAllPg(
+   db,
+   [...budgetByProject.entries()].map(([pid, row]) => ({
+     id: pid,
+     type: row.type,
+     based_on: row.based_on,
+     include_non_billable_time: row.include_non_billable_time,
+   })),
+ );

  ...
  const budgetRow = budgetByProject.get(doc.id);
  const budgetTotal = budgetRow ? num(budgetRow, "cost") : 0;
- const spent = budgetRow ? budgetSpent(budgetTotal, budgetRow) : 0;
+ const spent = budgetRow ? (spentByProject.get(doc.id) ?? 0) : 0;
```

`budgetSpent()` in `dashboard-utils.js` becomes dead code once this lands — either delete it, or leave a short comment noting it's unused/superseded so nobody reaches for it again on the next dashboard card.

**Test to add:** seed a project with a `project_budgets` row (`cost: 10000`, `type: "Cost based"`) and enough `time_entries`/task cost data to produce $6,000 of real spend (matching however `/api/project-budgets` computes it for the same fixture), assert Command Center `stats.budgetPercent === 60`, not `0`.

*(Full detail also filed under [Billing & Budgets](LOGIC-REVIEW-billing-budgets.md) — root cause is budget math, symptom shows here.)*

---

### 🟠 Medium — Dashboard cache is never invalidated, serves stale data for up to 60s after any write
**File:** `Dashboard-Backend/src/modules/dashboard/dashboard-cache.js:30`

`invalidateDashboardCache()` and `clearDashboardCache()` are exported but have **zero callers** anywhere in the backend. `dashboard/routes.js` populates the cache (`command-center:${memberId}`, 60s TTL) but nothing clears it on writes.

**Failure scenario:** A manager loads the Command Center (cached). A task is then marked done, changing that project's completion % and budget numbers. Anyone who re-requests the Command Center within the next up-to-60 seconds gets the pre-update numbers.

**Fix direction:** call `invalidateDashboardCache(memberId)` (or a broader org-level clear) from the task/project/budget mutation routes, or drop the TTL significantly if wiring invalidation everywhere isn't practical short-term.

**Solution:**

The cache key is per-viewer (`command-center:${memberId}`), but the underlying data (`loadDashboardBase`) is org-wide — a task update can affect what *every* viewer with access to that project sees, not just the actor. Targeting `invalidateDashboardCache` at one memberId per mutation isn't enough; the practical fix is a full `clearDashboardCache()` call from the write paths, since it's just clearing a small in-process `Map`, not an expensive operation:

```js
// Dashboard-Backend/src/modules/dashboard/dashboard-cache.js — no change needed, already exported:
export function clearDashboardCache() { cache.clear(); }
```

Two places need to call it:

1. **Generic entity writes** (tasks and most other schema-driven entities route through here) — `Dashboard-Backend/src/modules/schema/routes.js`, at the end of each successful POST/PATCH/PUT/DELETE branch (lines ~496, 519, 547, 722, 833, 957):
```js
import { clearDashboardCache } from "../dashboard/dashboard-cache.js";
// ...after each successful write, e.g. inside the PATCH/PUT branch around line 519:
  const data = await updateEntityPg(...); // or whatever the existing success path returns
+ clearDashboardCache();
  sendJson(res, origin, 200, { success: true, data });
```

2. **Project & client budget writes**, which are handled by their own dedicated routers and never touch `schema/routes.js` — `Dashboard-Backend/src/modules/projects/routes.js` (POST/PATCH `/api/project-budgets`) and `Dashboard-Backend/src/modules/clients/routes.js` (client budget endpoints):
```js
import { clearDashboardCache } from "../dashboard/dashboard-cache.js";
// ...after each successful budget create/update:
+ clearDashboardCache();
```

**Belt-and-suspenders:** because it's easy to miss a future write path and silently reintroduce staleness, also cap the cache TTL down from 60s to something short enough that a missed call self-heals quickly rather than staying wrong for a full minute:
```js
// Dashboard-Backend/src/modules/dashboard/dashboard-cache.js:3
- const DEFAULT_TTL_MS = 60_000;
+ const DEFAULT_TTL_MS = 15_000;
```
This doesn't fix the root cause on its own (that's the `clearDashboardCache()` calls above) — it just bounds the damage of the *next* mutation site nobody remembers to wire up.

**Test to add:** integration test — load Command Center (populates cache), mark a task `done` via the mutation route, immediately reload Command Center, assert the response reflects the new `done` count rather than the cached pre-mutation value.
