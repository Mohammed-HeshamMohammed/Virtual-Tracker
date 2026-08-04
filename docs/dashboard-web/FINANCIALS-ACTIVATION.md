# Financials — What It Takes to Activate Each Section

Same exercise as [REPORTS-ACTIVATION.md](REPORTS-ACTIVATION.md), for the Financials module (Invoices, Expenses, Payments, Payroll). Per [FEATURES.md](FEATURES.md), this entire section is UI-only today — checked directly against the Postgres/Firestore schema and every component's actual state, not just what the screens look like.

**Headline finding:** unlike Reports, most of Financials is genuinely starting from zero — there's no `invoices`, `expenses`, `payments`, or `payroll_adjustments` table anywhere in the schema, and every list in these components is a hardcoded empty array (`useState<Invoice[]>([])`, not even demo data). The one bright spot is Payroll's **Members** tab, which can lean on a pay-rate data model that already exists and is already wired into the member lifecycle — everything else needs new schema before it needs new UI wiring.

---

## Tier 1 — Data already exists, this is close to a wiring job

### Payroll → Members tab
**Current state:** `Dashboard-Web/features/financials/components/payroll/index.tsx` has "Members" and "Payroll adjustments" tabs. The Members tab is meant to show each member's pay rate and what they're owed for the current period.

**What already exists:** a `pay-rates` schema entity (`Dashboard-Backend/src/modules/schema/catalog/employment/index.js:79-96`) — `member_id`, `type`, `rate`, `currency`, `pay_period`, `effective_date`, `status`. This isn't just declared and unused: it's referenced in `member-profile.service.js`, `member-list-enrichment.js`, `member-dedupe.js`, and `member-entity-bootstrap.js` — it's a real part of the member data model, created when members are bootstrapped and read when member lists are enriched. Combined with `time_entries` (already tracks `member_id`, `duration`, `billable`, `date`), "hours worked this pay period × this member's rate" is computable today with no new tables.

**To activate:** a new read-only endpoint (e.g. `GET /api/financials/payroll/members`) that joins `pay_rates` (current/effective rate per member) with a `time_entries` sum for the selected pay period, returns rate × hours as the amount due. No new schema — this is a new query over two tables that already exist and are already populated in normal use.

**Caveat:** confirm what "amount due" should mean here — gross pay before any adjustments/deductions, since the separate "Payroll adjustments" tab (see Tier 3) is where bonuses/deductions would layer on top. Don't conflate the two in one query.

**Effort:** Low-Medium. Real query work, but zero new schema, and the underlying data is already correct and populated (not stubbed).

---

## Tier 2 — Partially ready: line-item generation works, but nothing persists it

### Invoices
**Current state:** `Dashboard-Web/features/financials/components/invoices/index.tsx` initializes `const [invoices] = useState<Invoice[]>([])` — a permanently empty array, no fetch, no demo data. The list will always be blank no matter what tab (Open/Closed/Drafts/All) is selected.

**What already exists:** `generate-line-items-modal.tsx` — the "Generate line items" flow inside invoice creation — filters by date range, project, member, and to-do, exactly matching the shape of `time_entries` (`project_id`, `member_id`, `task_id`, `date`, `duration`, `billable`). The rate to bill at is also already modeled: client budgets (`clients.budget`, reviewed in [LOGIC-REVIEW-billing-budgets.md](LOGIC-REVIEW-billing-budgets.md)) already carry an hourly/fixed/retainer rate per client. So the *inputs* to "what should this invoice's line items be" all exist.

**What's missing:** everywhere an actual invoice needs to be a persisted, addressable thing — an `invoices` table with a number, status (open/closed/draft), issue date, due date, total, amount paid, and a snapshot of its line items — none of that exists. Nothing generates invoice numbers, nothing tracks status transitions, nothing links a payment back to an invoice (which is also what blocks Amounts Owed in the Reports doc — same root cause).

**To activate:**
1. New schema: `invoices` table (number, client_id, status, issue_date, due_date, total, paid_to_date, created_by, etc.) and `invoice_line_items` (invoice_id, project_id, member_id, task_id, description, quantity/hours, rate, amount) — or store line items as JSON on the invoice row if a fully relational model isn't needed yet.
2. Line-item generation itself is the *easy* part once the table exists: query `time_entries WHERE billable = true AND date BETWEEN ... AND project_id = ...`, multiply by the client's rate, insert as line items.
3. Status workflow (draft → open → closed) and payment linkage come after the schema exists, not before.

**Effort:** Medium-High. The billing-time-into-money calculation is straightforward and mostly reuses existing data; the blocker is that there's no table to write an invoice to at all yet.

---

## Tier 3 — Genuinely blocked, needs new schema and (in one case) a third-party integration

### Expenses
**Current state:** `expenses/index.tsx` — `const [expenses, setExpenses] = useState<Expense[]>([])`, no fetch anywhere. Expects `member`, `date`, `description`, `amount`, `category`, `project`, `status` (uninvoiced/invoiced/paid), `billable`, and an optional `receipt` (file).

**Why it's blocked:** there's no `expenses` table or collection anywhere in the schema — this isn't a rename or a join of existing data, it's a feature that hasn't been started at the data layer at all. The receipt upload does have a reusable pattern to follow, though: the app already does authenticated file storage for activity screenshots (GCS upload, per [the screenshot-storage decision](FEATURES.md) and `Dashboard-Backend/src/lib/gcs/upload.js`) — receipts could follow the same upload-and-authenticated-retrieval shape rather than inventing a new storage pattern.

**To activate:** new `expenses` table (member_id, project_id, date, description, amount, category, status, billable, receipt_url, created_by) plus CRUD routes, plus wiring the receipt upload through the existing GCS helper.

**Effort:** High. New table, new CRUD, new file-upload wiring — nothing to reuse except the GCS upload pattern.

---

### Payments (Create Payments & Payment Records)
**Current state:** `payment-records.tsx` — `const [records] = useComponentState([])`, hardcoded empty, no fetch. `create-payments.tsx` describes itself as "Pay hours, approved timesheets, and one-time payments," and the Financials overview page (`overview/index.tsx`) explicitly lists this section as needing "Wise & payout integrations."

**Why it's blocked:** two separate blockers, not one. First, no `payments`/`payment_runs` table exists to record that a payment happened (amount, status, paid-on date, created-by, which members/timesheets it covers) — same category of gap as Expenses. Second, and the bigger one: actually *sending* money requires integrating a real payout provider (the UI copy names Wise specifically) — that's a third-party API integration with its own auth, webhook handling for payment status, and compliance/financial-controls considerations, not something that can be "wired up" from data that already exists in this codebase. Approved-timesheet hours and pay rates (same `pay_rates`/`time_entries` data as the Payroll Members tab above) are available as *inputs* to a payment amount, but that only gets you to "how much should this payment be," not "send the money and track that it happened."

**To activate:** new `payments` schema for record-keeping (buildable independent of a payout provider — this part alone could show payment *history* once payroll adjustments/amounts are computable), plus a genuine payout-integration project (Wise or equivalent) for the "actually pay someone" half. These are two different sizes of work and could be scoped separately — recording that a payment happened doesn't require solving how the money moves.

**Effort:** High for record-keeping alone; substantially higher (separate integration project) if "Create Payments" is meant to actually move money, not just log that a payment was made elsewhere.

---

### Payroll Adjustments
**Current state:** `payroll/adjust-modal.tsx` — a fully-built form (name, member, adjustment type addition/deduction, amount, frequency: one-time / every pay period / first of month, optional end date) with no persistence — closing the modal doesn't save anything anywhere.

**Why it's blocked:** no `payroll_adjustments` (or similarly named) table exists. Unlike Expenses/Payments, this one is a small, well-scoped shape — the form itself already defines exactly what a row needs (member_id, name, type, amount, frequency, end_date, created_by) — there's just nowhere to write it.

**To activate:** a single new table matching the form's fields, a CRUD route (this could even go through the existing generic schema-driven CRUD in `schema/routes.js`, the same mechanism `pay-rates` already uses, rather than needing a bespoke route), and wiring the modal's save action to it. Reading adjustments back in also needs to feed into the Payroll Members tab's "amount due" calculation (Tier 1 above) once both exist.

**Effort:** Medium. Smallest of the Tier 3 items — one small table, and it can likely reuse the existing generic schema-CRUD pattern instead of needing bespoke routes, unlike Expenses/Payments/Invoices.

---

## Summary

| Section | Current state | Blocker | Effort to activate |
|---|---|---|---|
| Payroll — Members | Empty | None — reuse `pay_rates` + `time_entries` | Low-Medium |
| Payroll — Adjustments | Form only, doesn't save | New table (small, well-scoped) | Medium |
| Invoices | Empty list, no fetch | New `invoices`/line-items schema; line-item *generation* logic can reuse `time_entries` | Medium-High |
| Expenses | Empty list, no fetch | New `expenses` table + receipt upload wiring | High |
| Payments | Empty list, no fetch | New `payments` table **and** a real payout-provider integration (Wise) | High (record-keeping) / much higher (actual money movement) |

**Suggested build order if this gets picked up:** Payroll Adjustments → Payroll Members (both small and mutually reinforcing) → Invoices (reuses the most existing data) → Expenses → Payments (the only one blocked on an external integration, not just internal schema work).
