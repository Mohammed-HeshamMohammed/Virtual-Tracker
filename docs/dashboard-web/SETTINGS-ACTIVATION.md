# Settings — What It Takes to Activate Each Section

Same exercise as [REPORTS-ACTIVATION.md](REPORTS-ACTIVATION.md) and [FINANCIALS-ACTIVATION.md](FINANCIALS-ACTIVATION.md), for the Settings module. Checked directly against the codebase: which settings screens actually call the backend (`apiFetch`) versus which only hold local component state that vanishes on refresh.

**Headline finding:** across the entire `Dashboard-Web/features/settings` directory, exactly **one** file calls the real API (`organization-fields-api.ts`, backing Custom Fields). Every other settings screen — Organization, Billing, Integrations, Policies, Enterprise Security, and most of Members — is local `useState` only; toggles flip visually and forms "save" into nothing. But like Financials, some of these are closer to done than others: a few already have real per-member data models sitting underneath them, created automatically for every member today, just not yet connected to these specific screens.

---

## Already live (fix the doc, not the code)

### Members → Custom Fields
**Current state:** fully wired. `organization-fields-api.ts` calls `GET/POST /api/organization-field-options`, a real, working endpoint (documented in [FEATURES.md](FEATURES.md) under Team Members & Invitations as "Custom Profile Fields").

No action needed here — flagging it because it's easy to assume everything under `features/settings` is a stub given how much of the rest is. This one isn't.

---

## Tier 1 — Real per-member data already exists, just needs the UI wired to it

### Members → Work Time Limits
**Current state:** `Dashboard-Web/features/settings/components/members/sections/work-time-limits.tsx` — every field (`activeDays`, `expectedHrs`, `weeklyLimit`, `dailyLimit`, per-member overrides) is local component state, seeded from a hardcoded `MEMBERS` mock list. "Save" doesn't call anything.

**What already exists:** two Firestore/Postgres collections that map almost field-for-field onto this screen — `time_settings` (`work_days`, `able_to_track_time`, `idle_timeout`, `keep_idle_time`, `require_approval`, `use_shifts_for_limits`) and `limits` (`weekly`, `daily`) — both defined in `Dashboard-Backend/src/modules/schema/catalog/employment/index.js:79-124`. These aren't theoretical: `member-entity-bootstrap.js:131-143` **auto-creates both for every member** the moment they're onboarded, with real default values (`able_to_track_time: true`, `idle_timeout: "5 min"`, etc.), the same way `pay_rates` is auto-created (see [FINANCIALS-ACTIVATION.md](FINANCIALS-ACTIVATION.md) Tier 1). Both are already reachable today via the generic schema CRUD: `GET/PATCH /api/time-settings/:id` and `GET/PATCH /api/limits/:id` work right now (`schema/routes.js`'s generic path parser matches any registered `entity.key` directly against `/api/<key>`).

**To activate:** replace the local `MEMBERS`-seeded state with `apiFetch` calls to `/api/time-settings` and `/api/limits`, scoped by `member_id`. No new backend route, no new table — this is almost entirely a frontend change, reusing infrastructure that's already running for every member in production today.

**Effort:** Low. The rare case where the backend is more ready than the frontend realizes.

---

### Activity & Tracking
**Current state:** `Dashboard-Web/features/settings/components/activity-tracking/activity-tracking-page.tsx` has six sections (overview, timesheets, activity, screenshots, urls, apps), all `Toggle` components on local state, no `apiFetch` anywhere in the file.

**What already exists:** the `timesheets`/`activity` sections overlap directly with `time_settings` fields already described above (`able_to_track_time`, `require_approval`, `idle_timeout`, `keep_idle_time`). The `screenshots`/`urls`/`apps` sections don't have a matching field in `time_settings` yet — those would need small additive fields on the existing collection (e.g. `screenshot_interval`, `url_tracking_enabled`, `app_monitoring_enabled`), not a new system.

**To activate:** wire the timesheets/activity sections to `time_settings` the same way as Work Time Limits above (same collection, literally reusable). For screenshots/urls/apps, add the missing fields to the existing `time_settings` schema entity (extend `employment/index.js`'s field list) and wire those toggles too — a schema *extension*, not a new table.

**Effort:** Low for half the page (reuses `time_settings` as-is); Low-Medium for the other half (small schema addition, then same wiring pattern).

---

## Tier 2 — Needs new schema, but small and self-contained (no external integration)

### Organization → Permissions
**Current state:** `Dashboard-Web/features/settings/components/organization/sections/permissions.tsx` renders its role/permission matrix from hardcoded constants (`ROLE_TYPES`, `ROLE_MATRIX`, `CUSTOM_PERMISSIONS` in `features/settings/components/shared/constants.ts`), not from the database.

**What already exists:** a real `roles` Firestore collection (`Dashboard-Backend/src/lib/firestore/collections.js:9`) that the rest of the app already reads constantly — every `role_id` → role name resolution in the codebase (`resolveMemberRoleName`, `resolveRoleNameById`, the Owner-exclusion logic reviewed in [LOGIC-REVIEW-members-org-chart.md](LOGIC-REVIEW-members-org-chart.md)) depends on it. What's missing is a **write path**: no dedicated route lets an admin edit what a role is allowed to do — no `roles` CRUD routes exist. Reading roles works everywhere; changing what a role means doesn't.

**To activate:** add CRUD routes for `roles` (could reuse the generic schema-CRUD pattern if `roles` gets registered as a schema entity, same as `pay-rates`/`time-settings` are) and a `role_permissions` shape (either fields on the role doc, or a small join table if permissions need to be granular per-resource). Then wire this screen to read/write that instead of the local constants.

**Effort:** Medium. The role *identity* system already exists and is load-bearing elsewhere; this is adding a permissions layer on top of it, which needs care not to break the existing role-name resolution that half the backend depends on.

---

### Organization → Company Information
**Current state:** `company-information.tsx` (branding, work week cycle, general org details) — local state only.

**Why this is its own tier:** there is no `organizations` table or org-level settings document anywhere in the schema — confirmed by searching the entire backend for any organization/tenant-settings collection. This app currently has no per-org settings row of any kind to extend (unlike Work Time Limits, which extends something that already exists).

**To activate:** a small new singleton-style settings document/table (company name, logo URL, work week start day, timezone default, etc.) plus a CRUD route. Genuinely new, but narrow in scope — this is not a large feature, just a from-scratch one.

**Effort:** Low-Medium. Small surface area, just zero existing foundation to build on (unlike almost everything else in Tier 1/2).

---

### Policies (Overtime, Time Off, Work Breaks, Holidays)
**Current state:** `features/settings/components/policy/*` — a genuinely large set of built screens (policy wizards, notification panels, holiday lists) all on local state, no backend calls anywhere in the directory.

**Why it's bigger than the others in this tier:** policies aren't a single settings row — they're rules (accrual schedules, who's covered, thresholds) that then need to apply to real member data elsewhere in the app (e.g., an overtime policy should presumably affect how hours are calculated/flagged in Time & Activity or Timesheets). No `overtime_policies`, `time_off_policies`, `work_break_policies`, or `holidays` schema exists at all today, and — unlike Work Time Limits or Company Info — building the schema doesn't finish the job, because the *enforcement* side (checking a member's hours against their assigned policy) doesn't exist anywhere in the tracking/timesheet code either.

**To activate:** new schema for each policy type, a policy-to-member(s) assignment model, CRUD routes, and — the part that's easy to underscope — actually wiring policy rules into the places that compute hours/overtime/time-off balances, which today have no concept of a "policy" at all.

**Effort:** Medium-High. Largest item in this tier specifically because storing the policy is the easy half; enforcing it against real tracked time is a separate, larger effort that touches other already-built features.

---

## Tier 3 — Blocked on a third-party integration, not just internal schema

### Billing (subscription plans, payment method, past invoices)
**Current state:** `features/settings/components/billing/*` (info, invoices, settings, client-invoice tabs) — local state, no backend.

**Why it's blocked:** this is billing for the SaaS subscription itself (which plan the org is on, its payment method, its own invoice history) — not to be confused with client invoicing in [Financials](FINANCIALS-ACTIVATION.md). This category of feature is normally built on a payment processor (Stripe or similar) for the actual card handling and recurring billing, which nothing in this codebase touches today. Do not build a bespoke card-storage system for this — that's a PCI-compliance liability; it needs a processor integration, not a new internal table.

**Effort:** High — a full third-party billing-processor integration project, out of proportion with everything else in this doc.

---

### Integrations (Slack, Jira, Trello, GitHub)
**Current state:** `integrations-page.tsx` and `project-management-section.tsx` — connection cards with no OAuth flow, no stored tokens, no webhook handling.

**Why it's blocked:** each of these is its own OAuth integration with its own API surface, scopes, and (for Jira/Trello/GitHub) bidirectional sync logic if the intent is two-way project/task sync, not just a connection status indicator. Nothing here is "wire up existing data" — these are four separate integration projects that happen to share one settings page.

**Effort:** High per integration; treat each as its own project rather than one "activate Integrations" task.

---

### Enterprise Security
**Current state:** `enterprise-security-page.tsx` — toggle rows (SSO, session policy, etc.) on local state.

**Why it's blocked:** this is the same root blocker already documented in [FEATURES.md](FEATURES.md)'s "What's Coming Next" — SSO / "Login with work email" is fully built as a UI pane (`login-work-email-pane.tsx`) but switched off (`WORK_EMAIL_LOGIN_ENABLED = false`) because there's no identity-provider integration wired up server-side. This settings page is the admin-facing half of the same unbuilt capability, not a separate gap.

**Effort:** Tied to the SSO/identity-provider work already flagged elsewhere — not a new blocker, the same one surfacing in a second place.

---

### Members → Payments (per-member payslip/payout settings)
**Current state:** `features/settings/components/members/sections/payments.tsx` — worth noting this one renders a component literally named `FakePayslip`, i.e. the author labeled it a mock at the time it was written. Purely decorative today.

**Why it's here and not Tier 1:** it looks adjacent to `pay_rates` (real, per [FINANCIALS-ACTIVATION.md](FINANCIALS-ACTIVATION.md) Tier 1), but the payslip/payout concept depends on the same missing `payments`/`payroll_adjustments` schema and, for actual payout, the same Wise integration blocker described there. Setting a member's *rate* is easy (Tier 1, reuse `pay_rates`); showing them a real payslip requires the payroll pipeline that doesn't exist yet.

**Effort:** Tied to the Financials Payments/Payroll Adjustments work — see that doc, not a separate blocker.

---

## Summary

| Section | Current state | Blocker | Effort |
|---|---|---|---|
| Custom Fields | ✅ Already live | — | Done (nothing to do) |
| Work Time Limits | Local state, mock members | None — reuse `time_settings` + `limits` | Low |
| Activity & Tracking | Local state | Half reuses `time_settings`; half needs small field additions | Low–Medium |
| Permissions | Hardcoded matrix | `roles` collection exists but has no write path | Medium |
| Company Information | Local state | No org-settings table exists at all (small, from scratch) | Low–Medium |
| Policies (overtime/time-off/breaks/holidays) | Local state | New schema **and** new enforcement logic elsewhere | Medium–High |
| Billing (subscription) | Local state | Needs a payment-processor integration (Stripe-class) | High |
| Integrations (Slack/Jira/Trello/GitHub) | Local state | Four separate OAuth integrations | High |
| Enterprise Security | Local state | Same SSO/identity-provider blocker as login | Tied to existing SSO gap |
| Members → Payments | Local state, literally named "Fake" | Same blocker as Financials Payments/Payroll | Tied to Financials |

**Suggested build order if this gets picked up:** Work Time Limits → Activity & Tracking (both near-free, same reused collection) → Company Information (small, unblocks Organization Settings generally) → Permissions (medium, but load-bearing for the rest of the app's role model) → Policies (biggest self-contained item) → everything in Tier 3 scoped as separate integration projects, not settings tasks.
