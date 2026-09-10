# Agent field reports: blank window, dead refresh, lag, unexpected pausing, wrong counts

Investigation of the Tauri agent against five recurring field complaints. Every
finding below is traced to a specific line, and each one is a distinct defect —
they are not five symptoms of one cause, though several make each other worse.

**Status:** diagnosis only. Nothing here is fixed yet.
**Codebase as of:** `718c8382` (agent v1.0.1 + unreleased fixes on `main`).

---

## The two screenshots

**Blank dark window over the dialer.** The agent window painted as one flat
rectangle with no content, and stayed that way. The window frame is alive — it
still draws, still has its chrome — so the *process* is fine; it is the WebView2
renderer inside it that died. See F1.

**"Couldn't load your tasks" / "Couldn't load your projects", with Pause and
Stop still live.** The UI's API calls failed while the session kept running.
That combination is by design (the tracker keeps counting when the backend is
unreachable, `tracker.rs:468`) but it is also the exact state in which the
counting is least trustworthy — see F5 and F6.

---

## F1 — The blank window: the webview runs out of memory

**What happens:** every screenshot the user clicks is fetched as a base64 `data:`
URL and stored in React state, in a map that is **never evicted**:

- `src/App.tsx:157` — `screenshotImages: Record<string, string>`
- `src/App.tsx:163` — `projectScreenshotImages: Record<string, string>`
- `src/App.tsx:721-728` — inserts on select; there is no matching delete anywhere.

A capture is resized to `MAX_SCREENSHOT_WIDTH` and JPEG-encoded, but base64
inflates it by a third again. Call it 150–400 KB per screenshot as a string, plus
the decoded bitmap the renderer holds for every `<img>` that has used one. Click
through a shift's worth of screenshots and the webview is holding tens of
megabytes of strings it can never release, because the map still references them.

When WebView2's renderer process hits its limit it is killed and the host window
is left painting nothing. Tauri does not reload it, and there is no error
boundary anywhere in `src/` (searched: no `ErrorBoundary`, no `componentDidCatch`,
no `window.onerror`, no `unhandledrejection` handler). So the window stays blank
until the user kills the app.

**Why it looks random:** it depends on how many screenshots someone opened, which
varies per person and per day. It is more likely on a machine already under
memory pressure — which is why it showed up on a dialer workstation.

**Fix:**
1. Cap both maps — an LRU of ~12 entries is more than the UI ever displays at
   once (`MAX_VISIBLE_SHOTS` is already 12). Evict on insert.
2. Better: stop holding base64 in JS at all. Convert to a `Blob` and an
   object URL, and `URL.revokeObjectURL` on eviction, so the bytes leave the JS
   heap the moment nothing points at them.
3. Add a top-level error boundary that renders a "Reload" button, plus a
   `window.onerror` / `unhandledrejection` hook that logs to the Rust side. A
   blank window should at minimum be able to tell you it is blank.
4. Add a watchdog on the Rust side: if the webview has not responded to a
   heartbeat within ~30s, reload it. A renderer crash should cost a reload, not
   a restart.

---

## F2 — Refresh "does nothing": the button latches disabled forever

**What happens:** `src/App.tsx:480`

```ts
const handleManualRefresh = async () => {
  if (refreshingData) return;
  setRefreshingData(true);
  try {
    await Promise.all([refresh(), refreshProjects(), refreshAssignedTasks()]);
  } finally {
    setRefreshingData(false);
  }
};
```

and the button is `disabled={refreshingData}`.

`invoke()` settles only when the Rust command returns. There is **no timeout on
any of the three**. If one of them does not return — because it is queued behind
a mutex held by a hung HTTP call (F3) — `refreshingData` stays `true`, the button
stays disabled, and every subsequent click is swallowed by the `if (refreshingData)
return` guard on the first line.

From the user's side: the refresh button stops working and never recovers.

**Fix:**
1. Race every `invoke` against a timeout (~20s, above the 15s HTTP timeout) so the
   promise always settles and the latch always clears.
2. Reset `refreshingData` on a timer as a backstop, independent of the promises.
3. Surface the failure — the `catch` already calls `toast.error`, but it can only
   run if the promise settles.

---

## F3 — The lag: one mutex, 46 commands, and a 5-second heartbeat

This is the big one, and it explains both the lag reports and F2.

`api` is a single `Arc<Mutex<ApiClient>>` shared by three things:

| Holder | Where | How often |
|---|---|---|
| UI commands | `agent/controller.rs` — **46** `self.api.lock()` call sites | every user action |
| Tracker tick | `agent/tracker.rs` — 13 call sites | **every 5 seconds** |
| Live sync | `agent/live_sync.rs:44` | websocket lifetime |

Every lock is held **across the whole HTTP round trip**, because the temporary
guard lives to the end of the statement:

```rust
let fetched = self.api.lock().fetch_session();   // tracker.rs:466 — every tick
```

`HTTP_TIMEOUT_SEC` is 15 (`constants.rs:100`). So a single slow request blocks
every other caller for up to 15 seconds.

It gets worse in two ways:

- **Token refresh doubles it.** `authorized()` (`client/api/mod.rs:150`) calls
  `refresh_token_if_needed()`, which makes its *own* network call to Firebase when
  the token is near expiry — inside the same lock. One command can therefore hold
  the mutex for two sequential round trips: **up to 30 seconds**.
- **A tick is not one request.** `upload_app_slice` posts the app slice, then the
  URL slices, then a screenshot on its own schedule — each re-locking. A single
  tick can hold the lock repeatedly across several requests.

And screenshot capture itself runs **synchronously on the tracker thread**
(`capture/screen.rs:14` — capture, resize, JPEG encode) every 90–210 s. On a
4K display that is hundreds of milliseconds of CPU inside the tick, before any
network call starts.

**Net effect:** on a slow or flaky connection the UI is unresponsive in bursts,
every 5 seconds, indefinitely. That is precisely "it lags so much when it's on".

**Fix:**
1. **Stop holding the lock across I/O.** Clone what the request needs, drop the
   guard, then do the HTTP call. `reqwest::blocking::Client` is already `Send +
   Sync` and internally pooled — it does not need the mutex at all. The mutex
   should protect the *token state*, not the network.
2. Give the tracker its own `ApiClient` so its heartbeat can never block a user
   action. Share only the token store, behind a lock held for microseconds.
3. Move screenshot capture and encode off the tracker thread onto a worker.
4. Drop `fetch_session` from every tick to every 3rd–4th tick (15–20 s). Nothing
   in the session state changes fast enough to need 5 s polling, and live-sync
   already pushes the changes that matter.
5. Lower `HTTP_TIMEOUT_SEC` for interactive commands specifically. 15 s is
   defensible for a background upload and far too long for a button.

---

## F4 — Unexpected pausing: idle detection rests on a hook Windows can silently remove

**What happens:** `tick_idle_escalation` (`agent/tracker.rs:875`) stops the
session and **rewinds** active time the moment `idle_seconds()` crosses the
threshold. There are no warning stages — the code says so at `tracker.rs:133`.
`IDLE_THRESHOLD_SEC` is **60** (`constants.rs:87`).

`idle_seconds()` (`capture/activity.rs:319`) is
`now - last_input_ms`, and `last_input_ms` is updated *only* from two low-level
Windows hooks installed at `capture/activity.rs:210-214`:

```rust
SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), ...)
SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), ...)
```

**Three ways that goes wrong, all of which read as "the user went idle":**

1. **Windows silently unhooks slow hooks.** If a `WH_*_LL` callback does not
   return within `LowLevelHooksTimeout` (`HKCU\Control Panel\Desktop`, 300 ms by
   default), Windows removes the hook **and does not tell the process**. There is
   no re-installation and no liveness check anywhere in `run_listeners`. Once it
   happens, `last_input_ms` freezes, `idle_seconds()` grows without bound, and
   60 seconds later the session stops and rewinds — while the user is typing.
   A laggy machine (see F3) is exactly the condition that trips this.
2. **UIPI.** Low-level hooks do not receive input directed at a
   higher-integrity-level process. Anyone working in an elevated app reads as
   idle for as long as they stay there.
3. **The hook thread's message pump stalls.** Delivery requires that thread to
   keep pumping (`activity.rs:230`); anything that blocks it stops the clock.

**Why 60 seconds is itself too aggressive:** a dialer agent listening on a call,
reading a script, or waiting on hold is not idle. Most trackers use 5–10 minutes
before acting, and warn before stopping.

**Fix:**
1. **Use `GetLastInputInfo()` as the authority for idle.** It is a kernel-level
   query, needs no hooks, cannot be silently removed, and is exactly the right
   signal for "has anyone touched this machine". Keep the hooks for the *activity
   score*, which genuinely needs event counts — but never let a dead hook stop a
   session.
2. Cross-check the two: if the hooks say idle and `GetLastInputInfo` says active,
   the hooks are dead — log it, reinstall them, and do not escalate.
3. Reinstall the hooks periodically regardless, and verify they are still live.
4. Raise the default threshold and add a warning stage before the stop-and-rewind.
   A user should see "still there?" before their time is taken back.

---

## F5 — Incorrect counting: every tick throws away its sub-second remainder

**What happens:** `credited_seconds` (`agent/tracker.rs:987`)

```rust
fn credited_seconds(elapsed: Duration) -> u64 {
    elapsed.as_secs().min(SESSION_POLL_SEC * 4)
}
```

and its caller (`tracker.rs:1013-1015`):

```rust
let now = Instant::now();
let delta = Self::credited_seconds(now.duration_since(*last_tick_at));
*last_tick_at = now;          // <-- the remainder is discarded, not carried
```

The loop is `tick() + sleep(5s)` (`tracker.rs:364-374`), so a tick period is
always **5 seconds plus however long `tick()` took** — and `tick()` does real
network I/O every single time. `as_secs()` truncates that to 5, and because
`last_tick_at` is reset to `now`, the leftover fraction is gone rather than
carried into the next tick.

The error is one-directional. The clock can only ever run **slow**:

| Work done in `tick()` | Tick period | Lost per tick | Lost per 8-hour shift |
|---|---|---|---|
| 50 ms | 5.05 s | 0.05 s | **4.8 min** (1.0 %) |
| 120 ms | 5.12 s | 0.12 s | **11.3 min** (2.3 %) |
| 250 ms | 5.25 s | 0.25 s | **22.9 min** (4.8 %) |
| 400 ms | 5.40 s | 0.40 s | **35.6 min** (7.4 %) |
| 800 ms | 5.80 s | 0.80 s | **66.2 min** (13.8 %) |

The comment above `credited_seconds` says it exists to stop exactly this
under-counting — measuring real elapsed time instead of assuming the sleep
interval. It fixed the large error and left a smaller one of the same shape.

Note the correlation: **the laggier the machine, the more time it loses.** The
people reporting lag are the same people reporting short hours, and that is not a
coincidence — it is the same milliseconds, counted twice as two complaints.

**Fix:** carry the remainder instead of dropping it.

```rust
let elapsed = now.duration_since(*last_tick_at);
let credited = elapsed.as_secs().min(SESSION_POLL_SEC * 4);
// Roll the sub-second remainder into the next tick rather than discarding it.
*last_tick_at = now - (elapsed - Duration::from_secs(credited));
```

The clamp still protects against a sleep/hibernate gap: when it bites, set
`last_tick_at = now` as today, since that gap must not be banked.

---

## F6 — Counting keeps running when the agent cannot see the backend

When `fetch_session` fails, the tracker deliberately keeps capturing and keeps
crediting time (`tracker.rs:468`, "keep capturing under it — nothing gets lost").
That is the right call for a brief network blip. But combined with F4 it means a
machine whose hooks have died and whose network is down will keep crediting
*active* seconds with nothing able to contradict it — and combined with F2 the
user cannot even refresh to find out.

Screenshot 2 is this state.

**Fix:** bound it. After N consecutive failed `fetch_session` calls (say 12 — one
minute), mark the session degraded in the UI, and either keep counting with a
visible banner or stop and queue, but do not do it silently. The user should be
able to see that the number in front of them is unverified.

---

## Priority

| # | Defect | Impact | Effort |
|---|---|---|---|
| F5 | Sub-second truncation | Everyone's hours run 1–14 % short | **Trivial** — 3 lines |
| F4 | Idle rests on removable hooks | Unexplained stops with time taken back | Small — `GetLastInputInfo` cross-check |
| F3 | One mutex across all I/O | Lag, and the root of F2 | Medium — real refactor |
| F2 | Refresh latches disabled | Refresh dies until restart | Small — timeouts |
| F1 | Unbounded screenshot cache | Blank window, needs restart | Small — LRU + boundary |
| F6 | Silent degraded counting | Untrustworthy numbers, invisible | Small |

F5 and F4 are the two worth doing first: they are the ones actually corrupting
recorded time, and both are small. F3 is the largest change and fixes the most
complaints at once.

---

## What is already fixed but not shipped

Three things on `main` are relevant and are **not** in v1.0.1:

- **"Unknown" as a tracked app** — an unidentifiable foreground window was
  recorded as an app literally named `Unknown` and accumulated real seconds.
  Skipped now (`capture/window.rs`, `is_identified`).
- **Top apps disagreeing with the week** — the query bucketed days in the
  database's timezone while the caller resolved the week in the member's, and
  returned five rows with no total to compare against.
- **The radar chart reading as a single dot** — radius scaled linearly against
  the largest app, so a 30-second app plotted 0.05 px from the centre.

The dialer CPU/crash work (in-process cached UIA, per-window backoff, history
fallback) **is** in v1.0.1. Anyone still reporting the original dialer lag should
be checked for their installed version before treating it as a new report.

A v1.0.2 release is needed to get any of this to users.
