# PLAN — Agent update checking and auto-update

Status: **proposal, nothing implemented.**
Scope: `Tauri-App-Extension` (+ one small backend endpoint in Phase 3).

Goal: check for updates and apply them automatically, including on start,
without ever costing someone their tracked time.

---

## 0. What exists today (verified, not assumed)

| Piece | Where | State |
|---|---|---|
| `tauri-plugin-updater` | [Cargo.toml](Tauri-App-Extension/src-tauri/Cargo.toml), [lib.rs:674](Tauri-App-Extension/src-tauri/src/lib.rs:674) | Registered |
| Endpoint + signing pubkey | [tauri.conf.json](Tauri-App-Extension/src-tauri/tauri.conf.json) `plugins.updater` | GitHub `releases/latest/download/latest.json`, minisign pubkey embedded |
| Capability | `capabilities/default.json` | `updater:default` granted |
| Check-on-mount | [App.tsx:770](Tauri-App-Extension/src/App.tsx:770) | Runs once on mount |
| Manual check | [App.tsx:1478](Tauri-App-Extension/src/App.tsx:1478) | Two menu entries |
| Clean-exit flush | [lib.rs:965](Tauri-App-Extension/src-tauri/src/lib.rs:965) `RunEvent::Exit` | Calls `controller.stop()` |
| Crash-safe progress | [progress_store.rs](Tauri-App-Extension/src-tauri/src/agent/progress_store.rs) | Survives unclean exit (PS-1/PS-2) |

So this is **not a greenfield feature** — auto-update already ships and runs
on every launch. The work is making it safe, not making it exist.

## 1. 🔴 The defect that matters

Today's flow, in full:

```js
const update = await check();
if (update) {
  await update.downloadAndInstall();
  await relaunch();          // ← unconditional
}
```
[App.tsx:198](Tauri-App-Extension/src/App.tsx:198), invoked unconditionally on
mount at [App.tsx:770](Tauri-App-Extension/src/App.tsx:770).

Trace what `relaunch()` does:

1. `relaunch()` ends the process → Tauri emits `RunEvent::Exit`
2. [lib.rs:965](Tauri-App-Extension/src-tauri/src/lib.rs:965) calls `exit_controller.stop()`
3. → `flush_and_stop_tracker("quit")` ([controller.rs:145](Tauri-App-Extension/src-tauri/src/agent/controller.rs:145))
4. → **`post_session_action("stop", …)`** — the session is closed *server-side*
5. Agent restarts, asks for the open session, finds none → **tracking does not resume**

**An employee working with the timer running has it silently stopped by an
update, mid-task, with no warning and no resume.** They lose the time between
the stop and whenever they notice, and their manager sees a gap in the day.

For a product whose entire purpose is accurate time capture, this is the worst
available failure mode, and it is on the default path for every user on every
launch.

> Note the exit handling itself is *correct* — flushing on exit is what stops
> an unclean shutdown losing time (PS-3). The bug is deciding to exit at all
> while a timer is running.

## 2. 🟠 The constraint nobody can code around

`tauri.conf.json` sets `"installMode": "perMachine"`, so the agent installs to
`%ProgramFiles%`. The updater downloads the NSIS installer and runs it —
**writing to Program Files requires administrator rights**.

On a managed employee machine, the user is typically not a local admin. So:

- the update either fails outright, or
- raises a UAC prompt the employee cannot satisfy,
- on **every launch**, because the check runs on mount and never records that
  it cannot succeed.

**Auto-update and `perMachine` are close to mutually exclusive without a
privileged helper service.** This is the same decision as Issue #5's A7 in the
other plan, and it must be settled before Phase 2 (§7).

## 3. Requirements

**Functional**
1. Check on start, and periodically for long-running instances.
2. Apply updates automatically, without the user managing it.
3. **Never** interrupt an active timer.
4. Never lose queued events.
5. Manual "check now" stays available.
6. An administrator can force a minimum version.

**Non-functional**
7. Failure is silent to the employee and visible to whoever can act.
8. No update loop: a bad build must not reinstall itself forever.
9. No downgrade, ever — including from a compromised or rolled-back endpoint.
10. Signature verification is non-negotiable (already provided by the plugin).

## 4. Design — one rule collapses most of the complexity

> **An update is applied only at a moment where restarting costs nothing.**

Everything else follows from that. The update lifecycle becomes a small state
machine rather than a pile of special cases:

```
        ┌──────── periodic / on-start check
        ▼
     [Idle] ──no update──► [Idle]
        │ update found
        ▼
  [Downloading] ──fail──► [Backoff] ──► [Idle]
        │ verified (minisign, by the plugin)
        ▼
    [Staged] ── waits for a safe point ──┐
        │                                │
        │  safe point reached            │ not safe yet: stay staged,
        ▼                                │ keep tracking, re-evaluate
    [Applying] ── flush queue ───────────┘
        │  install + relaunch
        ▼
   [Verifying] ── started OK? ──yes──► [Idle] (new version)
        │ no (crash-loop guard)
        ▼
    [Quarantined] — stop retrying, report
```

**A "safe point" is any of:**
- no session open (never started, or already stopped);
- the user explicitly quits;
- the machine is idle past the idle-stop threshold and the session has already
  been auto-stopped by idle escalation;
- the user accepts an offered restart.

**Staging is what makes this cheap.** Download and verify eagerly — that part
is safe at any time and gets the bytes on disk while the network is good. Only
the *install + restart* waits. A user who never stops their timer still gets
the update the moment they quit for the day.

### 4.1 Where the logic belongs

**In Rust, not in `App.tsx`.** The current check lives in a React effect, which
means it only runs while a window exists — but this app runs in the tray with
the window closed for most of the day, and `start_hidden` is a supported
preference. An update policy implemented in the webview cannot see the
tracker's state and does not run when the window is hidden.

The tracker already owns the session state, the queue, and a tick loop with
periodic work (`maybe_refresh_display_names`, `maybe_refresh_activity_scoring`).
Update checking is the same shape: `maybe_check_for_update` on that loop,
reusing the interval-and-backoff pattern already there.

The UI keeps only: a manual "check now", and a "restart to finish updating"
affordance when an update is staged.

## 5. Every case, and what happens

### 5.1 Session state at the moment an update is ready

| Case | Behaviour |
|---|---|
| No session ever started | Apply immediately |
| Session stopped | Apply immediately |
| **Session active (tracking)** | **Stage only. Never interrupt.** Apply on stop/quit |
| Session paused (break) | Stage. A pause is still an open session server-side; stopping it would end the break early and look like the employee quit |
| Idle, before escalation stops the timer | Stage — the session is still open |
| Idle-escalation has auto-stopped the session | Safe point: apply |
| Window hidden in tray, session active | Stage. Invisible restarts are worse, not better |
| Window hidden, no session | Apply. Nothing to lose and nobody to interrupt |
| Sign-in flow open (browser callback pending) | Defer: restarting kills the local callback server and the user's half-finished login |
| Manual "check now" while tracking | Offer: "Update ready — restart now?" with an explicit warning that the timer will stop. User's choice, made knowingly |

### 5.2 Network and download

| Case | Behaviour |
|---|---|
| Offline at check time | Silent no-op. Retry next interval; never surface to the employee |
| `latest.json` 404 / malformed | Treat as "no update". Log once per process, not per attempt |
| Download fails part-way | Exponential backoff (1m → 5m → 30m → 2h, capped). Never a tight retry loop |
| Signature verification fails | **Hard stop.** Do not retry with the same version, do not fall back to unsigned. Report and quarantine that version |
| Metered / very slow link | Deferred by the backoff naturally; not worth detecting explicitly |
| Disk full while staging | Fail like any download failure, clean up the partial file |

### 5.3 Version

| Case | Behaviour |
|---|---|
| Same version offered | No-op |
| Newer version | Normal path |
| **Older version offered** | **Refuse.** A rolled-back or tampered endpoint must never downgrade an agent — an older build may lack a security fix. Compare semver, do not trust ordering from the feed |
| Several versions behind | Normal path — the updater installs the latest, not each step |
| Backend requires a newer agent | Forced update (§5.5) |

### 5.4 Failure after install

| Case | Behaviour |
|---|---|
| Install fails (permissions — §2) | Record the failure reason. **Stop retrying every launch**; a UAC prompt on every start trains people to click through prompts |
| Relaunch fails | The installer has already replaced the binary; next manual start runs the new version. Nothing to do |
| **New build crashes on start** | Crash-loop guard: persist `{version, launch_count, first_seen}`. Three failed starts of the same version ⇒ quarantine it, stop updating, report. Otherwise a bad release turns into an infinite reinstall loop across the fleet |
| Update applied, backend now incompatible | Version skew is a release-ordering problem, not an updater one. Noted in §8 |

### 5.5 Policy (Phase 3, only if wanted)

| Case | Behaviour |
|---|---|
| Admin sets a minimum version | Agents below it update at the next safe point; if none arrives within a grace period, prompt the user directly |
| Emergency/mandatory update | Same, with a shorter grace period and an explicit UI |
| Staged rollout | Server decides eligibility per device; the agent just asks |

## 6. Queue and progress safety

Both are already solved and must be *used*, not rebuilt:

- **Queued events** — `queue.rs` is disk-backed and survives restart, so the
  worst case is delayed upload, not loss. Still, flush before applying so the
  common case is clean.
- **In-flight progress** — `progress_store.rs` mirrors active/idle seconds on
  every credited tick (PS-1/PS-2), so even a hard kill mid-update loses at most
  one tick.

`// ponytail: no new persistence for updates - the queue and progress store
already cover the two things that could be lost.`

## 7. Decisions needed before building

1. **`perMachine` or `currentUser`?** (§2) Auto-update effectively requires
   `currentUser` unless you ship a privileged updater service. This is the same
   question as A7 in the AV plan — answer it once, for both.
2. **May an update ever stop an active timer?** This plan says **no**, and
   everything above follows from that. If "yes, after warning" is acceptable,
   §5.1 collapses to a prompt.
3. **Is a forced-minimum-version needed?** If not, skip Phase 3 entirely.

## 8. Phasing

| Phase | Content | Size |
|---|---|---|
| **U1** | 🔴 **Guard the existing auto-update.** Do not `relaunch()` while a session is open — stage instead, apply on stop/quit. Smallest possible fix to the §1 defect | ~half day |
| **U2** | Move checking into the tracker loop with interval + backoff; stage/apply state machine; downgrade refusal; crash-loop guard | ~2 days |
| **U3** | UI: "restart to finish updating" affordance; manual check reports staged state; install-failure reporting for admins | ~1 day |
| **U4** | *Optional* — server-driven minimum version and staged rollout | ~1 day + backend |

**U1 is worth shipping on its own**, before anything else here. It is a few
lines and it removes the only case where this feature actively damages the
product.

## 9. Tests

- `is_safe_to_apply()` as a pure function over `{session state, sign-in
  pending}` — table-driven across every row of §5.1. This is the whole design
  in one function, so it is the one that must be pinned.
- Downgrade refusal: offered `0.4.20` while on `0.4.21` ⇒ refused.
- Crash-loop guard: three failed starts of the same version ⇒ quarantined.
- Backoff: repeated failures do not produce a tight loop.
- Signature failure does not retry the same version.
- Staged update survives a process restart (staged state is persisted, not
  in-memory).
- An update staged while tracking applies after `stop_session`.

## 10. What this plan deliberately does not do

- **No delta/patch updates.** Full installer replacement is what the plugin
  does and the binary is ~4 MB.
- **No custom update server.** GitHub Releases already serves it, signed.
- **No rollback-to-previous.** Quarantining a bad version and stopping is
  enough; automatic rollback needs two known-good binaries on disk and a
  supervisor, which is a much larger thing to get right than to want.
  `// ponytail: quarantine, not rollback - revisit only if a bad release
  actually ships and quarantine proves insufficient.`
