# Customer Accounts Tab and Multi-Tenancy Plan

## 1. Goal

Add a fourth tab to the Add Members modal — **Customer accounts** — visible only to Owners and Super Admins, gated behind an emailed 6-digit code, that onboards an external paying customer as the root of a **fully isolated tenant**.

A customer is not staff. They get their own tree, their own projects, employees, tasks, activity and reports, and can never see or be seen by the main organization or by another customer. Owners and Super Admins can view that data read-only and manage the account's commercial terms (seats, paid period, removal) — nothing else.

The tab itself is roughly two days of work. The isolation underneath it is the project. This plan is mostly about the isolation.

## 2. What exists today

These are measured facts about this repository, not assumptions. They set the scope.

### 2.1 There is no tenancy at all

```
grep -rn "organization_id\|org_id\|tenant" --include=*.js Dashboard-Backend/src
→ (no matches)
```

Every row in the system implicitly belongs to one organization. The product is single-tenant end to end.

| Surface | Size |
|---|---|
| Postgres tables (`src/lib/postgres/ensure-lookup-schema.js`) | **82** — 75 tenant-scoped, 7 global (§15.5) |
| Raw SQL statements across the backend | **~851** |
| Files importing the pg client | **93** |
| Files touching Firestore | **17**, all one collection (§15.1) |
| Backend route modules mounted in `src/app/handle-request.js` | **25** |
| Tables needing a **primary key** change, not just a column | **5** (§15.3) |
| UNIQUE constraints that break under tenancy | **5** (§15.4) |
| In-process caches leaking across tenants | **1** (§15.8) |

Retrofitting a hand-written `AND tenant_id = $n` into ~851 SQL statements is not a plan. One missed statement is a cross-customer data leak, and nothing in code review reliably catches the 850th one. **This is the single most important constraint on the design.**

### 2.2 But there is already exactly the right chokepoint

`Dashboard-Backend/src/lib/postgres/client.js` wraps every query, and it *already* publishes a per-request value onto the pooled connection before each statement, for the audit trigger:

```js
async function publishAuditActor(client, sql) {
  if (!statementMayAudit(sql)) return;
  const actor = currentAuditActor() ?? "";
  if (client[PUBLISHED_ACTOR] === actor) return;
  await client.query("SELECT set_config('app.actor_id', $1, false)", [actor]);
  client[PUBLISHED_ACTOR] = actor;
}
```

The audit trigger then reads it back with `current_setting('app.actor_id', true)`.

**The tenant is published the same way, and Postgres row-level security reads it back.** That is the whole isolation design, and it means the spec's rule *"enforced centrally … so no new endpoint can forget it"* is satisfied by the database rather than by discipline.

### 2.3 There is a single auth chokepoint

`Dashboard-Backend/src/http/auth-middleware.js` → `enforceApiAuthentication()` runs before every `/api/` route in `src/app/handle-request.js:184`. It is already the place that enforces device bans, member bans, `MUST_CHANGE_PASSWORD`, `EMAIL_NOT_VERIFIED`, privileged-role governance and `checkHierarchyAccess`. It builds the `AuthContext` that `setAuthContext()` stashes on the request:

```js
const context = { uid, memberId, roleName, roleId, hierarchyLevel, isManagement, securityStamp, email };
```

`tenantId` joins that context, and the **subscription-expiry gate joins that gate list**. The spec's *"checked in middleware on every request, not only at login"* is one new branch in a function that already does five of these.

### 2.4 Roles are a fixed ladder

`Dashboard-Backend/src/modules/members/services/relation-sync.js:90`:

```js
export const ROLE_PRIVILEGE_RANK = {
  owner: 100, superadmin: 90, admin: 80, supermanager: 70,
  manager: 60, teamlead: 50, employee: 40, intern: 30, client: 20, viewer: 10,
};
```

and `src/http/role-hierarchy.js` exports `ASSIGNABLE_ROLE_NAMES`, `canAssignRole()`, `maxAssignableRank()`. The web side mirrors this in `Dashboard-Web/features/auth/permissions/role-hierarchy.ts` (`listAssignableRoles`). Enterprise Super Manager / Enterprise Manager must be added to both **without** appearing in the ordinary Send-invites / Create-account role dropdowns.

### 2.5 The Add Members modal is already a tab container

`Dashboard-Web/features/members/components/modals/add-members/index.tsx` holds a `mode` union and builds its tab strip from an array already conditionally gated:

```tsx
const [mode, setMode] = useComponentState<"invites" | "accounts" | "migrate">("invites")
...
{ id: "invites", label: "Send invites" },
{ id: "accounts", label: "Create account" },
...(canMigrate ? [{ id: "migrate", label: "Migrate" }] : []),
```

The new tab is a fourth `mode` plus a fourth pane component beside `invite-form.tsx` / `account-form.tsx` / `migrate-form.tsx`. The container is not the hard part.

### 2.6 Firestore holds one collection, and it does not matter

17 files still touch Firestore, but **every one of them reads or writes the same collection** — `User_profiles`, always by Firebase UID, never listed or queried across users. `ENTITY_BOOTSTRAP_MANIFEST` lists ~40 collections and is a legacy inventory: projects, tasks, teams, clients, invites and employment have all moved to Postgres, and `src/modules/schema/routes.js` — despite being a generic CRUD router — imports no Firestore at all.

RLS does not protect Firestore, but there is nothing tenant-scoped there to protect. **No parallel scoping mechanism is needed.** Full evidence in §15.1; this was the largest risk in the first draft and it evaporated on inspection.

### 2.7 Things that will not be covered by RLS and need explicit work

- **Screenshot bytes** — served at `GET /api/activity/screenshot/:id` (`src/modules/activity/routes.js:1202`) and archived to GCS (`src/lib/gcs/upload.js`). The Postgres row is protected; the GCS object is protected only by the route.
- **Report exports** — `src/modules/reports/build-report-files.js` renders PDF/CSV from rows. Protected if the rows are, but scheduled reports (`report-schedule-runner.js`) run outside a request and therefore outside the request's tenant context. Solved by `withTenant()` (§15.2).
- **Background sweeps** — `abandoned-session-sweep.service.js`, `counter-reconciliation-sweep.service.js`, `integrity-sweep.service.js`, `data-retention.js` all run with no authenticated request. They must run as a privileged role that bypasses RLS *deliberately*, and must not mix tenants in their aggregates. Same `withTenant()` fix.
- **Org-wide configuration** — five config tables are physically single-row and cannot hold a second tenant's settings at all (§15.3). Two of them carry compliance meaning (retention periods, jurisdiction profile), so this is a legal question as well as a schema one.
- **The Tauri agent** — customer-tree members run the same desktop agent. `agent_devices`, `agent_link_sessions` and the whole `/api/activity/*` ingest path are tenant data.
- **Auth-Backend** — a separate service (`Auth-Backend/src/modules/auth/`) that owns sign-in. It has no Postgres tenant awareness. Expiry lockout is therefore enforced in Dashboard-Backend, not at sign-in.
- **Notify-backend / notifications** — `notifications` and `agent_notifications` are tenant data; the notify fan-out must not cross tenants.

## 3. The central decision: Postgres RLS, not application filters

**Recommendation: enable row-level security on every tenant-scoped table, with the policy reading a `app.tenant_id` GUC published by `client.js`.**

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON projects
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Why this and not a repository layer or a query builder:

| Approach | Cost | Failure mode |
|---|---|---|
| Hand-edit ~851 SQL statements | Very high, one-off | A missed statement leaks data silently, forever |
| Introduce a repository/query-builder layer | Very high, rewrites 93 files | Same — anything that drops to raw SQL escapes it |
| **RLS with a GUC** | Moderate: 83 `ALTER`s + 83 policies + one edit to `client.js` | A missed *table* fails **closed** (queries return nothing), which is loud and gets caught immediately in testing |

RLS is the only option here whose failure mode is "visibly broken" rather than "silently leaking". The existing `publishAuditActor` pattern means the plumbing cost is genuinely one function.

### 3.1 Three connection identities

RLS needs the app to connect as a role that is *not* the table owner (owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set — set it anyway, belt and braces).

| Identity | Used by | RLS |
|---|---|---|
| `vt_app` | every authenticated request | Subject to `tenant_isolation`; `app.tenant_id` set per request |
| `vt_readonly_crosstenant` | the Owner/Super Admin read-only customer view **only** | `SELECT`-only grant on business tables; policy allows any tenant; **no INSERT/UPDATE/DELETE grant at all** |
| `vt_admin` | schema bootstrap (`ensure-lookup-schema.js`), background sweeps, account-management writes | `BYPASSRLS` |

The middle role is how the spec's rule 8 is satisfied structurally: *"the read-only view uses a permission scope with no write permissions, so a future write feature cannot accidentally become available to Owners inside a customer tenant."* A Postgres role with no write grant cannot be talked into writing by a future code change. That is a much stronger guarantee than an `if (isReadOnly) throw`.

### 3.2 Publishing the tenant

`client.js`, mirroring the existing actor publication:

```js
async function publishRequestContext(client, sql) {
  await publishAuditActor(client, sql);
  const tenant = currentTenantId() ?? "";
  if (client[PUBLISHED_TENANT] === tenant) return;
  await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenant]);
  client[PUBLISHED_TENANT] = tenant;
}
```

with `currentTenantId()` living beside `currentAuditActor()` in `src/lib/postgres/audit-actor.js` (rename that file to `request-context.js`, or add a sibling). Both are set from one place: `setAuthContext()` in `src/http/auth-context.js`, which is already documented as *"The one place a request's viewer becomes known"*.

**Critical**: an empty `app.tenant_id` must mean *no rows*, never *all rows*. `current_setting('app.tenant_id', true)::uuid` on an empty string throws, which fails closed — but make it explicit rather than relying on a cast error:

```sql
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
```

`NULL = anything` is `NULL` is not-true, so a request with no tenant sees nothing. Good.

## 4. Data model

### 4.1 New tables

```sql
-- One row per customer = one tenant = one Enterprise role grant. These are
-- the same thing (see §4.3): the row IS the membership, and the paid period
-- is an attribute of the grant, not of a separate subscription object.
CREATE TABLE IF NOT EXISTS tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          VARCHAR(10)  NOT NULL DEFAULT 'customer',  -- 'main' | 'customer'
  root_user_id  UUID,                                      -- members.id of the customer root

  -- The grant itself.
  granted_role  VARCHAR(40)  NOT NULL,                     -- 'Enterprise Super Manager' | 'Enterprise Manager'
  seat_limit    INT          NOT NULL CHECK (seat_limit >= 1),
  period_start  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  period_end    TIMESTAMPTZ  NOT NULL,

  -- Lifecycle ONLY. Not "expired" - that is derived from period_end (§4.3).
  lifecycle     VARCHAR(20)  NOT NULL DEFAULT 'live'
                CHECK (lifecycle IN ('live', 'removing', 'removed')),

  created_by    UUID,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenants_lifecycle ON tenants (lifecycle, period_end);

-- The one definition of "may this tenant be used right now", so no caller
-- can invent a second one.
CREATE OR REPLACE FUNCTION tenant_is_active(t tenants) RETURNS boolean AS $$
  SELECT t.lifecycle = 'live' AND now() < t.period_end;
$$ LANGUAGE sql STABLE;

CREATE TABLE IF NOT EXISTS verification_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   UUID         NOT NULL,
  purpose     VARCHAR(40)  NOT NULL DEFAULT 'customer_accounts_tab',
  code_hash   TEXT         NOT NULL,          -- hash only, never the code
  expires_at  TIMESTAMPTZ  NOT NULL,
  attempts    INT          NOT NULL DEFAULT 0,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_codes_member
  ON verification_codes (member_id, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_account_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL,          -- deliberately NOT a FK: survives removal
  actor_id    UUID         NOT NULL,
  action      VARCHAR(40)  NOT NULL,          -- created|renewed|seats_changed|viewed|removed|unlock_requested|unlock_failed
  detail      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_audit_tenant ON customer_account_audit (tenant_id, created_at DESC);
```

Notes:
- `tenants`, `verification_codes` and `customer_account_audit` are **control-plane** tables. They are `BYPASSRLS`-managed and never carry a `tenant_id` policy themselves (the audit table's `tenant_id` is a reference, not a scope).
- `customer_account_audit` is separate from the existing `audit_logs` table (which is populated by the `fn_audit_log_trigger()` trigger and keyed `table_name`/`record_id`). The existing trigger table is row-change history; this one records *account actions including reads*, which no trigger can see. Both are kept.
- `detail` holds what was changed (old/new seats, old/new period) and, for `viewed`, which surface was opened.
- Deliberately no FK from `customer_account_audit.tenant_id` to `tenants.id`, so removal leaves the record of the action. The spec requires this.

### 4.2 Existing tables

`members` gains:

```sql
ALTER TABLE members ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE members ADD COLUMN IF NOT EXISTS parent_id UUID;
CREATE INDEX IF NOT EXISTS idx_members_tenant ON members (tenant_id);
```

`parent_id` is partly redundant with the existing `member_relationships` table and `member_tree_cache` (which already carries `ancestors`, `descendants`, `root_id`, `depth`). **Do not build a second tree.** Use `member_relationships` / `member_tree_cache` as the tree, exactly as today; `tenant_id` is the isolation boundary and is sufficient on its own. Adding `parent_id` as a denormalized convenience column is optional and should be decided when writing the seat-count query, not now.

**The full classification of all 82 tables is §15.5** — 74 scoped, 8 global, each global one with its justification. Beyond adding a column, two categories need structural change and are easy to miss:

- **Five org-singleton tables need a primary key change** (§15.3) — `currency_settings`, `capture_minimization_settings` and `activity_scoring_settings` are `CHECK (id = 1)`; `data_retention_settings` and `monitoring_capabilities` are keyed by their enum. A `tenant_id` column cannot help a table whose key forbids a second row.
- **Five UNIQUE constraints break** (§15.4) — those keyed on a human-chosen name rather than a UUID.

The main organization is a `tenants` row with `type = 'main'`, created by the bootstrap. Every existing row is backfilled to it. It has no meaningful `period_end` — give it a far-future date and let `tenant_is_active` return true for it unconditionally, rather than special-casing `type = 'main'` in the middleware.

### 4.3 The grant *is* the membership

**There is no subscription entity. The Enterprise role grant is the membership, and the paid period is an attribute of that grant** — the same way `effective_date` is an attribute of a `pay_rates` row and `start_date`/`end_date` are attributes of an `employment` row. The Add Members form already says so: Email, Paid period, Seats, Role are four fields describing *one thing*, and the spec notes the period "replaces Pay Rate/Month until billing exists" — it sits exactly where a pay rate sits.

This is not a new pattern here. `privileged-role-governance.js` already implements a role grant that is **re-validated on every request**: `enforcePrivilegedRoleGovernanceForMember` is called from `auth-middleware.js:118`, and an Admin or Super Admin whose `privileged_role_owner_granted` flag is absent is not honored. The Enterprise grant is the same shape with a timestamp instead of a boolean.

Five consequences, all simplifications:

**1. `status` is derived, never stored.** The spec defines *"Active means `status = active` and `now < period_end`"* — but storing both a status flag *and* the dates creates two sources of truth that can disagree, and the bug that follows ("the sweep hasn't run yet, so an expired account still says active") is unfixable without reconciling them. So `lifecycle` stores only what genuinely is a state — `live` / `removing` / `removed` — and *expired* is computed from `period_end`. `tenant_is_active()` is the single definition.

**2. There is no expiry scheduler.** Nothing flips at midnight. No cron job, no missed-run risk, no window where a lapsed tenant is still being honored because a sweep is behind. The grant simply stops being valid at a timestamp, and the next request notices. This removes a whole background service the earlier draft implied.

**3. Expiry must NOT touch `members.role_id`** — and here the Enterprise grant deliberately diverges from its precedent. `enforceUnauthorizedPrivilegedRole` *downgrades the member to Viewer and bans them* when the grant is missing. Doing that on expiry would be wrong: the spec requires *"renewal restores access immediately and the data is exactly as it was"*, and a downgrade-then-restore cycle means mutating `members.role_id` twice per billing period, with audit-trigger noise, role-cache invalidation, and a restore path that can fail halfway. **Honor-or-refuse at read time; never mutate the stored role.** The role stays exactly as granted; what changes is whether it is honored.

**4. Sub-members hold no grant of their own.** A customer's employees have ordinary roles (Manager, Employee, Team Lead) with no period attached. Their access derives entirely from the root's grant, resolved per request as `member → tenant_id → tenant_is_active()`. That is why expiry locks *"everyone under them"* without touching a single one of their records — there is nothing to lock, because there was never anything to unlock.

**5. Renewal is an `UPDATE` of one column.** `period_end`, plus a cache bust. Not a reactivation flow, not a state machine transition, not a re-grant. This is also why "all data is kept, nothing is deleted" is free rather than a feature: expiry never wrote anything, so there is nothing to undo.

The one thing that must NOT be derived is removal. `removing` / `removed` are real states with real side effects (§14.1), and they are what `lifecycle` exists to hold.

## 5. Phases

Ordered so that each phase is independently shippable and leaves the product working. **No customer can be created until Phase 4**, which means Phases 0–3 carry no isolation risk to real money.

### Phase 0 — Inventory and decisions — **done, see §15**

The artifact this phase existed to produce is now §15. What it found:

| Question | Answer |
|---|---|
| Classify all 82 tables | §15.5 — 74 scoped, 8 global with justifications |
| Is tenant-scoped data still in Firestore? | **No.** One collection, `User_profiles`, by UID only (§15.1) |
| Do background sweeps mix tenants? | Yes, and `withTenant()` per iteration fixes all five uniformly (§15.2) |
| `parent_id` on `members`? | **Skip it.** `member_relationships` + `member_tree_cache` already are the tree; `tenant_id` is the isolation boundary and is sufficient alone. Adding a second tree is how the two drift |

Two things it found that the first draft had missed entirely, both of which move into Phase 2: **five org-singleton tables need a primary key change** (§15.3) and **four UNIQUE constraints break** (§15.4).

**Phase 0 is fully closed.** The last open item — whether `lookup_tables` is platform-seeded or customer-editable — is answered by `lookup-postgres.service.js`, which exposes full INSERT/UPDATE/DELETE: it is customer-editable, therefore scoped, and its UNIQUE constraint is the fifth break (§15.4). The sweep also turned up §15.8, an in-process cache that leaks across tenants and that RLS cannot cover.

### Phase 1 — Control plane, no isolation yet

- `tenants`, `verification_codes`, `customer_account_audit` in `ensure-lookup-schema.js`.
- Bootstrap creates the `type = 'main'` tenant if absent, with a fixed, well-known id stored in `system_meta`.
- Verification-code service: generate (crypto-random 6 digits), hash (`scrypt` or `bcrypt` — reuse whatever `Auth-Backend` already uses for password hashing), send by email via the existing mailer used by `src/modules/auth/verification-email.js`, verify with the 10-minute / single-use / 5-attempt rules.
- Rate limit the request endpoint at 3 per 15 minutes per member via `src/http/rate-limit.js`.
- New route module `src/modules/customer-accounts/routes.js`, mounted in `handle-request.js`, guarded by `isOwnerOrSuperAdminRole(context.roleName)` from `src/http/role-hierarchy.js`.

Endpoints in this phase: `POST /api/customer-accounts/unlock/request`, `POST /api/customer-accounts/unlock/verify`. Nothing else yet.

**Ship-able**: yes, inert. No UI.

### Phase 2 — `tenant_id` columns, key changes and backfill

Four distinct kinds of change, in this order:

1. **Columns** — add `tenant_id UUID` (nullable at first) to the 74 scoped tables in §15.5, backfill every row to the main tenant, add indexes, then `SET NOT NULL`.
2. **Five primary key changes** (§15.3) — drop the `CHECK (id = 1)` singleton on `currency_settings`, `capture_minimization_settings`, `activity_scoring_settings`; re-key `data_retention_settings` to `(tenant_id, data_type)` and `monitoring_capabilities` to `(tenant_id, capability)`. Backfill the existing row(s) to the main tenant. These are the ones that will be forgotten, because they look like ordinary config tables until the second tenant tries to save a setting.
3. **Five UNIQUE constraint changes** (§15.4) — `lookup_tables`, `org_field_options`, `invoices.number`, `time_off_policies.name` all become `(tenant_id, …)`.
4. **Default-seeding for new tenants** — a fresh customer needs a row in each of the five config tables, or their settings read as absent rather than defaulted. This belongs in the Phase 4 create transaction; write the seeding helper here, next to the migration that made it necessary.

**Large-table caution.** `activity_screenshots`, `activity_app_logs`, `activity_url_logs`, `activity_sessions`, `activity_session_events`, `time_entries`, `daily_member_active_seconds` are the high-volume tables. On Postgres 11+ `ADD COLUMN ... NULL` is instant, but the `UPDATE` backfill and the `SET NOT NULL` validation scan are not. Backfill in batches; create indexes `CONCURRENTLY`; add the constraint as `NOT VALID` then `VALIDATE CONSTRAINT` rather than `SET NOT NULL` if the tables are large enough to matter in production. Note that `ensure-lookup-schema.js` runs on **every boot** (per the standing memory), so all of this has to be idempotent and fast on the second run — guard the backfill with a `system_meta` marker.

**Ship-able**: yes. Columns exist, every row says "main", nothing behaves differently.

### Phase 3 — RLS

- Create the three DB roles (§3.1). This is a deployment/Coolify change as well as a code change: `POSTGRES_URL` for the app switches to `vt_app`, and two new connection strings appear.
- `ENABLE`/`FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy on every scoped table.
- `client.js` publishes `app.tenant_id`; `auth-context.js` sets it; `auth-middleware.js` resolves it from `members.tenant_id`.
- Background sweeps and `ensure-lookup-schema.js` move to the `vt_admin` pool.

At this point the system is still single-tenant in behaviour — every member is in the main tenant, so every policy passes — but the **enforcement is live**, which means Phase 3's test suite exercises the real mechanism against real traffic before a single customer exists. That is the whole point of sequencing it here.

**Ship-able**: yes, and this is the riskiest deploy in the plan. A table whose policy is wrong returns zero rows and a feature visibly breaks. Budget a staging soak.

### Phase 4 — Creating customers

- `POST /api/customer-accounts` — validates email is new **system-wide** (across `members.work_email`, `members.personal_email`, `invites.email`, `pending_auth_members.email`, and Firebase Auth via `getAuthAdmin().getUserByEmail`), period ends in the future, seats ≥ 1, role is one of the two Enterprise roles.
- In one transaction: insert `tenants`, insert the `invites` row with the new `tenant_id`, write `customer_account_audit`.
- Send the invite through the existing invite mail path (`src/modules/members/services/invite-lifecycle.js` / `invite-email.js`).
- Invite acceptance (`POST /api/public/invites/:token/register`) must carry the invite's `tenant_id` onto the new `members` row and set `tenants.root_user_id`. This is a **public** route, so it runs before `app.tenant_id` is set — it must run on the `vt_admin` pool with an explicit `tenant_id` in the insert, and it is therefore one of the few places that needs careful manual review.
- Enterprise roles added to `ROLE_PRIVILEGE_RANK` and to `role-hierarchy.js`, excluded from `ASSIGNABLE_ROLE_NAMES` / `listAssignableRoles`.

### Phase 5 — Seats

- Seat count = active members + pending invites in the tenant, including the root.
- Enforced inside the insert transaction. **Counting rows does not block a concurrent insert**, so the transaction must first take a lock on the tenant row:

```sql
BEGIN;
SELECT seat_limit FROM tenants WHERE id = $1 FOR UPDATE;   -- serializes concurrent invites
SELECT (SELECT count(*) FROM members WHERE tenant_id = $1 AND status = 'active')
     + (SELECT count(*) FROM invites WHERE tenant_id = $1 AND status = 'pending') AS used;
-- if used >= seat_limit → ROLLBACK, 409 SEAT_LIMIT_REACHED
INSERT INTO invites (...) VALUES (...);
COMMIT;
```

`FOR UPDATE` on the tenant row is what makes the spec's *"simultaneous invites cannot exceed the limit"* actually true. Without it the check is a race, and the concurrency test in §11 will catch that.

- Every add/invite path inside a customer tree routes through this: `member-invites.routes.js`, `member-onboarding`, the share-link invite, and preprovision.
- `PATCH /api/customer-accounts/:id/seats` — Owner/Super Admin only, rejects a new limit below current usage.

### Phase 6 — Expiry, read-only view, removal

**Expiry** — one branch in `enforceApiAuthentication`, sitting directly beside the grant check it mirrors (`enforcePrivilegedRoleGovernanceForMember`, `auth-middleware.js:118`):

```js
// The Enterprise role grant, re-validated per request - same shape as the
// privileged-role grant above, with a timestamp instead of a boolean.
// Never mutates the member's role: see §4.3.
const grant = await resolveTenantGrant(result.context.tenantId);
if (!grant.active) {
  return { allowed: false, status: 403, error: grant.lifecycle === "live"
    ? "Your subscription has expired. Please contact your provider."
    : "This account has been removed.",
    code: grant.lifecycle === "live" ? "SUBSCRIPTION_EXPIRED" : "TENANT_REMOVED" };
}
```

Cache the tenant row for a few seconds (`src/http/role-cache.js` is the precedent) so this doesn't add a query to every request. **Cache the row, not the verdict** — `tenant_is_active` depends on `now()`, so caching the boolean would keep honoring a grant past its own expiry for the length of the TTL. Recomputing from a cached `period_end` costs nothing and is exact. Renewal busts the entry so access returns immediately rather than after the TTL.

**Use 403, not 402** — see §14.5. The status code is load-bearing for already-installed agents. Also gate `handleSessionBootstrap` (§14.4) so the login path reports expiry as the response to the first call after sign-in.

**Read-only view** — `GET /api/customer-accounts`, `GET /api/customer-accounts/:id`, and a read-only proxy for that tenant's projects/employees/activity. Runs on `vt_readonly_crosstenant` with `app.tenant_id` set to the target tenant. Writes are impossible at the grant level. Every such request writes a `viewed` row to `customer_account_audit` before returning.

**Removal** — `DELETE /api/customer-accounts/:id`. Four ordered steps, detailed in §14.1:
- Confirmation payload must include the customer's exact email, and the response to the preflight (`GET .../:id/removal-preview`) returns the counts to display.
- `lifecycle = 'removing'` first, then revoke sessions — access ends before anything is destroyed.
- GCS objects next, then one atomic DB transaction across the scoped tables on `vt_admin`.
- Session revocation is `getAuthAdmin().revokeRefreshTokens(uid)` for every uid in the tree. `authenticateRequest` already checks `userRecord.tokensValidAfterTime` against the token's `iat`, so it takes effect on the very next request. Note that Auth-Backend currently never calls `revokeRefreshTokens` anywhere — this is new usage, not an existing helper.

### Phase 7 — The tab

`Dashboard-Web/features/members/components/modals/add-members/customer-form.tsx`, plus:

- Fourth entry in the tab array in `index.tsx`, gated on `isOwnerOrSuperAdmin(memberRole)`.
- Selecting the tab immediately `POST`s `unlock/request` and renders a 6-digit code entry pane. The form fields do not render until `unlock/verify` returns an unlock token.
- The unlock token is held in **component state only** — never `localStorage`, never a cookie. Closing the modal drops it, which is exactly the spec's *"closing the tab locks it again"*, achieved by doing nothing rather than by adding a lock mechanism.
- Fields: email, paid period (a date range or an end date), seats (number, min 1), role (the two Enterprise roles only).
- The management list (US-5) is a separate surface, not part of this modal — it belongs on the members page as its own section or route, since the modal is a create flow. Recommend `Dashboard-Web/features/members/` with a `customer-accounts` sub-feature.

## 6. API surface

| Method | Path | Who | Notes |
|---|---|---|---|
| `POST` | `/api/customer-accounts/unlock/request` | Owner, Super Admin | Rate limited 3/15min; emails a code to the caller's own address |
| `POST` | `/api/customer-accounts/unlock/verify` | Owner, Super Admin | 10 min, single use, locks after 5 attempts |
| `POST` | `/api/customer-accounts` | Owner, Super Admin + unlock | Create tenant + invite |
| `GET` | `/api/customer-accounts` | Owner, Super Admin | List: email, role, seats used/limit, period end, status |
| `GET` | `/api/customer-accounts/:id` | Owner, Super Admin | Read-only detail; writes an audit row |
| `PATCH` | `/api/customer-accounts/:id/period` | Owner, Super Admin + unlock | Renew / change period — one `UPDATE` of `period_end` + cache bust (§4.3) |
| `PATCH` | `/api/customer-accounts/:id/seats` | Owner, Super Admin + unlock | Cannot go below used |
| `GET` | `/api/customer-accounts/:id/removal-preview` | Owner, Super Admin | Counts for the confirmation dialog |
| `DELETE` | `/api/customer-accounts/:id` | Owner, Super Admin + unlock | Requires typed email; one transaction; revokes sessions |

**Settled (§16.3): the unlock token is required on every mutating endpoint**, verified server-side. This is a system-level gate, not a UI affordance — an Owner with a valid session but no unlock token can do nothing here, including by curl.

Cross-tenant reads of the customer's *business* data (their projects, their activity) should be a distinct path — `GET /api/customer-accounts/:id/projects` etc. — and not a `?tenantId=` parameter bolted onto the ordinary endpoints. Rule 1 of the spec is that tenant comes from the session, never from a request parameter; the one place that must be violated is the deliberate cross-tenant read path, so it should be a visibly separate set of routes that is easy to audit.

## 7. Roles

Add to `ROLE_PRIVILEGE_RANK` in `relation-sync.js` — the ranks must sit inside the existing ladder so `canAssignRole` / `maxAssignableRank` keep working within a customer tree:

```js
enterprisesupermanager: 70,   // same tier as supermanager, different tenant type
enterprisemanager: 60,        // same tier as manager
```

Then in `src/http/role-hierarchy.js`:
- Keep them out of `ASSIGNABLE_ROLE_NAMES` (that array feeds the ordinary role dropdowns).
- Add `isEnterpriseRole(roleName)` and have `canAssignRole` **refuse both Enterprise roles as a target, unconditionally, from every actor.** Per §16.1 they exist only at the tenant root and are reachable only through the Phase 4 create path — never by assignment.
- A customer root's ceiling then falls out of the existing `maxAssignableRank` (`actorRank - 10`) with no special case: Enterprise Super Manager (70) assigns **Manager and below**, Enterprise Manager (60) assigns Team Lead and below. All ordinary roles. The admin tier is four ranks above the highest reachable role, so it is unreachable by arithmetic rather than by a guard.

Mirror in `Dashboard-Web/features/auth/permissions/role-hierarchy.ts` so `listAssignableRoles(memberRole)` returns the right set for a customer root, and never returns Enterprise roles for main-org staff.

**These two are grant types, not labels** (§4.3). An Enterprise role is only meaningful while its grant is live, which is why the role name alone must never be sufficient to authorize anything — every check goes through `tenant_is_active()`. Concretely: `isEnterpriseRole(roleName)` answers "which ladder is this on", never "may this member act". Anywhere those two get conflated is a member who keeps working past their paid period.

Because exactly one member per tenant holds an Enterprise role (§16.1), `tenants.root_user_id` and "who holds the grant" are the same fact. Assert that invariant in Phase 4: a tenant with two Enterprise-role members is a bug, and a cheap `CHECK`-style test will catch it before it becomes a permissions puzzle.

## 8. What Owners explicitly cannot do

The spec's hard "Never" column is enforced in three independent layers, and it should be all three, because each catches a different mistake:

1. **Grant level** — `vt_readonly_crosstenant` has no `INSERT`/`UPDATE`/`DELETE`. A future endpoint written without thinking still cannot write.
2. **RLS level** — `vt_app`, which *does* have write grants, has `app.tenant_id` set to the actor's own tenant. An Owner acting on `vt_app` cannot even see a customer row to modify it.
3. **Route level** — clock-in (`/api/activity/*`), classification (`/api/classification/*`) and tree changes (`/api/member-relationships/*`, `/api/member-transfer-requests/*`) additionally assert `actor.tenantId === target.tenantId` and return **404, not 403** on mismatch, per the spec.

There is deliberately **no endpoint** for moving a member or data between tenants. If that is ever needed it is a support operation run against the database, not a product feature, and it should stay that way.

**One deliberate exception** (§16.5): `data_retention_settings` and `monitoring_capabilities` are Owner/Super Admin-writable inside a customer tenant, because they are the platform's legal posture rather than the customer's operational choices. They are written through the account-management path on `vt_admin`, never through the read-only view, and every change is audited. Site/app classification rules, tracking rules and categories remain customer-only and are never writable by an Owner — the spec's "Never" row stands for those.

## 9. Audit

- Account actions (create, renew, seats, remove) → `customer_account_audit`, written in the same transaction as the change.
- Data views → `customer_account_audit` with `action = 'viewed'`, written **before** the response is produced, so a crash mid-render still leaves the record.
- Unlock attempts → `unlock_requested` / `unlock_failed`, which makes a brute-force attempt against the code visible.
- The existing `fn_audit_log_trigger()` continues to capture row-level changes into `audit_logs` and is untouched. Note it is `SECURITY DEFINER` and inserts into `audit_logs` — confirm in Phase 3 that leaving `audit_logs` un-RLS'd (it is in the global list) is what we want, given it contains `to_jsonb(NEW)` snapshots of *every* tenant's rows. **This is a real leak surface**: anything that exposes `audit_logs` to a customer would expose every tenant's row data. Either give `audit_logs` a `tenant_id` (populated by the trigger from `NEW.tenant_id` when the column exists) and RLS it, or confirm no customer-reachable endpoint reads it. Recommend the former.

## 10. Effect on the Tauri agent

Customer-tree members run the same desktop agent. Concretely:

- The agent authenticates the same way, so it picks up the tenant from `members.tenant_id` with no agent-side change.
- On expiry it starts receiving `403 SUBSCRIPTION_EXPIRED` from every endpoint. **Existing agents already handle this correctly** — 403 is already classified as terminal (`client/api/mod.rs:258`), so no agent release is required. See §14.5 for why the status code is load-bearing and what the optional agent-side polish is.
- `agent_devices` and `agent_link_sessions` are tenant-scoped; the link/exchange routes are **public** (`/api/activity/agent/link/init`, `/exchange`, `/reauth` are in `PUBLIC_API_ROUTES`), so like invite acceptance they run before a tenant is known and need explicit handling.

## 11. Tests

Mapped to the spec's list, with where they go:

| Test | Location |
|---|---|
| Tenant A requests tenant B by id / list / export / file URL → all fail with 404 | Backend integration, one per route module |
| Owner clock-in on a customer project → fails | Backend integration |
| Owner edits customer classification rules → fails | Backend integration |
| Owner reassigns a customer employee → no such endpoint (assert 404) | Backend integration |
| Concurrent invites at the seat limit never exceed it | Backend, parallel transactions against a real Postgres |
| Valid token blocked immediately after expiry | Backend, clock-manipulated |
| Customer data absent from main-org totals | Backend, against `dashboard` and `reports` modules |
| Every Owner view writes an audit row | Backend |
| Verification code: expiry, single use, 5-attempt lockout, rate limit | Backend unit |

Plus two that the spec does not list but that this design needs:

- **Every scoped table has RLS enabled.** A test that queries `pg_tables` / `pg_policies`, compares against the Phase 0 classification, and fails if a table was added without a policy. This is the test that keeps the isolation true a year from now, and it is the single highest-value test in the list.
- **`vt_readonly_crosstenant` cannot write.** Attempt an `INSERT` on that connection and assert it is refused by Postgres, not by application code.

## 12. Risks and open questions

### 12.1 Blocking — all resolved, none remain

1. ~~**Firestore.**~~ — **resolved in §15.1**: one collection (`User_profiles`), accessed by UID only, holding no tenant-scoped business data. Nothing to do.
2. ~~**`audit_logs` contains everything**~~ — **resolved in §14.3**: `tenant_id` populated generically by the trigger, plus RLS. No longer blocking; only two audit triggers exist (`members`, `roles`), which narrowed this considerably.
3. ~~**Scheduled reports**~~ — **resolved in §15.2**: `withTenant()` per loop iteration, a pattern that covers all five background sweeps. Customers may schedule reports in v1 (§16.7).

### 12.2 Significant

4. **Phase 3 is a one-way deploy.** Rolling RLS back after customers exist is not possible without losing isolation. It needs a staging soak with production-shaped data, not a smoke test.
5. **Connection-pool correctness.** `app.tenant_id` is published per connection, cached on the client object, and `set_config(..., false)` is session-scoped rather than transaction-scoped. That is exactly how the existing audit actor works, so it is a proven pattern here — but it means a pooled connection carries the last request's tenant until the next request overwrites it. The cache key comparison must be airtight, and any code path that gets a raw `pool.connect()` outside `client.js` (there are some — the 229 `pool.query`/`client.query` call sites include transaction blocks) must publish the tenant itself. **Audit every `pool.connect()` in Phase 3.** Consider `set_config(..., true)` (transaction-local) inside explicit transactions.
6. **Background sweeps on `vt_admin`** bypass RLS by design — mitigated by `withTenant()` (§15.2), which forces each sweep to name the tenant it is working on. Still needs a per-sweep review of `counter-reconciliation` and `integrity-sweep`, whose totals would otherwise merge tenants silently.
7. ~~**GCS deletion is not transactional**~~ — **resolved in §14.1**: lock the tenant out first, delete blobs, then one atomic DB transaction.
8. ~~**Auth-Backend does not know about tenants**~~ — **resolved in §14.4**: gate `handleSessionBootstrap` in Dashboard-Backend; Auth-Backend is untouched. The residual work is auditing the 14 `PUBLIC_API_ROUTES` entries, which is listed there.

### 12.3 Product questions

**All closed — see §16**, which is authoritative. Branding is the provider's (§16.2); customers cannot create customers (§16.1, structurally rather than by policy); expiry is a hard cutoff that also freezes the retention clock (§16.4, §16.6); compliance settings are Owner-controlled (§16.5).

One that answered itself from the code: a **banned** member does not occupy a seat — `member-ban-service.js:149` sets `status: "banned"`, so the `status = 'active'` seat query already excludes them and a ban frees a seat. Worth stating in the UI; no decision needed.

**Nothing is open. Implementation can start at Phase 1.**

## 13. Rough sequencing

| Phase | Work | Blocking risk |
|---|---|---|
| 0 — Inventory | **Done — §15.** One open item: is `lookup_tables` customer-editable? | Resolved |
| 1 — Control plane | 3 tables, verification code service, 2 routes | Low |
| 2 — Columns + keys + backfill | 74 columns, **5 PK changes**, **5 UNIQUE changes**, batched backfill | Large-table locks; the 5 PK changes are the easy-to-miss part |
| 3 — RLS | 3 DB roles, 83 policies, `client.js`, `auth-middleware.js` | **High** — one-way, needs a soak |
| 4 — Create customers | Create route, invite path, Enterprise roles | Public invite route needs manual review |
| 5 — Seats | Locked transaction, every invite path | Race correctness |
| 6 — Expiry / read-only / removal | Middleware gate, readonly pool, 4-step removal, `PUBLIC_API_ROUTES` audit | Public-route bypass list (§14.4) |
| 7 — Tab + management UI | `customer-form.tsx`, unlock pane, list surface | Low |

The honest summary: **Phase 7 is the feature the request describes; Phases 0–3 are 80% of the work and all of the risk.** Shipping the tab without the isolation underneath would produce a customer account that is a differently-labelled member of the main organization, which is the opposite of the requirement.

---

## 14. Resolutions for the five spec/reality gaps

Each of these was flagged as "can't be delivered exactly as written". Four have clean solutions that preserve the *intent* of the spec rule; one turned out not to be a problem at all once the agent code was read.

### 14.1 Removal atomicity vs. GCS blobs

**The repo already contains the correct ordering pattern.** `runRetentionSweep` in `src/modules/compliance/data-retention.js:110-122` deletes the GCS object *first* and only then adds the row id to the `deletable` list:

```js
for (const row of expiredArchived) {
  try {
    if (row.screenshot_url) await deleteFromGCS(row.screenshot_url);
    deletable.push(row.id);
  } catch (err) {
    logSafeWarn("[data-retention] GCS delete failed, leaving row for next sweep", { id: row.id, err });
  }
}
if (deletable.length) await deleteScreenshotsByIdPg(deletable);
```

A failed blob delete leaves the DB row alone for the next sweep. `deleteFromGCS` already swallows 404 (`upload.js:41`), so retries are idempotent. This ordering makes an orphaned blob — a file in the bucket with no row pointing at it — structurally impossible.

**Solution: four-step removal, with the tenant locked out before anything is destroyed.**

```
1. UPDATE tenants SET lifecycle = 'removing' WHERE id = $1   -- one small, instant txn
   + revokeRefreshTokens(uid) for every uid in the tree
   → the §6 gate now rejects every request in that tree
   → from this instant nobody can read, write, or sign in

2. Delete GCS objects for every archived screenshot in the tenant, batched,
   using the deleteFromGCS-then-record pattern above.
   Failures are logged; the tenant stays in 'removing'.

3. When step 2 reports nothing remaining: ONE transaction on vt_admin —
   DELETE FROM <each scoped table> WHERE tenant_id = $1, in FK-safe order,
   then DELETE FROM tenants. Atomic, all-or-nothing, exactly as specified.

4. If the process dies between 2 and 3, a sweep resumes any tenant left in
   'removing' from step 2. Fully idempotent.
```

**Why this satisfies the rule rather than dodging it.** The spec says "if any part fails nothing is deleted" — that rule exists to prevent a *half-deleted tenant*: orphaned projects, employees pointing at a dead root, data visible to nobody and deletable by no one. Step 3 being a single transaction prevents exactly that. The blobs were never the hazard the rule was aimed at.

And the property the customer actually cares about — "my data is gone and nobody can get at it" — is delivered at **step 1**, before any deletion at all.

**So the confirmation dialog can say something completely true**, with no asterisk:

> Access ends immediately for all **N** users. All **M** projects, **K** time entries and **S** screenshots are permanently deleted. This cannot be undone.

Both halves are honest: access *does* end at confirmation, and deletion *does* complete. That they are milliseconds apart rather than simultaneous is not something anyone was promised.

**Bonus:** when GCS isn't configured at all — `resolveGcsBucketName()` returns `""`, archiving is skipped entirely (`data-retention.js:83`), and screenshots live only in `image_data BYTEA` — step 2 is a no-op and removal is *literally* one transaction. Self-hosted deployments get the letter of the spec for free.

### 14.2 Seat counting race

**Solution: one shared helper, `FOR UPDATE` on the tenant row.**

```js
// The ONLY place a seat is consumed. Every add/invite path in a customer
// tree calls this inside its own transaction.
export async function assertSeatAvailable(tx, tenantId) {
  // FOR UPDATE is the whole point: counting rows does not block a concurrent
  // insert, so without this lock two simultaneous invites both read
  // used = limit - 1 and both succeed. Serializing on the tenant row makes
  // the count-then-insert atomic with respect to other seat consumers.
  const [tenant] = await tx.query(
    `SELECT seat_limit FROM tenants t WHERE id = $1 AND tenant_is_active(t) FOR UPDATE`, [tenantId]);
  if (!tenant) throw new ApiError(404, "Not found.");

  const [{ used }] = await tx.query(
    `SELECT (SELECT count(*) FROM members WHERE tenant_id = $1 AND status = 'active')
          + (SELECT count(*) FROM invites WHERE tenant_id = $1 AND status = 'pending') AS used`,
    [tenantId]);

  if (Number(used) >= tenant.seat_limit) {
    throw new ApiError(409, `All ${tenant.seat_limit} seats are in use. Remove someone to free a seat.`,
      "SEAT_LIMIT_REACHED");
  }
}
```

Points that matter:

- **One function, not a copy-pasted check.** The paths that consume a seat are `member-invites.routes.js`, the share-link invite, `member-onboarding`, and preprovision. Four call sites, one implementation. A fifth path added later that forgets to call it is the realistic failure mode, so the concurrency test in §11 should be written against the *route*, not the helper.
- **`FOR UPDATE` on `tenants`, not on `members`.** The row being locked is the thing whose invariant is being protected. Locking member rows wouldn't help — the conflict is about a row that doesn't exist yet.
- **No `SERIALIZABLE` isolation.** It would work, but it forces retry-on-serialization-failure handling onto a codebase with ~851 statements that has never needed it. `FOR UPDATE` keeps the cost local to the four paths that care.
- **A unique index can't substitute.** This is a cardinality constraint, not a uniqueness one; Postgres has no declarative form for it.
- **Accepting an invite doesn't consume a second seat** — it flips `invites.status` from `pending` to `accepted` and inserts an active member in the same transaction, so `used` is unchanged. Write that as a test; it's the kind of thing an off-by-one lands in.
- **Removing someone frees a seat automatically** because the count is derived, never stored. There is no counter to drift.
- Seats are counted *inside* the customer's tenant, so under RLS on `vt_app` the counts are already correct without the `WHERE tenant_id`. Write it explicitly anyway — the Owner-initiated path runs on `vt_admin`, which bypasses RLS.

### 14.3 `audit_logs` as a cross-tenant leak

Reading the schema narrowed this a lot: **only two audit triggers exist**, on `members` and `roles` (`ensure-lookup-schema.js:270-273`). So the exposure is member-row snapshots (names, emails, phone, IP) plus role changes — not literally every table.

It is definitely reachable: `GET /api/reports/audit-log` → `getAuditLogRowsPg` (`misc-reports-postgres.service.js:129`). And the doc comment directly above that function records a *prior incident of exactly this shape*:

> "…only their own reports - got every audit row in the organisation, complete with the full `to_jsonb(OLD)`/`to_jsonb(NEW)` snapshot of every member record."

**Solution: give `audit_logs` a `tenant_id`, populate it generically in the trigger, and RLS it like any other table.**

```sql
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS tenant_id UUID;
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs (tenant_id, created_at DESC);
```

In `fn_audit_log_trigger()`, derive it from the row itself rather than naming tables:

```sql
-- to_jsonb(NEW)->>'tenant_id' is NULL for a table without the column, so
-- global tables (roles) need no special case here and a trigger added to a
-- third table later is covered automatically. Falling back to the main tenant
-- rather than leaving NULL keeps "NULL" from ever meaning "visible to all".
tenant := COALESCE(
  NULLIF(COALESCE(to_jsonb(NEW)->>'tenant_id', to_jsonb(OLD)->>'tenant_id'), '')::uuid,
  main_tenant_id()
);
```

Then the same policy as everything else:

```sql
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

Two details worth writing down so nobody "fixes" them later:

- **`fn_audit_log_trigger()` is `SECURITY DEFINER`**, so its `INSERT` runs as the function owner and is not blocked by the policy. That is required and correct: the audit trigger must always be able to write, regardless of who is acting. Only *reads* are scoped.
- **Backfill existing rows to the main tenant** in Phase 2, same as every other table.

**The payoff is that `getAuditLogRowsPg` needs no change at all.** It has no `tenant_id` clause, doesn't want one, and is correct anyway — including its `LEFT JOIN members`, which RLS scopes too. This is the §3 design demonstrating itself on the exact query that leaked once before, and it is the best argument in this document for choosing RLS over application-level filters.

### 14.4 Auth-Backend has no tenant awareness

Two findings change this from a cross-service problem into a one-function change:

1. **Auth-Backend has no Postgres at all.** `Auth-Backend/src/config/` contains `firebase.js`, `env*.js` and `password-policy/` — no database client, no member table access. It does Firebase identity and Google OAuth, nothing more.
2. **`POST /api/auth/session-bootstrap` lives in Dashboard-Backend**, not Auth-Backend (`src/modules/auth/session-bootstrap.js`, routed via `identity-routes.js`). It is the first call the web client makes after Firebase sign-in, and it already has Postgres and already resolves the member.

**Solution: don't touch Auth-Backend. Gate `handleSessionBootstrap`.**

The expired user signs in to Firebase successfully, immediately calls session-bootstrap, and gets `SUBSCRIPTION_EXPIRED` as the response to their very first call. The client renders the expired state instead of a dashboard. No half-loaded UI, no change to the service that owns authentication.

**And leaving Firebase identity alone is the right call, not a compromise.** Blocking at the identity layer would mean setting `disabled` on the Firebase user, which would (a) require a scheduled writer against the auth provider, (b) have to be reliably reversed on renewal, and (c) put the spec's "renewal restores access immediately, data exactly as it was" at the mercy of that reversal succeeding. The credential is valid; the subscription is not. Gate authorization, not identity.

**The precise version of this problem is `PUBLIC_API_ROUTES`.** The 14 entries in `auth-middleware.js:12-27` bypass `enforceApiAuthentication` entirely, and therefore bypass the expiry gate. Each needs an explicit decision in Phase 6:

| Route | Decision |
|---|---|
| `POST /api/auth/session-bootstrap` | **Add the gate** — this is the login path |
| `GET /api/auth/sign-in-client-extras` | Check whether the client calls it pre-bootstrap; gate if so |
| `POST /api/activity/agent/link/{init,exchange}`, `/reauth` | **Add the gate** — an expired tenant must not link new devices or refresh agent tokens |
| `GET/POST /api/public/invites/:token[/register]` | **Add the gate** on the invite's tenant — an expired customer's pending invites must not be redeemable |
| `POST /api/auth/access-request`, `send-verification-email`, `notify-*` | Leave open — no tenant data, and blocking them would break password recovery |
| `GET/POST /api/public/member-transfer-requests/:id` | Gate on the request's tenant |

That list, not "Auth-Backend doesn't know about tenants", is the actual work item.

### 14.5 The Tauri agent — this one reverses

I priced in a mandatory agent release. Reading the agent's HTTP layer, **that was wrong, and the fix is to change one number in the backend.**

`ApiError` already has exactly the right shape (`client/api/mod.rs:36`):

```rust
pub enum ApiError { Network, Unauthorized, Rejected(String) }
```

with `is_rejected()` documented as *"this device/account is finished … as opposed to a retryable network hiccup."* And `reauth_with_device` already classifies by status code (`mod.rs:258`):

```rust
// 401/403 = this device or account is finished. 5xx = try later.
let terminal = status.as_u16() == 401 || status.as_u16() == 403;
```

**So the status code decides whether every already-installed agent behaves correctly:**

| Backend returns | Existing agents do |
|---|---|
| `402 Payment Required` | Not terminal → classified as `Network` → **retry forever**: battery drain, log spam, an agent that looks broken rather than expired |
| **`403` + `code: "SUBSCRIPTION_EXPIRED"`** | Already terminal → `ApiError::Rejected` → **stop, surface the message** |

**Use 403.** `402` is the more semantically precise status, but precision that makes every deployed agent spin is not worth having, and the `code` field carries the meaning for any client that wants it. This is why §6 specifies 403.

Result: **no agent release is required to ship this feature.** The agent-side work becomes optional polish in a later release:

- Event uploads currently `return false` on any non-success and retry next tick (`api/events.rs:35`), so an expired agent would keep posting refused events until the user quits it. Terminal-status handling belongs in that path too.
- The controller already has the perfect slot for the message: `blocked_by_monitoring_notice()` (`agent/controller.rs:956`) returns `Option<String>` meaning "reason you can't start the timer", and the UI already renders it. A sibling `blocked_by_subscription()` plugs the expiry message into an existing, already-styled surface with no new UI.
- Optionally a distinct `ApiError::SubscriptionExpired` variant so the message isn't string-matched.

On the web side, `SUBSCRIPTION_EXPIRED` is a new code in the switch that already handles `MUST_CHANGE_PASSWORD`, `EMAIL_NOT_VERIFIED`, `SESSION_REVOKED` and `ACCOUNT_DISABLED` — it must render the full-page expired state, not a generic permission error.

### 14.6 Net effect on §12

| Was | Now |
|---|---|
| 12.2 #7 — GCS deletion not transactional | **Resolved** — §14.1. Lock-then-delete; the dialog's promise is true as written |
| 12.2 #5 — seat race | **Resolved** — §14.2. `FOR UPDATE` in one shared helper |
| 12.1 #2 — `audit_logs` leak | **Resolved** — §14.3. Now a decided design, not an open question. Move out of "blocking" |
| 12.2 #8 — Auth-Backend unaware | **Resolved** — §14.4. Restated as: audit the 14 `PUBLIC_API_ROUTES` entries |
| §10 — agent release dependency | **Withdrawn** — §14.5. Use 403; agent work becomes optional |

Phase 0's blocking list therefore shrinks to two — and §15 now answers both of those too.

---

## 15. Existing-system inventory

This is the Phase 0 artifact, done. Both remaining blocking questions are answered, and the sweep turned up **two structural problems that a `tenant_id` column does not solve**.

### 15.1 Firestore — resolved, and it is a non-issue

Every Firestore access in the backend is the **same single collection**:

```
grep -rn "\.collection(" Dashboard-Backend/src --include=*.js
→ 17 files, all USER_PROFILES_COLLECTION ("User_profiles"), plus readiness.js's health-check ping doc
```

`ENTITY_BOOTSTRAP_MANIFEST` (`src/bootstrap/entity-bootstrap-manifest.js`) lists ~40 collections, but it is a **legacy inventory** — projects, tasks, teams, clients, invites, employment and the rest have all moved to Postgres. `src/modules/schema/routes.js`, despite being a generic CRUD router, imports no Firestore at all; it runs on the Postgres catalog in `schema/catalog/`.

So Firestore holds **user profile documents keyed by Firebase UID** and nothing else. That is per-user identity data, not tenant business data, and it is already only ever read by UID — never listed, never queried across users. **No parallel scoping mechanism is needed.** This was the single largest risk in §12.1 and it evaporates on inspection.

One caveat to verify in Phase 1: `migrate-profile-image-fields.js:19` does `db.collection(USER_PROFILES_COLLECTION).get()` — a full collection scan. It is a one-off backfill, not a request path, but confirm it is not reachable by a customer.

### 15.2 Scheduled reports — resolved, with a pattern that generalizes

`processDueReportSchedules` (`src/modules/reports/report-schedule-runner.js:81`) calls `listReportSchedulesPg(...)` and loops. It already resolves per-schedule context — the reported member's timezone, and `resolveScheduleAudience()` for "can the creator still see this report".

**Solution: set the tenant per iteration.** The loop runs on `vt_admin` so it can see every schedule, and each iteration publishes `app.tenant_id` from `schedule.tenant_id` before generating the report body. The report is then produced under that tenant's RLS, and the existing audience check works unchanged.

```js
for (const schedule of schedules) {
  await withTenant(schedule.tenant_id, async () => {
    // everything from here down sees exactly one tenant
  });
}
```

**This `withTenant()` helper is the answer for every background sweep**, not just this one — `abandoned-session-sweep`, `counter-reconciliation-sweep`, `integrity-sweep` and `runRetentionSweep` all have the same shape (loop over work, no request context). Write it once in Phase 3 and convert them together. It also resolves §12.2 #6: a sweep that must aggregate is forced to name which tenant it is aggregating.

### 15.3 Five org-singleton tables need a **primary key change**, not a column

This is the finding that does not fit the Phase 2 pattern. Five tables store organization-wide configuration as a *single row* — adding `tenant_id` is not enough, because their primary key forbids a second row:

| Table | Current key | Why it must become per-tenant |
|---|---|---|
| `currency_settings` | `id SMALLINT PK CHECK (id = 1)` | Each customer sets their own display currency |
| `capture_minimization_settings` | `id SMALLINT PK CHECK (id = 1)` | Screenshot blur/minimization policy |
| `activity_scoring_settings` | `id SMALLINT PK CHECK (id = 1)` | What counts as "active" |
| `data_retention_settings` | `data_type PK` (4 fixed rows) | Retention period per data type |
| `monitoring_capabilities` | `capability PK` (6 fixed rows) | Which monitoring is enabled, **and `jurisdiction_profile`** |

Migration for each: drop the singleton `CHECK` / re-key, make the PK `(tenant_id)` or `(tenant_id, data_type)`, backfill the existing row to the main tenant, and seed a default row for every new tenant at creation time (so a fresh customer is not left with zero rows, which would read as "no settings" rather than "defaults").

**The last two are not merely technical.** `data_retention_settings` and `monitoring_capabilities` are *compliance* settings — retention periods and a `jurisdiction_profile` of `eu_uk` / `us_one_party_consent` / `us_two_party_consent` / `strictest`. A customer is a separate legal entity employing its own people; the provider cannot impose its own jurisdiction profile or retention policy on them, and would arguably take on liability by doing so. **These must be per-tenant and customer-editable**, which also means the Owner's read-only view must not be able to change them — consistent with the spec's "Never" row for classification and tracking rules.

Seeding defaults for a new tenant belongs in the Phase 4 create transaction, beside the `tenants` insert.

### 15.4 Five UNIQUE constraints break under tenancy

Most existing UNIQUE constraints are keyed on UUIDs — `UNIQUE (team_id, member_id)`, `UNIQUE (task_id, member_id)`, `member_id UNIQUE` — and those are **safe without modification**, because two tenants can never collide on a globally-unique UUID.

The ones keyed on a **human-chosen name, label or number** break, because two tenants legitimately want the same string:

| Table | Constraint | Collision |
|---|---|---|
| `lookup_tables` | `uq_lookup_category_name UNIQUE (category, name)` | Both tenants want a "Senior" job title |
| `org_field_options` | `uq_org_field_type_label UNIQUE (type, label)` | Both want a "Remote" workplace model |
| `invoices` | `UNIQUE (number)` | Both issue invoice `001` |
| `time_off_policies` | `UNIQUE (name)` | Both want "Annual Leave" |

**`lookup_tables` is confirmed customer-editable** — `lookup-postgres.service.js` has full INSERT/UPDATE/DELETE for job titles, departments, job types and tax types. It is therefore tenant-scoped, and its `uq_lookup_category_name` is the fifth break.

Each becomes `UNIQUE (tenant_id, …)`. The failure mode if missed is not a leak — it is the second customer being unable to create ordinary records, with a confusing constraint-violation error. Annoying rather than dangerous, but it will happen on day one of the second customer, so it belongs in Phase 2 alongside the column additions.

`roles.name UNIQUE` and `apps.name UNIQUE` stay as they are, because both tables stay global (§15.5).

### 15.5 Table classification (82 tables)

**Global — no `tenant_id`** (7). Each is a deliberate hole in the isolation, so each needs its justification kept next to it:

| Table | Why global |
|---|---|
| `roles`, `role_permissions` | The 9-role catalog is the platform's own ladder; customers use the same ladder, they do not define roles |
| `apps` | A name→icon dictionary of known applications. Holds no observation of *who* ran what — that is `activity_app_logs`, which is scoped |
| `currency_rates` | FX reference data |
| `system_meta` | Bootstrap and migration markers |
| `device_bans` | **Global by necessity** — `assertDeviceNotBanned` runs *before* authentication, so no tenant is known yet. Note the consequence: a device ban is platform-wide, so a customer must not be able to create one |
| `audit_logs` | **Was** global; now scoped per §14.3 |

**Tenant-scoped — everything else** (75). Grouped by the module that owns them:

- **Identity & tree** — `members`, `member_relationships`, `member_tree_cache`, `member_transfer_requests`, `member_bans`, `member_onboarding`, `members_field_data`, `lookup_tables`, `pending_auth_members`, `invites`, `invite_projects`, `pending_auth_projects`, `access_requests`, `deactivation_requests`, `org_field_options`
- **Employment & pay** — `employment`, `pay_rates`, `pay_rate_history`, `limits`, `time_settings`, `member_makeup_days`, `currency_settings`
- **Work** — `projects`, `project_members`, `project_budgets`, `project_budget_notify_state`, `project_member_limits`, `project_subprojects`, `teams`, `team_members`, `team_projects`, `clients`, `client_budgets`, `client_invoicing`, `client_projects`, `client_automation_state`
- **Tasks** — `tasks`, `task_assignments`, `task_comments`, `task_subtasks`, `task_attachments`, `task_hours`, `task_member_progress`
- **Time** — `time_entries`, `timesheets`, `daily_member_active_seconds`, `daily_member_task_active_seconds`, `time_off_policies`, `time_off_requests`, `time_off_transactions`
- **Activity & monitoring** — `activity_sessions`, `activity_session_events`, `activity_screenshots`, `activity_app_logs`, `activity_url_logs`, `activity_integrity_flags`, `activity_alert_log`, `activity_categories`, `activity_scoring_settings`, `screenshot_access_log`, `capture_exclusions`, `capture_minimization_settings`, `data_retention_settings`, `monitoring_capabilities`, `monitoring_policy_audit`, `member_monitoring_consent`
- **Agent** — `agent_devices`, `agent_link_sessions`, `agent_notifications`
- **Money** — `invoices`, `invoice_line_items`, `invoice_payments`, `expenses`
- **Reporting & comms** — `saved_reports`, `report_schedules`, `notifications`

**High-volume — batch the Phase 2 backfill and index these** `CONCURRENTLY`: `activity_screenshots`, `activity_app_logs`, `activity_url_logs`, `activity_session_events`, `activity_sessions`, `time_entries`, `daily_member_active_seconds`, `daily_member_task_active_seconds`.

### 15.6 Existing behaviour that changes

Work items in existing code, beyond adding columns:

| Existing surface | What changes |
|---|---|
| `src/lib/postgres/client.js` | Publish `app.tenant_id` beside `app.actor_id`; add `withTenant()` |
| `src/http/auth-middleware.js` | Resolve `tenantId` into the context; add the grant gate beside `enforcePrivilegedRoleGovernanceForMember` |
| `src/http/auth-context.js` | Set the tenant where it already sets the audit actor |
| `PUBLIC_API_ROUTES` (14 entries) | Per-route decision — §14.4 |
| `fn_audit_log_trigger()` | Derive and store `tenant_id` — §14.3 |
| `ensure-lookup-schema.js` | 74 columns + indexes, 5 PK changes, 4 UNIQUE changes; runs **every boot**, so guard the backfill with a `system_meta` marker |
| `role-hierarchy.js` + web mirror | Two Enterprise roles, excluded from ordinary dropdowns |
| `member-invites.routes.js`, onboarding, preprovision, share-link | Call `assertSeatAvailable` — §14.2 |
| `report-schedule-runner.js` + 4 sweeps | Wrap each iteration in `withTenant()` — §15.2 |
| `data-retention.js` | Per-tenant retention settings instead of the singleton |
| `add-members/index.tsx` | Fourth tab + unlock pane |
| Web API error handling | `SUBSCRIPTION_EXPIRED` → full-page expired state |
| Tauri agent | Nothing required (§14.5); optional polish later |

**Not touched at all:** Auth-Backend, Landing-Web, Landing-Backend, Notify-backend, and every `*-postgres.service.js` query — the last of which is the entire point of choosing RLS.

### 15.8 In-process caches — the one hole RLS cannot cover

RLS protects the database. It does not protect a value already sitting in Node's memory. **A module-level cache holding tenant-scoped rows serves the first tenant's data to every subsequent tenant**, and no policy will stop it, because the second request never reaches the database.

There is exactly one such cache today, and it does leak:

```js
// src/lib/postgres/lookup-cache.js:5
let cache = { data: null, expiresAt: 0 };   // process-global, 15s TTL
// caches: roles (global, fine)
//         lookup_tables    ← TENANT-SCOPED
//         org_field_options ← TENANT-SCOPED
```

Under tenancy, the first tenant to populate this cache has their job titles, departments and employment-type options served to every other tenant for the next 15 seconds. **Fix: key the cache by tenant** — `Map<tenantId, {data, expiresAt}>` — and have `invalidateLookupCache()` clear either one tenant's entry or all of them. Keep `roles` in a single shared entry since it is genuinely global.

Audit of every other module-level cache:

| Cache | Verdict |
|---|---|
| `src/http/role-cache.js` | Keyed by member id → **safe**; member ids are globally unique. Verify the key in Phase 3 |
| `src/http/rate-limit.js`, `invite-abuse-guard.js` | Keyed by IP/route, hold no tenant data → safe |
| `src/config/env.js` | Process config → safe |
| Everything else | Function-local `new Map()`, lives for one call → safe |

**Add to the Phase 3 test suite**: populate a cache as tenant A, read as tenant B, assert B does not see A's values. It is the one isolation test that the RLS-coverage test cannot subsume, and this class of bug will recur every time someone adds a cache.

---

## 16. Settled decisions

All nine open flags are closed. This section is authoritative — where it disagrees with an earlier section, this one wins.

### 16.1 Enterprise roles exist **only** at the tenant root

The most consequential clarification, and it simplifies §7 considerably.

**There are exactly two Enterprise roles, and only the customer root ever holds one.** Everyone the customer creates beneath them gets an **ordinary** role — Manager, Team Lead, Employee, Intern, Client, Viewer. There is no "Enterprise Manager" two levels down a customer tree; that role is the *membership*, and a membership has exactly one holder (§4.3).

Ceilings fall straight out of the existing `maxAssignableRank` (`actorRank - 10`), with no special-casing:

| Root's granted role | Rank | May assign |
|---|---|---|
| Enterprise Super Manager | 70 | **Manager and below** — ordinary roles |
| Enterprise Manager | 60 | Team Lead and below — ordinary roles |

Consequences to enforce:

- `canAssignRole` must **refuse both Enterprise roles as assignment targets, always, from anyone.** They are not in `ASSIGNABLE_ROLE_NAMES` and are reachable only through the Phase 4 create path.
- A customer therefore cannot create another customer — **decision 7** — not by policy check but because the role is unreachable from inside a tree. Structural, not conditional.
- No customer tree member can ever reach Admin, Super Admin or Owner: the highest ceiling is Manager, four ranks below Admin.

### 16.2 Branding: the provider's — **My Virtual Tracker**

Not white-label, not customer-branded. Customers see **My Virtual Tracker** throughout: the invite email, the app shell, the expired-subscription message, the agent.

This inherits the standing project constraint that `productName` in `tauri.conf.json` stays `"My Virtual Tracker"` under all circumstances. Nothing in this feature introduces a per-tenant branding surface, so nothing here can regress it.

The expired message stays generic — *"contact your provider"* — rather than naming a reseller, since there is no reseller layer.

### 16.3 The verification code gates the **system**, not the tab

Confirmed emphatically: this is not a UI affordance. The unlock token is required on **every** customer-account endpoint that mutates — create, renew, change seats, change period, remove — and is verified server-side on each call.

Practically: `unlock/verify` returns a short-lived token bound to the member id and the purpose, held in component state only (§ Phase 7), and every mutating handler in §6 asserts it before doing anything. An Owner with a valid session but no unlock token can do nothing through this surface, including by curl.

### 16.4 Expiry is a hard cutoff

No grace window, no read-only degradation. `now >= period_end` → every request in the tree refused, exactly as §4.3 implements it.

**The "read-only" in the spec was never about expiry** — it describes the Owner/Super Admin *viewing a customer's Dashboard*, and that is a Dashboard viewing mode, not a system-wide API posture. The two concepts are unrelated and must not be conflated during implementation:

| Concept | What it is |
|---|---|
| **Read-only customer view** | Owner/Super Admin opens a customer's Dashboard to look at it. Backed by `vt_readonly_crosstenant` (§3.1). Nothing to do with expiry |
| **Expiry lockout** | The tenant's grant lapsed. *Everyone* in that tree is refused — not downgraded to reading |

One operational note to handle in Phase 6: an agent tracking at the moment of expiry holds unsynced local state. Its next sync is refused, so that time is stranded until renewal. Since renewal restores everything and nothing is deleted, the agent should **retain** its unsynced buffer rather than discard it on a terminal refusal.

### 16.5 Compliance settings are Owner/Super Admin controlled

`data_retention_settings` and `monitoring_capabilities` (including `jurisdiction_profile`) are set by the Owner or Super Admin. Customers do not edit them. The rationale is that the platform operator is the party accountable for lawful operation across every tenant.

**This does not contradict the spec's "Never" row**, and the distinction matters during implementation:

| Setting | Who controls | Why |
|---|---|---|
| `data_retention_settings`, `monitoring_capabilities` | **Owner / Super Admin** | Platform legal posture — the operator's accountability |
| Site/app **classification rules**, tracking rules, categories | **Customer only** — Owner can never touch | Operational choices about their own people (spec's "Never" row stands) |

So these two tables are the **single exception** to "Owners never write inside a customer tenant". They are written through the account-management path (`vt_admin`), never through the read-only view, and every change writes a `customer_account_audit` row. Everything else in §8 is unchanged.

Residual risk, recorded once and accepted: setting another legal entity's retention and jurisdiction profile means accepting responsibility for those choices with respect to their employees' data rights.

### 16.6 Expiry freezes retention — the sweep clock stops

Chosen rather than plain "keep everything indefinitely", because plain indefinite retention silently breaks the spec.

The problem: `runRetentionSweep` deletes screenshots older than 90 days, app logs older than 180, sessions older than 730. If it keeps running against an expired tenant, a customer expired for six months renews to find their screenshots gone — violating *"renewal restores access immediately and the data is exactly as it was."*

**So retention sweeps skip tenants that are not active.** One filter, `WHERE tenant_is_active(t)`, inside the `withTenant()` loop from §15.2. The retention clock stops at `period_end` and resumes on renewal. Data is frozen exactly as it was, which is what the spec actually promises.

Removal (§14.1) remains the only thing that deletes customer data.

### 16.7 Customers may schedule reports

Allowed in v1. `withTenant()` (§15.2) already makes the scheduled-report path tenant-safe, so permitting it is less work than blocking it.

### 16.8 The management list is its own route, copied from the members page

Not a new surface built from scratch — a copy of what already exists, trimmed to what's useful.

The existing pattern is a subpage id plus a page component:

```ts
// app/routes/people-member-pages.ts
export const PEOPLE_MEMBER_SUBPAGE_IDS = [
  "people-members", "people-members-tree", "people-member-bans",
] as const
```

Add `"people-customer-accounts"` as a fourth id, and `features/members/pages/customer-accounts-page.tsx` copied from `members-page.tsx`. Keep the table, filters, row menu and skeleton; swap the columns for **email, granted role, seats used / limit, period end, status**; replace the row actions with renew / change period / change seats / remove. The subpage is rendered only for Owner and Super Admin, and the backend refuses it for everyone else regardless.

Reuse rather than reinvent: `members-page-skeleton.tsx`, `member-filters-panel.tsx` and the row-menu components all carry over with column changes only.
