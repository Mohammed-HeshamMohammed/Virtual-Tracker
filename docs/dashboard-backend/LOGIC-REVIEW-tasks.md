# Logic Bug Review — Tasks

Part of the [full logic review](../LOGIC-REVIEW.md). Covers task assignment, time tracking, review, and reordering.

> **All 6 issues below are fixed**, including the per-assignee-blocking design gap, which was resolved by building the missing feature (Option A) rather than removing the code that implied it. Regression tests: `Dashboard-Backend/test/recompute-task-status.test.js` and `block-task-for-user.test.js`. Full backend suite: 224/224 passing.

---

### ✅ Fixed — 🟡 High — Approving one in-review task assignment silently leaves other assignees stuck in review
**Status:** **Fixed.** `reviewTaskTracking` now loops over every row in `inReviewRows` instead of only `inReviewRows[0]`, matching the sibling `/api/tasks/:taskId/review` endpoint. Returns the last result, preserving the existing single-object response contract the caller wraps in `{ success: true, data }` — no API change.
**File:** `Dashboard-Backend/src/modules/tasks/task-time-tracking.js:389-401`

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

### ✅ Fixed — 🟠 Medium-High — Batch task reorder can partially commit before a permission check fails, with no rollback
**Status:** **Fixed.** Split into the two-pass "validate everything, then write" version below — the 403 now returns before any `updateTaskPg` call in the batch, so a partial write is impossible. The stronger DB-transaction variant (which would also close the pass-1/pass-2 race) was deliberately not taken; see the trade-off note after the solution.
**File:** `Dashboard-Backend/src/modules/schema/routes.js:425-467`

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

### ✅ Fixed — 🟠 Medium — A task can show as "in progress" when nobody is actually working on it
**Status:** **Fixed** (`nextStatus = "blocked"` instead of `"in_progress"`). Note: this branch is currently unreachable — no code path writes `status: "blocked"` onto an individual *assignment* row (only onto the task itself), so `statuses.some((s) => s === "blocked")` can never be true today. Fixed anyway because assignment-level `"blocked"` is a documented state (`STARTED_ASSIGNMENT_STATUSES`, `startTaskForUser` explicitly reads it) that a future write path could plausibly produce, and the branch would then be silently wrong. Covered by the regression test regardless, since the test drives the function directly.
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

### ✅ Fixed — ⚪ Lower confidence → resolved as a bug — Never-started assignee can be promoted straight to "in review" / "done"
**Status:** **Fixed — Option A adopted** (`if (status !== "in_progress") continue;`). A never-started (`"todo"`) assignee is no longer swept into `"in_review"` because a co-assignee hit the task's combined estimate.

**Why Option A, since this was flagged as a product call:** researched how established multi-assignee tools handle it. The exact behavior this bug produced is the recognized anti-pattern — a task "flagged as completed by one of the users, instead of flagged as *done with my part*, which closed the task and removed it from everyone's work list." Asana sidesteps it entirely by allowing only one assignee per task and pushing multi-person work into subtasks with individual owners; tools that do allow multiple assignees (ClickUp, monday.com) pair that with per-assignee completion. Decisive factor for this codebase specifically: it already stores per-assignee `task_assignments` rows each carrying their own `status`, `expected_seconds`, and review state — it is *already* built on the "done with my part" model, and the promotion loop was the one place contradicting its own data model. Option B (keep task-level promotion, fix only the stats) would have kept that contradiction and required a second fix to `participation_percent`/`startedAssignees`; Option A makes those stats correct for free, because a never-started assignee simply stays `"todo"` and `computeParticipationStats` already counts only `STARTED_ASSIGNMENT_STATUSES`.
**File:** `Dashboard-Backend/src/modules/tasks/task-time-tracking.js:115-141`

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

---

### ✅ Fixed — 🟡 High — A task manually set to "Blocked" silently reverts on the next unrelated edit
**Status:** **Fixed.** `recomputeTaskStatus` now preserves an existing `"blocked"` task status in its final fallback branch (the "every assignee is still `todo`" case, where no assignee signal justifies overriding a manual block). The branches that *should* override a block — someone starts work, submits for review, gets approved — are untouched and are explicitly covered by the regression test.
**File:** `Dashboard-Backend/src/modules/tasks/task-assignments.js:537-563` (root cause), interacting with `Dashboard-Backend/src/modules/schema/routes.js:519-546` and `Dashboard-Backend/src/modules/tasks/task-assignments.js:381-440`

`recomputeTaskStatus` derives `tasks.status` purely from the statuses of the task's *assignment* rows. Traced every write path to an assignment's `status` column (`updateAssignmentStatus` call sites in `task-assignments.js` and `task-time-tracking.js`, plus the raw `updateAssignmentPg` calls) — none of them ever writes `"blocked"`. Assignment status can only ever be `todo`, `in_progress`, `in_review`, or `done`. So `recomputeTaskStatus`'s derivation state machine can never actually output `"blocked"` (the one branch that tries to — `statuses.some(s => s === "blocked")` — is dead code for the same reason as the bug above: it's checking a value no assignment row ever has).

Meanwhile, the **task's own** `status` field *can* be set to `"blocked"` directly — the board view's drag-and-drop (`Dashboard-Web/features/tasks/pages/tasks-page.tsx:146-158`, `handleDragEnd`) sends `{ status: "blocked" }` straight to the generic schema-driven `PATCH /api/tasks/:id` (`Dashboard-Backend/src/modules/schema/routes.js:519-546`), which writes the `tasks` row directly and has no awareness of assignments at all - it never calls `recomputeTaskStatus`.

The two paths collide the next time anyone edits that task through the Task Wizard modal. `handleSaveTaskForm` (`Dashboard-Web/features/tasks/hooks/use-task-mutations.ts:287-298`) always sends both `status: formValues.status` *and* `assigneeIds` together, for every edit, not just assignee changes. The frontend's `updateTask` (`Dashboard-Web/features/tasks/api/task-api.ts:358-391`) splits that into two backend calls: first the `PATCH` above, then - because `assigneeIds` is present - `applyAssigneeSync` (`task-api.ts:269-272`), which hits `POST /api/tasks/:taskId/assignments` and runs `syncTaskAssignments` (`task-assignments.js:381-440`). `syncTaskAssignments` **unconditionally** calls `recomputeTaskStatus` as its last step (line 438), regardless of whether the assignee set actually changed. That recompute derives a fresh status from assignment rows - which, as established, can never be `"blocked"` - and overwrites whatever the PATCH just set, with no error, no log, and no signal to the user that their edit silently undid the block.

**Failure scenario:** A manager drags a task to the "Blocked" column (task-level `status` becomes `"blocked"`, correctly, via the direct PATCH). Later, anyone - the same manager or a teammate - opens that task in the edit modal just to fix a typo in the title and hits Save. The save request always carries the current assignee list alongside the edit, which triggers assignment sync, which triggers `recomputeTaskStatus`, which - seeing assignees that are `todo`/`in_progress`/`in_review`/`done` but never `blocked` - recomputes the status to something else (e.g. back to `"todo"` or `"in_progress"`) and overwrites the task row. The task silently un-blocks. Nobody who saved the edit asked for that, and nothing in the response indicates it happened.

**Fix direction:** `recomputeTaskStatus` should not clobber an existing `"blocked"` task status when the assignment-derived signal doesn't itself indicate someone has resumed or otherwise progressed the task. The cases that *should* still override a manual block (someone starts working → `in_progress`, submits for review → `in_review`, gets approved → `done`) already have explicit branches above the dead `"blocked"` one; only the final fallback (effectively "all assignees are `todo`") needs to respect a pre-existing manual block instead of silently discarding it.

**Solution:**
```js
// Dashboard-Backend/src/modules/tasks/task-assignments.js:548-563
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
    nextStatus = "in_progress"; // separate bug, see above
  } else {
-   nextStatus = statuses[0] ?? "todo";
+   // No assignee signal (in_progress/in_review/done) overrides a manual
+   // block here - only "todo" assignees are present. Keep an existing
+   // manual "blocked" task status instead of silently reverting it just
+   // because an unrelated field on the task was edited.
+   const previousStatus = task.status ?? "todo";
+   nextStatus = previousStatus === "blocked" ? "blocked" : (statuses[0] ?? "todo");
  }
```
This only changes behavior for the specific case that's actually broken (task manually blocked, all assignees still sitting at `todo`) - every other branch, including the legitimate ones that should override a block (someone starts work, submits for review, gets approved), is untouched. The one-line moved-up `previousStatus` read is already computed a few lines below in the existing function (line 565) - this just needs it earlier, or the existing binding reused instead of redeclared.

**Test to add:** task with one `todo` assignee; manually set task status to `"blocked"` via `updateTaskPg`; call `recomputeTaskStatus`; assert status stays `"blocked"`. Second case: same setup, but flip the assignee to `"in_progress"` first; assert `recomputeTaskStatus` now correctly overrides the block to `"in_progress"`.

---

### ✅ Fixed — Option A adopted — No way to block a single assignee; per-assignee "blocked" is modeled but never written
**Status:** **Fixed.** Built the missing feature: a self-service "I'm blocked, waiting on X" action that blocks only the caller's own assignment, not the whole task.
**File:** `Dashboard-Backend/src/modules/tasks/task-assignments.js` (`blockTaskForUser`, new - mirrors `startTaskForUser`), `Dashboard-Backend/src/modules/tasks/routes.js` (`POST /api/tasks/:taskId/assignments/block`, new - mirrors `.../assignments/start`), `Dashboard-Web/features/tasks/api/task-assignments-api.ts` (`blockTaskAssignment`), `Dashboard-Web/features/tasks/components/list-view.tsx` + `board-view.tsx` (`TaskRowMenu` "I'm blocked" item), `Dashboard-Web/features/tasks/pages/tasks-page.tsx` (`handleBlockTask`)

Three separate places in `task-assignments.js` treated an individual assignment's `status` as if `"blocked"` were a real, reachable value (`STARTED_ASSIGNMENT_STATUSES`, `startTaskForUser`'s resume branch, `recomputeTaskStatus`'s derivation), but no write path ever produced it - only the *task's own* `status` could be set to `"blocked"` (whole-task, via board drag).

**Why Option A:** the practical gap was real - on a multi-assignee task, there was no way to flag that *one* person is blocked while others keep working; the only lever was task-level, blocking everyone at once including people actively logging time. The codebase already models per-assignee state everywhere else (`task_assignments` rows with their own `status`), so the missing write path was the actual gap, not the three read-side references - Option B (deleting them) would have removed the ability to fix this instead of fixing it.

**What was built:**
- `blockTaskForUser(db, { taskId, userId, userName })` - mirrors `startTaskForUser` exactly. Only transitions the caller's *own* assignment (`todo` or `in_progress` → `blocked`; no-ops if already `blocked`, `in_review`, or `done` - can't block work that's finished or under review). Calls `recomputeTaskStatus` afterward, same as every other assignment-status mutation.
- `POST /api/tasks/:taskId/assignments/block` - mirrors `.../assignments/start`'s exact access model: management bypasses the "must be assigned" check, but the action always targets the *viewer's own* assignment (`userId: access.viewer.memberId`), never someone else's on their behalf.
- Frontend: "I'm blocked" in the task row's `⋯` menu (list and board views), next to "Start task". Same optimistic local-state update pattern as `handleStartTask`.
- Fixed `notifyAssignmentStatusChange`'s `nextStatus === "blocked"` branch, which had stale copy from an old reject-flow ("Assignment rejected... was rejected and marked blocked", sent to the assignee themselves). Rewired to notify direct parents + project leadership (same audience as the "started" notification) with accurate copy - notifying yourself that you just blocked yourself was never useful.

**No change needed to `recomputeTaskStatus`'s derivation order:** it already checks `some(in_progress)` before `some(blocked)`, so a task with one blocked assignee and another still actively working correctly stays `"in_progress"` overall - only when *everyone* required is blocked (or blocked-and-done) does the task read as `"blocked"`. This ordering was already correct from the earlier fix above; the new write path just gives it real input for the first time.

**Test:** `Dashboard-Backend/test/block-task-for-user.test.js` - blocking from `todo`/`in_progress` succeeds; blocking from `blocked`/`done` no-ops; a sole assignee blocking themselves blocks the task; blocking while a co-assignee is still `in_progress` keeps the task `in_progress`. Full backend suite: 224/224 passing.
