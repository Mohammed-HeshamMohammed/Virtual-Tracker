# Feature Plan: "Welcome back" — Desktop Agent Session Recovery

Status: **Draft — ready for review, not yet implemented**
Owner: Mohammed Hesham
Created: 2026-07-30
Scope: `Tauri-App-Extension` (primary), `Dashboard-Backend` (one small addition)

## 1. Problem

When the desktop agent's connection to the backend dies — expired refresh
token, revoked session, backend unreachable, laptop offline overnight — the
app **does not say so**. It keeps rendering the normal tracking panel with the
user's name and avatar, dropdowns that silently never populate, and a Start
button that fails with a generic toast.

We want an explicit recovery screen: the user's **avatar centred in the app**,
their **name beneath it**, and a single button ("Welcome back") that talks to
the backend and re-establishes everything.

## 2. Why this happens today (traced, not assumed)

This is not a cosmetic gap — there is a real bug underneath it.

[`ApiClient::refresh_token_if_needed`](Tauri-App-Extension/src-tauri/src/client/api/mod.rs:68)
returns `false` when the token refresh fails, **but never clears `id_token`**.
And [`is_authenticated`](Tauri-App-Extension/src-tauri/src/client/api/mod.rs:60)
is just `self.id_token.is_some()`.

The consequences chain:

1. A failed refresh leaves a stale, expired `id_token` in place.
2. `is_authenticated()` still returns `true`.
3. [`get_profile`](Tauri-App-Extension/src-tauri/src/agent/controller.rs:259)
   takes the `Some(token)` branch and returns `signed_in: true`, decoding
   name/email/avatar out of the **stale JWT's** claims.
4. The UI therefore renders the full signed-in panel. Every
   `fetch_*` call bails at its `refresh_token_if_needed` guard and returns
   `None`/`Err`, so lists come back empty and actions fail — with no
   explanation.
5. The auto-sign-in poller
   ([controller.rs:461](Tauri-App-Extension/src-tauri/src/agent/controller.rs:461))
   only fires when `!is_authenticated()`, so it **never** re-prompts.

The app is stuck in a dead state that looks alive, and nothing recovers it
except quitting or manually hitting "Re-link account".

**Confirmed in the wild.** A live screenshot of the agent in exactly this
state: status pill reads **READY**, the hero card shows the correct name and
avatar, the panel invites you to "Select a task and start when you're ready" —
and the project dropdown reads **"No projects"**. The only way the user found
to recover was clicking "Re-link account". Every symptom matches the chain
above; this plan is written against a reproduced bug, not a hypothetical.

### 2.1 Three separate places the failure gets swallowed

The stale token is the root cause, but three independent bits of error-hiding
are what make it *invisible* rather than merely broken. All three need
addressing or the recovery screen will never be reached.

1. **The fetch discards the error.**
   [`refreshProjects`](Tauri-App-Extension/src/App.tsx:721) (and
   `refreshTasks` alongside it) is `try { … } catch { setProjects([]) }`. A
   failed load and a genuinely empty list produce **byte-identical UI**. The
   dropdown's `emptyLabel="No projects"` is what the screenshot shows — the
   app is reporting "you have no projects" when it means "I could not ask".
2. **The status pill is not measuring auth.** `statusTone`/`statusLabel`
   ([App.tsx:137](Tauri-App-Extension/src/App.tsx:137)) derive "READY" from
   the free-text link status plus `signedIn` — neither of which knows the
   token is dead. It reports READY because nothing ever told it otherwise.
3. **`get_link_status().connected` only pings `/health`.** An unauthenticated
   liveness check on the backend succeeds regardless of the token, so a
   perfectly healthy-looking connection coexists with a dead session.

### 2.2 What the "must re-link to fix" symptom tells us

`refresh_token_if_needed` re-attempts the refresh on *every* call, so a purely
transient network failure heals itself on the next 5-second poll with no user
action. The fact that this state **persists until a manual re-link** means the
refresh is failing permanently — i.e. Firebase is rejecting the refresh token
(revoked, password change, account disabled), or `firebase_api_key()` cannot
be fetched at all.

That has a direct design consequence: **a local token refresh alone will not
rescue the state in the screenshot.** Whatever the button does has to work
when the refresh token is permanently dead — which, with today's credential
model, means a browser re-link, because the device holds nothing else to
authenticate with.

Since sending the user back to the browser is explicitly ruled out (§4.2a),
that is what forces the device-credential work. It is not gold-plating: it is
the minimum required for "Welcome back" to be a button that actually works in
the state this feature exists to fix. The plain refresh path still carries the
genuinely-transient cases (backend restart, laptop resuming from sleep), which
today produce the same dead panel until something happens to succeed.

Silver lining, and the reason the requested design works so cleanly: **the
identity data is already on the device**. Name, email, and avatar come from
decoding the cached JWT locally — no network needed. A "Welcome back" screen
can render the user's face and name while completely disconnected.

## 3. Second problem this exposes: tracked time can be silently lost

Worth fixing in the same pass, because the reconnect button is the natural
place to handle it.

- The tracker's periodic sync
  ([tracker.rs](Tauri-App-Extension/src-tauri/src/agent/tracker.rs)) calls
  `post_session_action("sync", …)` and discards the result (`let _ = …`).
  While disconnected, the local counters keep climbing but nothing reaches
  the server.
- The backend treats a session as abandoned once
  `activity_sessions.updated_at` is older than
  `ACTIVITY_SESSION_STALE_MS` — **default 120 000 ms, i.e. 2 minutes**
  ([env.js:138](Dashboard-Backend/src/config/env.js:138)) — and
  [`scheduleAbandonedSessionSweep`](Dashboard-Backend/src/modules/activity/abandoned-session-sweep.service.js)
  closes it (`ended_at` set) every 30 s.
- After roughly 2 minutes offline, the server-side session is **closed**.
  `findOpenSession` then returns nothing, so when the agent reconnects, its
  `sync` matches no open session and does nothing. Every second worked
  during the outage is dropped.
- Quitting while disconnected loses it too: `flush_and_stop_tracker`'s
  `post_session_action("stop", …)` fails the same way.

So "refresh everything" must mean *re-establish the session and push the
accumulated seconds*, not merely re-fetch dropdown contents.

## 4. Design

### 4.1 A third connection state

Today the agent models two states: signed in, or not. Add a third.

| State | Meaning | What the user sees |
|---|---|---|
| `connected` | Token valid, backend reachable | Normal panel (unchanged) |
| `disconnected` | We hold cached identity, but the token cannot currently be used | **"Welcome back" screen** |
| `signed_out` | No token at all, or the refresh token was rejected outright | Existing sign-in screen |

The distinction between `disconnected` and `signed_out` is what decides
whether the button can fix things locally or has to send the user to the
browser.

### 4.2 Failure taxonomy — the piece that's missing today

[`FirebaseTokenService::refresh`](Tauri-App-Extension/src-tauri/src/client/firebase.rs:66)
collapses **every** failure into `None`: network error, HTTP 400
`invalid_grant` (token actually revoked), and "couldn't even fetch the
Firebase API key" are indistinguishable. They need opposite remedies, so
this must be split:

```rust
pub enum RefreshOutcome {
    Ok,
    /// Network/backend problem — the credentials are probably still fine.
    Unreachable,
    /// Firebase rejected the refresh token (revoked, password change,
    /// account disabled). Re-linking in the browser is the only fix.
    Rejected,
}
```

Map it from the actual response: transport error → `Unreachable`; HTTP 4xx
with `invalid_grant`/`TOKEN_EXPIRED`/`USER_DISABLED` → `Rejected`; 5xx →
`Unreachable`.

Note `firebase_api_key()` fetches the key from **our own backend**
(`/api/auth/firebase-config`) and caches it in memory only. So if the backend
is down and the app has restarted, refresh fails even with a perfectly good
refresh token — correctly classified as `Unreachable`, and exactly the case
the retry button fixes.

### 4.2a Hard requirement: recovery happens *in the app*

**Bouncing the user to a browser to log in again is not an acceptable primary
recovery path.** It reads as the product losing their session and making them
prove themselves again. "Welcome back" must mean one click, in the app, back
to work.

This has a real technical obstacle, and it is the reason the current app
cannot already do it.

**The agent has no credential of its own.** Tracing the link flow: the agent
calls `/api/activity/agent/link/init` and gets a `linkToken` + `agentSecret`
([link.rs:9](Tauri-App-Extension/src-tauri/src/client/api/link.rs:9)); the
user then authenticates **in the web app**, which calls
`/api/activity/agent/link/complete` and hands over *its own*
`idToken`/`refreshToken`
([routes.js:1093](Dashboard-Backend/src/modules/activity/routes.js:1093));
the agent polls `/link/exchange` and receives those browser tokens
([agent-link-sessions.js:110](Dashboard-Backend/src/modules/activity/agent-link-sessions.js:110)).

So the agent's refresh token *is the user's Firebase refresh token, borrowed
from the browser*. When Firebase rejects it, the device holds **nothing else**
to authenticate with — which is exactly why the only recovery today is another
browser round trip. No amount of UI work fixes that; the credential model has
to change.

The good news: the missing piece already half-exists. `agentSecret` is a
per-device secret this codebase already mints and verifies — it is just
consumed once during linking and then discarded. Making it persistent turns it
into the device credential that in-app reconnect requires.

**Proposed: a persistent device credential.**

- At link time, keep the `agentSecret` instead of discarding it. Store it
  client-side in the existing DPAPI-encrypted store next to the tokens
  ([tokens.rs](Tauri-App-Extension/src-tauri/src/auth/tokens.rs) already does
  encryption-at-rest), and server-side as a **hash** on a long-lived
  `agent_devices` row (`member_id`, `device_id`, `secret_hash`,
  `created_at`, `last_seen_at`, `revoked_at`).
- New endpoint `POST /api/activity/agent/reauth` taking
  `{ deviceId, agentSecret }`. It verifies the hash, re-runs the **same**
  member status and ban checks any other auth path runs, then mints fresh
  credentials with Firebase Admin `createCustomToken(uid)` — the backend
  already holds the Admin SDK via `getAuthAdmin()`.
- The agent exchanges that custom token for an `idToken`/`refreshToken` pair
  via Firebase's `signInWithCustomToken` REST endpoint. It already speaks to
  `securetoken.googleapis.com` for refreshes
  ([firebase.rs:71](Tauri-App-Extension/src-tauri/src/client/firebase.rs:71)),
  so this is one more call in a client that exists.

Result: pressing **Welcome back** recovers silently, in-app, even when the
borrowed user refresh token is long dead. The browser is demoted to a
genuine last resort (device secret itself revoked, or never linked).

**This is an authentication change and must be treated as one.** Non-negotiables:
the secret is stored hashed server-side and encrypted at rest client-side;
it is bound to one member and one device; revoking a member, banning them, or
removing the device invalidates it immediately; `reauth` re-runs every check
the normal login path runs, so this can never become a way to keep tracking
after being removed; and it is rate-limited per device the way
`/link/exchange` already tracks `invalid_exchange_attempts`.

### 4.3 What the button actually does

One command, `reconnect()`, running these in order and stopping at the first
hard failure:

1. **Re-refresh the token** with the existing refresh token. Handles expiry
   and transient outages with no user-visible ceremony.
2. **If that was `Rejected`, re-auth with the device credential** (§4.2a) —
   `POST /agent/reauth`, exchange the custom token, carry on. This is the step
   that keeps recovery in-app instead of throwing the user at a browser.
   `Unreachable` at either step → stay on the screen, "Still can't reach the
   server", let them retry.
3. **Health-check the backend** (`health_ok()`, already exists).
4. **Re-establish the session.** Ask the server for the open session. If
   there is none (the sweep closed it, §3), start a fresh one seeded with the
   locally accumulated active/idle seconds so the outage's work is preserved
   rather than restarted at zero.
4. **Refetch everything**: profile, member limits, projects, tasks, and the
   current session — the same set the UI polls today.
5. Return a structured result so the UI can say what happened.

### 4.4 The screen

Centred in the app body (not the side panel — the user asked for "the middle
of the app"):

```
        ┌─────────────┐
        │   avatar    │      ← cached JWT claim, works offline
        └─────────────┘
           Mohammed                ← name, from the same cached claims
     Your session went idle        ← one line explaining why
                                     (offline / server unreachable / expired)
       ┌───────────────────┐
       │   Welcome back    │       ← the reconnect button
       └───────────────────┘
        Log out instead            ← quiet secondary escape hatch
```

Reuses `avatar-wrap`/`avatar-img`/`avatar-fallback` and `btn btn-primary`,
already in [App.css](Tauri-App-Extension/src/App.css) — no new visual
vocabulary. `initialsFromName` already provides the no-avatar fallback.

### 4.5 Do NOT flash this screen on one blip

Deliberate constraint, learned from the Dashboard-Web "connection lost"
regression where a single flaky API call tripped a full-screen overlay and
made the app look broken.

- Require **two consecutive** failed refresh/health cycles before switching
  to `disconnected`. One transient failure changes nothing visible.
- Recovery is immediate — a single success returns to `connected`.
- **Never interrupt an active timer.** If tracking is running, keep counting
  locally and surface the disconnect as a banner rather than replacing the
  whole view; the full takeover is only for the idle case. Losing the visible
  clock mid-shift would read as lost work.

## 5. Options considered

### Option A — Reactive screen driven by a real connection state *(recommended)*

Model the third state properly, drive the UI from it, one explicit user
action to recover.

| Dimension | Assessment |
|---|---|
| Complexity | Medium — one enum, one command, one view |
| Fixes the underlying bug | Yes |
| User clarity | High — says what's wrong, one obvious action |

**Pros:** fixes the stale-token lie at its root; the user is never guessing;
the reconnect path is one function that can also flush lost time.
**Cons:** touches the auth client, controller, and UI together.

### Option B — Clear the tokens on refresh failure

One-line-ish: on failure, wipe `id_token` so the app falls back to the
existing "Not signed in" screen.

**Pros:** tiny diff, removes the lie.
**Cons:** throws away the cached identity, so no avatar/name to show — the
exact screen the user asked for becomes impossible. Also forces a full browser
re-link for what is often just a 30-second network blip. Rejected.

### Option C — Silent auto-retry with backoff, no UI

**Pros:** zero UI work; recovers unattended.
**Cons:** invisible. Against a revoked token it retries forever and the user
still has no idea why nothing works. Worth having *underneath* Option A, but
not instead of it.

**Decision: A**, with a modest auto-retry from C behind it (retry quietly on
the existing 5 s poll; only surface the screen once the debounce trips).

### 5.1 How the button re-authenticates — the consequential choice

| Option | In-app? | User effort | Cost |
|---|---|---|---|
| **A. Persistent device credential** *(recommended)* | Yes, fully silent | One click | New endpoint, new table, auth-surface review |
| B. Embedded webview login window | Technically in-app | Log in again | Small, but still asks them to re-prove identity |
| C. External browser re-link (today) | No | Leave app, log in | Zero, and explicitly rejected |

**A** is the only option where "Welcome back" behaves like the greeting it is.
**B** is the sane fallback for when even the device secret is gone — an
embedded Tauri `WebviewWindow` at least keeps them inside the app rather than
launching Chrome. **C** stays only as the true last resort (never linked, or
device revoked).

The honest trade-off for A: it introduces a long-lived credential that can
re-mint sessions, so it widens the auth surface. That is why the guardrails
in §4.2a are load-bearing rather than decorative — a device secret that
outlives a ban or a removal would be a security regression, not a convenience.

## 6. File change list

| Repo | File | Action |
|---|---|---|
| Tauri | `src-tauri/src/client/firebase.rs` | `refresh()` returns `RefreshOutcome` instead of `Option`, classifying transport vs. rejection |
| Tauri | `src-tauri/src/client/api/mod.rs` | Track `last_refresh_outcome`; add `connection_state()`; keep `is_authenticated` honest |
| Tauri | `src-tauri/src/agent/controller.rs` | `get_connection_state()`, `reconnect()`, debounce counter; `get_profile` reports the state |
| Tauri | `src-tauri/src/types.rs` | `ConnectionState` enum, `ReconnectResult`, `ProfileInfo.connectionState` |
| Tauri | `src-tauri/src/lib.rs` | Register `reconnect` command |
| Tauri | `src-tauri/src/agent/tracker.rs` | Preserve accumulated seconds across an outage; re-open a swept session on reconnect |
| Tauri | `src/App.tsx` | `WelcomeBackPanel`, view routing on connection state, in-timer banner variant |
| Tauri | `src/App.tsx` | Stop swallowing load errors in `refreshProjects`/`refreshTasks` (§2.1.1) — track a load-failed flag so "couldn't load" stops rendering as "No projects" |
| Tauri | `src/App.tsx` | Derive the status pill from the real connection state rather than free-text link status (§2.1.2) |
| Tauri | `src/App.css` | Centred recovery layout (reuses existing avatar/button classes) |
| Backend | `src/modules/activity/routes.js` | Accept a `resumeFromSeconds` hint on session start so a swept session resumes at the right cumulative total instead of 0 |
| Backend | `src/lib/postgres/ensure-lookup-schema.js` | `agent_devices` table (`member_id`, `device_id`, `secret_hash`, `created_at`, `last_seen_at`, `revoked_at`) |
| Backend | `src/modules/activity/agent-link-sessions.js` | Persist the device on successful link instead of discarding `agentSecret` |
| Backend | `src/modules/activity/routes.js` | `POST /api/activity/agent/reauth` — verify device secret, re-run member status/ban checks, mint a Firebase custom token |
| Backend | member removal / ban / deactivation paths | Revoke that member's `agent_devices` rows — the credential must die with the account |
| Tauri | `src-tauri/src/auth/tokens.rs` | Store `device_id` + `agentSecret` alongside the tokens in the existing DPAPI-encrypted store |
| Tauri | `src-tauri/src/client/api/link.rs` | Keep the `agentSecret` after linking; add `reauth()` + `signInWithCustomToken` exchange |

Everything else — budgets, reporting, the calling-project work from
[project-type-selection-plan.md](project-type-selection-plan.md) — is
untouched.

## 7. Edge cases

- **Revoked mid-session** (admin removes or bans the member): refresh returns
  `Rejected`, and the device re-auth must **also** fail — `/agent/reauth`
  re-runs the member status and ban checks precisely so this cannot become a
  back door that keeps a removed member tracking. Only here does the flow fall
  through to sign-out. This is the single most important test case in the
  feature.
- **Device secret stolen off a machine**: it is DPAPI-encrypted at rest and
  bound to one member and one device, but it is still a credential on disk.
  Revocation has to be reachable — at minimum implicitly via banning or
  removing the member; ideally a visible device list later.
- **Clock skew**: `refresh_token_if_needed` compares the JWT `exp` against
  local time with a 120 s buffer
  ([constants.rs:31](Tauri-App-Extension/src-tauri/src/constants.rs:31)). A
  badly-skewed machine can loop refreshing. Treat repeated immediate
  re-expiry as `Rejected` and say the clock may be wrong.
- **Outage longer than the 2-minute sweep**: covered in §4.3 step 3 — start a
  new session carrying the accumulated seconds.
- **Quit while disconnected**: today the stop call fails and the time is
  gone. Persist the pending counters to the existing agent store so the next
  launch can flush them. (Own step; call it out rather than assume it comes
  free.)
- **Never linked at all**: no cached identity, so there is no avatar or name
  to show — falls through to the existing sign-in screen, not this one.
- **Genuinely no projects assigned**: must stay distinguishable from a failed
  load (§2.1.1). A member with zero assigned projects should still read "No
  projects", while a fetch failure reads as a connection problem and routes
  to recovery. Same applies to the task list.
- **Backend up, token dead**: the `/health` ping succeeds while every
  authenticated call 401s (§2.1.3). Connection state must be driven by the
  token's real usability, not by `health_ok()` alone — otherwise this exact
  screenshot's state still reports itself as connected.

## 8. Open questions

1. Button copy: "Welcome back" reads as a greeting rather than an action.
   Alternatives: "Reconnect", "Resume tracking", or greeting-as-heading with
   "Reconnect" on the button. Needs a decision before UI work.
2. Should the recovery screen show *when* the connection dropped ("last
   synced 14 minutes ago")? Cheap to add — `updated_at` is already tracked —
   and makes the lost-time situation legible.
3. Should a disconnect while tracking also raise a Windows toast, given the
   window is usually minimised to the tray?
4. Should the device credential expire on its own (say 90 days idle), or live
   until explicitly revoked? Expiry is safer; never-expiring is the only thing
   that guarantees "Welcome back" always works for a laptop that sat in a
   drawer for a month.
5. Ship the device credential and the recovery screen together, or land the
   screen first with the plain refresh (fixes the transient cases, still
   needs a manual re-link for a dead refresh token) and follow with the
   credential? The former is the feature as asked for; the latter is smaller
   and lower-risk per deploy.

## 9. Status log

- 2026-07-30 — Constraint added by the product owner: **recovery must happen
  in the app; sending the client back to a browser to log in again is rude and
  is not an acceptable primary path.** Tracing the link flow to check whether
  that was achievable surfaced the blocker — `/agent/link/complete` is called
  by the *web app*, which hands its own `idToken`/`refreshToken` to the agent,
  so the agent's refresh token is a borrowed browser credential and the device
  holds nothing of its own. When Firebase rejects it there is literally
  nothing left to authenticate with, which is why today's only cure is
  another browser trip. Added §4.2a: persist the `agentSecret` the link flow
  *already mints and then throws away* into a real device credential, plus a
  `/agent/reauth` endpoint that mints a Firebase custom token after re-running
  the member status and ban checks. Corrected §2.2, which had concluded the
  browser re-link would be the button's dominant path — with the device
  credential it becomes the last resort instead. Added §5.1 comparing the
  three re-auth mechanisms and the security guardrails this pulls in.
- 2026-07-30 — Updated against a live screenshot of the failure: agent showing
  **READY** with the correct name and avatar while the project dropdown read
  "No projects", recoverable only by manually re-linking. Added §2.1 (three
  independent places the error is swallowed — the `catch { setProjects([]) }`
  in `refreshProjects` is why the failure renders as an empty list, the status
  pill never measures auth health, and `/health` succeeds regardless of token
  validity) and §2.2 (because the refresh retries every poll, a state that
  survives until a manual re-link implies the refresh token is genuinely
  rejected — so the browser re-link, not the local retry, is the button's
  dominant real path). No design reversal; the extra findings widen the fix
  from "add a screen" to "stop hiding the error in three places, then add the
  screen".
- 2026-07-30 — Drafted after tracing the auth path end to end. Found that the
  requested screen is really a fix for a live bug: a failed token refresh
  leaves a stale `id_token` in place, so `is_authenticated()` stays true and
  the agent presents a dead session as a healthy one, with no recovery path
  short of a restart. Also found that a disconnect longer than the backend's
  2-minute abandoned-session threshold silently discards tracked time, which
  the reconnect action is the right place to repair.
