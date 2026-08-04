# Mobile Web View — What It Would Take

Different kind of question from the other `*-ACTIVATION.md` docs — this isn't "which stub has real data behind it," it's "how far is Dashboard-Web from being usable in a phone browser." Checked directly against the app shell, layout code, and a sample of the densest pages, not assumptions.

**One thing to rule out first:** the codebase does reference a "mobile app" in a few places (`MIGRATION_PLAN.md`, `lint-mobile-collections.mjs`, member migration code). That's a **separate, legacy native mobile app** with its own old Firestore collections — the code in question migrates *users of that old app* into this system. It has nothing to do with Dashboard-Web's responsiveness and isn't evidence of any existing mobile-web support here.

---

## Current state

Checked the app shell (`Dashboard-Web/app/dashboard-shell.tsx`, `shared/ui/layout/components/sidebar/sidebar.tsx`, `.../topbar/topbar.tsx`) and the root layout:

- **No viewport meta configuration anywhere** in `app/layout.tsx` or elsewhere — no `export const viewport` (the Next.js App Router way to set it). Without this, mobile browsers render the page at desktop width and let the user pinch-zoom, rather than laying out for the actual screen width. This alone makes everything below moot until it's fixed — a phone will show a shrunken desktop page no matter how responsive the components underneath are.
- **The navigation shell has zero responsive breakpoints.** A repo-wide check for `sm:`/`md:`/`lg:`/`xl:` Tailwind classes in the sidebar, topbar, and dashboard-shell files returned **zero matches**. The sidebar is a fixed-width, always-visible desktop nav with a collapse-to-icons toggle (`isSidebarCollapsed` state) — that's a "make more room on a wide screen" feature, not a "hide on a narrow screen" one. There's no hamburger menu, no drawer, no `isMobile`/media-query-driven layout switch anywhere in the shell or in `app/page-layout.ts`.
- **Individual feature pages are not uniformly ignoring mobile** — 110 `.tsx` files under `features/` do use responsive (`sm:`/`md:`/`lg:`) classes somewhere (e.g. `settings-all.tsx`'s card grid: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`). So content-level responsiveness exists in patches; it's the wrapper around every page that doesn't adapt.

**Net effect today:** even on a page that itself has responsive classes, a phone would still render the full fixed-width sidebar + topbar chrome around it, with no viewport scaling to make any of it legible without zooming and horizontal panning. Nothing in the app is currently usable on a phone browser as-is.

---

## Tier 0 — Do this regardless of anything else

### Set the viewport meta
Add to the root layout (Next.js App Router: export a `viewport` object from `app/layout.tsx`):
```ts
export const viewport = {
  width: "device-width",
  initialScale: 1,
}
```
**Effort:** Trivial — minutes, one file. **Impact:** without this, every other mobile fix is invisible; browsers won't respect any responsive CSS until the viewport is declared. This is the one item in this doc with no judgment call attached — it should happen regardless of how far "mobile support" is meant to go.

---

## Tier 1 — Make the shell itself responsive

### Sidebar + Topbar
**Current state:** fixed-width sidebar, always rendered, no breakpoint-driven hide/collapse; topbar has no mobile-specific layout either.

**What it needs:** below a breakpoint (e.g. `lg:` / 1024px, matching where the existing desktop collapse behavior would stop making sense), the sidebar needs to become a drawer — off-canvas by default, opened via a hamburger button in the topbar, closes on navigation or outside-tap. This is a real UI feature to build, not a CSS tweak: it needs its own open/closed state, a backdrop/overlay, focus-trapping for accessibility, and a way to reconcile with the *existing* `isSidebarCollapsed` desktop state so the two don't fight each other (e.g. collapsed-desktop and closed-mobile shouldn't be conflated into one boolean).

**Effort:** Medium. Self-contained (one component tree), but real interaction design and state work, not just adding `md:hidden` classes.

---

## Tier 2 — Audit and fix the densest pages, one at a time

Even with a working responsive shell, several pages were built with layouts that assume real desktop width and won't reflow just because their container got narrower. These need individual attention, not a blanket fix:

- **Tasks — Board view** (`features/tasks/components/board-view.tsx`) and **Timeline/Calendar view** (`tasks-timeline-calendar.tsx`) both use `overflow-x-auto` with `min-w-[...]` columns — a horizontally-scrolling kanban/calendar. This works with touch-scroll on mobile out of the box, but a multi-column board designed for a 1400px desktop screen is a poor experience at 375px wide (columns too narrow to read, constant side-scrolling). Worth a dedicated mobile layout (e.g. a single-column, status-switchable view) rather than just letting the desktop grid scroll.
- **Reports** — several report views render fixed-pixel-width inline SVG charts (e.g. `work-sessions-report.tsx`'s activity chart hardcodes `W = 560` for the SVG viewBox) and wide multi-column data tables with column-visibility pickers. Charts need to become viewBox-responsive (scale with container width, not a hardcoded pixel value) and tables need either horizontal scroll-with-sticky-first-column or a card-based mobile layout — the same problem, page after page, given how many report types share this dense-table shape (see [REPORTS-ACTIVATION.md](REPORTS-ACTIVATION.md) for the full list).
- **Settings → Permissions** (`ROLE_MATRIX`/`CUSTOM_PERMISSIONS` grid) and other settings grids are wide comparison matrices (roles × permissions) — a classic "doesn't fit on a phone no matter what" layout that typically needs a completely different mobile interaction (e.g. drill into one role at a time) rather than a responsive reflow of the same grid.
- **Financials tables** (Invoices, Expenses, Payment Records) — once those have real data (see [FINANCIALS-ACTIVATION.md](FINANCIALS-ACTIVATION.md)), they'll have the same wide-table problem as Reports.

**Effort:** Medium-High in total, but each item above is independently scoped and shippable — this doesn't need to be one big redesign project, it can be tackled page-by-page after Tier 0/1 land.

---

## A judgment call worth making explicitly before investing here

Given the Tauri desktop app already exists for the "agent"/tracking side of this product, and a real native mobile app is referenced (in migration terms) as something that existed for this product line before — it's worth deciding *up front* whether "mobile web" should mean:

**(a)** A fully responsive version of the same feature-complete dashboard, or
**(b)** A deliberately reduced mobile view — e.g. checking your own tracked time, approving a task, seeing notifications — while leaving admin-heavy screens (Reports, Settings, Financials, org-chart management) desktop-only by design, with an explicit "this view works best on desktop" message rather than a half-broken responsive attempt.

Option (b) is considerably less work (Tier 0 + Tier 1 + a handful of the highest-traffic pages, not the full Tier 2 list) and matches how a lot of admin-dense B2B tools handle mobile — worth confirming with product before treating "make everything responsive" as the default scope.

---

## Summary

| Layer | Current state | Effort |
|---|---|---|
| Viewport meta | Missing entirely | Trivial — do first, unconditionally |
| Nav shell (sidebar/topbar) | Fixed-width, no responsive behavior, no drawer | Medium |
| Dense pages (Tasks board/calendar, Reports charts/tables, Settings matrices, Financials tables) | Desktop-width assumptions baked in | Medium-High, page by page |
| Scope decision | Not yet made | Free — but should happen before Tier 2 work starts |

---

## Estimated Effort & Timeline (with AI-assisted development)

Same two-column method as the desktop-agent roadmap: **baseline** (experienced frontend dev, no AI) vs **AI-assisted** (same dev pair-programming with an AI coding assistant). Effort is in **focused developer-days**.

**The big difference from the agent estimate: this is pure frontend React/Tailwind work.** There's no native FFI, no real-hardware driver debugging, no code-signing/notarization, no store review, and no legal/DPO gate. Those were the things AI *couldn't* compress in the agent plan and that set its calendar floor. Here they're all absent — so the AI speedup lands on ~90% of the work and translates almost directly into calendar time. The only thing AI doesn't do for you is **real-device testing** (actual phones, iOS Safari's quirks), which is the one overhead line below.

The doc defines two scope options — **(a) full responsive parity** and **(b) a deliberately reduced mobile view** (high-traffic screens only, admin screens gated "best on desktop"). Estimated separately, because they're very different sizes:

| Item | Baseline (dev-days) | AI-assisted (dev-days) | Notes |
| :--- | :--- | :--- | :--- |
| **Tier 0** — viewport meta | 0.25 | 0.25 | One file; not worth compressing |
| **Tier 1** — responsive nav shell (drawer + hamburger + state reconciliation + focus-trap/a11y) | 4–7 | 2.5–4 | Real interaction + state work; AI drafts it, you tune the a11y/animation on device |
| **Tier 2 — Tasks** board + calendar mobile layout | 3–5 | 2–3 | New single-column/status-switch layout, not just letting the grid scroll |
| **Tier 2 — Reports** (build one reusable responsive-table + viewBox-chart pattern, then apply across ~8 report types) | 6–11 | 3–6 | Strong AI fit — build the pattern once, AI replicates it across the reports |
| **Tier 2 — Settings** matrices (permissions etc. → drill-in mobile interaction) | 2–4 | 1.5–3 | Needs a different interaction, not a reflow |
| **Tier 2 — Financials** tables | 2–3 | 1–2 | Same table pattern as Reports; cheap once that exists |
| **Tier 2 — general page sweep** (dashboard, org-chart, activity, profile, timesheets) | 4–7 | 2.5–4 | Many already have partial responsive classes; this fixes the broken ones |

**Totals by scope:**

| Scope | Baseline (dev-days) | AI-assisted (dev-days) | + real-device testing (~20%) |
| :--- | :--- | :--- | :--- |
| **(b) Reduced view** — Tier 0 + Tier 1 + high-traffic pages + "best on desktop" gates on admin screens | 10–16 | **6–10** | ≈ **7–12** |
| **(a) Full parity** — Tier 0 + Tier 1 + all of Tier 2 | 21–37 | **13–22** | ≈ **16–26** |

**Translating to a calendar (AI-assisted, and there are *no* external gates to wait on):**

- **Option (b), reduced view — one dev + AI:** ≈ **1.5–2.5 weeks.** This is the recommended first move: it makes the app genuinely usable on a phone for the things people actually do on a phone (check tracked time, approve a task, read notifications) without sinking weeks into making a roles×permissions matrix reflow.
- **Option (a), full parity — one dev + AI:** ≈ **3–5 weeks** (≈ a month). **With two devs + AI:** ≈ **2–3 weeks**, since Tier 2 pages are independent and parallelise cleanly once the Tier 1 shell lands.

> **Net effect:** because nothing here waits on Apple, Microsoft, a browser store, or a DPO, "code-complete" and "shipped" are essentially the same date — unlike the agent, where they're weeks apart. So the honest headline is: **reduced mobile view in ~2 weeks, full responsive parity in ~1 month solo (or ~2 weeks with a pair)**, plus a few days of real-device testing on top. Do **Tier 0 today regardless** (it's minutes and unblocks everything), make the (a)-vs-(b) scope call before starting Tier 2, and — same caveat as always — the AI speedup assumes a competent engineer reviewing the output, especially the shell's a11y/focus behaviour, which is easy to get subtly wrong.
