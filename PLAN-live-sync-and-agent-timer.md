Warning: truncated output (original token count: 20926)
Total output lines: 1338

# Plan — Live sync across the Dashboard, and Tauri agent timer correctness

**Status:** **Implemented 2026-08-07** — Part I (§1–§9) and Part II (§10–§14, T1–T5 and P10) are
fully implemented, with one deliberate scope decision noted inline below.
**Date:** 2026-08-07 · **Implemented:** 2026-08-07
**Scope:** `Dashboard-Backend`, `Dashboard-Web`, `Tauri-App-Extension`

## Implementation status at a glance

| | Status |
|---|---|
| Part I §9 order of work, items 1–16 | ✅ All implemented, incl. Projects/Tasks/Clients full optimistic concurrency |
| Part I item 14 exception | ✅ Members: live-guard shipped for all tabs; optimistic concurrency shipped for **employment, payBill, settings** (Postgres/Firestore single-doc, per-section). **info, roles, workLimits remain excluded** — see the note under item 14 for the per-section reasoning. |
| Part II §14 order of work, P1–P10 | ✅ All implemented, incl. P10 (agent live-sync subscription) |

Jump to [§15](#15-implementation-status-2026-08-07) for the full status writeup, including what was
found additionally missing during the implementation pass (project-budget concurrency, hierarchy
scope frames, and the assignment-review 409) and fixed beyond what this plan originally itemized.

Two related bodies of work, kept in one document because they meet at the timer:

- **[Part I](#part-i--live-sync) — Live sync** (§1–§9). Multi-user staleness, concurrent edits, and
  dead references in the Dashboard web app.
- **[Part II](#part-ii--tauri-agent-timer--ux) — Agent timer & UX** (§10–§14). Five reported issues
  in the desktop agent. Three are self-contained agent bugs with no live-sync component at all
  (T1–T3); two (T4, T5) share the event bus Part I builds and are cross-referenced where they touch.

They can ship independently and in either order. Part II items T1–T3 depend on nothing in Part I.

---

# Part I — Live sync

## 1. The report

> Two or more users on the same page, touching the same data. Someone deletes a project or a task,
> or edits a member, **while I have it open or open in the edit form**. Nothing shows up on my side.
> Then I get an error saying things changed / some condition failed. To get out of it I have to
> refresh the whole Dashboard webapp — not just the page.

Four distinct bugs wear that one coat. Fixing any subset leaves a visible version of the same
complaint.

| # | Bug | What the user sees |
|---|-----|--------------------|
| **A** | No change propagation | Lists keep showing pre-change rows. Manual refresh is the only cure. |
| **B** | No concurrency control on writes | Both save. Second save silently overwrites the first — no error, no warning. |
| **C** | Open form holds dead references | Edit form loads blank, or saves against rows that no longer exist → raw database error. |
| **D** | Cache lives as long as the browser tab | Navigating away and back does not help. Only a full page load does. |

**C and D are what the report is literally about.** A and B are the substrate they grow on.

Guiding principle, same as [`PLAN-projects-tasks-fixes.md`](PLAN-projects-tasks-fixes.md): **do the
least that actually works.** This codebase already ships an authenticated WebSocket, an SSE stream, a
Redis fan-out bus, a shared list cache with a refetch-on-event hook, a targeted server→client push,
and `updated_at` on every table. Every piece needed already exists. Nothing new gets built — the
existing pieces get wired to each other. **Section 5 is a catalogue of cases, not a catalogue of
machinery**; the whole thing lands on one event bus and one guard hook.

---

## 2. Root causes

### Bug A — the client cache has no invalidation path

All list pages read through one module-level `Map`:

- [`list-cache-registry.ts`](Dashboard-Web/shared/tables/hooks/list-cache-registry.ts) — plain
  `Map<string, {data, lastFetchTime, fetchPromise}>`, no TTL of its own.
- [`use-cached-list.ts`](Dashboard-Web/shared/tables/hooks/use-cached-list.ts) — refetch fires on
  mount, on `refetchIntervalMs`, on `visibilitychange`, on a named window event, or on explicit
  `refetch({ forceRefetch: true })`. **Nothing else can ever mark a key dirty.**

Full inventory of what goes stale and for how long:

| Surface | Cache key / mechanism | Staleness window today |
|---------|----------------------|------------------------|
| Projects list | `pm-projects:projects` ([`projects-page.tsx:128`](Dashboard-Web/features/projects/pages/projects-page.tsx:128)) | `staleMs: 300_000`, **no interval** → 5 min, and only if something calls `refetch` |
| Tasks + its project list | `pm-tasks:tasks`, `pm-tasks:projects` ([`tasks-page.tsx:108`](Dashboard-Web/features/tasks/pages/tasks-page.tsx:108)) | 50 s interval |
| Clients + its members/projects | `pm-clients:*` ([`clients-page.tsx:82`](Dashboard-Web/features/clients/pages/clients-page.tsx:82)) | 50 s interval |
| Teams | `people:teams` ([`teams-page.tsx:118`](Dashboard-Web/features/teams/pages/teams-page.tsx:118)) | per-page config |
| Members list | `people-members:members`, plus field-scoped `people-members:members:*` ([`list-cache-registry.ts:64`](Dashboard-Web/shared/tables/hooks/list-cache-registry.ts:64)) | per-page config |
| Invites | `people-members:invites` ([`members-page.tsx:166`](Dashboard-Web/features/members/pages/members-page.tsx:166)) | per-page config |
| Member bans | `people:member-bans` ([`member-bans-page.tsx:39`](Dashboard-Web/features/members/pages/member-bans-page.tsx:39)) | per-page config |
| Member tree / hierarchy | `memberTreeCacheKey(scope)` ([`use-member-tree-data.ts:23`](Dashboard-Web/features/members/hooks/use-member-tree-data.ts:23)), `hierarchy-scoped-*` | per-page config |
| Member profile | [`member-profile-cache.ts`](Dashboard-Web/features/members/services/member-profile-cache.ts) | 60 s SWR |
| Timesheets › review queue | local `useState` ([`ReviewQueueTable.tsx:118`](Dashboard-Web/features/timesheets/components/view-edit/components/ReviewQueueTable.tsx:118)) | **never**, until filters change |
| Timesheets › approvals | `fetchedRef` one-shot ([`approvals/index.tsx:27`](Dashboard-Web/features/timesheets/components/approvals/index.tsx:27)) | **never**, by construction |
| Activity feed | [`activity-feed-cache.ts`](Dashboard-Web/features/activity/utils/activity-feed-cache.ts) + `ACTIVITY_FEED_POLL_MS` ([`activity-feed-context.tsx:183`](Dashboard-Web/features/activity/components/activity-feed-context.tsx:183)) | poll interval |
| Notifications bell | 30 s interval, **gated on `open`** ([`notifications-bell.tsx:77`](Dashboard-Web/shared/ui/layout/components/topbar/notifications-bell.tsx:77)) | **never while the dropdown is closed** |
| Project overview / dashboard / reports / financials / settings | ad-hoc `useEffect` fetches, no shared cache | mount only |

### Bug B — whole-row blind writes

The Add/Edit Project modal loads a full snapshot from `GET /api/projects/:id/edit-state`
([`routes.js:267`](Dashboard-Backend/src/modules/projects/routes.js:267)) and saves the **whole form**
back through `PATCH /api/projects/:id` ([`routes.js:587`](Dashboard-Backend/src/modules/projects/routes.js:587)):

```js
// Dashboard-Backend/src/lib/postgres/projects-postgres.service.js:102
sets.push("updated_at = now()");
const rows = await query(`UPDATE projects SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
```

`WHERE id = $1` and nothing else. No version check, no `If-Match`, no `SELECT … FOR UPDATE`. Last
save wins, on *every field* — including fields the saver never touched, written back from a snapshot
that may be minutes old. `project_budgets` PATCH ([`routes.js:841`](Dashboard-Backend/src/modules/projects/routes.js:841)),
client PUT ([`clients/routes.js:233`](Dashboard-Backend/src/modules/clients/routes.js:233)), member
PATCH ([`compat/routes.js:1160`](Dashboard-Backend/src/modules/compat/routes.js:1160)) and task update
all have the same shape.

The one accidental guard in the codebase is assignment review, which rejects when
`assignment.status !== "in_review"` ([`task-assignments.js:865`](Dashboard-Backend/src/modules/tasks/task-assignments.js:865)).
Right instinct, one route. This plan generalizes it.

### Bug C — the open form holds references to rows that no longer exist

**C1 — the entity itself gets deleted → blank form, then a bare error.**
[`project-modal.tsx:478`](Dashboard-Web/features/projects/components/modals/project-modal.tsx:478)
loads edit state; the failure branch is:

```ts
.catch((err) => {
  if (!cancelled) {
    setSubmitError(err instanceof Error ? err.message : "Failed to load project details")
  }
})
```

`fetchProjectForEdit` throws on 404 ([`project-details-api.ts:497`](Dashboard-Web/features/projects/api/project-details-api.ts:497)).
So when another user deleted the project a second earlier: `setAddForm` never runs, the form stays at
its **empty create-mode initial state**, and `"Project not found"` renders in the submit-error slot at
the bottom. Exactly *"nothing appears to me, then I get an error."* The modal stays open over a dead
entity, and the row is still sitting in the stale list behind it (Bug A).

**C2 — option lists go stale → dead UUIDs get submitted → raw database error.**
The modal fetches its pickers independently and once:

| Picker | Loaded at | Refreshed |
|--------|-----------|-----------|
| Clients / form config | [`project-modal.tsx:420`](Dashboard-Web/features/projects/components/modals/project-modal.tsx:420) | once, plus manual client reload |
| Teams | [`:443`](Dashboard-Web/features/projects/components/modals/project-modal.tsx:443) | on `user.uid` change only |
| Team members | [`:463`](Dashboard-Web/features/projects/components/modals/project-modal.tsx:463) | `[]` deps — **once per mount, never again** |

If a member or client is deleted while the form is open, it stays selectable. Save sends that UUID,
Postgres rejects it on the foreign key, and **nothing maps that error**: a grep for `23503` across
`Dashboard-Backend/src` returns zero hits, while route handlers pass the driver's text straight
through as `e instanceof Error ? e.message`. The user gets constraint-speak — *"things changed for
conditions or whatever."*

**C3 — the entity changed but still exists.** Stale-snapshot overwrite: Bug B, reached through the
same open form.

### Bug D — the cache lives as long as the browser tab

`clearAllListCaches()` has six call sites across three files, and **not one is data-driven**:

- [`browser-state-hygiene.ts:77`](Dashboard-Web/features/auth/services/browser-state-hygiene.ts:77) / [`:84`](Dashboard-Web/features/auth/services/browser-state-hygiene.ts:84) — soft/hard purge on auth transitions
- [`auth-context.tsx:680`](Dashboard-Web/shared/providers/auth/auth-context.tsx:680) / [`:1137`](Dashboard-Web/shared/providers/auth/auth-context.tsx:1137) — sign-out
- [`sidebar-section.tsx:95`](Dashboard-Web/features/profile/components/sidebar-section.tsx:95) / [`:118`](Dashboard-Web/features/profile/components/sidebar-section.tsx:118) — own-profile change

Every one is an *identity* event. Nothing anywhere clears a cache because the underlying **data**
changed.

`invalidatePeopleMemberCaches()` is a little better — clients and member-bans call it — but it covers
People only, and only for the user who performed the action. It is, however, the right shape: it
already knows every key derived from a member ([`list-cache-registry.ts:77`](Dashboard-Web/shared/tables/hooks/list-cache-registry.ts:77)),
which §6.4 reuses rather than re-deriving.

The registry is module state. Next.js App Router client navigation does **not** tear down modules. A
stale key stays stale across every in-app route change, for the whole lifetime of the tab. Only a
full page load resets it. That is not a quirk of the report — it is the documented behaviour of the
code, and it is why *"refresh the page"* doesn't help but *"refresh the whole Dashboard webapp"* does.

---

## 3. Decision

**Reuse the presence WebSocket as a change-notification bus. Send signals, never data. Invalidate the
cache registry — not just the mounted page. Reconcile open forms against the signal. Add optimistic
concurrency on writes.**

### Options considered

#### Option A — broadcast over the existing presence WebSocket *(chosen)*

| Dimension | Assessment |
|-----------|------------|
| Complexity | **Low** — one broadcast function, one client `onmessage` branch |
| New infra | **None** — socket, auth, reconnect, Redis fan-out, targeted push all exist |
| New deps | **Zero** |
| Latency | Sub-second |
| Team familiarity | Already owns and operates this exact code path |

Already running for every signed-in user:

- [`presence-gateway.js`](Dashboard-Backend/src/modules/presence/presence-gateway.js) — WS at
  `/api/presence/ws`, Firebase-token auth, `connectionsByMember` map, heartbeat, and `sendToMember`
  for **targeted** server pushes.
- [`presence-pubsub.js`](Dashboard-Backend/src/modules/presence/presence-pubsub.js) — Redis
  publish/subscribe with local-echo de-dup, so messages cross backend instances.
- [`presence-events-route.js`](Dashboard-Backend/src/modules/presence/presence-events-route.js) — an
  SSE stream that already does **permission-scoped fan-out** via `getVisibleMemberIds`. Precedent for
  scoping if it is ever needed (§4 explains why it is not).
- [`presence-ws.ts`](Dashboard-Web/features/auth/services/presence-ws.ts) — client with heartbeat and
  reconnect backoff, already turning frames into `window` events (`vt-presence-ping`).
- [`use-cached-list.ts:206`](Dashboard-Web/shared/tables/hooks/use-cached-list.ts:206) — the
  `presencePingEvent` option **already** does `window.addEventListener(event, runBackgroundRefetch)`.
  The consumer half of live sync is written and shipped.

**Pros:** shortest diff by a wide margin; no third long-lived connection per tab (there are already
two: WS + SSE); survives multi-instance deploys via Redis; reconnect already battle-tested.
**Cons:** couples "data changed" to a channel named *presence* (rename the module, or accept it); if
the WS is down, sync degrades to today's polling — which is the correct fallback.

#### Option B — new SSE endpoint `/api/events`

Precedent exists ([`presence-events-route.js:54`](Dashboard-Backend/src/modules/presence/presence-events-route.js:54),
[`compat/routes.js:388`](Dashboard-Backend/src/modules/compat/routes.js:388)), so it is not exotic. But
it duplicates a transport already open and authenticated: new route, new auth path, new client, new
reconnect logic, a third connection per tab. Pure cost.

#### Option C — shrink the polling intervals

Trivial and wrong. Still seconds of lag, constant load forever, and it touches none of B, C or D.
Rejected as the answer — though today's polling stays as the WS-down fallback, so it is effectively
already implemented.

---

## 4. Event taxonomy

Two frame classes, matching the two push primitives the gateway already has.

### 4.1 Broadcast — "something changed, go look"

```json
{ "type": "changed", "resource": "projects", "id": "…", "action": "created|updated|deleted", "actor": "member-uuid", "at": 1754524800000 }
```

Delivered to every connected socket via `broadcastToAll`. **Carries no row data.** The receiving
client reacts by refetching **through the endpoint it is already authorized to call**. Consequences:

- **No permission filtering on the broadcast side.** Nothing sensitive is on the wire — the worst a
  client learns is "some project changed", which it could already infer from its own polling.
- **No payload-shape coupling** between backend broadcast sites and the ~8 frontend mappers.
- **No cache-coherency logic.** Refetch is the merge strategy.

`action` is the one field worth carrying beyond a bare signal: a list treats `updated` and `deleted`
identically (refetch), but an **open form cannot** — deleted means close, updated means offer reload.
Without it, C1 stays unfixable.

`resource` values: `projects`, `project-budgets`, `project-members`, `tasks`, `task-assignments`,
`members`, `invites`, `teams`, `clients`, `member-bans`, `hierarchy`, `activity`, `timesheets`,
`notifications`, `settings`.

### 4.2 Targeted — "this changed *for you*"

```json
{ "type": "scope-changed", "reason": "role|project-access|team|ban|hierarchy", "at": … }
```

Delivered with the existing `sendToMember`, whose only current caller is force-sign-out
([`session-cookie-routes.js:43`](Dashboard-Backend/src/modules/auth/session-cookie-routes.js:43)).
Used when what changed is **the viewer's own permissions**, which must not be broadcast. The client
response is deliberately blunt: `clearAllListCaches()` + refetch the current route, because a scope
change invalidates essentially every list at once. This is the one place where the nuclear option is
the correct and lazy one.

---

## 5. Use-case catalogue

Every case below is one of: **A** list staleness, **B** concurrent write, **C** dead reference in an
open surface, **D** cache outlives navigation. The right-hand column names the phase in §6 that
closes it. Cases marked ⚠ have no current mitigation at all.

### 5.1 List and table staleness

| # | Scenario | Today | Target | Fix |
|---|----------|-------|--------|-----|
| 1 | A creates a project; B is on Projects | Invisible up to 5 min | Row appears < 1 s | 6.1, 6.4 |
| 2 | A renames / archives / deletes a project | Same | Row updates or disappears | 6.1, 6.4 |
| 3 | A creates or moves a task; B is on Tasks | Up to 50 s | < 1 s | 6.1, 6.4 |
| 4 | A edits a client; B is on Clients | Up to 50 s | < 1 s | 6.1, 6.4 |
| 5 | A adds/removes a team member; B is on Teams | Per-page | < 1 s | 6.1, 6.4 |
| 6 | A invites or deletes a member; B is on Members | Per-page | < 1 s | 6.1, 6.4 |
| 7 | ⚠ A submits work for review; B is on the review queue | **Never** refreshes | Row appears | 6.4 |
| 8 | ⚠ B is on Approvals when counts change | **Never** (`fetchedRef` one-shot) | Counts update | 6.4 |
| 9 | A bans a member; B is on Member bans | Per-page | < 1 s | 6.1, 6.4 |
| 10 | Hierarchy edit; B is on the member tree | Per-page | < 1 s | 6.4 |
| 11 | ⚠ A notification arrives while B's bell is closed | Badge never updates until opened | Badge updates live | 6.4 |
| 12 | Project overview / dashboard tiles after a change | Mount only | Refetch on signal | 6.4 |
| 13 | Two admins editing settings/policies | Mount only | Refetch on signal | 6.4 |

### 5.2 The open edit form (the reported case)

| # | Scenario | Today | Target | Fix |
|---|----------|-------|--------|-----|
| 14 | ⚠ B has the project edit modal open; A **deletes** the project | Blank create-mode form + `Project not found` in the submit-error slot | Modal closes, toast names the actor | 6.5, 6.7 |
| 15 | ⚠ B has it open; A **edits** the same project | Silent — B's save clobbers A | Banner: *Reload / Keep editing* | 6.7, 6.9 |
| 16 | ⚠ B has it open; A deletes a **member** selected in it | Dead UUID submitted → FK error | Picker refreshes, selection dropped with a note | 6.6, 6.8 |
| 17 | ⚠ Same for a deleted **client** or **team** | Same | Same | 6.6, 6.8 |
| 18 | ⚠ B opens the modal from an already-stale row | Loads fine, then 404s or clobbers | Same guards apply | 6.5, 6.7 |
| 19 | Task modal (wizard / hours / review) over a deleted task | Same class of failure | Same guards | 6.7 |
| 20 | Member manage modal over a deleted/banned member | Same class | Same guards | 6.7 |
| 21 | Client modal over a deleted client | Same class | Same guards | 6.7 |
| 22 | B has the modal open, loses focus for 10 min, then saves | Saves a 10-min-old snapshot | 409 on save | 6.9 |

### 5.3 Concurrent writes

| # | Scenario | Today | Target | Fix |
|---|----------|-------|--------|-----|
| 23 | ⚠ A and B save the same project seconds apart | Second silently overwrites **every field** | Second gets 409 + reload | 6.9 |
| 24 | ⚠ Same for a project budget | Same | Same | 6.9 |
| 25 | ⚠ Same for a member profile or role | Same | Same | 6.9 |
| 26 | ⚠ Same for a client | Same | Same | 6.9 |
| 27 | Two reviewers approve one assignment | Confusing error from the `in_review` guard | Clean 409 with a reason | 6.2, 6.9 |
| 28 | A archives while B renames | Rename resurrects stale `status` | 409 | 6.9 |
| 29 | Batch archive/delete overlapping one user's single edit | Partial, silent | Per-row 409 reported in the summary toast | 6.9 |

### 5.4 Deletion and referential integrity

| # | Scenario | Today | Target | Fix |
|---|----------|-------|--------|-----|
| 30 | ⚠ Save references a row deleted mid-edit | Raw Postgres `23503` text | 409 `stale_reference` in plain language | 6.2 |
| 31 | Delete a project that still has tasks | Fixed in `45732ff`, but siblings remain | Same handling everywhere | 6.2 |
| 32 | Delete a member who owns assignments/time entries | Whatever the constraint says | Mapped error + live refresh | 6.2, 6.1 |
| 33 | Deleted entity still selected in another user's **filter** | Filter silently returns nothing | Filter resets with a note | 6.6 |
| 34 | Deleted project still in the Tauri agent's picker | Agent submits a dead id | Mapped 409, agent re-fetches | 6.2, 6.11 |

### 5.5 Permission and scope changes mid-session

These use the **targeted** frame (§4.2). Broadcasting them would leak org structure.

| # | Scenario | Today | Target | Fix |
|---|----------|-------|--------|-----|
| 35 | ⚠ B is removed from a project while viewing it | Keeps rendering cached data until F5 | Scope frame → caches cleared, route re-evaluated | 6.3 |
| 36 | ⚠ B's role is downgraded | Stale permission flags for the tab's lifetime | Same | 6.3 |
| 37 | ⚠ B is moved to another team | Team-scoped views stay wrong | Same | 6.3 |
| 38 | B is banned | Handled at next request | Immediate, existing `force-sign-out` path | already exists |
| 39 | ⚠ B is granted **new** access | Nothing appears until F5 | Scope frame → refetch | 6.3 |
| 40 | Hierarchy/manager change affects visible members | `hierarchy-*` keys stale | Scope frame | 6.3 |

### 5.6 Running timer and the desktop agent

| # | Scenario | Today | Target | Fix |
|---|----------|-------|--------|-----|
| 41 | ⚠ Timer running on a task another user deletes | Keeps counting; writes fail silently | Timer stops, user told why | 6.11 |
| 42 | ⚠ Timer running on a project that gets archived | Same | Same | 6.11 |
| 43 | ⚠ B is unassigned from the task mid-timer | Same | Same | 6.11, 6.3 |
| 44 | Budget `stop_timers_when_reached` trips from someone else's time | 5 s session poll ([`activity-tracking-context.tsx:533`](Dashboard-Web/features/activity/components/activity-tracking-context.tsx:533)) | Signal-driven, poll becomes fallback | 6.11 |
| 45 | Timer limit reached while running | Preflight only checks at start | Live signal stops it | 6.11, **[T4](#t4--the-timer-runs-past-the-tasks-limit)** |
| 46 | Agent link status changes | 8 s poll ([`agent-status-context.tsx:105`](Dashboard-Web/features/activity/components/agent-status-context.tsx:105)) | Keep the poll — it is device-local, not shared state | no change |
| 46b | A manager assigns B a new task today | Agent's day totals never account for it | Signal refreshes the day plan | 6.1, **[T5](#t5--remaining-today-is-the-wrong-quantity)** |

> Timer cases are the highest-value ones in this document after the reported bug. They corrupt
> **billing data**, not just a view. Case 41 in particular currently produces time entries against a
> task that no longer exists.
>
> Cases 41–45 are written here from the **Dashboard web** timer's point of view. The desktop agent
> has the same exposure through a different code path — see [T4](#t4--the-timer-runs-past-the-tasks-limit).
> Both consume the same events; neither reimplements the other.

### 5.7 Connection lifecycle

| # | Scenario | Today | Target | Fix |
|---|----------|-------|-------…8926 tokens truncated…**Do not** silently discard the seconds between the true limit and the detected stop. Record them and
let the backend's existing allowance logic decide — the agent's job here is to stop, not to adjudicate.

### T5 — "Remaining today" is the wrong quantity

Today:

```ts
// src/App.tsx:732
const remainingTodayLabel = !memberLimits
  ? "—"
  : memberLimits.usesShifts || memberLimits.allowedRemainingSeconds == null
    ? "…"
    : `${fmtHours(memberLimits.allowedRemainingSeconds)} left`;
```

`allowedRemainingSeconds` comes from `computeMemberTimerAllowance`
([`activity/routes.js:280`](Dashboard-Backend/src/modules/activity/routes.js:280)) — the member's
daily/weekly **cap**. It answers *"how much am I still allowed to work?"*

The request is for a different number: *"I've got a regular project with a 1-hour task, then a calling
project of 3 hours, so Remaining today shows 4 hours before I select anything."* That is
*"how much work is assigned to me?"*

**These are two genuinely different quantities and both matter.** A member with a 6-hour cap and 9
hours of assigned work needs to see both, or the display lies in one direction or the other. So:

| Label | Value | Source |
|-------|-------|--------|
| **Assigned today** *(new)* | Σ over today's tasks of `max(0, estimatedSeconds − workedSeconds)`, plus calling-project allocations | new aggregate, below |
| **Daily cap left** *(renamed from "Remaining today")* | `memberLimits.allowedRemainingSeconds` | unchanged |

Renaming the existing tile is deliberate: keeping the name "Remaining today" on the cap while adding a
second number underneath is how this ends up misread again.

#### T5 allocation rules — decided

| Question | Decision |
|----------|----------|
| Calling project contribution | **Full allocation.** The whole outstanding amount is due today, not a per-day slice. |
| Multi-day task contribution | **Honour the schedule when the task has one; whole remainder when it doesn't.** |
| Overdue work from previous days | **Rolls forward**, bounded by the member's limits; whatever exceeds today's cap defers to the following days until it is all consumed. Nothing is dropped. |

Rule 2 is a judgement call, made here rather than inferred: `duration_hours_per_day`, `working_days`
and `duration_days` are columns a manager **filled in** ([`ensure-lookup-schema.js:1015`](Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js:1015)),
not something to guess around. Ignoring them would report a 40-hour task as 40 hours due today, which
makes the tile useless on exactly the projects it matters for. And `computeTaskDailyHours(task)`
already exists in [`task-workload-validation.js:28`](Dashboard-Backend/src/modules/tasks/task-workload-validation.js:28),
so honouring the schedule costs nothing.

#### The allocation

Per open assignment `a` of the member:

```
outstanding(a) = max(0, expected(a) − worked(a))

due(a) = outstanding(a)                                    if project is 'calling'   (rule 1)
       = outstanding(a)                                    if no daily schedule
       = min(outstanding(a),
             max(0, dailyShare(a) × workingDaysElapsed(a) − worked(a)))   otherwise

demandTodaySeconds = Σ due(a)
plannedTodaySeconds = min(demandToday, capLeftToday)        // capLeftToday = null ⇒ no cap
deferredSeconds     = demandToday − plannedToday            (rule 3)
```

**Rule 3 needs no carry-forward state.** `dailyShare × workingDaysElapsed − worked` already *is* the
rollover: fall two hours behind on a 2 h/day task and tomorrow's term grows to 4 h on its own, because
the scheduled side keeps advancing while the worked side does not. The `min(outstanding, …)` clamp
stops it from ever exceeding what the task actually has left. Past the due date, `scheduledToDate`
saturates at `expected` and the whole remainder falls due — which is the correct treatment of overdue
work. **No new table, no nightly job, no persisted plan.** The deferral the user described emerges
from the same expression on the next day's read.

Every input already exists:

| Term | Source |
|------|--------|
| `expected(a)` | `task_assignments.expected_seconds` ([`ensure-lookup-schema.js:1053`](Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js:1053)), falling back to `estimateAssignmentSeconds(task)` ([`task-assignments.js:118`](Dashboard-Backend/src/modules/tasks/task-assignments.js:118)) |
| `worked(a)` | `task_member_progress` per member/task |
| `dailyShare(a)` | existing `computeTaskDailyHours(task)` ([`task-workload-validation.js:28`](Dashboard-Backend/src/modules/tasks/task-workload-validation.js:28)) over `duration_hours_per_day` / `working_days` |
| `workingDaysElapsed(a)` | `start_date` → today against `working_days` |
| project type | `projects.type` (`normal` \| `calling`) |
| `capLeftToday` | existing `computeMemberTimerAllowance` → `allowedRemainingSeconds` |

**Backend.** Do **not** N+1 this from the agent across every assigned task. One query over
`task_assignments ⋈ tasks ⋈ projects ⋈ task_member_progress`, folded into the existing `Promise.all`
at [`activity/routes.js:295`](Dashboard-Backend/src/modules/activity/routes.js:295), returning one new
block on `/api/activity/limits`:

```jsonc
"assignedToday": {
  "demandSeconds":     14400,   // 4h — everything due today, including rollover
  "plannedSeconds":    14400,   // what fits inside today's cap
  "deferredSeconds":       0,   // pushed to following days; > 0 must be shown, never hidden
  "rolloverSeconds":       0,   // portion of demand that is catch-up from earlier days
  "taskCount":             2,
  "byProjectType":  { "normal": 3600, "calling": 10800 }
}
```

Extending the existing endpoint rather than adding one keeps the agent's poll count unchanged and
preserves the guarantee that route's own comment already makes — that what the agent displays and what
blocks the start button cannot disagree.

**Display.** Headline the demand (`4h 0m`). When `deferredSeconds > 0`, show it — *"4h assigned · 2h
over your cap, moves to tomorrow"* — because rule 3's whole point is that the time is not lost, and a
tile that silently clamps to the cap says the opposite. When `rolloverSeconds > 0`, say so too:
*"includes 1h carried from earlier."*

**Deliberately not built:** *which* task gets today's hours when the cap binds. The tile needs totals,
not an assignment, and a priority allocator (`due_date`, `priority`, calling-first) is only worth
writing when something renders a per-task plan. `tasks.priority` and `tasks.due_date` are already
there when that day comes.

**Multi-assignee caveat.** `expected_seconds` is per assignment row, so a task shared by three members
contributes only that member's own share — correct, and worth a test since the task-level
`estimateAssignmentSeconds` fallback does *not* have that property.

**Shift-based members.** `loadMemberCapContext` short-circuits to zeroed caps when
`memberUsesShiftsForLimits` is true ([`timer-limit.service.js:39`](Dashboard-Backend/src/modules/tasks/timer-limit.service.js:39)),
which is why the tile renders `"…"` today. `demandSeconds` is still meaningful for these members —
report it, and set `plannedSeconds = demandSeconds`, `deferredSeconds = 0`, since no cap applies.

**Live-sync tie-in.** Once Part I lands, a new assignment made by a manager should update this without
waiting for the 5 s poll — subscribe the agent to `changedEvent("task-assignments")` (case 46b). Until
then the existing poll covers it, just more slowly.

---

## 12. What Part II deliberately does not change

- **No change to recorded time.** T2 and T3 are presentation-only. T4 stops a timer earlier but does
  not rewrite history. T5 adds a read-only aggregate.
- **No new dependency in the agent.** The rewind animation is hand-rolled rAF;
  `@number-flow/react` stays a Dashboard-Web-only dependency.
- **No removal of tray mode**, and no prompt on every hide — only first-run visibility and a
  one-time notice.
- **No removal of the 5 s polls.** They are the fallback when the socket is down and, for T4, the
  thing standing between a stuck timer and corrupted billing data.
- **No idle-threshold changes.** 60 s / 5 m / 10 m / 15 m are server-tunable already
  ([`tracker.rs:57`](Tauri-App-Extension/src-tauri/src/agent/tracker.rs:57)); this plan does not touch
  the values.

---

## 13. Verification — Part II

**T1**
1. Fresh install, first launch → window is **visible**. Tray icon present.
2. Enable "start hidden", quit, relaunch → starts hidden, and a tray notice appears once explaining
   where it went. Relaunch again → hidden, no repeat notice.
3. Close the window with "keep running in tray" on → first time shows the notice; tracking continues.
4. Confirm which `preferences.json` the affected install actually loaded (log the resolved path once
   at startup) before concluding T1a is fixed.

**T2**
5. Start a timer → "Today, all work" advances every second, in step with the task timer.
6. Watch across a poll boundary (5 s) and a server sync boundary (20 s) → no jump, no stall, no
   backward step.
7. Stop the timer → the value settles to exactly the server's number.

**T3**
8. Go idle 60 s → idle toast appears at stage 1; both clocks still running.
9. Stay idle to 15 min → both clocks stop; "Today, all work" **animates** down over ~700 ms to the
   idle-detection value; banner explains it.
10. Compare the settled on-screen value against `/api/activity/limits` → identical.
11. Return from idle and resume → forward ticking resumes from the corrected value, never from the
    pre-rewind one.

**T4**
12. Task with a 10-minute limit, timer started at 0:00 → stops at 10:00 ±1 s, with a toast naming the
    limit. Not at 10:05.
13. Log time against the same task from another device mid-run → the running agent stops on the next
    signal (sub-second with Part I, ≤5 s without).
14. Confirm the recorded total for the task does not exceed the limit, and that no seconds vanish
    unrecorded.

**T5**
15. Assign a 1 h task on a normal project and a 3 h calling project → "Assigned today" reads 4 h
    **before** selecting anything. *(rule 1: the calling project contributes its full 3 h)*
16. Work 30 min on the task → demand drops to 3 h 30 m; nothing double-counts.
17. **Schedule honoured.** A 40 h task at 2 h/day over 20 working days contributes **2 h**, not 40 h.
18. **Rollover.** Same task, skip a day → the next day contributes 4 h. Skip two → 6 h. Never more
    than the task's own outstanding total. *(rule 3, and confirm no carry-forward row was written
    anywhere — the number must come from the formula alone)*
19. **Overdue saturation.** Push the same task past its `due_date` with 10 h unworked → the whole 10 h
    falls due, not 2 h.
20. **Cap binding.** Member with a 6 h daily cap and 9 h of demand → `demandSeconds` 9 h,
    `plannedSeconds` 6 h, `deferredSeconds` 3 h, and the UI **says** 3 h moves to tomorrow rather than
    quietly showing 6 h.
21. Next day, having worked the full 6 h → the deferred 3 h reappears in demand automatically.
22. A member whose cap is below their assigned load sees both tiles, and neither claims the other's
    number.
23. **Multi-assignee.** A 9 h task split across three members shows 3 h for each, not 9 h.
24. **Shift-based member** → `demandSeconds` populated, `plannedSeconds` equal to it, `deferredSeconds`
    zero; no `"…"` placeholder.
25. With Part I: a manager assigns a new task → the agent's total updates without waiting for the
    poll. *(case 46b)*

---

## 14. Order of work — Part II

| # | Task | Issue | Depends on | Effort | Status |
|---|------|-------|-----------|--------|--------|
| P1 | Log the resolved preferences path; reconcile / delete the committed `preferences.json` | T1a | — | XS | ✅ Fixed |
| P2 | `has_launched_before` gate + one-time tray notice | T1b | P1 | S | ✅ Fixed |
| P3 | `liveWorkedTodaySeconds` — local tick + monotonic reconcile | T2 | — | S | ✅ Fixed |
| P4 | Idle-stage toasts at stages 1 and 2 | T3 | — | XS | ✅ Fixed |
| P5 | rAF rewind animation on stage 3 | T3 | P3 | S | ✅ Fixed |
| P6 | Local to-the-second stop at the task limit | T4 | — | S | ✅ Fixed |
| P7 | Server-confirmed limit stop via the existing stop path | T4 | P6 | S | ✅ Fixed |
| P8 | `assignedToday` query + block on `/api/activity/limits` | T5 | — | M | ✅ Fixed, incl. the §8 rollover runnable check |
| P9 | Split the tile: "Assigned today" + "Daily cap left", surface deferred/rollover | T5 | P8 | S | ✅ Fixed, incl. `taskCount` in the sub-label when nothing else needs surfacing. `plannedSeconds`/`byProjectType` are parsed and available but deliberately not rendered - redundant with `demandSeconds` while nothing is deferred, and no per-task-type view exists yet to use `byProjectType` for. |
| P10 | Subscribe the agent to `changedEvent("task-assignments")` | T4, T5 | Part I steps 3–5 | S | ✅ Fixed. See [§15](#15-implementation-status-2026-08-07) for how - it needed a new WS client dependency and thread, but the Rust→JS event bridge it needed already existed (`vt-status`'s `window.eval` pattern in lib.rs), which lowered the risk originally flagged here. |

**P1–P3 are same-day changes** and cover the two issues a user notices within thirty seconds of
opening the app. **P6–P7 protect billing data** and should ship before P8.

**Nothing in Part II is blocked any more** — the three T5 questions are answered in §11 and the rules
are written down. P8 is the largest single item, but it stays one query plus roughly thirty lines:
`computeTaskDailyHours`, `estimateAssignmentSeconds` and `computeMemberTimerAllowance` already exist
and do the arithmetic, and rule 3's rollover needs no stored state. If P8 starts growing a carry-table
or a nightly job, that is the signal it has drifted from the design in §11 — the formula is meant to be
evaluated fresh on every read.

Leave one runnable check behind for P8 (repo convention, no new framework): a case asserting the
rollover identity — a 2 h/day task, three working days elapsed, 2 h worked → `due === 4h`; and the
same task past `due_date` → `due === outstanding`.

---

## 15. Implementation status (2026-08-07)

Both parts were implemented end to end on `claude/virtual-tracker-plan-review-5b95v3`. This section
records what shipped, the two deliberate deviations from the plan as written, and what was found
missing along the way that this plan named but the order-of-work tables didn't originally itemize.

### Part I — fully implemented, with three scoped exceptions on Members

Every item in §9 (1–16) is done, including full optimistic concurrency (§6.9) and the §6.7 live-guard
on all four single-entity modals: **Project, Task, Client, and Member**.

**Members got partial concurrency, not a full deviation.** Item 14 asked for `expectedUpdatedAt` → 409
on projects, budgets, clients, **members**, and tasks. First pass shipped only the §6.7 live-guard for
Members, on the assumption that member profile fields are spread across several independently-written
Firestore collections with no single `updated_at` covering a save the way the Postgres entities have
one. Closer investigation found that assumption half wrong: `employment`, `time_settings`, and `limits`
have since been migrated off Firestore onto Postgres (`member-data-store.js`'s `PG_MEMBER_SCOPED`),
each with its own real `updated_at` column - so **employment, payBill, and settings** now get the same
conditional-write pattern as the Postgres entities (`upsertMemberScopedRowPg`/
`upsertSingleByMemberIdConditional`, threaded through per-tab tokens on `MemberFormState`).

**info, roles, and workLimits remain excluded**, each for a distinct, real reason rather than time
pressure:
- `info` and `roles` both write through the single `members` Firestore doc, and *every* section's save
  bumps that doc's `updated_at` (`memberRef.update(memberUpdates)` runs unconditionally regardless of
  which tab changed) - conditioning on it would false-positive-conflict an open `info` tab the moment
  an unrelated `employment` save landed elsewhere. Not a usable token for either tab without adding a
  section-specific timestamp field, which is its own follow-up.
- `roles` additionally cascades into hierarchy/relationship-table sync (`syncMemberPrimaryRole`,
  `applyRoleChangeHierarchyEffects`) - a correctness-critical system this codebase already carries
  separate repair/audit tooling for (`hierarchy-repair.js`). Retrofitting concurrency there without
  dedicated review of that sync path risks the kind of hierarchy corruption that tooling exists to fix.
- `workLimits` spans two Postgres tables (`limits` + conditionally `time_settings`) that would need one
  token compared against two rows atomically - a design problem, not a mechanical port of the pattern
  used everywhere else.

All six tabs still have the §6.7 live-guard from item 7.

**Found missing during implementation, not originally itemized in §9, and fixed anyway** because they
follow directly from the plan's own root-cause analysis:

- **`project_budgets` PATCH had no concurrency guard at all** — Bug B's root-cause section
  (§2) named it explicitly alongside the project PATCH it sits beside in the same modal, but §9 item 14
  only mentions "budgets" in the task description without it showing up as a separate line the way
  clients/tasks/members do. `upsertProjectBudgetPg` now takes the same conditional-write path as
  `updateProjectPg`, with its own `budgetUpdatedAt` token threaded through the project modal's save.
- **Hierarchy/team-move scope-changed frames (cases 37, 40) were never wired** — §6.3 named
  `member-relationships/routes.js` explicitly as one of the call sites, but only the role-change and
  project-membership frames existed. `recordMemberRelationship` (the shared write helper backing both
  the direct create-relationship route and transfer-request acceptance) now sends a `scope-changed`
  frame to both the parent and child member.
- **Case 27's "not in review" guard was still a bare 403**, sharing a status code with the
  out-of-scope permissions case and giving no `code` field to branch on — exactly the "confusing error"
  the plan's own case table calls out, just not listed as its own §9 line item. Split into a clean 409
  with `code: "already_reviewed"` at both assignment-review route call sites.
- **The §8 runnable checks** ("a test asserting `publishChange` → `subscribeChanges` fires exactly
  once… and that `updateProjectPg(id, patch, staleTimestamp)` returns `{ conflict: true }`") were named
  in the plan but no test file existed yet. Added `Dashboard-Backend/test/live-sync-change-bus.test.js`
  covering both.
- **Member pay_rates and member_onboarding Firestore → Postgres backfill executed (2026-08-08)** —
  Executed `scripts/migrate-member-pay-onboarding-to-postgres.mjs` in production, successfully migrating 100% of records (29/29 `pay_rates` and 29/29 `member_onboarding`) from Firestore to PostgreSQL without errors.

**Not built, matching §7 non-goals exactly as scoped:** field-level collaborative editing, server-side
locks, event replay, row data over the socket, and the optional "soft edit indicator" §6.9 explicitly
says not to build in the first pass.

### Part II — T1–T5 and P10 all implemented

P1–P9 match the plan closely (see the §14 table above for per-item notes). P9's tile now also
surfaces `taskCount` in its sub-label when nothing more urgent (deferred/rollover) needs the space.

**P10 was initially deferred, then built.** The plan estimates "S" effort on the assumption that it
reuses existing push infrastructure the way the Dashboard-Web side of this plan reuses the presence
WebSocket. On first look that assumption seemed not to hold on the agent side — no WebSocket/SSE
client dependency existed in `Cargo.toml`, and a scan for `app.emit`/`listen` (Tauri's own event API)
found nothing. On closer inspection there **was** already a Rust→JS push channel in `lib.rs`'s
`.setup()`: the existing status bridge calls `window.eval("window.dispatchEvent(new CustomEvent(...))"
)` directly rather than using `app.emit`/`listen`, functionally equivalent to (and from the JS side,
literally the same idiom as) the `window.dispatchEvent(new CustomEvent(...))` pattern
`change-events.ts` already uses throughout Dashboard-Web. That materially lowered the risk this was
originally deferred over: P10 became "add a WS client + reuse an existing bridge," not "originate a
whole new push mechanism from nothing."

What was actually built:

- `Tauri-App-Extension/src-tauri/Cargo.toml` - added `tungstenite` (`rustls-tls-webpki-roots`
  feature, matching the `rustls-tls` reqwest already uses, so only one TLS backend links).
- `Tauri-App-Extension/src-tauri/src/agent/live_sync.rs` (new) - a dedicated `std::thread` (matching
  this app's existing all-blocking-call architecture; explicitly *not* `tokio-tungstenite`, since
  `run_blocking` in `lib.rs` documents why blocking work stays off the tokio runtime tauri carries).
  Connects to `/api/presence/ws` using an `Authorization: Bearer <id_token>` handshake header,
  reusing the `id_token` already held on `ApiClient` without putting credentials in the URL. Builds
  its own `TcpStream` with a read timeout (rather than
  `tungstenite::connect`'s all-in-one helper) so the same thread can both read incoming frames and send
  the application-level `{"type":"ping"}` `presence-gateway.js` requires every 30s - it only resets its
  120s heartbeat watch on that message, not on WS-protocol control frames. Reconnects with an
  increasing backoff
  on any disconnect, including a clean server-initiated close, to avoid hot-looping against a
  momentarily-rejecting server (e.g. a token mid-refresh).
- Every inbound frame is parsed and re-serialized through `serde_json` before being handed to the
  bridge callback - not a trust assumption that the server always sends well-formed JSON, but what
  guarantees the string is safe to interpolate into the `window.eval(...)` call, the same way the
  existing status bridge re-escapes through `serde_json::to_string` rather than embedding raw text.
- `AgentController` gained a `live_sync_listeners` field and `add_live_sync_listener()`, mirroring the
  existing `status_listeners`/`add_status_listener()` fan-out pattern exactly, and calls
  `live_sync::spawn(...)` from `start()`.
- `lib.rs`'s `.setup()` registers a listener that dispatches `vt-live-changed` via the same
  `window.eval` pattern as `vt-status`.
- `App.tsx` listens for `vt-live-changed`; on a `"changed"` frame for `task-assignments`/`tasks` or any
  `"scope-changed"` frame, it calls `refreshTaskTracking()`/`refreshMemberLimits()` immediately instead
  of waiting for their 5s polls (cases 45, 46b). The polls are unchanged and still run - they are what
  keeps working whenever this connection is down, exactly as the plan requires.

No backend changes were needed: `presence-gateway.js`'s `broadcastToAll` already sends to every
connected socket regardless of client type, so the agent connecting to the same endpoint the browser
uses is all that was required.

**Verified:** `cargo check` clean, `cargo test --lib` (one pre-existing, unrelated failure -
`tick_stops_the_timer_once_the_idle_escalation_deadline_passes` in `agent/tracker.rs`, confirmed via
`git stash` to fail identically with none of this session's changes applied), `tsc --noEmit` clean on
`App.tsx`. **Not verified:** an actual WS handshake/reconnect cycle against a live backend and a
running packaged agent - this environment has no live Dashboard-Backend + Firebase + built agent to
exercise that against, so treat the connect/reconnect path as compile-correct and logically reviewed,
not integration-tested. Recommend a manual pass per §13 check 25 before the next agent release.
