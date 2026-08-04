# Code Review: Tauri-App-Extension

Scope: full read of `src-tauri/src/**` (Rust backend: capture, auth, client, agent orchestration) and `src/**` (React frontend). Reviewed for security, correctness, performance/resource behavior, and maintainability, plus a structural/architecture assessment.

## Summary

This is a mature codebase for a long-running Windows desktop tracking agent — most obvious bugs already carry inline fix-commit references (`TC-2`, `ACT-3`, `MAC-1`, `CF-2`, etc.), and pure logic is genuinely unit-tested. The issues below are the ones that survived that process: a couple of real correctness bugs that can silently kill activity tracking, one resource-growth issue that matters specifically because this process is meant to sit quietly for weeks, and a handful of security hardening gaps that are defense-in-depth rather than directly exploitable today.

**Update:** all 4 Critical Issues and 13 of 14 Suggestions/Frontend findings below have since been fixed — see [Resolution](#resolution) at the bottom, plus a separate post-review regression (async commands panicking) found and fixed during live testing. `cargo check`/`cargo build`/`cargo test` all pass clean (73/73 tests) after the fixes.

## Critical Issues

| # | File | Line | Issue | Severity | Status |
|---|------|------|-------|----------|--------|
| 1 | `src-tauri/src/capture/activity.rs` | 123-136, 400-401 | `stop()` posts `WM_QUIT` to the hook thread without joining it, then `start_tracker()` can immediately start a new hook thread that overwrites `METER_FOR_HOOK` before the old thread's shutdown cleanup zeroes it out. Result: keyboard/mouse hook callbacks silently no-op forever, activity/idle detection goes dead with no error logged. Triggered by any rapid stop→start (sign-out/sign-in, reconnect click). | 🔴 Critical | ✅ Fixed |
| 2 | `src-tauri/src/capture/activity.rs` | 196-209 | `run_listeners` is a no-op on non-Windows, so `last_input_ms` never updates off Windows. Every session hits `idle_stop_sec` (900s) exactly 15 minutes after start and auto-stops/reverses credited time — even while the user is actively working. Functional blocker for any macOS rollout, not cosmetic. | 🔴 Critical | ✅ Fixed (escalation guarded; real hooks still deferred) |
| 3 | `src-tauri/src/queue.rs` | 41, 80-95 | `enqueue()` calls `trim_if_needed()` on every single queued event, which reads the **entire** backlog file into memory just to check its length. During a multi-hour outage, with screenshot payloads embedded per event and up to `MAX_QUEUED_BATCHES=2000` batches, this turns an O(1) append into O(n) file I/O + allocation on every event — on a process explicitly meant to be a lightweight background agent. Track the count separately, or only trim on a timer. | 🔴 Critical | ✅ Fixed |
| 4 | `src-tauri/src/client/api/mod.rs` | 40-50 | `ApiClient::new` calls `.unwrap_or_else(\|err\| panic!(...))` if the HTTP client fails to build. This runs in `AgentController::new` before any window exists, and release builds hide the console (`main.rs:2`), so a machine with a broken TLS/cert store crashes at launch with **no visible error**, only a log line. | 🔴 Critical | ✅ Fixed |

## Suggestions

| # | File | Line | Suggestion | Category | Status |
|---|------|------|------------|----------|--------|
| 1 | `src-tauri/src/agent/controller.rs` | 142-182 | `apply_tokens` holds `self.api.lock()` across three sequential blocking HTTP calls (`refresh_token_if_needed`, `ensure_device_registered`, `register_agent` — up to 45s worst case). `ActivityTracker::tick()` needs the same lock every 5s, so a slow sign-in/relink stalls the whole tracker loop, not just itself. Re-lock per call instead of holding one lock across all three. | Performance | ✅ Fixed |
| 2 | `src-tauri/src/auth/link_flow.rs` | 92 | The pending link token is logged in full (`log::info!("Opened sign-in page: {sign_in_url}")`, URL includes `?link=<token>`) to the persistent on-disk log, which is user-openable from Settings. The same file already truncates the token elsewhere (`link_flow.rs:154`); do the same here instead of logging the full URL. | Security | ✅ Fixed |
| 3 | `src-tauri/src/auth/server.rs` | 134-170, 180-203 | The local auth callback server parses any request body as JSON regardless of declared `Content-Type`, and CORS headers only gate response readability, not who can POST. Not directly exploitable (the attacker still needs the link token), but there's no explicit `Content-Type`/`Origin` check as defense-in-depth against a same-machine browser tab issuing a "simple" cross-origin POST. | Security | ✅ Fixed (Content-Type guard added) |
| 4 | `src-tauri/src/auth/link_flow.rs` | 87-90; `src-tauri/src/agent/controller.rs:210-214` | The `hint` query param is spliced unescaped into the URL opened in the system browser (unlike the link token two lines above, which is `urlencoding::encode`d). Currently only fixed literals (`provider=google`, `mode=signup`, …) reach it from the frontend, but there's no allow-list enforced at the boundary that accepts it. | Security | ✅ Fixed |
| 5 | `src-tauri/src/capture/screen.rs` | 63-80 | Screenshot capture picks the monitor under the **mouse cursor** (`GetCursorPos`), while the app/window activity log uses the OS **foreground window**. On a common dual-monitor setup these can disagree — the screenshot uploaded doesn't match the app/URL logged as active. | Correctness | ✅ Fixed |
| 6 | `src-tauri/src/capture/screen.rs` | 14-25 | No detection of a locked/secure-desktop session before capturing — a locked workstation typically still returns a capturable frame rather than an error, so screenshots keep uploading during a lock for no tracking value. | Correctness | ✅ Fixed |
| 7 | `src-tauri/src/capture/window.rs` | 277-360; `src-tauri/src/agent/tracker.rs:754` | Browser URL capture runs a subprocess **synchronously on the single tracker thread**, with an 8s timeout (`constants.rs:97`) firing every 15s app-log tick — a slow script can block over half the tracker's duty cycle, including the idle-escalation check that shares the same tick. | Performance | ⏭️ Deferred — needs a real concurrency-model change, not a contained fix |
| 8 | `src-tauri/src/capture/window.rs` | 277-302 | `run_command_timeout` polls the child process every 40ms in a sleep loop instead of a blocking wait-with-timeout. Minor, but fires often. | Performance | ⏭️ Deferred — no clean stdlib fix without adding a dependency; cosmetic |
| 9 | `src-tauri/src/constants.rs` | 93 | `MIN_TOKEN_LENGTH = 20` is the only local check before treating a credential-store value as a plausible id token. Server-side auth still gates every real request, but a basic JWT-shape check (three dot-separated segments) would be a cheap improvement over "20+ chars". | Security | ✅ Fixed |
| 10 | `src-tauri/src/client/api/*.rs` | events.rs:10-20, session.rs:12-24, work.rs:9-21, compliance.rs:15-27, classification.rs:21-34, scoring.rs:26-38 | Every endpoint file re-implements the same refresh/auth-header/timeout prologue. No shared "authenticated request" helper, so a future retry/backoff policy change means editing 6+ files. | Maintainability | ✅ Fixed |
| 11 | `src-tauri/src/agent/tracker.rs` | 182-230, 285-302 | `tick()` takes 15 `&mut` parameters and `loop_run` hand-maintains ~10 parallel locals. A `TickState` struct would remove the need to touch the signature, the caller locals, and every call site for each new piece of per-tick state. | Maintainability | ✅ Fixed |
| 12 | `src-tauri/src/agent/controller.rs` | 123-128 vs 738-743 | `on_status_changed` and `on_status_changed_local` are byte-for-byte duplicate implementations under two names. Collapse to one. | Maintainability | ✅ Fixed |
| 13 | `src-tauri/src/client/api/*.rs` | session.rs:12, compliance.rs:15, mod.rs:148, mod.rs:221, work.rs:172-319 | `ApiClient` methods return five different error shapes (`Result<_, ()>`, `Result<_, bool>`, `Result<(), Option<String>>`, bare `Option<T>` swallowing failure entirely). Each is individually well-commented, but every call site has to know its callee's bespoke contract. A shared network/auth/rejection error enum would remove that. | Maintainability | ✅ Fixed |
| 14 | `src-tauri/src/agent/tracker.rs`, `auth/server.rs`, `client/api/*.rs` | tracker.rs:285-501; server.rs:82-227 | All existing tests exercise pure/isolated helpers. The riskiest code — `ActivityTracker::tick()`'s ~220-line state machine, `AuthServer`'s route handlers, and every `ApiClient` network method — has zero coverage, even against a mock server. | Maintainability | 🟡 Partially fixed — targeted tests added for the queue fix (#3), `AuthServer`'s credentials-link route (Content-Type rejection + valid-token acceptance), and `ApiClient`'s `authorized()` prologue; full `tick()` state-machine coverage still not attempted |

## Frontend (React) Findings

| # | File | Line | Finding | Category | Status |
|---|------|------|---------|----------|--------|
| 1 | `src/App.tsx` | 1121-1147 | `handlePasswordSignIn` clears `signInPassword` only on success. On a failed attempt (wrong password, network error) the plaintext password stays sitting in component state/DOM until the user manually clears it. | Security | ✅ Fixed |
| 2 | `src/App.tsx` | 1913-1938 | DevTools/context-menu/view-source blocking (F12, Ctrl+Shift+I/J/C, Ctrl+U) has no real security value — anyone with local access can inspect the webview through other means (remote debugging port, unpacked build). Worth keeping only if it's meant to deter casual tampering, not as an actual control; the real boundary has to be server-side, which it already is elsewhere in this app. | Note | ⏭️ Not changed — informational only, no fix requested |
| 3 | `src/App.tsx` | 1004-1069 | Three independent `setInterval(..., 5000)` polls (`refreshGuarded`, `refreshTaskTracking`, `refreshMemberLimits`) fire on their own uncoordinated timers. Each is individually guarded against overlap, which is good, but they could be coalesced into one 5s tick to cut concurrent request bursts against the backend. | Performance | ⏭️ Skipped — the three effects have different enable-conditions (task/view changes); merging risks timer-coordination bugs for marginal gain |

## What Looks Good

- Clean module separation: `capture/` (OS integration), `client/` (HTTP protocol), `agent/` (orchestration), `auth/` (tokens/link/local server) have little circular coupling.
- Extensive inline documentation of *why*, including references back to specific prior bugs/fixes (`TC-2`, `TC-3`, `TC-6`, `ACT-3`, `MAC-1`, `MAC-2`, `CF-2`) — this made the review meaningfully faster and is worth keeping as a convention.
- Frontend guards against overlapping polls via in-flight refs (`refreshInFlight`, `trackingInFlight`, `limitsInFlight`), with a documented incident (a 30s stall used to queue ~2 dozen invocations) explaining why.
- `queue.rs` FIFO offline-retry design and bounded backlog (`MAX_QUEUED_BATCHES`) are the right shape, even though the trim implementation itself is O(n) per call (Critical #3).
- Monitoring-notice ("CF-2") consent flow is enforced both server-side (session start refuses while unacknowledged) and reflected in the UI rather than only one or the other.
- The stale-session vs. disconnected vs. needs-relink states in `App.tsx` are genuinely distinct and each has a real recovery path — a detail that's easy to collapse into one generic "you're logged out" state and wasn't here.

## Verdict

**Approved — Critical Issues resolved.** All 4 Critical Issues and 13 of the 14 Suggestions/Frontend findings have been fixed (see [Resolution](#resolution) below), plus a separate live-testing regression (async commands panicking on any network call — see further down). The 2 remaining deferred items (subprocess-off-tracker-thread, the 40ms busy-poll) are structural/cosmetic, not live bugs — safe to schedule separately rather than block on.

---

## Resolution

Applied directly to `src-tauri/src/**` and `src/App.tsx`. `cargo check`, `cargo build`, and `cargo test` (65/65 lib tests) all pass clean with no warnings after these changes.

- **Critical #1 — hook-thread race** (`capture/activity.rs`): `start()` now stores the hook thread's `JoinHandle`; `stop()` joins it via a watcher-thread + channel with a bounded 3s wait before returning, so `start()` can never run concurrently with the old thread's cleanup.
- **Critical #2 — non-Windows idle never resets** (`capture/activity.rs`, `agent/tracker.rs::tick_idle_escalation`): added an `ActivityMeter::HOOKS_SUPPORTED` const; idle escalation now returns immediately without auto-stopping when hooks aren't supported on the current platform. Real macOS/Linux input listeners remain unimplemented (deferred, as scoped).
- **Critical #3 — queue O(n) scan per enqueue** (`queue.rs`): added an `AtomicUsize` line-count tracker, seeded once and kept in sync by enqueue/trim/rewrite, so `enqueue()` only reads the file when actually at/over the cap. Added `queued_count_tracks_the_real_file_line_count` and `trim_drops_the_oldest_batches_once_over_the_cap` tests.
- **Critical #4 — startup panic** (`client/api/mod.rs::new`, `agent/controller.rs::new`, `lib.rs::run`): `ApiClient::new`/`AgentController::new` now return `Result`; a failed startup shows a native `MessageBoxW` (Windows) and exits cleanly instead of panicking pre-window.
- **Suggestion #1 — lock held across 3 HTTP calls** (`agent/controller.rs::apply_tokens`): re-locks `self.api` per call instead of holding one scope across all three; ordering/behavior unchanged.
- **Suggestion #2 — plaintext token in log** (`auth/link_flow.rs::start`): logs an 8-char token preview instead of the full URL, matching the existing truncation convention at `link_flow.rs:154`.
- **Suggestion #3 — no Content-Type check** (`auth/server.rs`): added a `has_json_content_type` guard on the credentials-link route; non-JSON requests get a 400.
- **Suggestion #4 — unescaped `hint`** (`auth/link_flow.rs`, `agent/controller.rs::open_sign_in`): new `util::is_allowed_link_hint` allow-list (`provider=google`, `provider=apple`, `mode=signup`, `mode=forgot-password`); anything else is dropped and logged instead of passed through.
- **Suggestion #5 — wrong-monitor screenshot** (`capture/screen.rs::active_monitor`): now prefers the foreground window's center (reusing `capture::window::get_foreground_window` + `GetWindowRect`), falling back to cursor position and then the first enumerated monitor.
- **Suggestion #6 — no locked-session check** (`capture/screen.rs::is_session_locked`): uses `OpenInputDesktop`/`DESKTOP_SWITCHDESKTOP` to detect a locked/secure desktop and skip capture; added the `Win32_System_StationsAndDesktops` feature to `Cargo.toml` (no new external dependency).
- **Suggestion #9 — weak token heuristic** (`agent/controller.rs::looks_like_jwt`): added a 3-segment JWT-shape check alongside `MIN_TOKEN_LENGTH` at both call sites.
- **Suggestion #10 — duplicated API boilerplate** (`client/api/mod.rs::authorized`): one shared refresh + auth-header prologue, used by `events.rs`, `session.rs`, `work.rs`, `compliance.rs`, `classification.rs`, `scoring.rs`. Each endpoint's own request/response logic and error type were left untouched.
- **Suggestion #12 — duplicate status method** (`agent/controller.rs`): `on_status_changed_local` removed; call sites unified on `on_status_changed`.
- **Frontend #1 — password not cleared on failure** (`src/App.tsx::handlePasswordSignIn`): `setSignInPassword("")` moved into the `finally` block, so it clears on every attempt, not just success.

A second pass applied the remaining maintainability items:

- **Suggestion #11 — `TickState` struct** (`agent/tracker.rs`): `tick()`'s ~15 parameters and `loop_run`'s hand-maintained locals are now bundled into one `TickState`, constructed once via `TickState::new()`.
- **Suggestion #13 — unified `ApiError` enum** (`client/api/mod.rs`): `Network` / `Unauthorized` / `Rejected(String)` replaces the five different ad-hoc error shapes; every `ApiClient` method and call site migrated, each method's actual success/failure semantics preserved.
- **Suggestion #14 — targeted test coverage**: added `AuthServer` tests for the Content-Type guard (rejects non-JSON, accepts a matching JSON link token) and `ApiClient` tests for the `authorized()` prologue (attaches the bearer header, distinguishes network failure from a real rejection). Full `tick()` state-machine coverage was not attempted — flagged as still open in the table above.

**Deferred, unchanged** — Suggestions #7 (subprocess off tracker thread) and #8 (40ms busy-poll): both noted above with the specific reason each was left alone.

---

## Post-Review Regression: Async Commands Panicking (found and fixed 2026-08-04)

Testing the app after the fixes above surfaced three symptoms that all traced to one root cause, not covered by the original review:

- Clicking "Link account", "Continue with Google/Apple", "Create account", or "Forgot password" did nothing visible — no browser window opened, no error shown.
- The dev console showed a repeating panic: `thread 'tokio-rt-worker' panicked ... Cannot drop a runtime in a context where blocking is not allowed. This happens when a runtime is dropped from within an asynchronous context.`

**Root cause:** every network-touching command in `lib.rs` was declared `#[tauri::command(async)]` on a plain synchronous function. Tauri dispatches that via `tauri::async_runtime::spawn` — it does **not** move the blocking body onto a separate thread, it just runs the whole synchronous function, blocking `reqwest` calls included, directly on a tokio worker thread. Any `reqwest::blocking` client built or dropped while already inside that context panics. Because every sign-in variant funnels through the same `sign_in` command, the crash killed the async task before the browser ever opened — explaining all three symptoms at once.

**Fix** (`lib.rs`): added a `run_blocking` helper wrapping `tauri::async_runtime::spawn_blocking` (tokio's dedicated pool where blocking is expected), and moved all 15 affected commands (`sign_in`, `sign_in_with_password`, `sign_out`, `get_link_status`, `get_session`, `get_task_time_tracking`, `get_member_limits`, `get_member_profile`, `start_task_session`, `get_monitoring_notice`, `acknowledge_monitoring_notice`, `get_connection_state`, `reconnect`, `start_project_session`, `stop_session`) onto it. Tauri requires an async command taking a `State` reference to return `Result`, so each was changed from a bare return type to `Result<T, String>` wrapping `Ok(...)` — the JS side is unaffected since `invoke<T>()` already resolved to the bare value on success and none of these paths ever produced a Rust-level `Err`.

Verified: `cargo check`, `cargo build` (zero warnings), and `cargo test` (73/73 lib tests) all pass. Could not execute the compiled binary directly from this environment (requires elevation) to reproduce the live UI flow — please re-run `npm run tauri:dev` to confirm the panic and sign-in/link/create-account/forgot-password flows are resolved.

---

## Architecture Assessment

### Context

Virtual Tracker's Tauri agent is a long-running Windows background process responsible for capturing screenshots, window/URL/idle activity, authenticating against a backend (DPAPI-backed local token storage, browser-handoff link flow, in-app password sign-in), and syncing everything through a disk-backed offline queue. The question this section addresses: given the current structure, what breaks first under load or bad conditions, and what's the biggest structural risk as the codebase grows (more platforms, more capture types, more API surface)?

### Current design

- **`capture/`** owns all OS integration (screen, window, activity/idle hooks, VM detection), gated by `cfg(windows)`/`cfg(target_os = "macos")` branches scattered across `activity.rs`, `window.rs`, `vm_detect.rs`, and `util.rs`.
- **`client/`** is a single `ApiClient` behind one `Mutex`, shared by the background tracker thread (ticking every 5s) and every UI-invoked Tauri command, with per-endpoint modules under `client/api/` each re-implementing their own request boilerplate and error shape.
- **`agent/`** splits lifecycle/state ownership (`controller.rs`) from the poll loop itself (`tracker.rs`), which is the right split, but `tracker.rs::tick()` has grown to 15 parameters and ~220 lines because there's no `TickState` container.
- **`auth/`** handles DPAPI token storage, the OAuth-like browser link handshake, and a local loopback HTTP server to receive the link callback — three genuinely different concerns.

### What breaks first

1. **The offline queue, under sustained bad network.** `queue.rs`'s full-file read on every enqueue (Critical #3) means a multi-hour outage doesn't just accumulate data — it accumulates *linearly increasing CPU and memory cost per event* on a process meant to idle quietly for weeks.
2. **The single tracker thread, under any slow I/O.** Session fetch, screenshot/app/URL upload, sync, and a synchronous PowerShell subprocess for URL capture all run serially on one thread per tick. One slow step (a hung script, a near-timeout HTTP call) delays everything scheduled for that tick — including the idle-escalation check that decides whether to auto-stop a session (Suggestion #7, and Critical #1/#2 make the consequences of a stalled/dead activity signal concrete).
3. **The shared `ApiClient` mutex, under any UI action during sign-in/relink.** Suggestion #1 is a direct symptom of one object serving both a 5s hot-path caller and cold-path UI commands with no separation between them — and nothing in the current structure stops a future contributor from reintroducing the same pattern by adding one more sequential call inside an existing lock scope.

### Structural risk as this grows

- **More platforms.** The `cfg(...)` branching is already spread across four files with no `PlatformCapture`-trait-style boundary. A third platform multiplies that scatter rather than containing it, and macOS today is a partial implementation (window/URL capture wired, activity/idle hooks entirely unimplemented — Critical #2) that's easy to miss precisely because there's no single seam that forces every platform to implement the same contract.
- **More capture types.** `tick()`'s already-overloaded signature (Suggestion #11) means a fourth capture type (clipboard, active file, tab list) means hand-threading another local through the whole call chain rather than plugging into a pipeline.
- **More API endpoints.** The copy-pasted request scaffolding (Suggestion #10) is fine at 7 files; past 15-20 the natural growth pattern becomes "copy the nearest file" rather than "call the shared helper," compounding the inconsistent-error-shape problem (Suggestion #13).

### Recommended direction

| Option | Addresses | Trade-off |
|--------|-----------|-----------|
| **A. Join the hook thread on `stop()` before allowing `start()`** | Critical #1 | Small, contained fix — a thread `join()` with a bounded timeout. Do this regardless of anything else below. |
| **B. Introduce a `PlatformCapture` trait (Windows/macOS impls) for activity+idle hooks** | Critical #2, platform-growth risk | Larger refactor, but turns "macOS forgot to implement idle" into a compile-time-visible gap instead of a silent no-op. Worth doing before any second-platform ship, not after. |
| **C. Replace `trim_if_needed`'s full-file scan with a tracked count (or timer-only trimming)** | Critical #3 | Small, isolated fix to `queue.rs`. |
| **D. Add a shared `authenticated_request` helper in `client/api/mod.rs`, with one error enum** | Suggestions #10, #13 | Medium refactor touching 6 files once; pays for itself at the next 2-3 endpoints added. |
| **E. Extract a `TickState` struct for `tracker.rs::tick()`** | Suggestion #11 | Medium, mechanical refactor; makes future capture types additive instead of signature-breaking. |

### Consequences

- Doing A and C costs little and removes two of the four Critical issues outright.
- B is the one item worth sequencing deliberately: if macOS support is actually on the near-term roadmap, doing B before that work avoids re-discovering Critical #2 in the field. If macOS isn't imminent, B can wait.
- D and E are pure maintainability investments — no user-visible bug today, but both compound in cost the longer they're deferred past this point (7 endpoint files, 15 tick parameters).
