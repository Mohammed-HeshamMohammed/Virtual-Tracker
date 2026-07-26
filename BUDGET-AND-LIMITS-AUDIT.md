# Budget & Limits Enforcement Audit

Traced end-to-end across `Dashboard-Backend`, `Dashboard-Web`, and `Tauri-App-Extension` to answer three questions: does project budget affect tasks, does member limit affect tasks (and does project limit also affect them), and does the Tauri agent know about limits and remember time already spent on a task across days. Extended with a fourth section auditing the Timesheets tab against everything found in 1-3.

Every claim below is backed by a file:line citation and a grep proving the negative cases (i.e. "X is never referenced in Y" is a real search result, not an assumption).

---

## Quick answers

| # | Question | Answer |
|---|---|---|
| 1 | Do project budget/limits affect tasks? | **No.** Project budget is stored and displayed only. Nothing in task creation or time tracking reads it. |
| 2 | Do member limits affect tasks assigned to them? Do project limits also affect them? | **Member limits: yes**, at two points (assignment-time validation + runtime timer capping). **Project limits: no**, same gap as Q1. |
| 3 | Does the Tauri app know about limits, and does it remember time spent on a task across days? | **Mechanism: yes.** Limits are computed server-side and pushed to the agent every 5s; a task's cumulative active seconds persist in Firestore/Postgres across sessions and days, so "8h task, 2h done, 6h left today" is the correct underlying model. **But two real bugs undercut what you actually see**: the displayed "Task total" can go stale and stop including overtime the moment a task is edited after assignment (§3a), and overtime hours have no dedicated field anywhere in the API or UI — they're silently merged into a combined total before they ever leave the backend (§3b). Full detail below — this is what your task looked like it was doing. |
| 4 | Timesheets tab — does it connect to any of the above? | **Half of it, yes; half of it, no — and the "no" half is a real problem.** The Review Queue approves real tracked task-assignment time (§4a). "Manual Time" entries write straight to a completely separate `time_entries` table with **zero limit enforcement, zero connection to `activity_sessions`, zero connection to anything in sections 1-3** (§4b). Someone can type in arbitrary hours through Manual Time and none of the member-limit, task-cap, or (theoretically, once built) project-budget logic ever sees it.

---

## 1. Project budget vs. tasks — NOT connected

### What "project budget" actually is

`Dashboard-Web`'s `ProjectModal` writes a `project_budgets` row per project via `buildBudgetFields()`:

```ts
// Dashboard-Web/features/projects/api/project-details-api.ts:437-451
function buildBudgetFields(payload: CreateProjectFormPayload) {
  return {
    type: payload.budgetType,
    basedOn: payload.budgetBasedOn,
    cost: parseOptionalNumber(payload.budgetTotal) ?? 0,
    notifyProjectMembers: payload.budgetNotifyMembers,
    notifyAtPct: parseOptionalNumber(payload.budgetNotifyAt),
    whoToNotify: payload.budgetWhoToNotify,
    stopTimersWhenReached: payload.hasBudget,
    stopTimersAtPct: parseOptionalNumber(payload.budgetStopTimersAt),
    resets: payload.budgetResets || "Never",
    startDate: payload.budgetStartDate,
    includeNonBillableTime: payload.budgetIncludeNonBillable,
  }
}
```

The form literally has a toggle labeled **"Stop timers when budget is reached"** (`project-modal.tsx`) that maps to `stop_timers_when_reached` / `stop_timers_at_pct` on the backend row.

### Where it's read

`Dashboard-Backend/src/modules/projects/routes.js:203-324` reads `project_budgets` back out **only to populate the edit form** — `budgetType`, `budgetTotal`, `budgetStopTimersAt`, etc. are all round-tripped for display, nothing more.

### Proof it's never enforced

```
$ grep -rin "budget" src/modules/tasks/ src/modules/activity/routes.js
(no output)
```

Zero matches. The entire tasks module and the activity-session start/stop endpoint — the two places that would need to check a budget to actually stop a timer — never reference the word "budget" at all.

```
$ grep -rn "stop_timers_when_reached|stopTimersWhenReached|stop_timers_at_pct|stopTimersAtPct" src --include="*.js"
src/modules/projects/services/project-budget-from-clients.js:78:    stop_timers_when_reached: true,
src/modules/schema/catalog/projects/index.js:52:      stop_timers_when_reached: "boolean",
src/modules/schema/catalog/projects/index.js:53:      stop_timers_at_pct: "decimal",
src/modules/schema/catalog/rules.js:135:      { field: "stop_timers_at_pct", validate: (v) => v >= 0 && v <= 100, ... }
```

Three hits, all writes/schema/validation. **Not one is a read that compares current spend against `cost`/`stop_timers_at_pct` and actually stops something.** The toggle changes a value in the database and nothing else.

### Verdict

Project budget is a **reporting field**, not a control. You can set "Stop timers when budget is reached," blow straight through it, and no timer will ever stop, no task creation will ever be blocked, and no warning will fire. This is presumably not what the toggle implies to whoever's filling out the form.

---

## 2. Member limits vs. tasks — connected in two places; project limits still absent

### 2a. Assignment-time validation (does creating/assigning a task respect the member's limit?)

```js
// Dashboard-Backend/src/modules/tasks/task-workload-validation.js:68-103
export async function validateAssigneeWorkLimits(db, task, assigneeIds, options = {}) {
  const taskDailyHours = computeTaskDailyHours(task);
  const expectedSeconds = estimateAssignmentSeconds(task);
  const newTaskHours = expectedSeconds != null ? expectedSeconds / 3600 : 0;
  const errors = [];

  for (const memberId of assigneeIds) {
    if (await memberUsesShiftsForLimits(db, memberId)) continue;

    const [weeklyLimit, dailyLimit] = await Promise.all([
      getMemberLimitHours(db, memberId, "weekly"),
      getMemberLimitHours(db, memberId, "daily"),
    ]);

    if (dailyLimit > 0 && taskDailyHours > 0 && taskDailyHours > dailyLimit) {
      errors.push(`${label}: task requires ${taskDailyHours}h/day but member daily limit is ${dailyLimit}h ...`);
    }

    if (weeklyLimit > 0 && dailyLimit <= 0 && newTaskHours > 0) {
      const existingHours = await sumActiveAssignmentHours(db, memberId, taskId);
      if (existingHours + newTaskHours > weeklyLimit) {
        errors.push(`${label}: assignment would total ${...}h but weekly limit is ${weeklyLimit}h.`);
      }
    }
  }

  if (errors.length > 0) throw new Error(errors.join(" "));
}
```

Called from `task-assignments.js:385` when assignees are set on a task:

```js
await validateAssigneeWorkLimits(db, { ...task, id: taskId }, ids, { taskId });
```

So: assigning a task that requires more hours/day than the member's daily limit allows, or that would push their weekly assignment total over their weekly limit, **throws and blocks the assignment** — not a soft warning, a hard rejection at write time.

### 2b. Runtime enforcement (does starting/continuing the timer respect the member's limit?)

```js
// Dashboard-Backend/src/modules/tasks/timer-limit.service.js:30-117
export async function computeTimerAllowance(db, memberId, task, options = {}) {
  const totalTaskSeconds = estimateAssignmentSeconds(task);          // task's own total cap
  const [weeklyLimitHours, dailyLimitHours] = await Promise.all([
    getMemberLimitHours(db, memberId, "weekly"),
    getMemberLimitHours(db, memberId, "daily"),
  ]);
  const effectiveDailyCapHours = computeEffectiveDailyCap(taskDailyHours, dailyLimitHours);
  // ... sums worked-today, worked-today-on-this-task, worked-this-week from Postgres ...

  const remainders = [];
  if (effectiveDailyCapSeconds > 0) remainders.push(Math.max(0, effectiveDailyCapSeconds - workedTodayOnTaskSeconds));
  if (memberDailyLimitSeconds > 0) remainders.push(Math.max(0, memberDailyLimitSeconds - workedTodaySeconds));
  if (memberWeeklyLimitSeconds > 0 && dailyLimitHours <= 0) remainders.push(Math.max(0, memberWeeklyLimitSeconds - workedWeekSeconds));
  if (totalTaskSeconds != null && totalTaskSeconds > 0) remainders.push(Math.max(0, totalTaskSeconds - currentCumulativeActiveSeconds));

  const allowedRemainingSeconds = remainders.length > 0 ? Math.min(...remainders) : null;
  // ...
}
```

**This is the key mechanic**: every applicable cap (task daily cap, member daily limit, member weekly limit, task total cap) is computed as an independent "seconds remaining" number, and **the most restrictive one wins** (`Math.min(...remainders)`). `computeEffectiveDailyCap` (`task-workload-validation.js:37-41`) itself does `Math.min(taskDailyHours, memberDailyLimit)` when both are set — the task can specify its own daily cap (`duration_hours_per_day` + `overtime_hours_per_day`), and the member's personal daily limit still applies on top of it, whichever is tighter.

`enforceTimerAllowanceOnSync` (`timer-limit.service.js:161-183`) is what actually acts on this:

```js
export async function enforceTimerAllowanceOnSync(db, memberId, task, activeSeconds, action) {
  const allowance = await computeTimerAllowance(db, memberId, task, { currentCumulativeActiveSeconds: activeSeconds });
  if ((action === "start" || action === "resume") && allowance.limitReached) {
    const err = new Error(allowance.message || TIMER_LIMIT_REACHED_MESSAGE);
    err.code = "TIMER_LIMIT_REACHED";
    throw err;
  }
  // ... also hard-caps activeSeconds to allowance.maxCumulativeActiveSeconds if the client sent more
  ...
}
```

Called from `task-time-tracking.js:179` on every session sync. And the HTTP surface that starts a session enforces the same thing:

```js
// Dashboard-Backend/src/modules/activity/routes.js:233-243
const allowance = await computeTimerAllowance(db, member.memberId, task, {
  currentCumulativeActiveSeconds: Math.max(0, Math.floor(activeSeconds ?? 0)),
});
if (allowance.limitReached) {
  sendJson(res, origin, 403, {
    success: false,
    error: allowance.message || TIMER_LIMIT_REACHED_MESSAGE,
    data: { timerAllowance: allowance },
  });
  return true;
}
```

A `POST /api/activity/session` with `action: "start"` gets a **hard 403** if the limit's already blown, with the reason in `error`.

### Where members' limits are actually configured

`getMemberLimitHours(db, memberId, "daily"|"weekly")` reads from `limits(member_id, weekly, daily, ...)` in Postgres (`Dashboard-Backend/src/lib/postgres/member-data-store.js:187-197`, backed by `member-data-postgres.service.js`) — this is exactly the "member limits... accessed through the People > members page" from your question. `memberUsesShiftsForLimits` (same file, line 181-184) is an opt-out: if a member is on shift-based scheduling, daily/weekly caps are skipped entirely and only the task's own total (`totalTaskSeconds`) applies.

### Does project limit also factor in?

No — same absence as Q1. `computeTimerAllowance` and `validateAssigneeWorkLimits` both take `task` and `memberId`, never `project`. A project can have `stop_timers_at_pct: 50` configured and it changes nothing about what `computeTimerAllowance` returns.

### Verdict

Member daily/weekly limits are real, hard-enforced constraints at both assignment time and runtime, correctly combined with the task's own hour caps via a "tightest wins" rule. Project-level limits are completely absent from this same logic — the gap from Q1 repeats here.

---

## 3. Tauri app: limit-awareness and cross-day memory — both implemented

### Does the agent know about limits?

Yes — it doesn't compute anything itself, it polls the same allowance the backend computes for everyone else:

```rust
// Tauri-App-Extension/src-tauri/src/client/api/work.rs
pub fn fetch_task_time_tracking(&mut self, task_id: &str) -> Option<crate::types::TaskTimeTracking> {
    // GET /api/tasks/{task_id}/time-tracking
    // ... maps response.data.timerAllowance into TaskTimeTracking
}
```

```rust
// Tauri-App-Extension/src-tauri/src/types.rs:105-124
pub struct TaskTimeTracking {
    pub active_seconds: u64,
    pub idle_seconds: u64,
    pub task_status: String,
    pub estimated_seconds: Option<u64>,
    pub progress_percent: Option<f64>,
    pub worked_today_seconds: Option<u64>,          // across all tasks today
    pub worked_today_on_task_seconds: Option<u64>,  // this task, today
    pub allowed_remaining_seconds: Option<i64>,      // the Math.min(...remainders) result
    pub limit_reached: bool,
    pub allowance_message: Option<String>,
}
```

`App.tsx` polls this every 5 seconds (`refreshTaskTracking`, `window.setInterval(... 5000)`) and renders it directly:

```tsx
// Tauri-App-Extension/src/App.tsx:737-744
const remainingLabel = !taskTracking
  ? "—"
  : taskTracking.limitReached
    ? "Limit reached"
    : taskTracking.allowedRemainingSeconds == null
      ? "No cap"
      : `${fmtHours(taskTracking.allowedRemainingSeconds)} left`;
```

Plus a warning banner when `taskTracking?.limitReached` is true, and the stat card goes into a `warn` visual state. So the desktop agent is fully limit-aware — it's a thin client over the exact same `computeTimerAllowance` result the backend enforces.

**Gap found while tracing this**: `handleStart()` (`App.tsx:689-711`) does not check `taskTracking?.limitReached` before calling `start_task_session` — the Start button's only disabled condition is `busy || !selectedTaskId`. Clicking Start when already at the limit still round-trips to the backend, which correctly rejects it (the 403 path above) and the error surfaces via `actionError` — so **nothing incorrect happens**, but the button could be disabled client-side to avoid the pointless round trip and give instant feedback instead of a network-round-trip delay.

### Does it remember time already spent, across days, correctly?

Yes. The persistence chain:

1. Every session sync calls `syncTaskTimeTracking()`, which upserts a per-task-per-user Firestore doc (`task-time-tracking` subcollection) with **cumulative** `active_seconds`:
   ```js
   // Dashboard-Backend/src/modules/tasks/task-time-tracking.js:207-220
   const patch = { active_seconds: active, idle_seconds: idle, last_activity_at: now, updated_at: now };
   await taskChildDocRef(db, taskId, "task-time-tracking", trackingDoc.id).update(patch);
   ```
   This value is never reset by a day boundary — it only grows (or gets capped by `enforceTimerAllowanceOnSync`).

2. `computeTimerAllowance` receives that cumulative value as `currentCumulativeActiveSeconds` and computes `totalTaskSeconds - currentCumulativeActiveSeconds` as one of the remainder candidates (`timer-limit.service.js:100-102`). `totalTaskSeconds` itself (`estimateAssignmentSeconds`, `task-assignments.js:89-106`) is `(hoursPerDay + overtimePerDay) × workingDays` — the task's **total** allotment, not a daily figure.

3. Separately, `workedTodayOnTaskSeconds` is summed fresh from Postgres `activity_sessions` bounded to `[todayStart, todayEnd]` (`timer-limit.service.js:76-82`, `sumPgMemberActiveSeconds`) — this is the piece that resets daily, used only against the **daily** cap (`effectiveDailyCapSeconds`), never against the task's total.

Concretely, for your example — "8h task, did 2h, stopped, came back":
- `totalTaskSeconds` = 28800s (8h), fixed.
- `currentCumulativeActiveSeconds` = 7200s (2h), read back from the persisted Firestore doc.
- `allowedRemainingSeconds` (task-total remainder) = 28800 − 7200 = 21600s = **6h left** — exactly what you asked for, and it's already how the system behaves today, not something to build.
- Next day, if there's no *daily* cap configured (task daily hours = 0, member daily limit = 0), `workedTodayOnTaskSeconds` resets to 0 for the new day, but `currentCumulativeActiveSeconds` (used against the total cap) is unaffected by day boundaries — so the person still only has 6h left total, not a fresh 8h. If a daily cap *is* set, that's a second, independent ceiling layered on top of the total — you'd be limited to whichever is smaller: the daily cap for today, or the remaining total.

### 3a. Why "Task total" can silently go stale (and stop including overtime)

The number shown in Tauri's **"Task total"** stat card comes from `getTaskTimeTracking`, and it does **not** always recompute live from the task:

```js
// Dashboard-Backend/src/modules/tasks/task-time-tracking.js:291-296
export async function getTaskTimeTracking(db, taskId, userId, options = {}) {
  const assignment = await ensureAssignmentForUser(db, taskId, userId);
  const doc = await findTrackingDoc(db, taskId, userId);
  const taskSnap = await db.collection("tasks").doc(taskId).get();
  const taskData = taskSnap.data() ?? {};
  const estimatedSeconds = assignment.expectedSeconds ?? estimateAssignmentSeconds(taskData);
  //                        ^^^^^^^^^^^^^^^^^^^^^^^^^^ preferred over a fresh calculation
```

`assignment.expectedSeconds` is the `task_assignments.expected_seconds` column — a **frozen snapshot**, not a live value. It only gets recalculated in one place:

```js
// Dashboard-Backend/src/modules/tasks/task-assignments.js:370-419
export async function syncTaskAssignments(db, taskId, assigneeIds = [], options = {}) {
  const taskSnap = await db.collection("tasks").doc(taskId).get();
  const task = taskSnap.data();
  const expectedSeconds = estimateAssignmentSeconds(task);   // fresh, but only computed HERE
  ...
  for (const userId of ids) {
    const existing = existingByUser.get(userId);
    if (existing) {
      await existing.ref.update({
        expected_seconds: expectedSeconds,   // <- the only place this column is ever refreshed
        ...
```

```
$ grep -n "syncTaskAssignments" src/modules/tasks/routes.js
325:      const data = await syncTaskAssignments(db, taskId, assigneeIds, { removeUnlisted });
```

**One call site, and it's tied to the assignee-list endpoint** — it runs when who's assigned changes, not when the task's own hours change. Editing `duration_hours_per_day` / `overtime_hours_per_day` on a task that's already assigned goes straight to the task document (confirmed in `Dashboard-Web/features/tasks/api/task-api.ts:368-371`, the update-payload builder writes `payload.duration_hours_per_day` / `payload.overtime_hours_per_day` directly) and **never touches `task_assignments.expected_seconds`**.

Net effect: assign a task at 8h/day → `expected_seconds` gets set to the 8h-equivalent. Later, add 2h/day of overtime to that same task → the task doc now says 10h/day, but `expected_seconds` still says 8h's worth, forever, until someone re-touches the assignee list. **"Task total" shows the stale 8h figure and never updates**, which is exactly "I added overtime and don't see it."

The cruel twist: **enforcement doesn't have this bug.** `computeTimerAllowance` (`timer-limit.service.js:38`) calls `estimateAssignmentSeconds(task)` directly on the live task doc every time, no caching, no frozen column. So the hour cap you're actually held to silently includes the overtime correctly — you're just never shown it, because the display path (`getTaskTimeTracking`) and the enforcement path (`computeTimerAllowance`) read two different sources of truth that only agree at the moment `syncTaskAssignments` last ran.

### 3b. Overtime hours have no field to display in the first place

Independent of the staleness bug above, overtime is architecturally invisible **by design**, not by omission:

```js
// task-workload-validation.js:29-34
export function computeTaskDailyHours(task) {
  const hoursPerDay = Number(task.duration_hours_per_day ?? task.durationHoursPerDay ?? 0);
  const overtimePerDay = Number(task.overtime_hours_per_day ?? task.overtimeHoursPerDay ?? 0);
  const total = hoursPerDay + overtimePerDay;      // <- summed and the parts discarded
  return Number.isFinite(total) && total > 0 ? total : 0;
}
```

```js
// task-assignments.js:89-94 (estimateAssignmentSeconds) — identical pattern
const hoursPerDay = Number(taskData.duration_hours_per_day ?? taskData.durationHoursPerDay ?? 0);
const overtimePerDay = Number(taskData.overtime_hours_per_day ?? taskData.overtimeHoursPerDay ?? 0);
const hoursTotal = hoursPerDay + overtimePerDay;    // <- same
```

Every function that touches these two fields adds them together immediately and returns one blended number. Neither `TaskTimeTracking` (Rust, `types.rs:105-124`) nor `timerAllowance`'s JSON shape (`buildAllowanceResult`, `timer-limit.service.js:122-152`) carries a separate `overtimeSeconds` — because nothing upstream of them ever produced one. This isn't a rendering gap in Tauri; the value was thrown away in the backend before an API response was ever built. There is currently no code path anywhere in the repo — backend or either frontend — that exposes regular-hours and overtime-hours as two distinct numbers past the point they're first read off the task document.

### Verdict

The underlying model is sound — cumulative time worked, checked against a task total that persists across days — and that part genuinely works as described (§ "Concretely, for your example" above still holds when nothing's been edited since assignment). But two real, confirmed bugs mean what you actually observe often won't match that model: **(1)** "Task total" freezes at whatever `expected_seconds` was when assignees were last synced, silently diverging from the live number enforcement uses the moment a task's hours are edited afterward — this is very likely why it looked like your total wasn't moving; **(2)** overtime hours are combined into totals immediately on read, with no distinct field ever produced, so there's nothing for either frontend to show even where it would make sense to. Both are backend fixes; Tauri (and Dashboard-Web, which reads the same `plannedDurationSeconds` shape from `/api/tasks/:id/progress` and `/progress/me`) are just faithfully displaying whatever the backend hands them.

---

## 4. Timesheets tab — two systems wearing one tab

`Dashboard-Web`'s Timesheets area has two distinct sub-features that look like one feature from the tab bar. They connect to completely different backend data, and only one of them touches anything from sections 1-3.

```
features/timesheets/components/approvals/...        <- "Manual Time" entry (ManualTimeContent.tsx)
features/timesheets/components/view-edit/...         <- "Review Queue" (ReviewQueueTable.tsx)
```

### 4a. Review Queue — connected to the real tracked data

```ts
// Dashboard-Web/features/timesheets/components/view-edit/hooks/use-review-queue-mutations.ts
import { reviewAssignment } from "@/features/tasks/api/task-assignments-api"

async function submitReview(assignmentId, decision, notes) {
  const result = await reviewAssignment(assignmentId, decision, notes)
  ...
}
```

This calls straight into the same `task_assignments` review workflow already covered in §3 — the assignment's `active_seconds` is whatever was actually tracked (and capped) by `enforceTimerAllowanceOnSync` the whole time. Approving here doesn't edit hours, only flips status:

```js
// Dashboard-Backend/src/modules/tasks/task-assignments.js:846-876 (reviewAssignment)
if (decision === "approve") {
  const result = await updateAssignmentStatus(db, assignmentId, "done", reviewerId, {
    reviewState: "approved",
    reviewedBy: reviewerId,
    reviewedAt: now,
    reviewNotes: notes ?? "",
  });
  await recomputeTaskStatus(db, assignment.taskId);
  ...
}
```

No hour figure is ever touched by the review action itself — it's a pure status gate over numbers that were already correctly enforced. **This half of Timesheets is fine and does connect to everything audited above.**

### 4b. Manual Time — a fully separate, unenforced table

`time_entries` is served through the generic schema-CRUD module, not the tasks module:

```js
// Dashboard-Backend/src/modules/schema/catalog/timesheets/index.js:4-27
export const timesheetSchemas = [
  { key: "time-entries", storage: "postgres", table: "time_entries",
    fields: { id, member_id, project_id, task_id, date, start_time, end_time, duration, description, billable, status, ... } },
  { key: "timesheets", storage: "postgres", table: "timesheets",
    fields: { id, member_id, period_start, period_end, status, total_hours, billable_hours, ... } },
]
```

The insert path is a blind write — no service in this call chain has anything to do with limits, tasks, or the timer:

```js
// Dashboard-Backend/src/modules/schema/services/postgres-crud.service.js:168-191
if (entityKey === "time-entries") {
  const rows = await query(
    `INSERT INTO time_entries
      (id, member_id, project_id, task_id, date, start_time, end_time, duration, description, billable, status, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ...`,
    [payload.id, payload.member_id, payload.project_id, payload.task_id ?? null, payload.date,
     payload.start_time ?? null, payload.end_time ?? null, payload.duration ?? 0, ...],
  );
  return normalizePgRow(rows[0]);
}
```

`payload.duration` is trusted verbatim — whatever the client sends is what gets stored. Confirmed via search: no call to `validateAssigneeWorkLimits`, `computeTimerAllowance`, `getMemberLimitHours`, or anything from the timer-limit machinery appears anywhere in `postgres-crud.service.js` or the schema route layer that serves it.

And when a `timesheets` (period submission) row gets totaled up, it sums *this same disconnected table*, never the actually-tracked data:

```js
// postgres-crud.service.js:311-324
export async function computeTimesheetHours(memberId, periodStart, periodEnd) {
  const [summary] = await query(
    `SELECT COALESCE(SUM(duration), 0) / 3600.0 AS total_hours,
            COALESCE(SUM(CASE WHEN billable THEN duration ELSE 0 END), 0) / 3600.0 AS billable_hours
     FROM time_entries
     WHERE member_id = $1 AND date BETWEEN $2 AND $3 AND status != 'rejected'`,
    [memberId, periodStart, periodEnd],
  );
  return { total_hours: Number(summary?.total_hours ?? 0), billable_hours: Number(summary?.billable_hours ?? 0) };
}
```

`SUM(duration) FROM time_entries` — never `activity_sessions`, never `task-time-tracking`. A submitted/approved timesheet period total is **entirely self-reported**.

### What this means in practice

Everything sections 1-3 established — member daily/weekly caps, task total caps, the tightest-wins model, the (currently absent) project budget hook — applies exclusively to time tracked through the timer (Tauri agent or the web activity session). None of it applies to a row typed into Manual Time. Concretely:

- A member at their weekly limit, correctly blocked from starting the Tauri timer, can open Timesheets → Manual Time and log any number of hours for any date with no check against that same limit.
- A task with an 8h total cap that's already fully consumed (timer refuses to start) can still receive additional logged hours via Manual Time — the two systems don't know about each other.
- The `billable` flag and `status` (`pending`/`rejected`/etc.) on `time_entries` exist and get summed into `timesheets.total_hours`/`billable_hours`, so whatever downstream reporting or invoicing reads those period totals is reading numbers that never passed through the enforcement this whole audit is about.

This isn't necessarily wrong as a *product* decision — manual time entry for e.g. offline/field work that the agent can't track is a legitimate use case — but as it stands there's no visible distinction anywhere in the data model between "verified, agent-tracked, limit-enforced hours" and "self-reported, unverified hours." Both end up as rows that can feed the same `timesheets.total_hours` figure.

### Verdict

Review Queue: sound, correctly wired to real enforced data, nothing to fix. Manual Time: a parallel, fully-trusted, zero-validation time-logging path that every constraint in sections 1-3 is blind to. If Timesheets is meant to be the authoritative record for payroll/billing, this is arguably the biggest gap in the whole system — bigger than the missing project-budget hook, because at least project budget's absence just means a cap doesn't fire; Manual Time means the whole enforcement layer can be routed around entirely by using a different tab.

---

## Summary table

| Constraint | Configured where | Enforced at task creation/assignment | Enforced at timer start/sync | Visible in Tauri agent |
|---|---|---|---|---|
| Task's own hours (`duration_hours_per_day`, `overtime_hours_per_day`, total via working days) | Task form | — (it *is* the thing being checked against) | ✅ `timer-limit.service.js` | ✅ |
| Member daily/weekly limit | People → member → Limits | ✅ `validateAssigneeWorkLimits` | ✅ `computeTimerAllowance` | ✅ (folded into `allowedRemainingSeconds`) |
| Project budget (`cost`, `stop_timers_at_pct`, `stop_timers_when_reached`) | Project modal | ❌ never checked | ❌ never checked | ❌ never sent |
| Overtime hours (`overtime_hours_per_day`) as a *distinct* figure | Task form | — | ✅ folded into enforcement correctly (live) | ❌ never exposed — merged into totals before any API response is built |
| "Task total" display accuracy after a post-assignment hours edit | — | — | ✅ enforcement always live | ❌ can go stale — reads a frozen `assignment.expected_seconds` snapshot instead of recalculating |
| Timesheets → Review Queue (approve/reject tracked assignment time) | — | — | ✅ operates on real, already-enforced `active_seconds` | n/a (web only) |
| Timesheets → Manual Time (`time_entries` rows) | Timesheets tab, typed by hand | ❌ no limit check on insert | ❌ not connected to `activity_sessions` or the timer at all | n/a (web only) |

---

## Implemented (this pass)

Four of the seven items below were safe to ship without any open design question — done, committed against this doc:

- **§3a fix — stale `estimatedSeconds`.** `getTaskTimeTracking` and `syncTaskTimeTracking` (`Dashboard-Backend/src/modules/tasks/task-time-tracking.js`) no longer prefer the frozen `assignment.expectedSeconds` snapshot; both now call `estimateAssignmentSeconds(task)` live, matching what `computeTimerAllowance` already did. "Task total" can no longer silently disagree with what enforcement is actually using.
- **§3b fix — overtime exposed as its own field.** `task-assignments.js` gained `estimateAssignmentOvertimeSeconds()` (factored the shared working-days calc out of `estimateAssignmentSeconds` into `workingDaysForTask()` so both share it, no duplicated logic). `getTaskTimeTracking` now returns `overtimeSeconds` alongside `estimatedSeconds`. Threaded through Tauri's `TaskTimeTracking` struct (`types.rs`), the `work.rs` fetch mapping, and the frontend type — "Task total" now shows a `+Xh overtime` sub-label under it when overtime is set (`App.tsx` stat card, new `.stat-card-sub` style).
- **Start button pre-check.** `handleStart()` now checks `taskTracking?.limitReached` before calling `start_task_session` and shows the allowance message immediately instead of round-tripping to get rejected; the button itself is now also `disabled` (with a matching `title` tooltip) when the limit's already reached, not just when busy/no-task-selected.
- **§4b partial fix — `time_entries.source`.** Added a `source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'tracked'))` column (`ensure-lookup-schema.js` + `schema.sql`, with an `ADD COLUMN IF NOT EXISTS` for already-deployed databases). The Manual Time insert path (`postgres-crud.service.js`, the only writer this table has ever had) now stamps every row `source: 'manual'` explicitly — a fact, not a guess, since no other code path writes to this table. This is the data-layer half of recommendation 6(b) below: the distinction now exists and is queryable. **Not done**: a UI surface to actually display it — there's currently no existing view that lists individual `time_entries` rows with per-row detail to attach a badge to (Manual Time is a creation form; Review Queue operates on a different table entirely, §4a) — surfacing it would mean designing a new list view, which felt like a decision to make deliberately rather than bolt on.

Verified: `cargo build` clean (Tauri backend), `tsc --noEmit` clean, `vite build` clean, `node --check` clean on every touched backend file.

## Where to go from here (still not implemented — genuinely need a decision, not just code)

1. **Project budget enforcement is the real gap.** Investigated this pass and found it's *not* a small addition: the existing project-budget-usage machinery (`client-budget-usage.js` → `sumBillableHoursForProjectInPeriod`) already sums from `time_entries` — the same disconnected, unenforced table §4b is about. Reusing it would mean tying real-time enforcement to self-reported data. Doing it properly means a *new* aggregation over `activity_sessions` (the real tracked data), joined through Firestore task→project lookups since `activity_sessions` has no `project_id` column — a genuinely new query added to the hottest path in the system (`computeTimerAllowance`, called on every timer start/sync). Didn't want to guess that shape or its performance profile without confirming first.
2. Still needs deciding: **hours-based vs. cost-based** project budget semantics (see original reasoning below) — this determines what #1 even looks like.
3. **Manual Time still bypasses every constraint in §1-3.** The `source` tag (done, above) makes the gap *visible*; it doesn't close it. Still an open choice between (a) running limit checks against manual entries before insert, or (b) leaving them unchecked by design but now at least distinguishable downstream. Only (b)'s foundation is in — (a) is a behavior change to how people log hours and shouldn't happen without confirming it's actually wanted (could break a legitimate offline/field-work workflow if done wrong).
4. Whether **Manual Time needs a separate insert path at all**, or should produce the same kind of assignment/tracking record the agent does — still an open architecture question, not something to decide unilaterally.

<details>
<summary>Original reasoning for #2 (hours-based vs. cost-based)</summary>

Worth deciding intentionally: should project budget realistically be **hours-based** (fits the same seconds-remaining model as everything else) or strictly **cost-based** (dollars, which doesn't map onto "seconds remaining" at all and would need a different enforcement shape — e.g. blocking at the project level rather than per-task-per-member)? The current form already models it as choosable between the two (`Cost based` / `Hours based`, per the change pushed earlier this session) — cost-based budgets would need a fundamentally different check than the time-remainder model everything else uses.

</details>
7. Given the Review Queue (§4a) already correctly reuses the tracked-assignment pipeline, it's worth checking **whether "Manual Time" needs to exist as a separate insert path at all**, or whether it should create the same kind of task-assignment/tracking record the agent does (with an explicit manual-entry marker), so it flows through one enforcement + one review pipeline instead of two.
