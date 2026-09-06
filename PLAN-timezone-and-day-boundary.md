# Timezone & day-boundary handling — options and trade-offs

> **Status: Option A is confirmed as the main piece of work.** Every member's
> "today" gets computed from their own `members.timezone` (already-existing,
> already-editable data) instead of the server's raw clock, everywhere a day
> boundary currently matters (daily/weekly limit resets, the working-day
> gate) — for every member who can clock in, individually, regardless of
> team structure — plus the required multi-member-aggregate convention this
> forces on Command Center (see that section below). Options B/C/D/E further
> down are about the separate question of a single session *spanning*
> midnight (a real night shift) — still open, not blocking Option A.
>
> **✅ Decided: sticky start-date attribution, on both sides.** A session's
> hours belong to the day it *started*, start to finish — reports change to
> match what limits already do, and crossing midnight never grants a fresh
> daily allowance. See "The agreed model" section for the worked example.
>
> **⚠️ Read "Verified edge cases, setbacks and prior art" near the end before
> implementing.** That research pass corrected two things this doc originally
> got wrong, and one of them changes the scope: **daily limits and reports
> already bucket the same session into different days** (limits = whole
> session on its start day in UTC; reports = split across the member's local
> midnights). Fixing timezones without reconciling those two would just trade
> one wrong answer for a different one. It also found that Option A's core
> helper is already written and DST-safe, that the container's timezone rules
> are frozen at image-build time (a live risk for `Africa/Cairo` specifically,
> since Egypt restored DST in 2023), and that the default work-week is
> Mon–Fri in a product whose home market runs Fri–Sat weekends.

## The problem, concretely

A member in Egypt (UTC+2/+3) starts a shift at 10pm local time. Two hours later
it's past midnight — locally still "the same work session," but every place
this codebase currently decides "what day is it" uses the **server's** wall
clock, not the member's. Depending on where the server and the member actually
are relative to each other, "today" can flip at the wrong moment, in either
direction — not only the midnight-rollover case, but generally: the server's
notion of "today" and the member's do not have to agree at all.

This was raised alongside a second, related question from earlier in this
investigation: should a session automatically stop when it crosses into a day
the project doesn't consider a working day (e.g., started Friday 10pm, and
Saturday isn't scheduled)? That feature doesn't exist at all yet (see
`INVESTIGATION-idle-time-and-tracking.md` and the conversation that produced
this doc) — but whatever "day" it would check against has the exact same
timezone problem described here, so the two issues share a root cause and a
fix should probably be designed once, for both.

## Scope: every member who can clock time, not just "teams"

Worth stating plainly so it doesn't get lost in the options below: this is
not a "team" feature or something that only matters once people are grouped
or viewed on a team dashboard. **Every member capable of starting a
timer** — solo contributor, someone with no team assigned at all, a
member on a task with no other assignees, anyone — has their own daily/
weekly hour limits and their own working-day gate evaluated individually
(`timer-limit.service.js`, `routes.js`'s working-day check), and both
already run per-member today, unconditional on any team structure existing
at all. So the base fix (Option A: compute each member's own day in their
own timezone) is required for *every* member who tracks time, full stop -
it has nothing to do with whether that member happens to be part of a team
or ever appears on someone else's dashboard.

The separate "team reporting" section further below is about something
additional: once *multiple* members' individually-correct data gets
combined into one aggregate view (a manager's dashboard, a report spanning
several people), *that* combination needs its own convention. But that's a
layer on top of the base fix, not the reason the base fix is needed - the
base fix is needed for literally anyone who can clock in, whether or not
anyone ever aggregates their data with anyone else's.

## Important existing context — read this before choosing an option

**A per-member timezone already exists, is already user-editable, and is
already unused for anything that matters here.**

- `members.timezone VARCHAR(64)` — the column has existed since
  `Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js:98`.
- It's a real, working dropdown today: `Dashboard-Web/features/profile/pages/profile-page.tsx:318-334`
  — auto-detected via the browser (`detectBrowserTimezone()`, line 150) and
  freely user-editable, saved through `identity-routes.js:353-357`
  (`PATCH` profile, validated as one of `Intl.supportedValuesOf("timeZone")`-style values).
- It's already read successfully elsewhere: `getMemberTimezones(db, memberIds)`
  (`Dashboard-Backend/src/modules/reports/member-timezones.js:10-19`) is a
  ready-made, reusable helper — batched lookup, safe `"UTC"` fallback for a
  member who never set one — used by report-building code
  (`build-time-and-activity-rows.js`) and by `sumMemberActiveIdleSeconds`'s
  SQL (`activity-events-postgres.service.js:641-648`, which already does
  `s.started_at AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC')`).

**But every place that decides "is this a new day" for anything session/timer-related ignores it completely** and uses the server's raw clock instead:

| What it decides | Where | How "today" is computed |
|---|---|---|
| Daily/weekly hour-limit reset boundary | `timer-limit.service.js:25-35` (`dayKey`, `currentDayRange`) | `new Date()` — server wall clock |
| Per-task daily cap remainder | `timer-limit.service.js:206` (`currentDayRange()` again) | same |
| One-time "is today a scheduled working day" gate at session start | `routes.js:100-102` (`todayWeekdayIndex`) | `new Date().getDay()` — server wall clock |
| A future day-boundary-stop feature (not built yet) | — | would inherit whichever of the above it's built on |

So this isn't only a midnight-rollover problem — it's that **"today" is
computed identically for every member regardless of where they are**, and it
happens to already collect the one piece of data (`members.timezone`) that
would fix it, sitting unused right next to the code that needs it.

## Two genuinely different problems worth separating

1. **Which calendar day does a given moment belong to?** — pure timezone
   correctness. Solved by consistently applying the member's own timezone
   instead of the server's.
2. **What happens when one continuous session straddles a day boundary
   (in whichever timezone is now correctly being used)?** — a policy
   decision, independent of (1). Even with perfect timezone data, a session
   that runs from 11pm to 1am still crosses a boundary; the question is
   whether that stretch gets split across two calendar days or treated as
   one unbroken block.

The user's two suggestions map onto these separately: a **timezone
dropdown** answers (1); a **"stick to the start day" switch** answers (2).
They're not alternatives to each other — they answer different questions,
and a real fix likely needs a position on both.

---

## Option A — Apply the member's existing timezone everywhere "today" is decided ✅ confirmed

Stop computing `dayKey`/`todayWeekdayIndex`/`currentDayRange` from the
server's raw clock; compute them from `member.timezone` (already fetchable
via the existing `getMemberTimezones` helper, or a single-member variant of
it) instead. No new UI, no new setting — just correct what's already broken
using data that's already collected.

**Pros**
- Smallest possible change: the data model, the UI to set it, and a reusable
  fetch helper already exist. This is a matter of *using* something, not
  building it.
- Fixes the root correctness problem for every consumer at once — daily/weekly
  limit resets, the per-task daily cap, and the working-day start gate all
  get corrected in one pass, since they all funnel through the same couple of
  day-key functions.
- No user-facing behavior change for anyone whose local day roughly matches
  server time already (i.e., no regression risk for the common case).
- A future day-boundary-stop feature (still undesigned) would automatically
  inherit correct behavior for free if built on top of this.

**Cons**
- Doesn't touch problem (2) at all — it corrects *which* calendar each
  subsystem uses without changing *how* each one treats a midnight crossing.
  Post-research (Correction 2), that means it would leave reports still
  splitting at local midnight and limits still attributing the whole session
  to its start day — the same disagreement, just now in the member's own
  timezone on both sides. If the actual complaint is about a session being
  split (or not) across a day boundary rather than which calendar is used,
  this alone doesn't address it.
- Depends on the member's `timezone` field actually being accurate. It's
  auto-detected once and freely editable, but nothing keeps it in sync if a
  member travels — a member who set it once from Cairo and is now working
  from the US for a week would get the wrong "today" until they update it
  manually.
- Every daily-bucket query (`sumDailyMemberActiveSeconds` and friends) is
  currently a plain `day = $1` match against a UTC-stored timestamp column;
  making that timezone-aware means changing those queries to bucket by a
  *converted* day, which touches SQL in a few places rather than one.

---

## Option B — A new, Tauri-app-local timezone selector

Build the dropdown the user described, inside the desktop agent itself,
separate from the Dashboard-Web profile setting.

**Pros**
- Puts the control in front of the person actually using the tracked machine,
  at the moment it matters, rather than requiring a trip to a web profile
  page they may rarely open.
- Could reasonably answer a real edge case Option A's single stored value
  can't: a person temporarily working from a different timezone than their
  profile says (e.g., traveling) without wanting to permanently change their
  profile setting.

**Cons**
- **Two sources of truth for the same concept.** The moment this exists
  alongside the profile page's dropdown, something has to decide which wins
  when they disagree — every sync call already carries no such field
  (`post_session_action` has no timezone parameter today), so this also
  isn't just a UI addition; it's a new value that has to be threaded through
  the agent, the API, and the server's day-key computation, in parallel with
  a value that already exists and already flows through the profile API.
- Most members will never touch it, and an unset/wrong local override is a
  worse failure mode than Option A's "member never updated their profile
  once" — at least the profile value is a single, visible, one-place setting
  a manager could reasonably check. A per-install, easy-to-miss agent setting
  is more likely to be silently wrong and harder for anyone but the member
  themselves to notice or audit.
- Solves the same problem as Option A (which day is "today") with meaningfully
  more surface area, for a scenario (temporary travel) that's real but
  narrower than the general case Option A already covers for free.

**Verdict if pursued**: worth doing only as a deliberate *override* of the
profile value for the rare travel case, layered on top of Option A rather
than instead of it — not as the primary fix.

---

## Option C — "Sticky day": a session stays attributed to the day it started until it ends

The user's second suggestion: once a session starts, every second of it — no
matter how far past midnight it runs — is credited to the calendar day it
started in, until the member stops (or pauses/idles-out). No mid-session
splitting.

**🔴 Partly already true — see Correction 1 below.** The daily-limit
buckets already do exactly this (attributing every delta to the session's
`started_at`). So "Option C" is less "build a new behaviour" and more
"make the behaviour that already exists deliberate, configurable, anchored
to the member's real calendar, and consistent with what reports do." The
pros/cons below still apply — they're now about whether to *keep and
formalise* this, not whether to introduce it.

**Pros**
- Directly matches how a person actually thinks about "my shift" — one
  continuous stretch of work is one thing, not two, regardless of what the
  clock did in the middle of it.
- Sidesteps the timezone-correctness question entirely for the *duration* of
  a single session — it doesn't matter whether the boundary is computed in
  server time or member time if nothing is allowed to cross it mid-session
  anyway. (It does still matter for the boundary check that decides whether
  a working day allows starting at all — see the interaction note below.)
- Naturally compatible with a future day-boundary-stop feature: "does this
  session's day allow continuing" becomes one fixed answer for the whole
  session, decided once at start, rather than a value that could flip
  mid-session.

**Cons**
- **Changes what a "day" means for every daily-bucketed number in the
  system**, not just the display clock: daily hour limits, daily task caps,
  and any future daily report would need to decide whether a sticky session
  that runs from 11pm to 3am counts entirely against *yesterday's* quota,
  entirely against *today's*, or needs its own carve-out. Today's queries
  (`sumDailyMemberActiveSeconds`, keyed by calendar day) implicitly assume
  every second of tracked time belongs to the calendar day it was actually
  worked in — sticky sessions break that assumption on purpose.
- **Unbounded worst case**: nothing in this design stops a session from being
  "stuck" on day 1 indefinitely if the member never stops it — a forgotten
  running timer over a long weekend would keep crediting entirely to the
  Friday it started, potentially blowing straight through daily/weekly caps
  that are supposed to reset each day, since this session's time never moves
  into a new bucket to be capped by a fresh day's allowance. This needs an
  explicit answer (e.g., an outer time limit after which sticky behavior
  stops applying and normal splitting resumes) or it becomes a bigger cap-
  evasion loophole than the bug it's fixing.
  Prior context: this is exactly the finding from `INVESTIGATION-idle-time-and-tracking.md`
  about crash/offline sessions running unbounded — sticky-day makes that
  existing risk worse rather than better if not paired with a hard ceiling.
- If this is meant to be optional (the user described it as "a switch"),
  someone has to decide the scope of the switch — per project, per member,
  or global — and what the default is for everyone who never touches it.

---

## What established time-tracking/payroll software actually does about this

This exact problem — a shift that crosses midnight — is old and common enough
(retail, healthcare, manufacturing, hospitality all run night shifts) that
mainstream time & attendance products have settled on named, well-understood
patterns. Worth grounding this design in them rather than inventing from
scratch.

**Three named attribution strategies**, per Personio's own support
documentation for exactly this feature ([Overview of overnight time tracking](https://support.personio.de/hc/en-us/articles/35622297233693-Overview-of-overnight-time-tracking),
[The transition to overnight time tracking](https://support.personio.de/hc/en-us/articles/35528961810717-The-transition-to-overnight-time-tracking)):

1. **Shift-start-date attribution** — every hour of an overnight shift is
   saved to the day the shift *started* (their example: a shift beginning
   4pm Thursday, ending 12:30am Friday, is entirely "a Thursday shift"). This
   is exactly Option C/D above, just under its real industry name.
2. **Clock-in-date attribution** — functionally the same idea, framed as
   "the timer keeps running past midnight, hours count toward the clock-in
   date."
3. **Split at midnight** — hours after midnight become a *new*, separate
   entry attributed to the next day.

**🔴 Superseded — see Correction 1 and Correction 2 in the research pass
below.** This section originally claimed option 3 was this codebase's
current default. That is wrong, and the truth is worse: **this system
currently does option 1 *and* option 3 simultaneously, in different
subsystems.** Daily-limit enforcement does shift-start-date attribution
(option 1, in UTC); reporting does split-at-midnight (option 3, in the
member's local timezone). Neither was deliberately chosen, and they
disagree with each other about the same session.

Naming the status quo still matters — it's just that the status quo turned
out to be "two contradictory answers" rather than one undeclared default.

### Option E — a configurable day-boundary hour, instead of (or alongside) per-session stickiness

The pattern several established products use is different from all of
Options A–D above: rather than a per-*session* sticky flag, they make the
**day boundary itself** a configurable hour, org- or shift-wide, instead of
hardcoding midnight.

- **TimePilot** calls this a ["Day Boundary"](https://www.timepilot.com/2025/07/31/accommodate-night-shifts-with-day-boundary/) —
  settable per shift, moved to whatever hour the business is confident every
  employee has finished working (e.g., 4am), so a shift from 8pm–5am simply
  never crosses the boundary at all and needs no special "sticky" handling.
- **Oracle Fusion / Cloud HCM** exposes this as ["Workday Definitions"](https://docs.oracle.com/en/cloud/saas/human-resources/25b/faitl/setup-to-handle-midnight-spanning-time-and-overtime-day-start.html) —
  a configured policy for where a workday starts and how overtime/earned-date
  rules apply across a midnight-spanning shift.
- **Odoo's** Attendance module has a company-wide setting for the hours that
  count as "night worktime" (default 10pm–6am) specifically so overnight
  attendance computes correctly without per-entry special-casing.

**Why this is worth serious consideration over Options C/D**: it sidesteps
almost every hard question those options raise. If the "day" for a project
that runs night shifts is defined as, say, 6am–6am instead of midnight–
midnight, an 8pm–5am shift is simply **entirely inside one day** — there is
no boundary-crossing event to detect, no stickiness to apply, no cap to
design for an unbounded runaway (Option C's hardest open problem), and
crash/restart is a non-issue for day-attribution purposes (addendum above)
because there's no boundary near where the crash happened in the first
place. Daily/weekly hour-limit resets, the working-day gate, and any future
day-boundary-stop feature all get simpler for free, the same way Option A's
"just use the right timezone" simplifies things for free.

**Trade-offs against Option E**:
- It's a coarser tool: it solves "our night shifts always run within
  a known window" well, but doesn't help a shift with a genuinely
  unpredictable end time that might occasionally spill past *any* fixed
  boundary hour (a very long emergency shift, say) — that residual case still
  needs either a cap or a fallback to split-at-boundary.
- It's a new, additional per-project (or per-org) setting to expose and
  explain, on top of whatever timezone fix ships (Option A) — two settings
  instead of one, though a materially simpler *pair* of settings than
  Option D's timezone-plus-cap combination.
- Doesn't obviously help the daytime-but-cross-region case (an Egypt-based
  member working US daytime hours) at all — that's purely a timezone problem
  (Option A), unrelated to where the day boundary sits.

**This isn't a replacement for Option A** — Option E answers "when does a day
start," Option A answers "in whose clock." A project running night shifts
in a single timezone might only need E; the cross-region remote-work case
from the addendum needs A regardless of what E decides.

### Daylight saving time — a real, separately-documented risk class, worth naming explicitly

Independent of which option above is chosen, DST transitions are a genuine,
recurring source of bugs in exactly this kind of duration/day-boundary code —
well-documented enough to have its own name in the payroll industry ([Kronos Timekeeper and Daylight Savings Time](https://blog.improvizations.com/bid/17662/Kronos-Timekeeper-and-Daylight-Savings-Time-Solved)),
and a live engineering topic generally ([The DST Bugs That Only Show Up at 2 A.M.](https://medium.com/@1nick1patel1/the-dst-bugs-that-only-show-up-at-2-a-m-c7154f626335)).
The concrete failure mode: "spring forward" skips a wall-clock hour (2am
jumps straight to 3am — that hour never happens), "fall back" repeats one (a
wall-clock hour occurs twice) — an overnight shift spanning either transition
can appear to be an hour short or an hour long if computed with naive
wall-clock subtraction instead of real elapsed time.

**Good news for this codebase specifically**: the actual tracked-seconds
math is already safe from this. Confirmed by reading the code directly -
`Tauri-App-Extension/src-tauri/src/agent/tracker.rs` credits elapsed time
using `std::time::Instant` (`credited_seconds`, and `last_tick_at: Instant`
throughout `TickState`) - a monotonic clock the OS guarantees never jumps
for DST, timezone changes, or even a manual system-clock edit. **The
remaining DST exposure is entirely in day-*attribution*, not duration**:
whichever code eventually decides "which calendar day does this UTC instant
fall into, in this member's timezone" must use a real timezone-database
conversion (an IANA tzdata-backed lookup, which correctly encodes every
region's DST rules and transition dates), never fixed-offset arithmetic
("add 3 hours for Cairo") - a fixed offset is wrong for at least part of the
year in almost every timezone that observes DST at all.

**No new dependency needed**: since this logic lives server-side in Node
(`Dashboard-Backend`, not the Rust agent), Node's built-in `Intl.DateTimeFormat`
with a `timeZone` option already does correct, DST-aware conversion using the
same ICU/tzdata the rest of the platform relies on - the codebase is already
trusting this exact mechanism for the *existing* `getMemberTimezones`/profile
timezone validation (`Intl.supportedValuesOf("timeZone")`). Whichever option
above is implemented just needs to route every "what day is this" conversion
through `Intl.DateTimeFormat(..., { timeZone })` (or equivalent), and never
hand-roll an offset calculation.

### Aggregate views spanning multiple members - required, additional layer on top of the base fix

Not "a team feature" - this section is specifically about the narrower case
of any view that *combines* more than one member's data into one number or
one chart, regardless of whether those members are formally grouped into a
"team" anywhere. This is required, not a deferred concern: the moment Option
A ships and each individual member's "today" is computed correctly in
*their own* timezone instead of uniformly in server time, every existing
aggregate that rolls several members' daily numbers into one view has to
decide what "today" means for the roll-up itself, or it silently becomes
wrong in a new way.

This isn't hypothetical for this codebase - there's a real, shipping feature
this hits directly: the **Command Center** dashboard
(`Dashboard-Backend/src/modules/dashboard/command-center-service.js`,
`Dashboard-Web/features/dashboard/components/command-center/`) already has
stat cards that sum numbers across multiple members - "Total Time Worked,"
"Team Utilization," and similar - built on the same daily-bucketed data this
whole plan is about correcting, and none of this is contingent on those
members being on a formally-defined "team." Once two members in different
timezones each have a *correctly* computed but *different* local "today,"
summing their numbers into one "Today" stat card without a defined
convention produces a roll-up that mixes two different real calendar days
under one label - not obviously wrong the way the current
single-server-timezone version is, but wrong in a subtler way a manager has
no reason to expect.

**Required decision, not optional polish**: adopt an explicit convention for
every multi-member aggregate, the same way [Toggl Track does it](https://hubstaff.com/blog/managing-time-zones/) -
each contributing member's data is correctly computed in their own local
day (Option A), then *converted* into one reference timezone before being
summed or compared for display purposes. The reference timezone for that
conversion needs a concrete answer for this codebase specifically:

- **The viewing manager's own timezone** (Toggl's approach) - intuitive for
  whoever's looking at the dashboard, but means the same underlying data
  renders differently depending on who's viewing it, and two managers
  comparing notes could see different day-boundaries for the same team.
- **A fixed org-level reporting timezone** (e.g., company headquarters) -
  consistent for everyone regardless of who's viewing, at the cost of not
  matching *any* individual viewer's or member's actual local day.
- **Per-project**, matching whichever timezone that project's own schedule is
  anchored to (ties back to the "schedule timezone" framing in the addendum
  above) - most consistent with how idle allowances and other settings are
  already scoped per-project in this system, but means one manager
  overseeing multiple projects in different regions sees a different
  reference day depending which project's dashboard they're on.

Whichever is chosen, it must be applied consistently everywhere multi-member
daily/weekly aggregates are computed (Command Center's stat cards, and any
future report built on the same daily-bucketed tables), not decided
per-screen as each one happens to get built.

---

## Option D — Combine A and C

Use the member's real, correct local timezone (Option A — already-collected
data, minimal new work) to decide which calendar day a session **starts**
in, and then apply sticky-day behavior (Option C) for that one session only,
capped by a maximum sticky duration (e.g., a session can stay "attributed to
its start day" for at most N hours past midnight before normal per-day
splitting kicks back in — closing Option C's unbounded-runaway problem while
still giving a real shift that runs a couple of hours past midnight the
"one continuous shift" treatment it's actually asking for).

This is not a fully-specified design — it's the shape that keeps both of the
user's ideas without inheriting either one's standalone downside.

## Which to recommend: D vs. E, now that both are on the table

Both D and E solve the night-shift-crosses-midnight problem; they trade off
differently, and the research above suggests E is the more established,
lower-risk default for the common case:

- **If a project's night shifts run within a broadly predictable window**
  (e.g., always somewhere inside 6pm–8am), **Option E is simpler, has no
  runaway-duration edge case to design for, and is the pattern established
  products actually ship** for this exact situation. It needs one new
  per-project setting (the boundary hour) instead of a session-level sticky
  flag plus a cap.
- **If shifts are unpredictable in length** (genuinely open-ended, could
  occasionally run 20+ hours), **E alone isn't enough** — a shift that
  outlasts even a generously-set boundary still crosses it, and Option D's
  per-session stickiness (with its own cap) is the more general tool.
- **They aren't mutually exclusive**: E could be the default day-boundary
  behavior for everyone, with D's per-session stickiness as a fallback only
  for the rarer case of a shift that outruns the configured boundary anyway.

Recommend deciding based on how predictable this project's actual shift
lengths are, rather than picking one in the abstract — the open questions
below apply to either choice, plus one new one specific to E.

---

## Addendum: three follow-up scenarios (remote cross-region work, a real night shift, and crash/restart)

### "I'm physically in Egypt but working a USA client's timeline" — member timezone needs to mean *schedule*, not *location*

`members.timezone` as it exists today (auto-detected from the browser, editable
in the profile page) implicitly assumes "your timezone" means "where your
computer thinks it is." That's wrong for anyone deliberately working hours
aligned to a different region than where they're sitting - exactly the
scenario described. If Option A is implemented naively (just trust the
browser-detected value), it would compute this person's "today" from Cairo
time even though their actual shift, working day schedule, and any client-
facing "is this a working day" expectation are all defined by the US
timeline they're intentionally working.

**The fix is conceptual, not structural**: treat `members.timezone` as "the
timezone this member's schedule is anchored to," not "this member's physical
location," and let people set it accordingly - a Cairo-based contractor
working US hours sets their profile to the US zone, same as they'd presumably
already want their `work_days`/working-hours settings interpreted in that
zone rather than their own local one. This needs to be communicated (label/
help text on the profile field), not re-engineered - the same single column
and dropdown already cover it once the mental model is corrected.

**Known limitation this does *not* solve**: one member working genuinely
different regional shifts across *different projects* in the same week (e.g.
mornings for a US client, evenings for a local one) can't be served by a
single member-level field - that would need a timezone *per project
membership*, not per member. Worth naming as an explicit, deliberately
out-of-scope edge case for a first version rather than something this design
silently gets wrong: if it comes up, it's a schema extension (a timezone
column on the project-membership/assignment row, falling back to the
member's own when unset), not a rethink of the approach above.

### "My shift is 8pm-5am, same timezone the whole time - what detects this, what's the manual switch?"

To be precise about the mechanism, since "manual switch" could be misread as
something done per-shift: this is not a per-instance action anyone has to
remember to flip on the night they happen to work late. It would be a
**standing, one-time policy setting** (per project, or per member - see the
existing open question on scope) - something like *"sessions that cross
midnight stay attributed to the day they started."* Once set, it applies
automatically to *every* session that happens to cross midnight for that
project/member, planned night shift or not; nothing about the shift itself
is "detected" as special, and no one has to declare per-session "this one's a
night shift." The setting decides the *rule*; the rule then applies uniformly
whenever a session happens to run past local midnight.

### "What happens on a crash, force-quit, or restart mid-shift, past midnight?" - this is the sharpest question, and it exposes an existing bug

Verified directly in the current code, independent of anything proposed
above: the working-day gate (`routes.js:471,485-496`) runs on **both**
`"start"` **and** `"resume"`, and both evaluations use nothing but
`todayWeekdayIndex()` - the server's current date, recomputed fresh every
time, with **zero memory of when the session itself actually started**. So
right now, today, with no new feature involved: a member who takes a break
before midnight and clicks "resume" after midnight, on a day that isn't in
their `work_days`/`makeup_days`, gets a 403 - blocked from continuing a shift
that started on a perfectly valid day. This is exactly the failure mode
described, and it already ships.

This generalizes directly to the sticky-day feature under discussion: **any
"which day does this session belong to" decision must be a fact stored once,
on the session's server row, at the moment the session is created - never a
value re-derived from "what is today, right now" on every subsequent
touch.** Concretely, that means a column like `attributed_local_day` (or
similar), computed once from the member's schedule timezone (see above) when
the session starts, and then treated as immutable for that session's entire
lifetime:

- **"sync"** (the periodic heartbeat, and what a reconnect-after-a-crash
  actually goes through - confirmed in `INVESTIGATION-idle-time-and-tracking.md`
  that `tick_progress`/the periodic sync never touch the working-day gate at
  all) - already effectively safe today for a pure crash-and-reconnect,
  *because* sync isn't gated. The gap is specifically the explicit
  **"resume"** action (the pause/break button), which *is* gated and
  shouldn't be, for the same session.
- **"resume"** should stop re-running the working-day check altogether for an
  *already-open* session - the gate's entire purpose is deciding whether a
  session may *start*; a session that already legitimately exists shouldn't
  need to re-earn that on every pause/break. The check belongs only on
  genuine new-session creation (`"start"`), not on continuing one that's
  already running.
- Any future sticky-day/day-boundary-stop feature must read whichever day is
  *stored on the session*, never recompute "today" for a session that's
  already in progress - otherwise a crash at 11:58pm followed by a relaunch
  at 12:05am would silently and incorrectly reset which day the whole
  session counts against, which is precisely the bug being described.

**Recommendation**: fix the `"resume"`-triggers-the-working-day-gate bug on
its own, now, regardless of what's decided about timezones or sticky-day more
broadly - it's a real, shipping bug, it's small and self-contained (stop
running that one check for `"resume"`), and it removes one whole failure mode
(pause spans midnight → blocked from resuming) before the bigger design is
even settled.

---

# Verified edge cases, setbacks and prior art — the "make it solid" pass

Everything below was checked directly against this codebase or sourced from
practitioner/vendor documentation, not assumed. Two of these **correct
earlier conclusions in this document** — those are marked 🔴.

## 🔴 Correction 1: sticky-day is ALREADY the behaviour for daily limits

Earlier this doc stated that "split at midnight" is this codebase's current
default. **That is wrong for the enforcement path.** Verified in
`Dashboard-Backend/src/lib/postgres/activity-events-postgres.service.js:592,599-613`:

```js
await recordDailyActiveSecondsDelta(prev.member_id, prev.task_id, delta, prev.started_at);
//                                                                      ^^^^^^^^^^^^^^^^
async function recordDailyActiveSecondsDelta(memberId, taskId, deltaSeconds, attributedTo) {
  const day = attributedTo ? new Date(attributedTo) : new Date();
  // ... INSERT INTO daily_member_active_seconds (member_id, day, ...) VALUES ($1, $2::date, ...)
```

There is exactly **one** write path into `daily_member_active_seconds` /
`daily_member_task_active_seconds`, and it always attributes the delta to
**the session's `started_at`**, never to "now." So every second of a session
that runs 10pm→5am already lands entirely on the day the session *started* —
which is precisely the "stick to the old day" behaviour that was being
proposed as new work. For daily-limit purposes it already exists; it's just
undocumented, unconfigurable, and anchored to the wrong calendar (below).

## 🔴 Correction 2: reports and limits already bucket the same session two different ways

This is the sharpest finding of the pass, and it's a live inconsistency, not
a future risk:

| | Day bucket for one session | Timezone used |
|---|---|---|
| **Daily limits / caps** (`activity-events-postgres.service.js:599-613`) | Entire session → its **start day** (sticky) | Postgres session timezone via `$2::date` (unpinned; effectively UTC) |
| **Reports** (`build-time-and-activity-rows.js:3-33`, `splitSessionByLocalDay`) | **Split across local midnights**, prorated by elapsed ms | The **member's own** timezone |

The same 10pm→5am shift is therefore counted as *one full day's work on
Friday* by the limit enforcer, and as *two partial days (Fri + Sat)* by any
report — in the member's local calendar, not UTC. Nobody chose this; the two
subsystems were built independently and never reconciled. **Whichever option
this plan lands on has to make these two agree**, which is arguably a bigger
correctness win than the original timezone question.

## ✅ Good news: Option A's machinery is already written and DST-safe

`Dashboard-Backend/src/modules/reports/timezone-utils.js` already provides
`localDayFor(date, timeZone)`, `localMidnightUtc(localDay, timeZone)` and
`nextLocalDay(localDay)` — implemented with `Intl.DateTimeFormat` and
`formatToParts`, i.e. real IANA/DST-correct conversion, **not** fixed-offset
arithmetic. Option A is therefore much cheaper than first estimated: it is
largely *"call the helper the reports module already uses from the
enforcement path too,"* not new date logic. Sharp edge worth knowing before
it becomes load-bearing for enforcement: `localMidnightUtc` derives the
offset from a single *guess* (midnight UTC of that day) and applies it once —
correct almost everywhere, but for zones that transition DST *at* midnight
the resulting instant can be an hour off, and on a spring-forward day a local
midnight can be a time that never exists. Fine for a report row; worth
hardening if it starts deciding people's limits.

## ⚠️ Write-time and read-time "today" are computed by two different systems, neither pinned

- **Write** side buckets by casting a JS `Date` with `$2::date` — resolved
  using the **Postgres** connection's timezone. `Dashboard-Backend/src/lib/postgres/client.js`
  sets none, so it inherits whatever the database server defaults to.
- **Read** side (`timer-limit.service.js:25-35`, `dayKey`/`currentDayRange`)
  resolves "today" from the **Node process's** clock. `Dashboard-Backend/Dockerfile`
  sets no `ENV TZ`, so Node inherits the container's system zone.

Today these are *probably* both UTC and therefore agree — **by luck, not by
design**. Changing the DB server's `timezone` setting, or adding `ENV TZ` to
the backend container, would silently make writes and reads target different
day keys. Whatever ships should pin this explicitly rather than leave two
independent, unstated assumptions that happen to match.

## ⚠️ Alpine + ICU: the timezone rules in production are frozen at image-build time

`Dashboard-Backend/Dockerfile:1` pins `node:20-alpine` **by SHA digest**.
Two compounding facts:

- Alpine ships **no `tzdata` package** by default — `/usr/share/zoneinfo`
  doesn't exist, and musl silently falls back to UTC rather than erroring
  ([Docker Alpine set timezone](https://bhived.ai/lessons/docker-alpine-set-timezone-tzdata),
  [nodejs/docker-node#626](https://github.com/nodejs/docker-node/issues/626)).
  Anything relying on system-local time gets UTC with no warning. (`Intl`
  with an explicit `timeZone` still works — it uses ICU's *own* bundled
  copy — which is why reports work today.)
- That bundled ICU copy is **frozen at whenever the pinned image was built**,
  and tzdata changes constantly — 9 releases in 2018 alone, and Node ships
  updates only every few months ([maintaining-icu](https://github.com/nodejs/node/blob/main/doc/contributing/maintaining/maintaining-icu.md),
  [nodejs/node#62323](https://github.com/nodejs/node/issues/62323) for a live
  example where stale rules produce the wrong offset).

**Why this matters *specifically* here**: this is an Egypt-facing product,
and **Egypt restored DST in 2023** after years without it
([tzdata 2023a/b/c](https://bugs.launchpad.net/ubuntu/+source/tzdata/+bug/2012599),
[Red Hat's 2023 tzdata review](https://www.redhat.com/en/blog/tzdata-review-2023)).
Lebanon in the same year moved its DST switch with ~2 days' notice, forcing
an emergency tzdata revert. A container pinned to a pre-2023 ICU would put
`Africa/Cairo` an hour off for half the year — and every day-boundary
decision built on it with it. Mitigation is cheap but must be deliberate:
refresh the pinned base image on a schedule, and/or `apk add --no-cache
tzdata` plus pointing ICU at system tz files, and treat "tzdata is current"
as an operational requirement rather than an assumption.

## ✅ Device-clock manipulation: already immune, and worth *keeping* that way

Industry research on offline time tracking flags device-clock trust as a
core vulnerability — offline punches take the device's clock, so "events can
claim to have happened last week, last month or even last year"
([TimeClock 365](https://timeclock365.com/blog/offline-mobile-time-tracking/),
[Airship on device timestamps](https://www.airship.com/blog/devices-and-timestamps-seriously-though-wtf/)).

**This system is structurally immune to that for session timing**, verified
in `Tauri-App-Extension/src-tauri/src/client/api/session.rs:30-80`: the agent
sends only `action`, `activeSeconds`, `idleSeconds`, `taskId`, `projectId`,
`stopNote` — **no timestamps at all**. `started_at`/`updated_at` are
server-generated, and durations come from the monotonic `Instant` clock
(unaffected by clock edits or DST). A member changing their PC clock cannot
move their tracked time to another day.

**This is a property to protect, not just note**: any future design that
starts trusting an agent-supplied "the day I started" value — a tempting
shortcut for sticky-day — would hand back exactly the attack surface the
architecture currently avoids. Sticky-day must be anchored to the
server-recorded `started_at`, never to a client-declared day.

## ⚠️ The work-week defaults are Western-centric, in a product built for Egypt

`routes.js:109` / `getMemberTodayWorkStatus` default `work_days` to
`[0,1,2,3,4]`, which under this code's `(getDay()+6)%7` indexing means
**Mon–Fri**. But Egypt, Iraq, Jordan and Libya run **Friday–Saturday
weekends** (i.e. working Sun–Thu), and the UAE moved from Sun–Thu to Mon–Fri
only in 2022 — these are government decisions that change
([The National](https://www.thenationalnews.com/mena/2021/12/07/when-is-the-weekend-in-the-arab-world/),
[country-by-country guide](https://www.mejunction.com/blog/a-country-by-country-guide-to-weekend-days-in-the-middle-east)).
The field is per-member configurable, so this isn't unfixable — but every
member who never edits it silently gets a Monday–Friday assumption that is
wrong for the product's home market, and the working-day gate (which can
*block clock-in entirely*) is built on it. Worth changing the default, or
forcing an explicit choice at onboarding, as part of this work.

## ⚠️ Legacy IANA aliases can silently downgrade a member to UTC

`member-timezones.js:3-8` validates against
`new Set(Intl.supportedValuesOf("timeZone"))` and **falls back to `"UTC"` on
any miss**. `supportedValuesOf` returns *canonical* zone names only, while
plenty of real clients still emit legacy aliases (`Asia/Calcutta` for
`Asia/Kolkata`, `Europe/Kiev` for `Europe/Kyiv`, `Asia/Saigon`,
`America/Buenos_Aires`). Any member whose stored value is an alias is
silently treated as UTC — with no error and no UI indication — which under
Option A would push their entire day boundary hours away from where they
actually are. Fix is small: canonicalize (e.g. via
`Intl.DateTimeFormat(undefined,{timeZone:tz}).resolvedOptions().timeZone`,
which resolves aliases) before the membership test, rather than
reject-to-UTC. Should be verified against real stored values in the database
before assuming the current data is clean.

## ⚠️ Assorted correctness traps to design against explicitly

- **Non-whole-hour offsets** are common and must never be special-cased away:
  India +5:30, Iran +3:30, Nepal +5:45, Chatham +12:45. The existing `Intl`-
  based utils handle these correctly; hand-rolled "add N hours" logic would
  not.
- **Timezone *abbreviations* are ambiguous and must never be stored** — "IST"
  alone means Indian, Irish *and* Israeli Standard Time. IANA IDs only (which
  this codebase already does correctly).
- **DST gap/overlap directly threatens Option E**: a configurable day-boundary
  hour set anywhere in the ~1–3am window may be a wall-clock time that
  *doesn't exist* on spring-forward day, or that *happens twice* on
  fall-back day. If Option E is chosen, either constrain the configurable
  hour away from that window or handle non-existent/ambiguous local times
  explicitly.
- **A member editing their timezone mid-day or mid-session** retroactively
  changes which local day past work belongs to, and can make a daily total
  jump or appear to reset. The session-level rule already established (freeze
  the attributed day at session start, never recompute) covers the in-session
  case; the same-day-but-earlier-sessions case needs a decision.
- **Storing bare `YYYY-MM-DD` without the zone it was computed in** is called
  out repeatedly in practitioner write-ups as a root cause of this whole bug
  class ([DEV: handling date and time to avoid timezone bugs](https://dev.to/kcsujeet/how-to-handle-date-and-time-correctly-to-avoid-timezone-bugs-4o03)).
  `daily_member_active_seconds.day` is exactly such a bare date — its meaning
  is only defined by whatever zone the writer used, which is currently
  implicit. If the write zone ever changes, previously-written rows become
  uninterpretable retroactively; a migration/backfill plan is needed if the
  bucketing zone changes.
- **`timestamptz` vs `timestamp` semantics differ under `AT TIME ZONE`** and
  the direction of conversion flips depending on the column type
  ([EDB](https://www.enterprisedb.com/postgres-tutorials/postgres-time-zone-explained),
  [Crunchy Data](https://www.crunchydata.com/blog/working-with-time-in-postgres)).
  Worth confirming the actual column types on `activity_sessions` before
  writing any new `AT TIME ZONE` query, since one existing query already uses
  this pattern (`activity-events-postgres.service.js:641-648`).

## Revised effort picture

The research changes the shape of the work materially:

- Option A is **cheaper** than estimated (helper already exists, DST-safe).
- But there is a **bigger, previously-unidentified problem** to fix alongside
  it: limits and reports currently disagree about what day a session's hours
  belong to (Correction 2). Fixing timezones without reconciling those two
  just makes a *consistently-wrong* system into a *differently-wrong* one.
- And there is **operational work** that isn't code: tzdata currency in the
  container, and the Mon–Fri default that's wrong for the home market.

---

# ✅ The agreed model: sticky start-date attribution, everywhere

**Decision (answers open question 12):** a session's hours belong to the
calendar day the session **started**, for its entire life, and *both*
subsystems follow that rule. Limits already do; reports change to match.

## The worked example

Task limit: **8 hours**. Shift starts **8pm on Sep 5** and runs past
midnight, ending sometime on Sep 6 (1pm in one variant, 2pm in another —
the ending time deliberately doesn't matter to the outcome):

| | Elapsed wall-clock | Active time recorded | Attributed to |
|---|---|---|---|
| Shift A: 8pm Sep 5 → 1pm Sep 6 | ~17h | ≤ 8h (task limit) | **Sep 5, all of it** |
| Shift B: 8pm Sep 5 → 2pm Sep 6 | ~18h | ≤ 8h (task limit) | **Sep 5, all of it** |

In both variants **Sep 6 shows zero hours from this shift**, and a report
for Sep 5 shows the full tracked amount. The end time changes nothing —
only the start day decides attribution.

Note the interaction that makes this coherent: the two shifts run 17–18
hours of wall-clock time but can only ever record **up to the task's 8-hour
limit** of active time, because the existing cap stops the timer once
cumulative active time reaches the allowance. Crossing midnight does **not**
hand the member a fresh 8 hours — the allowance is consumed against the
start day's bucket, which is exactly what sticky attribution is for.

## What this decision settles for free

- **Open question 2 ("if sticky-day is wanted, what's the cap?") is
  effectively answered**: the task/daily hour limit *is* the natural bound.
  A forgotten timer running for days can't quietly bank days of work,
  because the allowance caps it long before that. Sticky attribution
  therefore doesn't reintroduce the runaway risk flagged earlier in this
  doc — the cap that already exists contains it.
- **Options C/D stop being speculative** — the behaviour is already live on
  the limits side; this decision makes it deliberate and extends it to
  reports, rather than introducing anything new.
- **The crash/restart requirement is unchanged and still mandatory**: the
  attributed day must come from the server-recorded `started_at`, never
  recomputed as "today" and never taken from a client-supplied value
  (see the addendum, and the device-clock finding in the research pass).

## ✅ Working days: the gate is at *start* only — a shift may finish inside a weekend

Clarified alongside the decision above. Two separate points:

**1. The example dates were illustrative.** "Sep 5 → Sep 6" was about the
*midnight crossing*, not a claim that those particular weekdays are
workable. Which days count as working days is **already per-member
configurable** and stays that way — `time_settings.work_days` plus
`time_settings.makeup_days` (`ensure-lookup-schema.js:550,553`), so a
Fri–Sat weekend, a Sun–Thu week, or an ad-hoc makeup day are all
expressible per person. (See also the research finding that the *default*
`[0,1,2,3,4]` = Mon–Fri is wrong for this product's home market and should
change — open question 14.)

**2. The rule: a shift that legitimately started on a working day is
counted in full, even when it ends inside a non-working day.** If the last
working day before the weekend is Thursday and a shift starts Thursday
8pm, running into Friday (a weekend day for that member), those hours are
**still tracked and still counted** — the shift doesn't become invalid
because the clock rolled over into a rest day.

**The rule stated exactly: the hours are counted, and they are saved on the
last working day. The holiday/weekend day itself records nothing — zero.**

Two things make this coherent rather than a special case:

- **Sticky attribution already puts those hours on Thursday**, the working
  day the shift started. So a report never shows "hours worked on the
  weekend" — the time lands on the last working day, and the weekend/holiday
  row is **zero**, not a partial figure. Nothing is lost and nothing is
  recorded against a day the member isn't scheduled to work.
- **Therefore the working-day check is a gate on *starting* a session, not
  a condition re-evaluated while one runs.** Once a session has validly
  begun on a working day, no later moment in that session needs to re-earn
  permission.

### 🔴 This reverses the previously-proposed "stop the timer when it crosses into a non-working day" feature

Earlier in this investigation (and in `INVESTIGATION-idle-time-and-tracking.md`)
an idea was raised: auto-stop a session when it crosses midnight into a day
the schedule doesn't allow — the "started Friday 10pm, Saturday isn't
scheduled, so it stops there" scenario. **That feature is now explicitly
rejected**: it does precisely the opposite of the rule above, cutting off a
legitimate shift mid-work simply because the wall clock advanced. Nothing
should be built for it.

### 🔴 This makes the `"resume"` working-day-gate bug a blocker, not a nice-to-have

The bug found earlier (`routes.js:471,485-496` — the working-day check runs
on **both** `"start"` and `"resume"`, always against *today's* server date)
is exactly what breaks this requirement in practice today: a member who
starts Thursday 8pm, takes a break at 11:55pm and hits resume at 12:05am
Friday gets a **403 "Today is not a scheduled working day"** and cannot
continue a shift they legitimately started. Under the agreed model that is
plainly wrong. **Fixing it is now required scope** (was open question 6):
the gate must apply to `"start"` only, never to `"resume"` of an
already-open session.

## What this decision does NOT settle — still needs answers

1. **Does a *new* session later the same day get that day's fresh
   allowance?** If the Sep 5 shift ends 1pm Sep 6 and the member starts a
   brand-new session at 3pm Sep 6, that new session presumably starts a
   fresh Sep 6 allowance. Assumed yes (stickiness is per-session, not "the
   day never advances"), but should be confirmed — it's the difference
   between "one shift can't exceed 8h" and "a person can't exceed 8h per
   calendar day no matter how many shifts."
2. **Does the weekly limit follow the same rule?** A shift starting Sunday
   8pm and ending Monday 1pm would, under sticky attribution, count entirely
   toward the *previous* week if the week boundary falls between. Consistent,
   but worth stating explicitly rather than discovering later.
3. **Which timezone decides "the start day"?** Sticky attribution still
   needs a calendar to be sticky *in*. This is Option A: the member's own
   `members.timezone`, resolved once at session start. Currently the limits
   path resolves it in the Postgres session zone (effectively UTC) — so
   "8pm Sep 5 in Cairo" is currently recorded as Sep 5 only by luck of the
   offset, and would be recorded as Sep 5 *reliably* only after Option A.
4. **Historical data**: reports for past periods will change once splitting
   is removed — hours currently shown on the "next day" move back to their
   session's start day. Needs a cutover decision (recompute historical rows,
   or apply the new rule from a date forward). This is open question 13.

## Open questions to settle before anything is built

1. **Is problem (2) — sessions splitting at midnight — separately needed,
   now that Option A is confirmed?** Option A ships regardless; the open
   question is only whether a real night shift also needs B/C/D/E on top of
   it, or whether correct per-member timezones alone (Option A) already
   cover what prompted this.
2. **If sticky-day is wanted, what's the cap?** Unbounded is a real budget/
   cap-evasion risk (see Option C's cons) — needs a concrete maximum, and a
   decision on what happens to a session that hits it (forced split? forced
   stop, the same way idle-escalation stops one today?).
3. **Scope of any new switch**: global default, per-project, or per-member?
   This system already configures idle allowances per project
   (`idleTimeSeconds`) — a per-project setting would be consistent with that
   existing pattern, but "which day is today" feels more like a per-member
   (timezone-driven) fact than a per-project policy choice.
4. 🔴 **ANSWERED — do not build the day-boundary-stop feature.** It is
   rejected outright: a shift that validly started on a working day must be
   counted in full even when it runs into a weekend/holiday, so auto-stopping
   at the boundary would break the agreed model. See "Working days: the gate
   is at *start* only."
5. **Should Option B's per-install override exist at all**, or is "update
   your profile timezone when you travel" an acceptable answer for that edge
   case? Recommend deferring B entirely until Option A/D ship and someone
   actually asks for the travel case in practice.
6. ✅ **ANSWERED — required scope, not optional.** The
   `"resume"`-triggers-the-working-day-gate bug must be fixed: it currently
   blocks resuming a shift that legitimately started on a working day, the
   moment the clock crosses into a weekend/holiday — directly contradicting
   the agreed model. The gate applies to `"start"` only.
7. **Is the multi-project, multiple-regional-shifts-per-member case (addendum)
   worth solving now**, or is a single member-level schedule timezone an
   acceptable v1 scope boundary, with a per-project-membership override left
   for if/when someone actually needs it?
8. **For sticky-day specifically**: whichever day gets attributed to a
   session must be written once to that session's own server row at creation
   and never recomputed from "today" afterward (addendum) — this is a hard
   requirement, not a preference, since anything else reintroduces the exact
   crash/restart failure mode this was meant to fix.
9. **D vs. E**: how predictable are this project's/org's actual night-shift
   lengths? If there's a real, known outer bound (even a generous one, like
   "never past 10am"), Option E alone is probably sufficient and simpler. If
   shift length is genuinely open-ended, Option D's per-session cap is the
   more general answer, possibly layered on top of an E-style default
   boundary rather than replacing it.
10. **Whichever option ships, route all day-of-week/day-boundary conversion
    through real timezone-aware conversion** (`Intl.DateTimeFormat` with a
    `timeZone` option, already used elsewhere in this codebase for validating
    the timezone field itself) — never hand-rolled UTC-offset arithmetic.
    This is what keeps the fix correct across DST transitions for free,
    without needing to reason about DST as a separate case later.
11. **Required, not optional: pick the reference timezone for multi-member
    aggregates** (Command Center's stat cards and any future report built on
    the same daily-bucketed data) — viewing manager's timezone, a fixed
    org-level reporting timezone, or per-project. This has to ship as part of
    the same change that corrects individual members' day-boundaries,
    otherwise Command Center's numbers go from "wrong the same way
    for everyone" to "wrong in a way that depends on who's included,"
    which is a worse, less obvious failure mode than what exists today.

### Added by the research pass (see "Verified edge cases" above)

12. ✅ **ANSWERED — sticky start-date wins; reports adopt it.** Everything a
    session accrues belongs to the calendar day that session *started*, from
    start to end, on both the enforcement side and the reporting side.
    Limits already behave this way (Correction 1); **reports change** —
    `splitSessionByLocalDay` (`build-time-and-activity-rows.js:3-33`) stops
    splitting at local midnight and attributes each session whole to its
    start day instead. See "The agreed model" section below for the worked
    example and what it implies.
13. **Backfill/migration story** for `daily_member_active_seconds` rows
    already written under the current (implicit, effectively-UTC) bucketing,
    once the bucketing zone changes. Existing rows carry a bare `day` with no
    record of which zone produced it, so they can't be reinterpreted after
    the fact — they'd have to be recomputed from `activity_sessions`, or
    knowingly left as-is with a cutover date.
14. **Operational, not code**: who owns keeping the container's tzdata
    current (Egypt/`Africa/Cairo` DST is a live example of why), and should
    the default work-week change from the inherited Mon–Fri to this market's
    actual Sun–Thu (Fri–Sat weekend)?
15. **Data-quality check before shipping Option A**: audit real
    `members.timezone` values for legacy aliases and empty/never-set rows —
    both currently resolve silently to UTC, which under Option A becomes a
    materially wrong day boundary rather than a cosmetic report detail.

No code has been changed for this. This is planning and research only, per
request.
