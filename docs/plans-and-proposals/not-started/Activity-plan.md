# ADR: Activity Sub-Tab UX & Visibility Hardening

**Status:** Proposed
**Date:** 2026-07-28
**Deciders:** Mohammed Hesham
**Scope:** `Dashboard-Web` (Screenshots / Apps / URLs sub-tabs of Activity) + `Dashboard-Backend` (activity feed scope resolution)

---

## 1. Context

Activity has three sub-tabs — **Screenshots**, **Apps**, **URLs** — sharing one route chunk (`activity-chunk.tsx`) and one toolbar shell (`ActivityShell`). Two independent problems were reported against this surface:

1. **UX bug** — switching between the three sub-tabs visibly animates the entire toolbar (fade + slide in/out), and the toolbar shows redundant page-name text ("Screenshots" / "Apps" / "URLs"). The only things that should visually change between sub-tabs are the view-mode control (Grid/List, screenshots only) and the category filter (All/Productive/Neutral/Unproductive, apps+urls only) — the rest of the toolbar (date range, search, export, refresh, My-team toggle) is shared state and shouldn't remount or animate.
2. **Access-control bug** — these three pages must respect the org hierarchy: Manager/Super Manager should see their reports plus the people above them in the chain; plain Employees should see **only their own data**; the "All org" scope toggle must be visible **only** to Super Admin / Admin / Owner.

This document covers root-cause analysis for both, the options considered, the decision, and the concrete file-level action plan.

---

## 2. Problem 1 — Toolbar animates on every sub-tab switch

### Root cause

The app's top-level page router wraps every page switch in a slide/fade transition:

- [`app/page-content.tsx:45`](Dashboard-Web/app/page-content.tsx#L45) renders `<PageTransitionShell activeItem={activeItem} transitionKey={resolvePageTransitionKey(activeItem)}>`.
- [`app/routes/page-transition-shell.tsx`](Dashboard-Web/app/routes/page-transition-shell.tsx) keys a `framer-motion` `AnimatePresence` (`mode="wait"`) on `shellKey = transitionKey ?? activeItem` (line 20, and the `motion.div key={shellKey}` at line 45). Whenever `shellKey` changes, the **entire previous subtree unmounts** (fade+slide out) and the new one mounts (fade+slide in) — this includes `ActivityShellStickyBar`, i.e. the whole toolbar.
- [`app/routes/people-member-pages.ts:20`](Dashboard-Web/app/routes/people-member-pages.ts#L20) `resolvePageTransitionKey()` already solves this exact problem for the **People** section: `people-members` / `people-members-tree` / `people-member-bans` all collapse to the same stable key `"people-member-section"`, so switching between those three doesn't remount the outer shell — a nested `AnimatePresence` inside `PeopleSectionContent` ([features/members/pages/people-section-content.tsx:96](Dashboard-Web/features/members/pages/people-section-content.tsx#L96)) handles the *inner* content transition using its own directional logic (`getPeopleMemberSubpageDirection`).
- **Activity subpages were never added to this map.** `resolvePageTransitionKey("activity-screenshots")` falls through to `return pageId`, so each of the three sub-tab ids produces a distinct `shellKey` → full outer remount every switch. This is the entire bug; it's a coverage gap, not a design flaw in the transition system.

Separately, [`features/activity/components/activity-shell.tsx:195-206`](Dashboard-Web/features/activity/components/activity-shell.tsx#L195-L206) (`ActivityShellBody`) already runs its **own** `AnimatePresence` keyed on `pageId`, scoped to just the page *content* (screenshot grid / app list / url list) — not the toolbar. This is the correct, already-working analogue of `PeopleSectionContent`'s inner transition. It does not need to change.

### Root cause, text labels

[`features/activity/components/activity-toolbar-secondary.tsx:89-93`](Dashboard-Web/features/activity/components/activity-toolbar-secondary.tsx#L89-L93) defines:

```ts
const PAGE_LABELS: Record<ActivitySubPage, string> = {
  "activity-screenshots": "Screenshots",
  "activity-apps": "Apps",
  "activity-urls": "URLs",
}
```

...and renders it at line 128-130 as a `<span>` inside the toolbar's secondary row. This is the text the user wants removed — it's a redundant page label sitting inside a toolbar that's otherwise state controls, not navigation.

### Options considered

**A. Extend `resolvePageTransitionKey` to group the three Activity sub-tabs under one stable key** (mirrors the existing People pattern exactly).

| Dimension | Assessment |
|---|---|
| Complexity | Low — ~6 line addition to an existing, proven function |
| Consistency | High — reuses the exact pattern already shipped for People |
| Blast radius | Contained to `resolvePageTransitionKey`; doesn't touch `PageTransitionShell` internals |
| Risk | Low |

**B. Remove `AnimatePresence`/`motion.div` from `PageTransitionShell` entirely for the Activity chunk (special-case bypass).**

| Dimension | Assessment |
|---|---|
| Complexity | Medium — needs a per-chunk escape hatch in a shared, generic component |
| Consistency | Low — one-off carve-out instead of reusing the established pattern |
| Blast radius | Touches a component used by every page in the app |
| Risk | Medium — could regress transition behavior for other pages sharing that component |

**C. Memoize/hoist `ActivityShellStickyBar` above `PageTransitionShell` so it never lives inside the animated subtree.**

| Dimension | Assessment |
|---|---|
| Complexity | High — toolbar reads shell/feed context that's currently provided per-chunk (`ActivityFeedProvider`, `PeopleTeamScopeProvider`); hoisting it means restructuring where those providers mount |
| Consistency | Low — introduces a second toolbar-hoisting mechanism when the People-style stable-key mechanism already exists |
| Blast radius | High |
| Risk | High |

### Decision

**Option A.** It's the smallest diff, reuses a pattern already validated in production for the structurally identical People sub-tab case, and requires no changes to shared/generic components.

`activity-tools` (the fourth id mapped to the `activity` chunk in `resolve-chunk.ts`) is **excluded** from the stable-key group: it renders a completely different page (`ActivityToolsPage`, no `ActivityShell`/toolbar at all — see `activity-chunk.tsx:46-48`), so animating the transition *into*/*out of* Tools is the correct, expected full-page transition, not a bug. Only `activity-screenshots` / `activity-apps` / `activity-urls` get grouped.

**On duplication:** `ACTIVITY_SUBPAGE_IDS`/`isActivitySubpage()` will be a near copy of the existing `PEOPLE_MEMBER_SUBPAGE_IDS`/`isPeopleMemberSubpage()` pattern in the same file. That's intentional, not an oversight — two instances of a shape don't justify a shared abstraction yet (rule of three). If a third grouped section shows up needing this same stable-key treatment, extract a shared helper then, not preemptively now.

### Consequences

- Switching Screenshots ↔ Apps ↔ URLs: toolbar (date range, search, export/refresh, My-team toggle) stays mounted and static — no fade/slide.
- Only the parts of the toolbar that are genuinely page-specific (Grid/List; All/Productive/Neutral/Unproductive) swap instantly via normal React re-render (they're driven by `pageId` inside `ActivityPageFilters`, [activity-shell.tsx:19-87](Dashboard-Web/features/activity/components/activity-shell.tsx#L19-L87) — no change needed there, this already works correctly).
- The page *content* below the toolbar keeps its existing crossfade (unchanged, and not something the user flagged as a problem).
- Navigating **into** Activity from a different section (e.g. Dashboard → Activity) still gets the normal full-page slide transition, since the shellKey changes going from e.g. `"dashboard"` to `"activity-section"`.

---

## 3. Problem 2 — Role-based visibility on Screenshots / Apps / URLs

### Current architecture

Visibility for the three feeds is enforced server-side, not client-side — the frontend cannot be trusted to gate data, only UI affordances. The chain:

`GET /api/activity/scope` and `GET /api/activity/feed` (both in [`Dashboard-Backend/src/modules/activity/routes.js`](Dashboard-Backend/src/modules/activity/routes.js)) call `resolveActivityFeedScope(db, viewerMemberId, options)` ([`Dashboard-Backend/src/modules/activity/activity-scope.js:111`](Dashboard-Backend/src/modules/activity/activity-scope.js#L111)), which calls `getVisibleMemberIds(db, viewerMemberId, roleName)` ([`Dashboard-Backend/src/modules/member-relationships/service.js:903`](Dashboard-Backend/src/modules/member-relationships/service.js#L903)) to get the member-id allowlist. That allowlist becomes `scope.targetMemberIds`, which is the *only* set of member ids the Postgres queries (`fetchPgScreenshots`, `fetchPgAppLogs`, `fetchPgUrlLogs`) are allowed to pull from — and any explicit `memberId` query param outside the allowlist gets a `403`.

`getVisibleMemberIds` branches by role:

| Role | Behavior | Source |
|---|---|---|
| `superadmin` / `owner` / `admin` | returns `null` → no filter, sees everyone | [service.js:907](Dashboard-Backend/src/modules/member-relationships/service.js#L907) |
| `manager` / `supermanager` | `getManagerPeoplePageVisibleMemberIds` = subtree they manage **+** read-only upline (ancestors) **+** org leadership | [service.js:911](Dashboard-Backend/src/modules/member-relationships/service.js#L911), [service.js:828](Dashboard-Backend/src/modules/member-relationships/service.js#L828) |
| any employee role | `getEmployeeHierarchyMemberIds` | [service.js:915](Dashboard-Backend/src/modules/member-relationships/service.js#L915) |
| `client` | client-specific visibility helper | [service.js:919](Dashboard-Backend/src/modules/member-relationships/service.js#L919) |

### Audit findings

**a) Manager/Super Manager scope — already correct, no change needed.**
`getManagerPeoplePageVisibleMemberIds` ([service.js:828-835](Dashboard-Backend/src/modules/member-relationships/service.js#L828-L835)) unions three sets: `getManagerVisibleMemberIds` (their team subtree — "people under him"), `getSubtreeUplineReadOnlyMemberIds` (their ancestors — "others above them in the hierarchy"), and `getOrgLeadershipReadOnlyMemberIds` (sibling managers + admin branches). This already matches the requirement exactly.

**b) "All org" toggle gating — already correct, no change needed.**
`canToggleMyTeam = canSeeAllMembers` in [`people-team-scope-context.tsx:66`](Dashboard-Web/features/members/context/people-team-scope-context.tsx#L66), and `canSeeAllMembers: isAdminOrOwner` in [`use-permissions.ts:58`](Dashboard-Web/features/auth/hooks/use-permissions.ts#L58), where `isAdminOrOwner = isSuperAdmin || role === "admin" || isOwner` ([use-permissions.ts:29](Dashboard-Web/features/auth/hooks/use-permissions.ts#L29)). All four `MyTeamScope*Button` components (`my-team-scope-controls.tsx`) early-return `null` when `!canToggleMyTeam`. Managers and employees never see the toggle today. This requirement is already satisfied.

**c) Employee scope — real bug, confirmed.**
`getEmployeeHierarchyMemberIds` ([service.js:881-894](Dashboard-Backend/src/modules/member-relationships/service.js#L881-L894)):

```js
export async function getEmployeeHierarchyMemberIds(db, memberId) {
  const ownerMemberId = await resolveSharedOrgOwnerMemberId(db, memberId);
  if (ownerMemberId && (await memberBelongsToOrg(db, memberId, ownerMemberId))) {
    return getOwnerOrgMemberIds(db, ownerMemberId);   // <-- entire org subtree
  }
  ...
}
```

Its own doc-comment says it plainly: *"Employee read-only tree: shared Owner root → full subtree."* `getOwnerOrgMemberIds` walks every descendant of the org owner — i.e. **every member in the company**. This function was written for the People "org tree" read-only directory view (where employees are meant to see a name/role roster of the whole company). `resolveActivityFeedScope` reuses the same generic `getVisibleMemberIds` dispatcher for Activity, so it inherits this org-wide allowlist — meaning today, any Employee-role user can pull every coworker's screenshots, app usage, and browsing history through `/api/activity/feed?memberId=<anyone>`, and the member picker ([`activity-member-select.tsx`](Dashboard-Web/features/activity/components/activity-member-select.tsx)) will happily list them all. This is the bug behind "employees can only see their data nothing else."

**d) Client role — checked, not affected.** `getVisibleMembersForClient` ([service.js:624](Dashboard-Backend/src/modules/member-relationships/service.js#L624)) scopes a client to `[self, ...membersSharingAProject]` only — never the org-wide walk `getOwnerOrgMemberIds` does. No equivalent leak on the client branch; no change needed there.

### Options considered

**A. Add an Activity-specific branch in `resolveActivityFeedScope` that hard-codes employees to `[viewerMemberId]`, bypassing `getVisibleMemberIds` for that role only.**

| Dimension | Assessment |
|---|---|
| Complexity | Low — ~4 line change, isolated to the activity module |
| Correctness | High — targets the actual privacy boundary (activity/behavioral data) without touching the (intentionally broader) org-roster visibility used elsewhere |
| Blast radius | Contained to `activity-scope.js`; zero effect on People tree, task-assignment pickers, presence, invites, `compat` routes — all of which also call the shared `getVisibleMemberIds` and rely on its current (broader) employee behavior |
| Risk | Low |

**B. Change `getEmployeeHierarchyMemberIds` itself to return self-only (or team-subtree-only) for employees.**

| Dimension | Assessment |
|---|---|
| Complexity | Low as a diff, but... |
| Correctness | Wrong scope — this function is shared by 9 call sites (`compat/routes.js` ×4, `authorization.js`, `task-assignments.js`, `bootstrap-warm-service.js`, `invite-scope.js`, `schema/visibility.js`, `member-relationships/routes.js`, `presence-events-route.js`, `team-edit-access.js`) covering task assignment, presence, invites, and the People directory — several of which plausibly *want* employees to see the org roster (e.g. picking a coworker in a task-assignment dropdown). Narrowing this globally is a much bigger, riskier behavior change than what was asked for. |
| Blast radius | Very high — every consumer of `getVisibleMemberIds` for an employee-role viewer |
| Risk | High — likely breaks unrelated features (task assignment search, org directory) that were never reported as broken |

**C. Add a `context` parameter to `getVisibleMemberIds` (e.g. `"roster"` vs `"activity"`) so callers can request the narrower scope explicitly, and route the activity module through the narrow path.**

| Dimension | Assessment |
|---|---|
| Complexity | Medium — touches the shared function's signature and every call site to make the context explicit |
| Correctness | High, and slightly more self-documenting than A long-term |
| Blast radius | Medium — 13 call sites to review, though all but one keep passing the same context |
| Risk | Medium — larger review surface for a one-page bug fix |

### Decision

**Option A.** It fixes the actual reported bug (Activity data leakage to employees) with a minimal, contained diff, and explicitly avoids touching the shared `getVisibleMemberIds`/`getEmployeeHierarchyMemberIds` used by 9+ other call sites whose current (broader, roster-style) behavior for employees was not reported as a problem and is out of scope for this change. Option C is a reasonable future refactor if more call sites need this distinction, but is unjustified ceremony for a single-module fix today.

### Consequences

- Employees calling `/api/activity/scope` or `/api/activity/feed` (any of screenshots/apps/urls) get `allowedMemberIds = [viewerMemberId]` → `canSeeAllMembers: false`, `defaultMemberId: viewerMemberId`, member picker shows only themselves.
- Attempting `?memberId=<coworkerId>` now returns `403 Not allowed to view this member's activity` (the existing `scope.forbidden` check already handles this once the allowlist is narrowed — no new check needed).
- No change to how employees see the People-directory org tree, task-assignment pickers, presence, or invites — those keep today's broader roster visibility, which was not reported as a problem.
- Manager, Admin/Owner/SuperAdmin, and Client behavior is untouched.
- **Residual exposure, not fixable by this change:** the frontend caches feed responses client-side — in-memory (`feedCache` in [`activity-api.ts:191`](Dashboard-Web/features/activity/services/activity-api.ts#L191)) and in `sessionStorage`/`localStorage` scope preferences, keyed per `viewerMemberId`. This server fix stops any *new* cross-member reads the moment it ships. It cannot retroactively purge coworker screenshots/app/URL data an employee already fetched and has sitting in their browser's memory or disk cache from before the fix — that data ages out on its own per the existing cache TTLs, same as any other already-downloaded content. Not a gap in the fix; just worth knowing it's not instant-everywhere.

---

## 4. Implementation Plan

Three files change. Order below is deliberate: the two frontend UX fixes first (independent of each other, zero risk, no backend dependency), then the backend access-control fix last (security-sensitive, isolate it as its own reviewable unit — consider landing it as a separate commit from the two UX fixes so it can be reverted independently if needed).

| # | File | Change | Risk |
|---|---|---|---|
| 1 | `Dashboard-Web/app/routes/people-member-pages.ts` | Add `ACTIVITY_SUBPAGE_IDS` + `isActivitySubpage()`, extend `resolvePageTransitionKey()` | Low |
| 2 | `Dashboard-Web/features/activity/components/activity-toolbar-secondary.tsx` | Delete `PAGE_LABELS` map + its `<span>` | Low |
| 3 | `Dashboard-Backend/src/modules/activity/activity-scope.js` | Narrow employee-role visibility to self-only | Low, but security-sensitive — review carefully |

No other files need to change. In particular, do **not** touch `use-permissions.ts`, `people-team-scope-context.tsx`, `my-team-scope-controls.tsx`, or `getManagerPeoplePageVisibleMemberIds` — all already correct per the [section 3 audit](#3-problem-2--role-based-visibility-on-screenshots--apps--urls).

---

### 4.1 `Dashboard-Web/app/routes/people-member-pages.ts`

Add a new exported id-group + guard, and extend the existing `resolvePageTransitionKey` to recognize it. `getPeopleMemberSubpageDirection` is untouched — Activity's inner content transition (`ActivityShellBody` in `activity-shell.tsx`) doesn't use directional sliding, just a plain fade (see section 2 Consequences), so no `getActivitySubpageDirection` equivalent is needed.

**Step 1 — insert a new block immediately after `isPeopleMemberSubpage`'s closing brace, before the `resolvePageTransitionKey` doc-comment.**

Find:
```ts
export function isPeopleMemberSubpage(pageId: string): pageId is PeopleMemberSubpageId {
  return (PEOPLE_MEMBER_SUBPAGE_IDS as readonly string[]).includes(pageId)
}

/** Stable shell key so Members ↔ Tree ↔ Bans animate inside PeopleSectionContent, not the whole app shell. */
export function resolvePageTransitionKey(pageId: string): string {
  if (isPeopleMemberSubpage(pageId)) return "people-member-section"
  return pageId
}
```

Replace with:
```ts
export function isPeopleMemberSubpage(pageId: string): pageId is PeopleMemberSubpageId {
  return (PEOPLE_MEMBER_SUBPAGE_IDS as readonly string[]).includes(pageId)
}

export const ACTIVITY_SUBPAGE_IDS = [
  "activity-screenshots",
  "activity-apps",
  "activity-urls",
] as const

export type ActivitySubpageId = (typeof ACTIVITY_SUBPAGE_IDS)[number]

export function isActivitySubpage(pageId: string): pageId is ActivitySubpageId {
  return (ACTIVITY_SUBPAGE_IDS as readonly string[]).includes(pageId)
}

/** Stable shell key so Members ↔ Tree ↔ Bans (and Activity's Screenshots ↔ Apps ↔ URLs) animate inside their own section content, not the whole app shell. */
export function resolvePageTransitionKey(pageId: string): string {
  if (isPeopleMemberSubpage(pageId)) return "people-member-section"
  if (isActivitySubpage(pageId)) return "activity-section"
  return pageId
}
```

Rest of the file (`PEOPLE_MEMBER_SUBPAGE_ORDER`, `getPeopleMemberSubpageDirection`) is unchanged. No other file imports anything new from here yet — this step alone is a no-op until `resolvePageTransitionKey` is actually called with an activity id, which it already is (`app/page-content.tsx:45`), so the fix takes effect immediately on save, no caller changes needed.

*(Naming note: this file is called `people-member-pages.ts` but now also owns the Activity grouping. Leaving the filename as-is — renaming it is a pure cosmetic churn across every importer for zero behavior change. Not worth it for two exports.)*

---

### 4.2 `Dashboard-Web/features/activity/components/activity-toolbar-secondary.tsx`

Delete the page-name label. Two separate edits in the same file.

**Step 1 — delete the `PAGE_LABELS` map** (currently lines 89-93, immediately before the `ActivityToolbarSecondaryRow` function declaration).

Find:
```ts
const PAGE_LABELS: Record<ActivitySubPage, string> = {
  "activity-screenshots": "Screenshots",
  "activity-apps": "Apps",
  "activity-urls": "URLs",
}

export function ActivityToolbarSecondaryRow({
```

Replace with:
```ts
export function ActivityToolbarSecondaryRow({
```

**Step 2 — delete the `<span>` that renders it** (currently inside the opening `<div className="flex min-w-0 flex-wrap items-center gap-2">` of the returned JSX, right before the date-range button group).

Find:
```tsx
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {PAGE_LABELS[pageId]}
        </span>

        <div
          className="flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-50/80 p-0.5"
          role="group"
          aria-label="Date range"
        >
```

Replace with:
```tsx
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div
          className="flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-50/80 p-0.5"
          role="group"
          aria-label="Date range"
        >
```

**Deliberately left as-is:** the `pageId` prop itself (in both `ActivityToolbarSecondaryRowProps` and the destructured function params) becomes unused *inside this component* after the above, but it's left in place — removing it would cascade into `ActivityControlBar` ([activity-control-bar.tsx:17,48,166](Dashboard-Web/features/activity/components/activity-control-bar.tsx#L17)) and its caller in `activity-shell.tsx`, purely to drop one now-dead passthrough prop. `tsconfig.json` has no `noUnusedLocals`/`noUnusedParameters` set, so this does not fail `npm run type-check`. Also leave the `ActivitySubPage` type import at the top of the file untouched — it's still used by the `pageId` field in the props interface.

---

### 4.3 `Dashboard-Backend/src/modules/activity/activity-scope.js`

**Step 0 — pre-check for a shadow.** Before editing, confirm there's no existing local `isEmployeeRole` in this file:

```bash
grep -n "isEmployeeRole" Dashboard-Backend/src/modules/activity/activity-scope.js
```

Expected: no output (file doesn't currently reference that name at all). If it *does* match something, stop and reconcile the existing usage before adding the import below — don't silently shadow it.

**Step 1 — add the import**, alongside the existing two imports at the top of the file.

Find:
```js
import { getVisibleMemberIds } from "../member-relationships/service.js";
import { pickHighestPrivilegeRoleName, resolveRoleNameById } from "../members/services/relation-sync.js";
```

Replace with:
```js
import { getVisibleMemberIds } from "../member-relationships/service.js";
import { pickHighestPrivilegeRoleName, resolveRoleNameById } from "../members/services/relation-sync.js";
import { isEmployeeRole } from "../../http/role-hierarchy.js";
```

**Step 2 — branch the allowlist for employees** inside `resolveActivityFeedScope`.

Find:
```js
  const roleName = await resolveMemberRoleName(db, viewerMemberId);
  const roleKey = normalizeRole(roleName);

  let allowedMemberIds = await getVisibleMemberIds(db, viewerMemberId, roleName);
  const canFilterByProject = PROJECT_SCOPE_ROLES.has(roleKey);
```

Replace with:
```js
  const roleName = await resolveMemberRoleName(db, viewerMemberId);
  const roleKey = normalizeRole(roleName);

  // Activity feeds (screenshots/apps/urls) are private behavioral data, not the org
  // roster — getVisibleMemberIds gives employees a full-org read for directory/People-tree
  // purposes, which is too broad here. Narrow to self only for this module.
  let allowedMemberIds = isEmployeeRole(roleName)
    ? [viewerMemberId]
    : await getVisibleMemberIds(db, viewerMemberId, roleName);
  const canFilterByProject = PROJECT_SCOPE_ROLES.has(roleKey);
```

Nothing below this point in the function needs to change — the existing dedupe-with-viewer logic (`if (allowedMemberIds !== null) { const set = new Set(allowedMemberIds); if (!set.has(viewerMemberId)) set.add(viewerMemberId); ... }`), the `memberIdFilter` forbidden-check, and the `canSeeAllMembers` computation all already work correctly against a one-element array — they were written to handle any-length allowlist, not just `null`/broad ones.

**Deliberately left as-is:** `getVisibleMemberIds` and `getEmployeeHierarchyMemberIds` in `member-relationships/service.js` are untouched (see Option B rejection in section 3) — this keeps every other consumer of employee visibility (People tree, task-assignment pickers, presence, invites, `compat` routes) exactly as it behaves today.

---

### 4.4 Rollout

1. Land 4.1 + 4.2 (Dashboard-Web only, pure UX, no access-control implications) — safe to ship independently.
2. Land 4.3 (Dashboard-Backend) separately — it's the security-relevant change; keep it isolated so it can be reverted on its own without dragging the UX fixes back out if something about the employee-narrowing needs a second look post-deploy.
3. Run through the full [Verification plan](#5-verification-plan) below against both before considering this closed.

## 5. Verification plan

- **Toolbar animation:** switch Screenshots → Apps → URLs → Screenshots repeatedly; toolbar (date range chips, search box, export/refresh icons, My-team toggle if visible) should never fade/slide/remount. Only the Grid/List control (screenshots) or category filter (apps/urls) should visually change, instantly.
- **Transition direction regression, specifically:** collapsing the three sub-ids into one `shellKey` changes what `previousPageRef`/`previousShellKeyRef` see mid-group inside `PageTransitionShell` ([page-transition-shell.tsx:21-31](Dashboard-Web/app/routes/page-transition-shell.tsx#L21-L31)) — direction is only recomputed via `getPageTransitionDirection` when `shellKey` actually changes, i.e. on the way in/out of the whole "activity-section" group, not between the three sub-tabs. Explicitly verify: Dashboard → Activity still slides in from the correct side per `NAV_PAGE_ORDER`, Activity → Reports still slides out correctly, and re-entering Activity on a *different* sub-tab than you left it on (e.g. leave on Apps, come back to Screenshots via sidebar) doesn't produce a stale/wrong direction.
- **Toolbar text:** confirm no "Screenshots"/"Apps"/"URLs" label remains anywhere in the sticky toolbar on any of the three sub-tabs.
- **RBAC — manual, one account per role:**
  - Employee: Screenshots/Apps/URLs show only their own data; member picker (if rendered) shows only self; no "All org" control visible.
  - Manager: sees their reports' data + upline/org-leadership per existing behavior (regression-check only, no code change); no "All org" control visible.
  - Admin/Owner/SuperAdmin: sees everyone; "All org" toggle visible and functional.
- **Regression check on Option A's contained blast radius:** spot-check one employee-role user in the People org tree page and a task-assignment member picker — both should be unchanged (still show full roster), confirming the activity-only narrowing didn't leak into `getVisibleMemberIds` itself.

## 6. Risks / open questions

- Should `activity-tools` also join the stable transition-group key so switching Screenshots/Apps/URLs ↔ Tools doesn't full-page-transition either? Left **out** of scope per the decision above (Tools is a structurally different page, and the user's report was specifically about the three data sub-tabs), but flagging in case the intent was broader.
- Employee-role Activity narrowing (3c) is a genuine access-control tightening, not just a UI fix — worth a quick sanity pass from whoever owns the org-hierarchy model to confirm no legitimate employee-facing feature (e.g. a "team activity" employee view) currently depends on the wider allowlist. Nothing in the current codebase suggests one exists, but flagging since this is a security-relevant change.
