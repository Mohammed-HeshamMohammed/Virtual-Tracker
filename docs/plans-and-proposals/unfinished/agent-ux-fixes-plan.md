# Desktop Agent — UX & Stability Fix Plan

**Scope:** `Tauri-App-Extension` (agent), with the one backend read it needs in `Dashboard-Backend`.
**Status:** **Implemented 2026-07-31** — items 1–5 and 7 are in the working tree (`cargo test` 7/7,
`npm test` 29/29, `tsc` and `vite build` clean). Item 6 is a GitHub dismissal only the repo owner can
click; the expiry condition it depends on is now pinned in
[release.yml](.github/workflows/release.yml). Manual repros listed under *Checks to leave behind*
still need running on a real machine.
**Date:** 2026-07-30 · **Re-verified against `main`:** 2026-07-31 (after `fa3622c`, `9d0809a`, `750d9d5`)
**Backends checked:** `Auth-Backend` (no change needed), `Dashboard-Backend` (one endpoint extended).

### What the 2026-07-31 re-check changed

Items **2, 3, 4, 5, 6** are unchanged — every file, symbol and behaviour they name still exists as
described (line numbers drift by ≤5). The per-person project-budget work of 2026-07-31 touched only
`Dashboard-Backend` + `Dashboard-Web`, so it changes **item 1 only**:

- Project budgets now **do** stop timers (`stop_timers_when_reached` is read at session start, for
  calling projects too) — the old "notify flags only" line in item 1's table was already stale when
  written.
- `project_budgets.scope` exists: `per_person` means `cost` is **hours per member**, not a total.
- That new scope was not applied at either enforcement reader — the new **item 7**, a prerequisite for
  item 1's UI honesty (a member could be blocked by a budget that read 1/N of its real size). **Now
  fixed in the working tree, not yet committed.**

Five reported items, each with root cause, the smallest fix that actually holds, and what is
deliberately *not* built. Ordered by risk, not by the order they were reported: **item 3 first** —
a frozen window makes the other four invisible.

---

## 3. App goes unresponsive / crashes after a game or after sleep

### Root cause (primary, confirmed in code)

Every network-touching Tauri command is declared `#[tauri::command]` **without** `async`. Tauri runs
non-async commands **on the main thread**. These all do blocking HTTP:

| Command | Blocking work | Timeout |
|---|---|---|
| `get_connection_state` ([lib.rs:148](Tauri-App-Extension/src-tauri/src/lib.rs:148)) | `refresh_token_if_needed` → Firebase | 15s |
| `get_session` ([lib.rs:120](Tauri-App-Extension/src-tauri/src/lib.rs:120)) | `GET /api/activity/session` | 15s |
| `get_link_status` ([lib.rs:81](Tauri-App-Extension/src-tauri/src/lib.rs:81)) | `/health` | 15s |
| `list_projects` / `list_tasks` | 1–2 requests each | 15s |
| `get_task_time_tracking`, `get_member_limits`, `get_member_profile` | 1 request each | 15s |
| `start_*_session`, `stop_session`, `reconnect` | 1–3 requests | 15s each |

Worse, they contend on the **same** `Arc<Mutex<ApiClient>>` the tracker thread holds while uploading
([tracker.rs:500](Tauri-App-Extension/src-tauri/src/agent/tracker.rs:500),
[tracker.rs:513](Tauri-App-Extension/src-tauri/src/agent/tracker.rs:513)) — screenshot/event POSTs run at
`EVENT_POST_TIMEOUT_SEC = 30`. So the worst case for a main-thread command is *30s waiting on the
mutex + 15s of its own request*. Windows marks a window "Not responding" after ~5s.

This exactly matches the reported trigger. Coming back from a fullscreen game or from sleep means the
network stack is briefly dead, so requests hit their **full timeout** instead of failing fast — the
one condition that turns a normally-invisible main-thread block into a 30–45s freeze, and into a
"ghost window" the user then force-closes.

### Contributing cause

The UI polls `refresh()` every 5s with **no in-flight guard**
([App.tsx:882](Tauri-App-Extension/src/App.tsx:882)), and `refreshTaskTracking` polls on its own 5s
timer ([App.tsx:916](Tauri-App-Extension/src/App.tsx:916)). While commands are blocked, each tick
queues four more. A 30s stall enqueues ~24 invocations that all fire in a burst on unblock.

### Fix

1. **Move every network-touching command off the main thread.** One attribute per command, zero logic
   change:
   ```rust
   #[tauri::command(async)]   // was #[tauri::command]
   fn get_connection_state(state: tauri::State<'_, AppState>) -> ConnectionState { ... }
   ```
   Apply to: `get_link_status`, `get_session`, `get_connection_state`, `list_projects`, `list_tasks`,
   `get_task_time_tracking`, `get_member_limits`, `get_member_profile`, `start_task_session`,
   `start_project_session`, `stop_session`, `reconnect`, `sign_in`, `sign_out`, `open_log_file`.
   Leave `get_version`, `minimize_current`, `close_window`, `get_status`, `get_app_settings`,
   `save_preferences` sync — they touch no network. `close_window` and `minimize_current` **must**
   stay on the main thread (window ops).
2. **Guard the UI polls.** A `useRef<boolean>` per poll, skip the tick if the previous one has not
   resolved. Two small edits in [App.tsx](Tauri-App-Extension/src/App.tsx) (`refresh` loop and
   `refreshTaskTracking` loop).
3. **Verify before doing more.** After 1 + 2, repro: start tracking → run a fullscreen game 10 min →
   alt-tab back; and: start tracking → sleep the machine → wake. Watch `agent.log` for gaps between
   tick lines. If the window is responsive but the *webview content* is blank/frozen, that is a
   separate WebView2 GPU-loss problem — only then add a reload-on-show.

### Deliberately not built

- No restructuring of `Arc<Mutex<ApiClient>>` into per-call clients or an async client. Step 1 removes
  the freeze from the user's side; the lock contention that remains is between background threads
  where a 30s wait is harmless. Revisit only if step 3 still shows stalls.
- No watchdog/auto-restart. A crash we cannot yet reproduce does not get a supervisor.

### Risk

`#[tauri::command(async)]` on a command taking `tauri::State` is fine (the state is `Send + Sync` via
`Arc`). `close_window` calls `app.exit(0)` — leave it sync so the exit still runs on the main thread.

---

## 1. Calling-project timers show no allowed hours

### Current behaviour

For a `calling` project the whole stat grid is skipped
([App.tsx:1413](Tauri-App-Extension/src/App.tsx:1413)) — by design, since a calling project has no task
estimate. The result is a bare running clock with no cap information at all. On the task path, the
member's own daily/weekly cap is only ever visible *folded into* the single "Remaining" number
([App.tsx:1118](Tauri-App-Extension/src/App.tsx:1118)) — the user cannot see which cap is binding.

### Where the hours actually come from (the question in the report)

Three different things, and they are not interchangeable:

| Source | Table / API | Semantics | Enforced today? |
|---|---|---|---|
| **Member limits** | `limits` collection, read by `getMemberLimitHours(db, memberId, "daily"\|"weekly")` | This person's own daily/weekly hour cap. `0` = **no cap**. | Yes — `computeMemberTimerAllowance` ([timer-limit.service.js:80](Dashboard-Backend/src/modules/tasks/timer-limit.service.js:80)) |
| **Shifts** | `memberUsesShiftsForLimits` | Member is scheduled by shift, so daily/weekly caps do not apply. | Yes (bypasses caps) |
| **Task estimate** | `estimateAssignmentSeconds(task)` + per-task daily hours | Whole-task budget, incl. overtime. Calling projects have none. | Yes, task path only |
| **Project hourly budget** | `project_budgets` (`type = 'Hours based'`, `cost` = hours). `scope = 'per_project'` → `cost` is the flat total; `scope = 'per_person'` → `cost` is **hours per member** and the real total is `cost × headcount` ([projects-postgres.service.js:620](Dashboard-Backend/src/lib/postgres/projects-postgres.service.js:620)) | **Team-wide** budget for the whole project. | **Yes** — since `9ea2a0b`, `stop_timers_when_reached` + `stop_timers_at_pct` 403 the session start for *both* the task and the calling-project branch ([routes.js:376](Dashboard-Backend/src/modules/activity/routes.js:376)). But it compares against raw `cost` — wrong for `per_person`, see item 7 |
| **Per-member project limit** | `project_member_limits` | Would be the per-person project cap — but the only reader treats `cost` as a **headcount**, per the schema comment at [ensure-lookup-schema.js:477](Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js:477). Note this is *not* what `project_budgets.scope = 'per_person'` uses — that reads `project_members` headcount, not this table. | **No** |

**Recommendation:** derive the displayed cap from **member limits**, not from the hourly budget. The
project hourly budget is a team pool — showing it as "your allowed hours" would tell a member they have
200h left when their own cap is 8h/day. The backend already agrees: `computeMemberTimerAllowance` is
what actually blocks the start button for a calling project
([routes.js:356](Dashboard-Backend/src/modules/activity/routes.js:356)), and it reads member limits only.

If project budget context is still wanted, it is a **separate, clearly-labelled card** ("Project budget:
X h of Y h used"), not the personal number — and it is phase 2, not this change.

**Still true after the per-person budget work**, with one addition. `scope = 'per_person'` makes an
hours budget look like a personal cap, but it is not one: it is not per-member enforced, it is not
consumed per member, and blowing past it stops the timer for *everyone* on the project. Showing it as
"your allowed hours" would be wrong in a new way. Member limits stay the source of the personal card.

What the per-person work *does* change: a start can now be refused with "This project's budget has
been reached — timers are stopped for this project." **No agent work needed for that** — the 403
body's `error` is already propagated verbatim
([session.rs:71](Tauri-App-Extension/src-tauri/src/client/api/session.rs:71)) into `ActionResult.error`
and rendered as the inline error + toast ([App.tsx:1066](Tauri-App-Extension/src/App.tsx:1066)). It is
only *wrong* while item 7 is unfixed, because the threshold it trips on is too small.

### Fix

**Backend — extend the existing endpoint, do not add a new one.** `GET /api/activity/limits`
([routes.js:212](Dashboard-Backend/src/modules/activity/routes.js:212)) already resolves the member and
returns `{ dailyHours, weeklyHours, usesShifts }`. Add the allowance the calling-project start path
already computes:

```js
const allowance = await computeMemberTimerAllowance(db, member.memberId);
sendJson(res, origin, 200, {
  success: true,
  data: { dailyHours, weeklyHours, usesShifts, timerAllowance: allowance },
});
```
`computeMemberTimerAllowance` is already imported in that file; its third `options` argument is
optional ([timer-limit.service.js:80](Dashboard-Backend/src/modules/tasks/timer-limit.service.js:80)),
so the two-argument call above is correct. It returns `allowedRemainingSeconds`
(`null` = no cap), `limitReached`, `workedTodaySeconds`, `workedWeekSeconds`,
`memberDailyLimitSeconds`, `memberWeeklyLimitSeconds`.

**Agent — extend `MemberLimits`** in [types.rs:170](Tauri-App-Extension/src-tauri/src/types.rs:170) and
`fetch_member_limits` in [work.rs:233](Tauri-App-Extension/src-tauri/src/client/api/work.rs:233) with
`worked_today_seconds`, `worked_week_seconds`, `allowed_remaining_seconds: Option<i64>`,
`limit_reached`. All `#[serde(default)]`.

**UI —** `get_member_limits` is currently fetched only when the profile view opens
([App.tsx:922](Tauri-App-Extension/src/App.tsx:922)). Also fetch it on the home view when signed in, on
the same 5s timer as `refreshTaskTracking`, and render one "Your hours today" card group:

- **Calling project** (replaces today's empty area): `Today` · `Daily cap` · `Remaining today`.
- **Task project** (added *alongside* the existing four cards, so both caps are legible): the same
  `Daily cap` / `Remaining today` pair.

Copy rules, so "no limit" is never mistaken for "broken":
- `usesShifts` → "Scheduled by shifts — no daily cap".
- `dailyHours === 0 && weeklyHours === 0` → **"No hour limit"** (not "—", not "0h").
- `dailyHours === 0 && weeklyHours > 0` → show the weekly cap and label it weekly.
- `allowedRemainingSeconds == null` → "No cap".

### Deliberately not built

- No new `/api/activity/allowance` endpoint — the limits endpoint is already the "what am I allowed"
  read, and the agent already calls it.
- No project-budget card in this pass (see above).
- No fix to the `project_member_limits.cost` headcount/hours mismatch. It is a real bug, but it is a
  data-semantics decision, not something to silently redefine inside a UI change. Flag it separately.

---

## 2. "Close to tray" option

### Current behaviour

The X button and the window `CloseRequested` handler both quit the whole app
([lib.rs:59](Tauri-App-Extension/src-tauri/src/lib.rs:59),
[lib.rs:340](Tauri-App-Extension/src-tauri/src/lib.rs:340)). Only `startHidden` exists.

### Fix

1. Add `close_to_tray: bool` (default `true`) to `UserPreferences`
   ([prefs.rs:8](Tauri-App-Extension/src-tauri/src/prefs.rs:8)).
2. **Required with it:** put `#[serde(default)]` on **every** field of `UserPreferences`. Today
   `load()` does `serde_json::from_str(&text).unwrap_or_default()`
   ([prefs.rs:59](Tauri-App-Extension/src-tauri/src/prefs.rs:59)) — adding a field to the struct makes
   every existing `preferences.json` fail to deserialize, which silently **resets all of the user's
   settings**. Per-field defaults make old files load fine.
3. `close_window` command: if `close_to_tray`, `window.hide()` and return; else current behaviour
   (`controller.stop()` + `app.exit(0)`).
4. `CloseRequested` handler: same branch. Keep `api.prevent_close()` in both paths.
5. Settings UI: new toggle in the Startup card — **"Keep running in tray"** / "Closing the window hides
   it instead of quitting" ([App.tsx:336](Tauri-App-Extension/src/App.tsx:336) area).
6. Tray "Quit" stays the real exit and still flushes the session — that path is unchanged
   ([lib.rs:316](Tauri-App-Extension/src-tauri/src/lib.rs:316)).

### Note

With this on, closing mid-session no longer stops the timer — which is the point, but it must be
obvious. Add a one-line hint under the toggle: "Tracking keeps running. Use Quit in the tray to stop."

---

## 4. Auto sign-in on by default

### Fix

`UserPreferences::default()` → `auto_sign_in: true`
([prefs.rs:24](Tauri-App-Extension/src-tauri/src/prefs.rs:24)).

Two things this does **not** cover, both of which matter:

- **Existing installs** already have `preferences.json` on disk with `"autoSignIn": false` (the current
  repo copy of [preferences.json](Tauri-App-Extension/preferences.json) shows exactly that). Defaults
  only apply to fresh installs. If existing users should also get it: a one-time flip keyed on a marker
  field. **Recommendation: do not** — silently opening a browser on an existing user's next launch is a
  surprise. New installs get the better default; existing users have the toggle.
- **Interaction with item 5.** `maybe_auto_sign_in` currently fires whenever `!is_authenticated`
  ([controller.rs:629](Tauri-App-Extension/src-tauri/src/agent/controller.rs:629)). Once item 5 shows a
  Welcome Back screen for a stale-but-present session, auto sign-in must **not** throw a browser over
  it. Gate it on "no stored credentials at all" — check `store.load()` for an empty `id_token` rather
  than on live authentication state.

---

## 5. Stale session keeps the old user signed in

### Root cause (confirmed)

Two things combine:

1. `get_profile` builds the whole identity from the **cached id token's JWT claims**
   ([controller.rs:318](Tauri-App-Extension/src-tauri/src/agent/controller.rs:318)). An expired,
   revoked or wrong-user token still yields `signedIn: true`, a name and an avatar.
2. `WelcomeBackPanel` only renders when `connection === "disconnected"`
   ([App.tsx:1141](Tauri-App-Extension/src/App.tsx:1141)). But when the refresh token is **rejected**
   and there is no device credential, `get_connection_state` returns **`signedOut`**, not
   `disconnected` ([controller.rs:395](Tauri-App-Extension/src-tauri/src/agent/controller.rs:395)).

So the exact reported state — old user still shown, everything disabled — is `signedOut` + a cached
profile: the home view renders normally, `list_projects` fails, the dropdown says "Couldn't load
projects", and no recovery UI ever appears.

### Fix

**Agent UI only. No backend change.** (`Auth-Backend` exposes no revoke/session endpoint — routes are
`verify`, `firebase-config`, `password-policy`, `resolve-sign-in-methods`, `readiness` — and none is
needed: `sign_out` already clears tokens *and* the device credential
([controller.rs:259](Tauri-App-Extension/src-tauri/src/agent/controller.rs:259)), so the old user cannot
silently re-auth from this machine.)

1. Route `signedOut`-with-cached-profile into the Welcome Back panel:
   ```ts
   const staleSession = connection === "signedOut" && signedIn;
   if ((connection === "disconnected" || staleSession) && !tracking && view === "home") {
     return <WelcomeBackPanel ... needsRelink={needsRelink || staleSession} ... />;
   }
   ```
2. Add the switch-account affordance to `WelcomeBackPanel`
   ([App.tsx:510](Tauri-App-Extension/src/App.tsx:510)) — a text link under the primary button, not a
   third stacked button:

   | Element | Copy |
   |---|---|
   | Heading | `{firstName}` (unchanged) |
   | Body, stale session | "We couldn't verify this session. Continue, or sign in as someone else." |
   | Primary button | "Continue as {firstName}" (reconnect) / "Link this device again" (needsRelink) |
   | Text link | **"Not you? Switch account →"** |
   | Existing tertiary | "Log out instead" — **remove**, the link replaces it |

3. "Switch account" = `sign_out()` then `sign_in()`. The web link page already offers **"Use a
   different account"** with a real Firebase logout
   ([agent-link-flow.tsx:202](Dashboard-Web/features/auth/components/agent-link-flow.tsx:202)), so the
   browser side of the switch already works — this only has to get the user there with the agent's own
   tokens cleared first.

### Deliberately not built

- No "always show Welcome Back on every cold start". The connection check runs on the first poll and is
  effectively instant on a healthy session; gating every launch behind a click would be a regression for
  the 99% case.
- No per-user profile switching / multi-account storage. One machine, one linked account.

---

## 7. `per_person` budgets stop timers at 1/N of their real size

*Added 2026-07-31. Regression from `fa3622c`; `Dashboard-Backend` only, no agent change.*
**Status: fixed.** Both readers below call `computeProjectBudgetTargetPg`, and
`maybeNotifyProjectBudget` takes the computed `cap` as a parameter instead of re-deriving it. Covered
by [project-budget-target.test.js](Dashboard-Backend/test/project-budget-target.test.js).

### Root cause

`fa3622c` added `project_budgets.scope`. On a `per_person` row, `cost` is **hours per member** and the
real project total is `cost × headcount` — computed by `computeProjectBudgetTargetPg` /
`computeProjectBudgetTargetForAllPg`
([projects-postgres.service.js:700](Dashboard-Backend/src/lib/postgres/projects-postgres.service.js:700)).

Only `overview-service.js` was taught this. The two places that *act* on a budget read raw `cost`:

| Reader | Was | Effect on a `per_person` budget |
|---|---|---|
| Timer stop gate ([routes.js:385](Dashboard-Backend/src/modules/activity/routes.js:385)) | `const cap = Number(budget.cost ?? 0)` | Timers stop once the **whole team** has burned one member's allotment. 5 members, 40 h each → everyone blocked at 40 h, not 200 h |
| Budget notify ([project-budget-notify.js:101](Dashboard-Backend/src/modules/projects/services/project-budget-notify.js:101)) | same expression, computed internally | "80% of budget" fires at 16% of the real target |

Timer stop was the visible one: the member saw "This project's budget has been reached" while the
dashboard Budget column (which *does* scale) said 20% used, and nothing reconciled the two.

Nothing else needed touching: `overview-service.js` and the `/api/project-budgets` GET
([routes.js:766](Dashboard-Backend/src/modules/projects/routes.js:766)) were already scope-aware, and
[routes.js:346](Dashboard-Backend/src/modules/projects/routes.js:346) is a form default that *should*
echo raw `cost`.

### Fix (applied)

The wrapper already existed and short-circuits to `cost` for `per_project`, so the non-scoped path is
byte-identical:

```js
import { computeProjectBudgetTargetPg } from "../../lib/postgres/projects-postgres.service.js";
const cap = await computeProjectBudgetTargetPg(db, sessionProjectId, budget);
```

The gate computes `cap` once and passes it into `maybeNotifyProjectBudget(db, projectId, budget,
spent, cap)` — one read serving both, matching how `spent` was already shared.

### Deliberately not built

- No per-member enforcement of a `per_person` budget. The column means "the total scales with
  headcount", not "each member is individually capped" — inventing per-member enforcement here would
  be a product decision, not a bug fix.
- No backfill or migration. `scope` defaults to `per_project`, where the two expressions agree.

### Check left behind

[project-budget-target.test.js](Dashboard-Backend/test/project-budget-target.test.js) — `per_project`
passes `cost` through untouched, `per_person × 3` members scales to 3×, an empty project is 0 (not the
per-person figure), pay-rate budgets sum each member's own rate, and a missing budget row is 0.

---

## Sequencing

| Order | Item | Why here | Rough size |
|---|---|---|---|
| 1 | **3** — async commands + poll guards | Everything else is untestable through a frozen window | S (mechanical) |
| 2 | **2** — close to tray (+ the `serde(default)` fix) | Prerequisite: the per-field defaults protect items 2 and 4 from wiping saved prefs | S |
| 3 | **5** — stale-session Welcome Back + switch account | Highest user-visible correctness win | S–M |
| 4 | **4** — auto sign-in default | One line, but must land **after** 5 so it does not fight the new panel | XS |
| 5 | **7** — `per_person` budget cap at the two enforcement readers | **Code already written (uncommitted)** — only the unit test is left | XS |
| 6 | **1** — allowed hours (backend + agent + UI) | Only agent item needing a backend deploy; ships in the same deploy as 7 | M |

Items **3, 2, 5, 4** (all agent-side) ship as one agent release. Items **7** and **1**'s backend half
go out in one `Dashboard-Backend` deploy; the agent tolerates 1's missing field via `serde(default)`,
so deploy order is safe either way.

## Checks to leave behind

- Rust unit test for `UserPreferences` deserialising an **old** `preferences.json` (no `closeToTray`
  key) without resetting the other fields — this is the one change that can silently destroy user
  settings.
- Manual: game/sleep repro from item 3, step 3.
- Manual: revoke the session server-side → relaunch agent → Welcome Back with "Not you?" appears, and
  the switch lands on the web page's account chooser.
- Unit: `per_person` budget cap, per item 7.

## Implementation notes (2026-07-31) — where the build differs from the plan

- **Item 1 UI:** one shared "Your hours today" card group (`Today, all work` · `Daily cap` ·
  `Remaining today`) renders for *both* project types, instead of a calling-only group plus a separate
  pair on the task path. Same information, one code path, and the task cards keep their own row below
  it under a labelled heading.
- **Item 1 polling:** member limits moved from a one-shot fetch on the profile view to a guarded 5s
  poll on home *and* profile — "Remaining today" has to count down while the clock runs. The
  People-page record stays a one-shot fetch; it cannot change while the app is open.
- **Item 4 gate:** `maybe_auto_sign_in` now tests `has_stored_identity()` — a cached id token **or** a
  device credential — rather than live authentication, so a stale session gets the Welcome Back panel
  instead of a browser thrown over it. `AgentController::is_authenticated` had no callers left
  afterwards and was deleted.
- **Item 3 scope:** `open_web_app` and `get_profile` stayed synchronous — the first spawns the OS
  browser, the second decodes cached JWT claims; neither does HTTP.
- **Item 6 note:** `tauri.conf.json` is strict JSON and cannot carry a comment, so the
  "re-open this if a Linux target appears" warning lives next to `runs-on: windows-latest` in
  [release.yml](.github/workflows/release.yml) instead.

---

## 6. Dependabot #43 — `glib` unsoundness in `VariantStrIter` (RUSTSEC / moderate 6.9)

**Alert:** `glib >= 0.15.0, < 0.20.0` — `VariantStrIter::impl_get` passed `&p` where the C function
needs `&mut p`, so recent rustc optimises the write away, `CStr::from_ptr` gets `NULL`, crash.
Locked version: `glib 0.18.5` ([Cargo.lock:1502](Tauri-App-Extension/src-tauri/Cargo.lock:1502)).
Dependabot reports it cannot reach the fixed `0.20.0`.

### Why it cannot update (and why that is correct)

`glib` is not a direct dependency — nothing in [Cargo.toml](Tauri-App-Extension/src-tauri/Cargo.toml)
names it. It arrives transitively:

```
tauri 2.11.5 → gtk 0.18.2 / webkit2gtk 2.0.2 → glib 0.18.5
```

`gtk 0.18` and `webkit2gtk 2.0` are pinned to the `glib 0.18` API. `glib 0.20` is a breaking major bump,
so `cargo update -p glib` can only reach `0.18.5` — exactly what the alert says. Forcing `0.20` via
`[patch]` would fail to compile `gtk`. **This is upstream-blocked in `tauri`/`wry`, not fixable here.**

### Actual exposure: none for what we ship

`gtk`/`webkit2gtk`/`glib` are the **Linux** webview backend. This agent ships Windows only:

- `bundle.targets` is `["nsis", "msi"]` ([tauri.conf.json:42](Tauri-App-Extension/src-tauri/tauri.conf.json:42))
- release CI is `runs-on: windows-latest`, single job ([release.yml](.github/workflows/release.yml))
- on Windows the webview is WebView2; the `gtk` dependency is `cfg`-gated and never compiled

`Cargo.lock` lists every platform's dependencies regardless of build target — that is why the alert
fires at all. The vulnerable `VariantStrIter` code is not compiled into, not linked into, and not
reachable from any artifact we produce.

### Action

1. **Dismiss the alert as "vulnerable code is not actually used"**, with this reasoning in the dismissal
   note: Linux-only transitive dependency, Windows-only build targets, upstream-pinned by
   `gtk 0.18`/`webkit2gtk 2.0`. Do **not** dismiss as "won't fix" or "no bandwidth" — the reason is
   non-exposure, and that reason has an expiry condition (below).
2. **Track the real fix upstream.** It lands when `tauri`/`wry` move to `glib 0.20`-based bindings. Bump
   `tauri` on the next routine dependency pass and re-check whether `glib 0.18.5` is still in the lock
   file. No pinning, no patching, no vendoring in the meantime.
3. **Re-open this immediately if a Linux target is ever added** — a `deb`/`appimage` target or a
   `ubuntu-latest` CI job turns this from non-exposure into a genuine crash risk, and the dismissal
   above stops being true. Worth a one-line comment next to `bundle.targets` saying so.

### Deliberately not done

- No `[patch.crates-io]` override of `glib` — breaks the `gtk 0.18` build for zero benefit on a build
  that never compiles either crate.
- No hand-editing `Cargo.lock` to a version cargo cannot resolve.
- No forking `gtk`/`webkit2gtk` bindings.
- No `cargo-deny`/audit-ignore config added just for this one alert; if dependency alerts become
  routine, add `cargo-deny` properly as its own task rather than as a silencer here.
