# Plan — Live sync across the Dashboard, and Tauri agent timer correctness

**Status:** **Implemented 2026-08-07** — Part I (§1–§9) and Part II (§10–§14, T1–T5 and P10) are
fully implemented, with one deliberate scope decision noted inline below.
**Date:** 2026-08-07 · **Implemented:** 2026-08-07
**Scope:** `Dashboard-Backend`, `Dashboard-Web`, `Tauri-App-Extension`

## Implementation status at a glance

| | Status |
|---|---|
| Part I §9 order of work, items 1–16 | ✅ All implemented, incl. Projects/Tasks/Clients full optimistic concurrency |
| Part I item 14 exception | ⚠️ Members: live-guard (deleted/updated notice) shipped; optimistic concurrency deliberately **not** built — see the note under item 14 |
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
|---|----------|-------|--------|-----|
| 47 | WS drops and reconnects | Presence recovers; data does not | Refetch on reconnect (frames missed while down are unrecoverable — refetch, don't replay) | 6.10 |
| 48 | Tab backgrounded for an hour | `refetchOnVisibility` on some pages | Keep it — it is the catch-up path | keep |
| 49 | Laptop sleeps and wakes | Heartbeat times out at 120 s, socket closes | Reconnect + full refetch | 6.10 |
| 50 | Backend deploys / restarts mid-session | 5 s reconnect backoff ([`presence-ws.ts:52`](Dashboard-Web/features/auth/services/presence-ws.ts:52)) | Same, plus refetch | 6.10 |
| 51 | Two tabs, same user | Both refetch independently | Actor filter suppresses self-echo in **both** | 6.4 |
| 52 | Redis unavailable | Presence falls back to local `EventEmitter` | Same path — single-instance still works | 6.1 |
| 53 | Multi-instance backend | Redis fan-out already handles presence | Same channel pattern | 6.1 |
| 54 | Sign-out in one tab | `force-sign-out` broadcast to the member's sockets | unchanged | already exists |
| 55 | Offline entirely | Connection-lost banner ([`backend-connection-events.ts`](Dashboard-Web/infrastructure/api/backend-connection-events.ts)) | Suppress live-sync toasts while the banner is up — don't stack noise | 6.10 |

### 5.8 Volume and abuse

| # | Scenario | Today | Target | Fix |
|---|----------|-------|--------|-----|
| 56 | Agent uploads screenshots continuously | n/a | Server throttles `activity` to 1 frame / 10 s | 6.1 |
| 57 | Batch delete of 50 projects | n/a | 400 ms client coalescing → one refetch | 6.4 |
| 58 | 30 users on one page during a bulk import | n/a | One refetch each, coalesced; acceptable at this scale | 6.4 |
| 59 | An import job writing thousands of rows | n/a | Publish once at job end, not per row | 6.1 |

---

## 6. Implementation

### Phase 1 — Backend broadcast

**6.1** Add a broadcast to the existing gateway. `presence-gateway.js` already holds every socket in
`connectionsByMember`; iterate it.

```js
// Dashboard-Backend/src/modules/presence/presence-gateway.js
/** Push a frame to every connected socket. Signals only — never row data. */
export function broadcastToAll(message) {
  const payload = JSON.stringify(message);
  for (const sockets of connectionsByMember.values()) {
    for (const ws of sockets) {
      try { ws.send(payload); } catch { /* cleaned up on close */ }
    }
  }
}
```

New `Dashboard-Backend/src/modules/realtime/change-bus.js` — a near-copy of `presence-pubsub.js`:
same local-echo de-dup, channel `data:changes`, falling back to the local `EventEmitter` when
`REDIS_URL` is unset (matching [`presence/index.js:40`](Dashboard-Backend/src/modules/presence/index.js:40)):

```js
export async function publishChange(resource, id, action, actorMemberId) { /* localBus + Redis PUBLISH */ }
export function subscribeChanges(handler) { /* localBus + ensureRedisSubscriber() */ }
```

Wire subscriber to broadcaster once at startup, beside the gateway init at
[`index.js:85`](Dashboard-Backend/index.js:85):

```js
subscribeChanges((msg) => broadcastToAll({ type: "changed", ...msg }));
```

Call `publishChange` after each write commits, fire-and-forget (`void publishChange(...)`) — a failed
broadcast must never fail the user's save. **Put the call inside the shared write helpers**
(`updateProjectPg`, `deleteProjectPg`, `archiveProjectPg`, and the task/member/client equivalents)
rather than in each route handler, so a new route cannot forget it. Covers cases 1–13, 30–34.

Throttle `activity` to one frame per 10 s (case 56), and have bulk/import paths publish once at
completion rather than per row (case 59):

```js
// ponytail: single global throttle window; make it per-member if activity fan-out gets noisy
```

**6.2 — Map constraint errors to a clean 409.** Today `23503` appears nowhere in
`Dashboard-Backend/src`, so the driver's message reaches the user verbatim. One helper, used by the
project / task / member / client write routes:

```js
// 23503 = foreign_key_violation → a referenced member/client/team was deleted mid-edit.
if (err?.code === "23503") {
  return sendJson(res, origin, 409, {
    success: false, code: "stale_reference",
    error: "Someone deleted one of the selected items while you were editing. Reload to continue.",
  });
}
```

Converts the reported *"error about conditions"* into a sentence a human can act on. **Independently
shippable in an afternoon.** Covers cases 30–34.

**6.3 — Targeted scope frames.** On role change, project membership change, team move, or hierarchy
edit, call the existing `sendToMember(affectedMemberId, { type: "scope-changed", reason })` from the
same routes that already perform the change ([`compat/routes.js:879`](Dashboard-Backend/src/modules/compat/routes.js:879)
for roles, [`projects/routes.js:690`](Dashboard-Backend/src/modules/projects/routes.js:690) and
[`:715`](Dashboard-Backend/src/modules/projects/routes.js:715) for project members,
[`member-relationships/routes.js`](Dashboard-Backend/src/modules/member-relationships/routes.js) for
hierarchy). Client response: `clearAllListCaches()` + refetch the current route + re-evaluate route
guards. Covers cases 35–40, 43.

### Phase 2 — Client dispatch and cache invalidation

**6.4** Extend the `onmessage` switch in
[`presence-ws.ts:101`](Dashboard-Web/features/auth/services/presence-ws.ts:101) — it already turns
`hello` into a window event:

```ts
} else if (data.type === "changed") {
  dispatchChanged(data)
} else if (data.type === "scope-changed") {
  void handleScopeChanged(data)
}
```

New `Dashboard-Web/infrastructure/api/change-events.ts`. **This is where Bug D dies:** the handler
invalidates the registry key whether or not any component is currently mounted on it.

```ts
import {
  invalidateCache,
  invalidateCachesByPrefix,
  invalidatePeopleMemberCaches,
} from "@/shared/tables/hooks/list-cache-registry"

export const changedEvent = (resource: string) => `vt-changed:${resource}`

/** One place mapping a backend resource to every client cache key derived from it. */
const CACHE_KEYS: Record<string, string[]> = {
  projects:      ["pm-projects:projects", "pm-tasks:projects", "pm-clients:projects"],
  tasks:         ["pm-tasks:tasks"],
  clients:       ["pm-clients:clients"],
  teams:         ["people:teams"],
  invites:       ["people-members:invites"],
  "member-bans": ["people:member-bans"],
}
const PREFIXES: Record<string, string[]> = {
  clients:   ["pm-clients:"],
  hierarchy: ["hierarchy-", "people-members:tree:"],
}

const pending = new Map<string, ReturnType<typeof setTimeout>>()

export function dispatchChanged(msg: ChangeFrame) {
  if (msg.actor && msg.actor === currentMemberId()) return   // own write already applied locally

  // Unconditional: unmounted pages must not keep serving stale data after navigation.
  if (msg.resource === "members") {
    invalidatePeopleMemberCaches(msg.id)   // already knows every member-derived key
    invalidateCache("pm-clients:members")  // the one it does not cover
  }
  for (const key of CACHE_KEYS[msg.resource] ?? []) invalidateCache(key)
  for (const p of PREFIXES[msg.resource] ?? []) invalidateCachesByPrefix(p)

  if (pending.has(msg.resource)) return
  pending.set(msg.resource, setTimeout(() => {
    pending.delete(msg.resource)
    window.dispatchEvent(new CustomEvent(changedEvent(msg.resource), { detail: msg }))
  }, 400))
}
```

> The `members` branch delegates to `invalidatePeopleMemberCaches`
> ([`list-cache-registry.ts:77`](Dashboard-Web/shared/tables/hooks/list-cache-registry.ts:77)) instead
> of listing keys, because that function already covers `people-members:members`, the field-scoped
> `people-members:members:*` slots, `__members_meta__`, `invites`, `people-members:tree:*` and the
> three `hierarchy-*` keys — and it will keep covering new ones. Re-deriving that list here is how the
> two copies drift apart.
>
> Verified prefixes, since they are easy to guess wrong: member profiles are
> `people-members:profile:` ([`member-profile-cache.ts:17`](Dashboard-Web/features/members/services/member-profile-cache.ts:17)),
> the member tree is `people-members:tree:` ([`use-member-tree-data.ts:17`](Dashboard-Web/features/members/hooks/use-member-tree-data.ts:17)).

The actor check matters (case 51): mutation hooks such as
[`use-project-mutations.ts`](Dashboard-Web/features/projects/hooks/use-project-mutations.ts) already
update local state optimistically. Without it every save triggers a redundant self-refetch that can
visibly flicker the row.

> **`currentMemberId()` does not exist yet.** `memberId` is React context state only — derived from
> `currentMember?.id` at [`auth-context.tsx:1191`](Dashboard-Web/shared/providers/auth/auth-context.tsx:1191)
> — and `change-events.ts` is a plain module with no hook access. Do **not** build a store for this.
> Export a module-level `setCurrentMemberId(id)` from `change-events.ts` and call it from one effect in
> the auth provider, next to where the presence socket is already connected
> ([`auth-context.tsx:446`](Dashboard-Web/shared/providers/auth/auth-context.tsx:446)). Two lines, and
> it fails safe: if the id is unset the check is skipped and the actor merely sees one redundant
> refetch of their own change.

> `invalidateCache` sets `data = null`, which makes `hasCachedData` false and puts a remounting page
> into its loading state. Correct for a page that is *not* mounted. For one that **is** mounted, the
> `presencePingEvent` refetch below runs in the same tick and repaints — but verify there is no
> skeleton flash on the Projects table. If there is, split into `markStale(key)` (clears
> `lastFetchTime`, keeps `data`) versus `invalidateCache(key)`. That is a 5-line addition to the
> registry and the better default.

Then subscribe each surface. For anything on `useCachedList` / `useCachedMultiList` this is **one
option object** — the listener already exists:

```ts
// features/projects/pages/projects-page.tsx:128
useCachedList<Project[]>({
  cacheKey: "pm-projects:projects",
  presencePingEvent: changedEvent("projects"),
  backgroundRefetch: { forceRefetch: true },   // bypass the 2 s debounce + 5 min staleMs
  …
})
```

| Surface | Change | Cases |
|---------|--------|-------|
| Projects | option object above | 1, 2 |
| Tasks | same, `changedEvent("tasks")`; **drop `refetchIntervalMs: 50_000`** | 3 |
| Clients | same; drop its 50 s interval | 4 |
| Teams, Members, Invites, Bans, Member tree | same | 5, 6, 9, 10 |
| Timesheets › review queue | `useEffect` listener calling the existing `loadRows` ([`ReviewQueueTable.tsx:118`](Dashboard-Web/features/timesheets/components/view-edit/components/ReviewQueueTable.tsx:118)) | 7 |
| Timesheets › approvals | same, against the one-shot loader ([`approvals/index.tsx:24`](Dashboard-Web/features/timesheets/components/approvals/index.tsx:24)) | 8 |
| Activity | listener calling the existing `reload({ silent: true, force: true })` | 12 |
| Notifications bell | **remove the `!open` early-return** so the badge tracks live; drive off `changedEvent("notifications")` and drop the 30 s poll | 11 |
| Member profile | clear the matching key in [`member-profile-cache.ts`](Dashboard-Web/features/members/services/member-profile-cache.ts) | 12 |
| Overview / dashboard / reports / settings | listener calling their existing loaders | 12, 13 |

Keep `refetchOnVisibility` everywhere (case 48). It is the catch-up path for frames missed while the
WS was reconnecting.

### Phase 3 — Open-form reconciliation (Bug C)

One shared hook, used by every modal that edits a single entity.

```ts
// Dashboard-Web/shared/hooks/use-entity-live-guard.ts
/** Reacts when the entity this form is editing changes or vanishes underneath the user. */
export function useEntityLiveGuard({ resource, id, onDeleted, onUpdated }: {
  resource: string; id: string | null
  onDeleted: (actor?: string) => void
  onUpdated: (actor?: string) => void
}) { /* addEventListener(changedEvent(resource)), filter on detail.id === id */ }
```

**6.5 — fix the blank-form path first, independent of live sync.** The `.catch` at
[`project-modal.tsx:532`](Dashboard-Web/features/projects/components/modals/project-modal.tsx:532)
must distinguish 404 from everything else: on 404, close the modal and toast *"This project no longer
exists."* rather than leaving an empty create-mode form with an error stuck to the bottom. ~10 lines,
no backend work, removes the worst part of the reported experience on its own. Case 14.

**6.6 — option lists refresh on `members` / `clients` / `teams` events.** The three modal effects at
[`project-modal.tsx:420`](Dashboard-Web/features/projects/components/modals/project-modal.tsx:420),
[`:443`](Dashboard-Web/features/projects/components/modals/project-modal.tsx:443) and
[`:463`](Dashboard-Web/features/projects/components/modals/project-modal.tsx:463) get the event added
to their deps (the third has `[]`, so it never refreshes at all). After refresh, drop any selected id
no longer in the options and show one line under the field: *"2 selected members were removed and
have been deselected."* This is what stops a dead UUID from ever reaching Postgres. Same treatment for
filter selects on list pages (case 33). Cases 16, 17, 33.

**6.7 — deleted / updated while open.** Deleted → close the modal, toast *"This project was deleted by
{actor} — your changes weren't saved"*, drop the row. Updated → non-blocking banner *"{Actor} changed
this project — **Reload** / **Keep editing**"*; Reload refetches `edit-state`, Keep editing proceeds
and hits the 6.9 conflict check on save. The user chooses; nothing is discarded behind their back.
Apply to the project, task, member and client modals. Cases 14, 15, 18–21.

**6.8** Wire 6.6's deselect logic into the save payload builder too, so a picker that never got a
chance to refresh still cannot submit an id it knows is gone.

### Phase 4 — Optimistic concurrency (Bug B)

`projects.updated_at` already exists, is `NOT NULL`, and is already bumped on every write
([`ensure-lookup-schema.js:748`](Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js:748),
[`projects-postgres.service.js:102`](Dashboard-Backend/src/lib/postgres/projects-postgres.service.js:102)).
No migration. Use it as the version token.

**6.9** Return it from the read the modal already makes — add `updatedAt: toIso(project.updated_at)`
to the `edit-state` response ([`routes.js:318`](Dashboard-Backend/src/modules/projects/routes.js:318)).
Send it back on save; make the `UPDATE` conditional:

```js
// updateProjectPg(id, patch, expectedUpdatedAt)
const where = expectedUpdatedAt
  ? `WHERE id = $1 AND updated_at = $${params.push(expectedUpdatedAt)}`
  : "WHERE id = $1";
const rows = await query(`UPDATE projects SET ${sets.join(", ")} ${where} RETURNING *`, params);
if (rows.length === 0 && expectedUpdatedAt) return { conflict: true };
```

Zero rows means someone wrote first → route returns **409** with the current row. `expectedUpdatedAt`
stays optional so existing callers (and the Tauri agent) keep working unchanged.

Client handles 409 in the save path
([`use-project-mutations.ts`](Dashboard-Web/features/projects/hooks/use-project-mutations.ts)): same
banner as 6.7, form reloaded, modal stays open. For batch operations, collect per-row conflicts and
report them in the summary toast rather than failing the whole batch (case 29).

Same guard on `project_budgets` PATCH, client PUT, member PATCH and task update — all have
`updated_at`, all are whole-row writes. Cases 22–29.

**Optional, only if 409s prove annoying in practice.** Soft edit indicator: on modal open, broadcast
`{resource:"projects:editing", id, actor}`; other clients show *"Mohammed is editing this"* on the row
and in the modal header. Advisory only — no server-side lock, no expiry to get wrong, no way to wedge
a project because someone shut their laptop. **Do not build this in the first pass.** 409-with-reload
is the correct floor and may well be enough.

### Phase 5 — Lifecycle and the timer

**6.10 — reconnect and offline.** On WS `onopen` after a drop, dispatch a synthetic
`changedEvent("*")` that invalidates everything and refetches the current route. Frames missed while
the socket was down are gone — refetch, do not attempt replay; a sequence-number/replay buffer is
real complexity for a case that `refetchOnVisibility` already half-covers. While the connection-lost
banner is up ([`backend-connection-events.ts`](Dashboard-Web/infrastructure/api/backend-connection-events.ts)),
suppress live-sync toasts so notices do not stack on top of the outage banner. Cases 47, 49, 50, 55.

**6.11 — the running timer.** [`activity-tracking-context.tsx:533`](Dashboard-Web/features/activity/components/activity-tracking-context.tsx:533)
already polls session state every 5 s and can already stop a timer
(`applyPhase("idle")` + `notifyAgentTimerBlocked`). Subscribe that same logic to
`changedEvent("tasks")` / `changedEvent("projects")` filtered to the **currently tracked** task and
project id, and to `scope-changed`. On a match: stop the timer, name the reason
(*"This task was deleted — timer stopped, your time up to now was saved"*), keep the 5 s poll as the
fallback. Cases 41–45.

> Do not delete the 5 s session poll. It is the only thing that works when the socket is down, and
> the correctness cost of a silently-running timer is higher than the cost of one small request.

---

## 7. Non-goals

Named explicitly so they do not creep in:

- **Field-level collaborative editing** (two people typing in one form). CRDT/OT territory, a
  genuinely different project. 409-with-reload is deliberately not that.
- **Server-side locks.** No lock table, no lease, no expiry. A lock that outlives a closed laptop is
  worse than the problem.
- **Event replay / guaranteed delivery.** Frames are best-effort hints. Correctness comes from the
  refetch they trigger, never from the frame itself. This is why they carry no data.
- **Pushing row data over the socket.** Would drag permission filtering, payload versioning and cache
  merging in behind it — the three things §4.1 exists to avoid.
- **Live sync for the Landing site or the Monitor console.** Out of scope.
- **Replacing the SSE presence stream.** It already works and is scoped; leave it.

---

## 8. Verification

Two browsers, different members, same workspace, unless stated otherwise.

**Core report**
1. A edits a project name → B's Projects row updates without refresh, < 1 s. *(case 1)*
2. B has the edit modal open; A deletes the project → B's modal closes naming A. **Not** a blank form
   with `Project not found` at the bottom. *(case 14)*
3. B has member M selected in the modal; A deletes M → picker drops M with a visible note; B saves
   successfully; no `23503` ever reaches the client. *(cases 16, 30)*
4. A and B both open the same project. A saves. B saves → 409 banner, form reloads, A's change
   survives in the database. *(case 23)*
5. **No F5.** B navigates Projects → Activity → Projects after A's change, with no page reload. Fresh
   data on arrival. *(case D — fails today)*

**Scope**
6. A removes B from a project while B is viewing it → B's view re-evaluates, no F5. *(case 35)*
7. A downgrades B's role → B's permission-gated UI updates within seconds. *(case 36)*
8. Confirm scope frames go **only** to the affected member — watch A's socket, it must see nothing.

**Timer**
9. B has a timer running; A deletes that task → B's timer stops with a named reason; time up to the
   stop is saved and attributed correctly. *(case 41)*
10. Same for archiving the parent project. *(case 42)*

**Lifecycle**
11. Kill the backend mid-session, restart → WS reconnects (5 s backoff) and a full refetch runs.
    *(cases 47, 50)*
12. Sleep the laptop 5 min, wake → heartbeat timeout closes the socket, reconnect + refetch. *(49)*
13. Two tabs as the same user: a save in tab 1 causes **no** extra refetch in tab 1, and one refetch
    in tab 2. *(case 51)*
14. With `REDIS_URL` set and two backend containers: a change on container 1 reaches a client on
    container 2. Without `REDIS_URL`, single instance still works via the local `EventEmitter`.
    *(cases 52, 53)*

**Volume**
15. Agent uploading screenshots → at most one `activity` frame per 10 s. *(case 56)*
16. Batch-delete 50 projects → observers issue **one** refetch, not 50. *(case 57)*

Runnable checks to leave behind (repo convention: one test, no new framework) — a
`Dashboard-Backend/test/` case asserting that `publishChange` → `subscribeChanges` fires exactly once
for a local publish (local-echo de-dup does not double-deliver), and that
`updateProjectPg(id, patch, staleTimestamp)` returns `{ conflict: true }` without mutating the row.

---

## 9. Order of work

| # | Task | Fixes | Cases | Effort | Status |
|---|------|-------|-------|--------|--------|
| 1 | Modal 404 → close + toast ([`project-modal.tsx:532`](Dashboard-Web/features/projects/components/modals/project-modal.tsx:532)) | C1 | 14 | XS | ✅ Done |
| 2 | Postgres `23503` → 409 `stale_reference` | C2 | 30–34 | XS | ✅ Done |
| 3 | `broadcastToAll` + `change-bus.js` + startup wiring | — | — | S | ✅ Done |
| 4 | `publishChange` inside the shared write helpers | A | 1–13 | S | ✅ Done |
| 5 | `change-events.ts` + `presence-ws.ts` branch + **registry invalidation** | A, **D** | 1–13, 51 | S | ✅ Done |
| 6 | Subscribe Projects, Tasks, Clients; delete the 50 s polls | A | 1–4 | XS | ✅ Done |
| 7 | `useEntityLiveGuard` + modal deleted/updated handling | C1, C3 | 14–21 | M | ✅ Done — Project, Task, Client, **and Member** modals |
| 8 | Modal + filter option lists refresh, deselect stale ids | C2 | 16, 17, 33 | M | ✅ Done |
| 9 | Subscribe Timesheets (review queue, approvals) | A | 7, 8 | S | ✅ Done |
| 10 | Notifications bell: drop the `!open` gate, drive off signals | A | 11 | XS | ✅ Done |
| 11 | Subscribe + throttle Activity | A | 12, 56 | M | ✅ Done |
| 12 | Targeted `scope-changed` frames + client handler | — | 35–40 | M | ✅ Done, incl. hierarchy/team-move frames (`recordMemberRelationship`) added during implementation |
| 13 | Timer live-stop on deleted task/project/unassign | — | 41–45 | M | ✅ Done |
| 14 | `expectedUpdatedAt` → 409 on projects, budgets, clients, members, tasks | B | 22–29 | M | ⚠️ Done for **projects, project_budgets, clients, tasks**. **Members deliberately excluded** — profile fields span several non-transactional Firestore upserts with no single `updated_at` to condition a write on, unlike the Postgres-backed entities. Members got the §6.7 live-guard (item 7) instead; full concurrency there needs separate design work. |
| 15 | Client 409 handling in the save paths, incl. batch summaries | B | 23–29 | S | ✅ Done for the single-entity save path. Batch-summary reporting is N/A: no batch archive/delete endpoint exists for projects/tasks/clients in this codebase to attach it to. |
| 16 | Reconnect refetch + toast suppression during outages | — | 47–50, 55 | S | ✅ Done |

**Steps 1–2 ship today**, need no WebSocket work, and remove the ugliest half of the reported
experience — the blank form and the constraint-speak error.
**Step 5 is the one that kills the "refresh the whole webapp" requirement**; without the registry
invalidation, everything else still leaves stale data behind after navigation.
**Steps 7–8** make an open form safe.
**Step 13** is the highest-value item after the reported bug — it is the one protecting billing data.
**Step 14** closes the silent-overwrite hole. Do not stop before it and call this done.

---
---

# Part II — Tauri agent timer & UX

## 10. The reported issues

Five issues in `Tauri-App-Extension`. Only T4 and T5 touch Part I; T1–T3 are self-contained.

| # | Reported as | Real category |
|---|-------------|---------------|
| **T1** | App opens straight into the tray on first launch — user thinks it never opened | Startup UX + a config mismatch |
| **T2** | "Today, all work" doesn't tick with the timer, so the app looks stuck or wrong | Display cadence, not arithmetic |
| **T3** | Going idle should stop both timers and rewind "Today, all work" — animated, not a jump | Missing transition on a correction that already happens |
| **T4** | Timer must stop when the task's own limit is reached | Limit enforced at start, never while running |
| **T5** | "Remaining today" should be the total time assigned across today's projects and tasks | Wrong quantity displayed under a right-sounding label |

**A note on framing before the fixes.** T2 and T3 are explicitly *not* requests to change what the
backend records. The user's phrasing is exact: *"it gives the time actually worked… so we keep it in
sync by the second in the frontend while it actually calculates correctly in the backend."* That is
the correct instinct and this plan holds to it — **every fix below is presentation-layer only, except
T4 (which must stop a real timer) and T5 (which needs one new server aggregate).** No fix changes how
a single second of billable time is computed or stored.

---

## 11. Root causes and fixes

### T1 — the app starts hidden in the tray

**Two separate problems, both real.**

**T1a — a committed preferences file disagrees with the code default.**

```jsonc
// Tauri-App-Extension/preferences.json  (checked into the repo)
{ "launchAtLogin": true, "startHidden": true, "autoSignIn": false }
```

```rust
// src-tauri/src/prefs.rs:36 — UserPreferences::default()
launch_at_login: true,
start_hidden:    false,   // ← disagrees
auto_sign_in:    true,    // ← disagrees
close_to_tray:   true,
```

The runtime store reads `data_dir.join("preferences.json")`
([`config.rs:35`](Tauri-App-Extension/src-tauri/src/config.rs:35)), so the repo copy is *not* the file
a packaged install loads — but it is what a dev run and anything that copies the project directory
picks up, and it is the only **configuration** in the tree carrying `startHidden: true`. (The other
occurrence, [`prefs.rs:96`](Tauri-App-Extension/src-tauri/src/prefs.rs:96), is a deserialization test
fixture and is meant to be there.)

**Diagnose in this order before changing anything:**

1. **Is the setting simply on?** There is a user-facing toggle
   ([`SettingsPanel.tsx:106`](Tauri-App-Extension/src/components/views/SettingsPanel.tsx:106)). If the
   affected user's stored preference has it enabled, T1a is a red herring and only T1b applies.
2. **Which file was read?** Log the resolved `prefs_path` once at startup. If the repo copy is
   reaching users, deleting it is the entire fix.

Either way the committed file and `Default` should not disagree: delete it (defaults are written back
on first load, [`prefs.rs:68`](Tauri-App-Extension/src-tauri/src/prefs.rs:68)) or correct it to match.

**T1b — even when `startHidden` is genuinely on, the *first* launch must not use it.**

```rust
// src-tauri/src/lib.rs:518
if start_hidden {
    let _ = window.hide();
}
```

Unconditional on every launch. On a first run the user has never seen the tray icon, does not know it
exists, and has no reason to look in an overflow menu for it. Two changes:

1. **First run always shows.** Gate on a `has_launched_before` flag written to preferences after the
   first successful startup:
   ```rust
   if start_hidden && prefs.has_launched_before {
       let _ = window.hide();
   }
   ```
2. **Every hide-to-tray announces itself once.** The first time the window is hidden in a given
   install — at startup or via the close button ([`lib.rs:146`](Tauri-App-Extension/src-tauri/src/lib.rs:146)) —
   show a tray notification: *"Virtual Tracker is still running. Click the tray icon to reopen."*
   Once per install, flagged in preferences. This is what actually removes the "did it close?"
   confusion, and it covers the close-button path that `has_launched_before` alone does not.

> Deliberately **not** done: removing tray mode, or prompting on every hide. The tray behaviour is
> correct for a tracking agent; only its discoverability is broken.

### T2 — "Today, all work" only moves every 5 seconds

```ts
// src/App.tsx:739
const workedTodayLabel = memberLimits ? fmtHours(memberLimits.workedTodaySeconds) : "—";
```

`memberLimits` comes from a 5 s poll ([`App.tsx:334`](Tauri-App-Extension/src/App.tsx:334)) of
`get_member_limits` → `/api/activity/limits`. Server-side the session itself only syncs every
`SESSION_SYNC_INTERVAL_SEC` (20 s), so the displayed number can sit still for up to 20 seconds while
the task timer beside it counts every second. Nothing is wrong with the value — it just arrives in
steps, and two clocks side by side moving at different rates reads as a bug.

**The fix already exists three lines away.** The task timer solves exactly this:

```ts
// src/App.tsx:359 — reconcile to server, never go backward while tracking
useEffect(() => {
  const next = session?.activeSeconds ?? 0;
  setLiveActiveSeconds((s) => (tracking ? Math.max(s, next) : next));
}, [session?.activeSeconds, tracking]);

// src/App.tsx:366 — tick locally between polls
useEffect(() => {
  if (!tracking) return;
  const timer = window.setInterval(() => setLiveActiveSeconds((s) => s + 1), 1000);
  return () => window.clearInterval(timer);
}, [tracking]);
```

Apply the same two effects to `workedTodaySeconds` as `liveWorkedTodaySeconds`, and render that
instead. Same monotonic guard, same reconcile-on-poll, same "server wins once tracking stops". The
comment block at [`App.tsx:347–358`](Tauri-App-Extension/src/App.tsx:347) already documents this
invariant — the fix is to stop applying it to only one of the two clocks.

One extra condition: tick **only while `tracking` and `idleStage === 0`**. Otherwise the local ticker
keeps advancing through an idle period that the backend is about to subtract, which is the setup for
T3's jump.

### T3 — idle should stop both timers, then rewind the day total on screen

The correction **already happens correctly.** Idle escalation is staged
([`tracker.rs:44`](Tauri-App-Extension/src-tauri/src/agent/tracker.rs:44)):

| Stage | At | Meaning |
|-------|-----|---------|
| 0 | — | working |
| 1 | `IDLE_FLAG_WARN_SEC` = 5 min | warned |
| 2 | `IDLE_FLAG_ALERT_SEC` = 10 min | alerted |
| 3 | `IDLE_FLAG_STOP_SEC` = 15 min | stopped, idle time removed |

with idle itself detected at `IDLE_THRESHOLD_SEC` = 60 s
([`constants.rs:75`](Tauri-App-Extension/src-tauri/src/constants.rs:75)). The Rust side already calls
this an *"idle rewind"* ([`tracker.rs:50`](Tauri-App-Extension/src-tauri/src/agent/tracker.rs:50)) and
the banner already tells the truth: *"Timer stopped after 15 minutes idle. The idle time was removed
from your hours"* ([`App.tsx:1137`](Tauri-App-Extension/src/App.tsx:1137)).

**What's missing is only the transition.** The number snaps from "15 minutes ago" to "now" in one
frame, which reads as data loss rather than a correction. Three parts:

1. **Toast on idle detection, not just at stage 3.** At stage 1 (`idleStage` 0→1), toast *"You look
   idle — the timer will stop in 10 minutes if there's no activity."* The `Toast` component already
   exists ([`src/Toast.tsx`](Tauri-App-Extension/src/Toast.tsx)). Stages 2 and 3 escalate the wording.
   This gives the user a chance to act before anything is taken back.
2. **Both clocks stop together.** At stage 3, `tracking` goes false, which already stops the task
   ticker. With T2 applied, the same flag stops the day ticker. No extra work — this falls out of
   gating T2's interval on `tracking && idleStage === 0`.
3. **Animate the rewind.** On the `idleStage` transition into 3, animate `liveWorkedTodaySeconds` from
   its current value down to the next server value over ~700 ms with `requestAnimationFrame`, easing
   out. The target needs no new arithmetic — it is simply the `workedTodaySeconds` the server returns
   after the stop POST lands, which is by definition the value at the moment idle was detected.

   ```ts
   // ponytail: hand-rolled rAF countdown, ~15 lines. Dashboard-Web has @number-flow/react
   // for this, but it is not a dependency of the agent and one animation does not justify adding it.
   ```

   Suppress the monotonic guard from T2 for the duration of the animation — this is the one moment
   the day total is *supposed* to move backward.

> Worth stating plainly, since it is the whole point of the request: after this change the number on
> screen is identical to the number in the database at every settled moment. The only thing added is
> how it travels between two of them.

### T4 — the timer runs past the task's limit

`limitReached` and `allowedRemainingSeconds` already exist on every task
([`types/index.ts:104`](Tauri-App-Extension/src/types/index.ts:104)) and are refreshed every 5 s
([`App.tsx:311`](Tauri-App-Extension/src/App.tsx:311)). They are used in exactly two places, **both of
which are gates on starting**:

- the task list filters out tasks that already hit their budget ([`App.tsx:204`](Tauri-App-Extension/src/App.tsx:204))
- the start button is disabled and explains why ([`App.tsx:996`](Tauri-App-Extension/src/App.tsx:996))

Nothing stops a timer that is **already running**. A 10-minute task started at minute 0 keeps counting
at minute 11, minute 40, indefinitely.

**Fix, in two layers:**

1. **Local, to-the-second stop.** `allowedRemainingSeconds` is known at start. Compute the stop
   instant client-side and stop exactly there, rather than waiting up to 5 s for the next poll to
   report `limitReached`. This is what makes the behaviour match the user's description — *"once I
   finish 10 mins for the task the timer stops"*, not "up to 5 seconds after".
2. **Server-confirmed stop.** When a poll returns `limitReached === true` while `tracking`, stop
   through the existing stop path regardless of the local estimate. This covers time logged against
   the same task from another device or by an admin adjustment — and it is the point where **Part I's
   event bus helps**: `changedEvent("task-assignments")` and `changedEvent("tasks")` collapse the
   detection window from 5 s to sub-second (case 45).

Reuse the idle-stop path — it already handles flushing partial progress, the `pending_stop` retry
([`tracker.rs:47`](Tauri-App-Extension/src-tauri/src/agent/tracker.rs:47)), and the offline queue.
Toast: *"Task limit of 10m reached — timer stopped. Your time is saved."*

**Do not** silently discard the seconds between the true limit and the detected stop. Record them and
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
| P1 | Log the resolved preferences path; reconcile / delete the committed `preferences.json` | T1a | — | XS | ✅ Done |
| P2 | `has_launched_before` gate + one-time tray notice | T1b | P1 | S | ✅ Done |
| P3 | `liveWorkedTodaySeconds` — local tick + monotonic reconcile | T2 | — | S | ✅ Done |
| P4 | Idle-stage toasts at stages 1 and 2 | T3 | — | XS | ✅ Done |
| P5 | rAF rewind animation on stage 3 | T3 | P3 | S | ✅ Done |
| P6 | Local to-the-second stop at the task limit | T4 | — | S | ✅ Done |
| P7 | Server-confirmed limit stop via the existing stop path | T4 | P6 | S | ✅ Done |
| P8 | `assignedToday` query + block on `/api/activity/limits` | T5 | — | M | ✅ Done, incl. the §8 rollover runnable check |
| P9 | Split the tile: "Assigned today" + "Daily cap left", surface deferred/rollover | T5 | P8 | S | ✅ Done, incl. `taskCount` in the sub-label when nothing else needs surfacing. `plannedSeconds`/`byProjectType` are parsed and available but deliberately not rendered - redundant with `demandSeconds` while nothing is deferred, and no per-task-type view exists yet to use `byProjectType` for. |
| P10 | Subscribe the agent to `changedEvent("task-assignments")` | T4, T5 | Part I steps 3–5 | S | ✅ Done. See [§15](#15-implementation-status-2026-08-07) for how - it needed a new WS client dependency and thread, but the Rust→JS event bridge it needed already existed (`vt-status`'s `window.eval` pattern in lib.rs), which lowered the risk originally flagged here. |

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

### Part I — fully implemented, with one scoped exception

Every item in §9 (1–16) is done, including full optimistic concurrency (§6.9) and the §6.7 live-guard
on all four single-entity modals: **Project, Task, Client, and Member**.

**The one deviation:** item 14 asked for `expectedUpdatedAt` → 409 on projects, budgets, clients,
**members**, and tasks. Members got the §6.7 live-guard (deleted/updated notice) but not the
conditional-write concurrency check. Reason: `updateProjectPg`/`updateClientWithDetails`/task update
all condition a single `UPDATE ... WHERE id = $1 AND updated_at = $2` against one Postgres row. Member
profile fields are spread across several independently-written Firestore collections
(`employment`, `pay_rates`, `time_settings`, the member limits doc, `members` itself) with no single
`updated_at` that covers a save the way the Postgres entities have one. Building real concurrency
control across that write shape is a separate, non-trivial piece of design work — not a corner cut for
time, a genuine architectural difference the plan's Postgres-only Bug B analysis didn't anticipate.

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
  Connects to the same `/api/presence/ws?token=<id_token>` endpoint Dashboard-Web uses, reusing the
  `id_token` already held on `ApiClient`. Builds its own `TcpStream` with a read timeout (rather than
  `tungstenite::connect`'s all-in-one helper) so the same thread can both read incoming frames and send
  the application-level `{"type":"ping"}` `presence-gateway.js` requires every 30s - it only resets its
  120s heartbeat watch on that message, not on WS-protocol control frames. Reconnects with a 5s backoff
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
