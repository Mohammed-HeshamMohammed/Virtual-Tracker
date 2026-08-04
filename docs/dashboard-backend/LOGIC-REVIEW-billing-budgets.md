# Logic Bug Review — Billing & Budgets

Part of the [full logic review](LOGIC-REVIEW.md). Covers invoicing automation and project/client budget math.

---

### 🔴 Critical — Auto-invoicing never fires when a send-delay is configured
**File:** `Dashboard-Backend/src/modules/clients/services/invoicing-logic.js:150`

`shouldRunAutoInvoice` passes a **millisecond** value into `addDays`, which expects a **day count**:
```js
const delayMs = invoicing.autoDelaySending * MS_DAY;   // e.g. 7 days = 604,800,000
const firstDue = addDays(asOf, delayMs);                 // addDays does setDate(getDate() + days)
```
`setDate(getDate() + 604800000)` rolls the date ~1.65 million years into the future, not 7 days.

**Failure scenario:** Any client with `autoInvoicing: true` and `autoDelaySending: 7` that has never had an auto-invoice sent (`lastAutoInvoiceAt` unset — true for every newly configured client) gets `firstDue` set to a date so far out that `due` is always `false`. The client's first automated invoice silently never sends. Only `autoDelaySending === 0` avoids the bug by accident. The sibling function `computeNextAutoInvoiceAt` (same file, line 115) uses day counts correctly, confirming this is a genuine unit mix-up.

**Fix direction:** pass `invoicing.autoDelaySending` (the day count) directly to `addDays`, drop the `* MS_DAY` conversion for this call.

**Solution:**
```js
// Dashboard-Backend/src/modules/clients/services/invoicing-logic.js:142-152
export function shouldRunAutoInvoice(invoicing, state = {}) {
  if (!invoicing.autoInvoicing) {
    return { due: false, reason: "auto_invoicing_disabled" };
  }

  const asOf = state.asOf instanceof Date ? state.asOf : new Date();
  const last = state.lastAutoInvoiceAt
    ? new Date(state.lastAutoInvoiceAt)
    : null;
  const periodMs = frequencyToDays(invoicing.autoFrequency) * MS_DAY;
- const delayMs = invoicing.autoDelaySending * MS_DAY;

  if (!last || Number.isNaN(last.getTime())) {
-   const firstDue = addDays(asOf, delayMs);
+   const firstDue = addDays(asOf, invoicing.autoDelaySending);
    return { due: asOf >= firstDue, reason: "first_run", nextAt: firstDue };
  }

+ const delayMs = invoicing.autoDelaySending * MS_DAY;
  const next = new Date(last.getTime() + periodMs + delayMs);
  return {
    due: asOf >= next,
    reason: asOf >= next ? "schedule_elapsed" : "waiting",
    nextAt: next,
  };
}
```
`delayMs` is still needed further down for the `last`-based branch (added to a millisecond timestamp via `new Date(last.getTime() + periodMs + delayMs)`, which is correct as-is), so it's moved rather than deleted — only the `addDays(asOf, delayMs)` call in the first-run branch was wrong. After this fix, `firstDue` for a client with `autoDelaySending: 7` is `asOf + 7 days`, matching `computeNextAutoInvoiceAt`'s already-correct math.

**Test to add:** a unit test asserting `shouldRunAutoInvoice({ autoInvoicing: true, autoFrequency: "monthly", autoDelaySending: 7 }, { asOf: new Date("2026-01-08") })` (no `lastAutoInvoiceAt`) returns `due: true` and `nextAt` within a few days of `asOf`, not centuries out.

---

### 🔴 High — "Total" client budgets get charged to every linked project, not split
**File:** `Dashboard-Backend/src/modules/clients/services/budget-logic.js:86-92`

`computeClientContributionForProject` handles `basedOn: "total"` the same as `basedOn: "per_project"`:
```js
if (budget.basedOn === "per_person") {
  return budget.cost * Math.max(1, Number(scope.memberCount ?? 1));
}
return budget.cost;   // "per_project" AND "total" both fall here
```
But the cap formula it's supposed to mirror (`computeBudgetCap`, same file, line 73) treats them differently: `"per_project"` scales as `cost × projectCount`, while `"total"` stays flat at `cost` regardless of project count.

**Failure scenario:** Client has `type: "fixed"`, `basedOn: "total"`, `cost: 6000`, linked to 3 projects. `aggregateProjectBudgetFromClients` (`Dashboard-Backend/src/modules/projects/services/project-budget-from-clients.js:40`) runs per-project and writes the full `6000` into *each* of the 3 projects' `project_budgets.cost` — instead of splitting the shared $6,000 cap, the org now shows $18,000 of budget capacity across those projects.

**Fix direction:** for `basedOn: "total"`, divide `budget.cost` by the number of projects the client is currently linked to (mirroring how `computeBudgetCap` treats it as a single shared pool).

**Solution:**
```js
// Dashboard-Backend/src/modules/clients/services/budget-logic.js:85-92
/** One client's budget slice when assigned to a single project (stacking). */
export function computeClientContributionForProject(budget, scope = {}) {
  if (!budget) return 0;
  if (budget.basedOn === "per_person") {
    return budget.cost * Math.max(1, Number(scope.memberCount ?? 1));
  }
+ if (budget.basedOn === "total") {
+   return budget.cost / Math.max(1, Number(scope.clientProjectCount ?? 1));
+ }
  return budget.cost;   // "per_project" only, from here down
}
```
The caller needs to supply `clientProjectCount` — the number of projects *this client* is linked to (not the project's own linked-client count, which `memberCount`/project-scoped values already cover). That count is already available via `listProjectIdsForClientPg`, used elsewhere in the same module tree:
```js
// Dashboard-Backend/src/modules/projects/services/project-budget-from-clients.js:1,51-56
import { listClientIdsForProjectPg, listProjectIdsForClientPg, listProjectMembersPg, upsertProjectBudgetPg } from "../../../lib/postgres/projects-postgres.service.js";
...
  for (const clientId of clientIds) {
    const budget = await readClientBudget(db, clientId);
    if (!budget) continue;
    if (!primaryBudget) primaryBudget = budget;
+   const clientProjectCount = budget.basedOn === "total"
+     ? Math.max(1, (await listProjectIdsForClientPg(clientId)).length)
+     : undefined;
-   totalCost += computeClientContributionForProject(budget, { memberCount });
+   totalCost += computeClientContributionForProject(budget, { memberCount, clientProjectCount });
  }
```
This makes the three `basedOn` modes consistent with `computeBudgetCap`'s documented `capFormula`: `per_person` scales with project headcount, `per_project` gives each project the full flat cost (by original design — each project independently gets `cost`, and `computeBudgetCap` scales the *displayed* client-side total by project count to match), and `total` now actually splits one shared cap across the client's linked projects instead of duplicating it.

**Test to add:** unit test with a `basedOn: "total"`, `cost: 6000` client linked to 3 projects — assert `aggregateProjectBudgetFromClients` returns `totalCost <= 6000` per project (specifically `2000` per project if evenly split, or confirm the intended split policy with product first — see note below), not `6000` × 3.

**Open question before implementing:** should a `"total"` budget split *evenly* across linked projects (as shown above), or should the full `$6,000` be treated as a cap enforced at spend-check time across all linked projects combined (i.e., store `6000` once and sum actual spend across projects when checking against it, rather than pre-dividing at write time)? The even-split fix above matches the existing "sum client contributions into `project_budgets.cost`" architecture with the smallest change, but if the product intent is a true shared pool with cross-project enforcement, the deeper fix is to stop writing a per-project `cost` for `"total"` budgets at all and check spend against the client's budget directly at read time instead. Confirm which model is intended before shipping.

---

### 🟡 High — Command Center "Budget Used" always shows 0%
**File:** `Dashboard-Backend/src/modules/dashboard/dashboard-utils.js:85-89`

```js
export function budgetSpent(total, row) {
  const pct = num(row, "_seedBudgetSpentPct", "seedBudgetSpentPct");
  if (pct > 0 && total > 0) return Math.round(total * Math.min(pct, 1));
  return 0;
}
```
The real `project_budgets` table (queried in `dashboard-base-loader.js`) has no `_seedBudgetSpentPct` / `seedBudgetSpentPct` column — those are leftover seed-script fields. `num()` returns 0 when the field is absent, so this always returns 0 for real data.

**Failure scenario:** A project with a $10,000 budget and $6,000 actually spent (correctly shown as 60% on the Projects/Budgets page, via the separate `computeProjectSpentPg` path) shows **0%** used on the Command Center dashboard for the same project — actively misleading, not just missing.

**Fix direction:** wire `budgetSpent` to the same `computeProjectSpentPg` calculation used by `/api/project-budgets`, or feed it real spend data from `dashboard-base-loader.js`.

**Solution:** full code change detailed in [LOGIC-REVIEW-dashboard.md](LOGIC-REVIEW-dashboard.md#-high--budget-used-always-shows-0) — it touches `command-center-service.js` and `dashboard-base-loader.js`, both dashboard-owned files, so the diff lives there. Summary: replace the fabricated `_seedBudgetSpentPct` read with a real call to the already-existing batched `computeProjectSpentForAllPg(db, budgetRows)` (`Dashboard-Backend/src/lib/postgres/projects-postgres.service.js:480`), the same function `/api/project-budgets` already uses — no new spend-calculation logic needs to be written, it just needs to be reused here instead of reading a column that was never populated.

*(This one also appears in the [Dashboard](LOGIC-REVIEW-dashboard.md) file since it surfaces on the Command Center — grouped here because the root cause is budget math.)*
