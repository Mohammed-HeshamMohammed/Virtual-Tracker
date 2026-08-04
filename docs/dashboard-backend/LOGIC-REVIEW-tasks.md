# Logic Bug Review — Tasks

Part of the [full logic review](LOGIC-REVIEW.md). Covers task assignment, time tracking, review, and reordering.

---

### 🟡 High — Approving one in-review task assignment silently leaves other assignees stuck in review
**File:** `Dashboard-Backend/src/modules/tasks/task-time-tracking.js:370-382`

`reviewTaskTracking` (backing `POST /api/tasks/:taskId/time-tracking/review`) only acts on `inReviewRows[0]` — it ignores every other row `getInReviewAssignmentsForTaskPg` returns (there's no `ORDER BY`, so it's whichever row Postgres happens to return first).

**Failure scenario:** Two members are both assigned the same task and both independently hit `in_review`. A manager calls the review endpoint intending to resolve the task. Only one assignee's row moves to `"done"`; the other stays `"in_review"` forever from that call, while the API reports success as if review were fully resolved. The sibling endpoint `POST /api/tasks/:taskId/review` (`routes.js:716-776`) does this correctly by looping over all rows — the two endpoints diverge on the same situation.

**Fix direction:** loop over all `inReviewRows` in `reviewTaskTracking`, same as the sibling `/review` endpoint already does.

**Solution:**
```js
// Dashboard-Backend/src/modules/tasks/task-time-tracking.js:369-382
/** @deprecated Use reviewAssignment from task-assignments */
export async function reviewTaskTracking(db, { taskId, reviewerId, reviewerName, decision, notes }) {
  const inReviewRows = await getInReviewAssignmentsForTaskPg(taskId);
  if (!inReviewRows.length) throw new Error("No assignment in review for this task");

  const mappedDecision = decision === "rework" ? "reject" : decision;
- return reviewAssignment(db, {
-   assignmentId: inReviewRows[0].id,
-   reviewerId,
-   reviewerName,
-   decision: mappedDecision,
-   notes,
- });
+ const results = [];
+ for (const row of inReviewRows) {
+   results.push(
+     await reviewAssignment(db, {
+       assignmentId: row.id,
+       reviewerId,
+       reviewerName,
+       decision: mappedDecision,
+       notes,
+     }),
+   );
+ }
+ return results[results.length - 1];
}
```
Returns the same shape the caller (`routes.js:382-389`) already expects (a single object it wraps in `{ success: true, data }`), so no response-contract change — it just makes sure every in-review row actually gets reviewed, not only the first one Postgres happens to return. If the caller later needs per-assignee results instead of just the last one, return `results` and update `routes.js` accordingly, but that's a separate, deliberate API change, not part of this fix.

**Simpler alternative:** since this function is already marked `@deprecated Use reviewAssignment from task-assignments`, the lower-risk fix might be to stop routing `POST /api/tasks/:taskId/time-tracking/review` through `reviewTaskTracking` entirely and point it at the same loop `routes.js:743-755` already uses for `/api/tasks/:taskId/review` — that endpoint has no known bug. Worth a decision on which endpoint is meant to be the long-term one before patching the deprecated path.

**Test to add:** two assignments in `in_review` for the same task; call the review endpoint once with `decision: "approve"`; assert both assignments end up `"done"`, not just one.

---

### 🟠 Medium-High — Batch task reorder can partially commit before a permission check fails, with no rollback
**File:** `Dashboard-Backend/src/modules/schema/routes.js:436-457`

The per-task project-permission check runs **inside** the update loop, after earlier rows in the same batch have already been written — no transaction wraps the batch.

**Failure scenario:** A manager scoped to project X submits a reorder batch containing one task from project X (allowed) and one from project Y (not allowed). The project-X task's `order_index` gets committed first; the loop then hits the project-Y task, fails the permission check, and returns 403 immediately. The project-X task is left with a changed `order_index` with no corresponding renumbering of the rest of the list — duplicate or gapped order values — and the caller only sees a 403, with no indication a partial write already happened.

**Fix direction:** validate every task's permission up front before writing any row, or wrap the batch in a transaction that rolls back on the first permission failure.

**Solution:**
```js
// Dashboard-Backend/src/modules/schema/routes.js:425-457
try {
  const body = await readJsonBody(req);
  const updates = Array.isArray(body.updates) ? body.updates : [];
  if (!updates.length) {
    sendJson(res, origin, 400, { success: false, error: "body.updates must be a non-empty array" });
    return true;
  }
  const allowedProjects = viewer
    ? await getViewerProjectIds(db, viewer.memberId, viewer.roleName)
    : [];
  const allowedSet = toAllowedProjectSet(allowedProjects);
- const touched = [];
- for (const row of updates.slice(0, 200)) {
-   const id = typeof row?.id === "string" ? row.id : "";
-   const orderIndex = row?.order_index ?? row?.orderIndex;
-   if (!id || typeof orderIndex !== "number" || !Number.isFinite(orderIndex)) continue;
-   const taskData = await getTaskPg(id);
-   if (!taskData) continue;
-   const projectId = String(taskData.project_id ?? taskData.projectId ?? "").trim();
-   if (allowedSet !== null && projectId && !allowedSet.has(projectId)) {
-     sendJson(res, origin, 403, {
-       success: false,
-       error: "Insufficient permissions to reorder tasks in this project.",
-     });
-     return true;
-   }
-   await updateTaskPg(id, { order_index: Math.trunc(orderIndex) });
-   touched.push(id);
- }
+ // Pass 1: validate every row before writing anything.
+ const validated = [];
+ for (const row of updates.slice(0, 200)) {
+   const id = typeof row?.id === "string" ? row.id : "";
+   const orderIndex = row?.order_index ?? row?.orderIndex;
+   if (!id || typeof orderIndex !== "number" || !Number.isFinite(orderIndex)) continue;
+   const taskData = await getTaskPg(id);
+   if (!taskData) continue;
+   const projectId = String(taskData.project_id ?? taskData.projectId ?? "").trim();
+   if (allowedSet !== null && projectId && !allowedSet.has(projectId)) {
+     sendJson(res, origin, 403, {
+       success: false,
+       error: "Insufficient permissions to reorder tasks in this project.",
+     });
+     return true;   // nothing written yet - safe to bail
+   }
+   validated.push({ id, orderIndex: Math.trunc(orderIndex) });
+ }
+ // Pass 2: every row passed permission checks - now write.
+ const touched = [];
+ for (const { id, orderIndex } of validated) {
+   await updateTaskPg(id, { order_index: orderIndex });
+   touched.push(id);
+ }
  if (!touched.length) {
    sendJson(res, origin, 400, { success: false, error: "No valid task updates" });
    return true;
  }
  const data = await getTasksByIdsPg(touched);
  sendJson(res, origin, 200, { success: true, data });
```
This is the "validate everything, then write" version — no partial writes ever happen because the 403 return now fires before any `updateTaskPg` call in the batch. It costs one extra pass over `validated`, which is cheap next to the `getTaskPg` fetch already being done per row. A DB-level transaction wrapping the write loop would also work and additionally protects against a concurrent write racing between passes 1 and 2, but the two-pass version above removes the actually-reported bug (permission-fail-after-partial-write) with a much smaller diff; add the transaction later if the race turns out to matter in practice.

**Test to add:** batch reorder with task A (allowed project) first and task B (disallowed project) second; assert the response is a 403 **and** task A's `order_index` in the DB is unchanged from before the call.

---

### 🟠 Medium — A task can show as "in progress" when nobody is actually working on it
**File:** `Dashboard-Backend/src/modules/tasks/task-assignments.js:559-560`

`recomputeTaskStatus` sets `"in_progress"` for a task where assignees are a mix of `"todo"` and `"blocked"` — no assignee has actually started.

**Failure scenario:** A task has two required assignees: one `"blocked"`, one still `"todo"` (never started). The status-recompute logic falls through to `some(blocked) → "in_progress"`. The task now reads as "in progress" on dashboards and reports despite zero assignees having started work.

**Fix direction:** only set `"in_progress"` when at least one assignee is actually `"in_progress"`; a `blocked` + `todo` mix with no active work should resolve to `"blocked"` or stay `"todo"`.

**Solution:**
```js
// Dashboard-Backend/src/modules/tasks/task-assignments.js:549-563
  const statuses = assignments.map((a) => a.status);
  let nextStatus = "todo";

  if (statuses.every((s) => s === "done")) {
    nextStatus = "done";
  } else if (statuses.some((s) => s === "in_review")) {
    nextStatus = "in_review";
  } else if (statuses.some((s) => s === "in_progress")) {
    nextStatus = "in_progress";
  } else if (statuses.every((s) => s === "blocked" || s === "done")) {
    nextStatus = statuses.some((s) => s === "blocked") ? "blocked" : "done";
  } else if (statuses.some((s) => s === "blocked")) {
-   nextStatus = "in_progress";
+   // Reached only when: no assignee is done/in_review/in_progress, but at
+   // least one is blocked (the rest are todo) - nobody has actually
+   // started, so this should read as blocked, not in_progress.
+   nextStatus = "blocked";
  } else {
    nextStatus = statuses[0] ?? "todo";
  }
```
By the time this branch is reached, every branch above it has already ruled out `done`, `in_review`, and `in_progress` being present in `statuses` — so the only members present here are some mix of `blocked` and `todo`. Since nobody in that mix has started work, `"blocked"` is the honest status (something needs attention before work can proceed) rather than the previous `"in_progress"`, which claimed active work that isn't happening.

**Test to add:** two assignees, one `"blocked"` one `"todo"`; call `recomputeTaskStatus`; assert the task's `status` becomes `"blocked"`, not `"in_progress"`.

---

### ⚪ Lower confidence — Never-started assignee can be promoted straight to "in review" / "done"
**File:** `Dashboard-Backend/src/modules/tasks/task-time-tracking.js:114-140`

`maybePromoteTaskToReview` promotes based on the **task's combined** active seconds across all assignees hitting the estimate, not the seconds logged by each individual assignee. An assignee who logged 0 seconds (still `"todo"`) can be swept into `"in_review"` — and, if approved, marked `"done"` — because a co-assignee did the work. May be intentional "task-level" completion, but it's inconsistent with every other status check in the module treating `"todo"` as strictly not-started, and it inflates participation stats for someone who did no work. Worth a product decision, not necessarily a pure bug.

**Possible solution (pick one, needs a product call first):**
```js
// Dashboard-Backend/src/modules/tasks/task-time-tracking.js:114-134
async function maybePromoteTaskToReview(db, taskId, task, userId, userName, estimatedSeconds, totalActiveSeconds) {
  if (estimatedSeconds == null || totalActiveSeconds < estimatedSeconds) return false;

  const assignmentRows = await getTaskAssignmentsPg(taskId);

  let statusChanged = false;
  for (const row of assignmentRows) {
    const status = String(row.status ?? "todo").toLowerCase();
-   if (status !== "in_progress" && status !== "todo") continue;
+   if (status !== "in_progress") continue;   // only promote assignees who actually worked
    const result = await updateAssignmentStatus(db, row.id, "in_review", userId);
    ...
```
**Option A (shown above):** only promote assignees who are `"in_progress"` — a `"todo"` assignee stays `"todo"` even after the task-level estimate is hit, and `recomputeTaskStatus` (see the bug above) will reflect that the task isn't fully staffed yet.

**Option B:** keep today's task-level promotion behavior (some products do want "close the task once the work is done, regardless of who logged it"), but if so, stop counting never-started assignees in `participation_percent`/`startedAssignees` so those stats stay honest even when the status itself is promoted for everyone.

Flag this to whoever owns task/time-tracking product behavior before picking one — it changes what "in review" means for a never-started assignee, which is a policy question, not just a bug.
