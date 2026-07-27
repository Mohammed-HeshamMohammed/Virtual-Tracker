# Feature Plan: Migrate Existing Firebase Auth Users into Virtual Tracker

Status: **Finalized — ready to implement**
Owner: Mohammed Hesham
Created: 2026-07-28

## 1. Problem

Virtual Tracker and a companion mobile app (a branch of the same company's product line) share the **same Firebase Auth project**. Users who signed up through the mobile app already exist in Firebase Authentication, but have no corresponding row in this app's Firestore `members` collection.

Today, "Add members" only supports:
- **Send invites** — email invite flow, recipient registers fresh.
- **Create account** — admin creates a brand-new Firebase Auth user + member row.

Neither path works for someone who **already has a Firebase Auth account** — inviting them re-creates identity conflicts, and "Create account" would try to create a duplicate Auth user for an email that already exists.

We need a third path: **Migrate** — let an Owner/Admin/Super Admin browse existing Firebase Auth users not yet linked to a member row, pick one (or more), assign a role, and adopt them into Virtual Tracker without touching their Auth identity.

## 2. Relevant existing code

- [`Dashboard-Web/features/members/components/modals/add-members/index.tsx`](Dashboard-Web/features/members/components/modals/add-members/index.tsx) — the "Add members" modal, currently has `"invites" | "accounts"` tabs.
- [`Dashboard-Backend/src/modules/members/services/ensure-member-from-auth.js`](Dashboard-Backend/src/modules/members/services/ensure-member-from-auth.js) — `ensureMemberRowForUserRecord(db, userRecord)`, the organic first-sign-in bootstrap. Always assigns `"Viewer"`. **Not** what Migrate should call directly (see §3) — stays untouched.
- [`Dashboard-Backend/src/modules/members/routes/member-invites.routes.js`](Dashboard-Backend/src/modules/members/routes/member-invites.routes.js) — `promotePendingMemberCore(db, auth, uid)` (already exported) is the real "create a member row with a specific role from a `pending_auth_members` doc" logic. This is what Migrate should call. Also has the existing "Create account" handler to mirror for request-shape conventions.
- [`Dashboard-Backend/src/config/firebase.js`](Dashboard-Backend/src/config/firebase.js) — `getAuthAdmin()` exposes the Firebase Admin Auth SDK (`admin.auth()`), which is how we'd call `listUsers()` / `getUser()` / `getUserByEmail()`.
- `members` collection has no `organization_id`/tenant field — this deployment is single-tenant per Firebase project, so any unlinked Auth user in the project is a valid migration candidate (no cross-tenant filtering needed).
- Dedup/index helpers already exist: `dedupeMembersForFirebaseUid`, `ensureMemberAuthIndex` in `member-dedupe.js`, plus `pending_auth_members` and `member_auth_index` collections used to avoid double-creating members.
- [`Dashboard-Backend/src/modules/members/services/member-ban-service.js`](Dashboard-Backend/src/modules/members/services/member-ban-service.js) — `assertMemberNotBanned(db, { email, memberId, firebaseUid })` checks bans by email/memberId/uid. Reused so Migrate can't resurrect a banned identity as a fresh, unbanned member.
- [`Dashboard-Backend/src/modules/members/services/member-remove-from-tree-service.js`](Dashboard-Backend/src/modules/members/services/member-remove-from-tree-service.js) and [`Dashboard-Backend/src/modules/auth/account-deactivation.js`](Dashboard-Backend/src/modules/auth/account-deactivation.js) — confirms member removal either demotes-in-place (member row kept) or hard-deletes the member row **and** the Firebase Auth user **and** `member_auth_index` together (`deleteViewerSelfAccount`). No path leaves a dangling `member_auth_index` entry pointing at a live Auth user with no member row — relevant to the "migratable list" filter query (see resolved Q5).

## 3. Proposed design (revised)

**Key correction from the first draft:** `ensureMemberRowForUserRecord` (in `ensure-member-from-auth.js`) is the *organic first-sign-in* bootstrap path — it always assigns `"Viewer"` and is designed to run unattended when someone logs in for the first time. It is **not** the mechanism the codebase actually uses when an admin wants to create a member with a specific role ahead of time.

That mechanism already exists: the **"Create account" pre-provision pipeline**.
1. [`member-invites.routes.js`](Dashboard-Backend/src/modules/members/routes/member-invites.routes.js:719) (the `POST` account-creation handler) writes a `pending_auth_members/{uid}` doc containing `role_id`, `pay_rate`, `created_by_uid`, plus optional `pending_auth_projects` rows.
2. `promotePendingMemberCore(db, auth, uid)` ([member-invites.routes.js:102](Dashboard-Backend/src/modules/members/routes/member-invites.routes.js:102), already exported) reads that pending doc, creates the real `members` row **with the stored role** (not hardcoded Viewer), syncs project membership, records the creator→new-member hierarchy relationship, deletes the pending doc, then calls `ensureMemberLinkedRecordsForUserRecord` to run the full org/entity bootstrap.
3. Today, step 2 only fires later, when the new user completes their first login (`complete-first-login.js:83`) — because in the "Create account" flow the person doesn't have working credentials yet and must go through a forced password change.

**Migration is the same problem minus the "doesn't have credentials yet" part** — a mobile-app user already has a working Firebase Auth account. So Migrate can call `promotePendingMemberCore` **immediately**, synchronously, instead of waiting for a future login:

```
write pending_auth_members/{uid}  (role_id, created_by_uid, no password/must-change flags)
  → promotePendingMemberCore(db, auth, uid)   // runs right now, not on next login
  → real members row created with the chosen role, hierarchy + bootstrap done
```

This means **zero changes to existing files.** `ensure-member-from-auth.js` stays untouched (still Viewer-only, still only for organic sign-in). Everything Migrate needs is one new orchestration function plus one new route.

### 3.1 Backend

**GET `/api/members/migratable`**
- Auth-gated: **not** the shared `requireManagementRole` — see §7.5, use a narrower Owner/Super Admin/Admin-only check instead.
- Calls `authAdmin.listUsers(1000, pageToken)`.
- Filters out any uid that already has a `members` doc (`firebase_uid == uid`), is in `member_auth_index`, or is in `pending_auth_members`.
- **Also filters out `user.disabled === true`** — a disabled Firebase account can't sign in, so promoting it is a no-op at best and could mask a ban-elsewhere situation at worst (see Edge Cases).
- Returns `{ users: [{ uid, email, displayName, phoneNumber, creationTime }], nextPageToken }`.
- Also accepts `?email=` or `?phone=` for exact-match lookup via `authAdmin.getUserByEmail(email)` / `getUserByPhoneNumber(phone)` — worth having both, since a mobile app skews toward phone-auth signups more than a web dashboard does. At ~40 total users (confirmed, §7.4) this is a nice-to-have, not load-bearing — browse-first is fine.

**POST `/api/members/migrate`**
- Body: `{ uids: string[], role: MemberRole }` — **batch from day one** (see resolved Q1 below).
- Auth-gated: same narrower check as above (§7.5) + `validateRoleAssignment(db, actorRoleName, { roleName })` (existing guard — blocks assigning Owner, blocks assigning above the actor's own rank). Checked once for the whole batch since all uids in one call share one role.
- Per uid (loop, partial-failure tolerant — mirrors [`batchRemoveMembersFromTree`](Dashboard-Backend/src/modules/members/services/member-remove-from-tree-service.js:133): cap at 100 uids, collect a result row per item instead of failing the whole batch):
  1. `userRecord = await auth.getUser(uid)` — re-validates the uid is still real and grabs current email/displayName.
  2. **Already-migrated guard** — `db.collection("members").where("firebase_uid","==",uid).limit(1).get()`; if found, return `{ uid, success: false, error: "already migrated" }` for this row instead of proceeding. Prevents a double-click or stale-list race from minting two `members` rows for one Firebase identity (see §7.2).
  3. **Ban check** — `assertMemberNotBanned(db, { email, firebaseUid: uid })` (existing helper, [member-ban-service.js:45](Dashboard-Backend/src/modules/members/services/member-ban-service.js:45)). A user could be banned by email/IP without ever having had a `members` row here; block the migration with the existing ban message instead of silently creating a fresh, unbanned member row for them.
  4. Write `pending_auth_members/{uid}` with `role_id` (resolved via `resolveRoleIdByName`), `created_by_uid: actorUid`, `created_at`. No `must_change_password`/`first_login` flags — those exist to force a password reset for *new* credentials; a migrated user's existing password is untouched.
  5. `await promotePendingMemberCore(db, auth, uid)`, wrapped in try/catch — on failure, best-effort delete `pending_auth_members/{uid}` before recording the row as failed, so the uid isn't stuck invisible to future `GET /migratable` calls (see §7.3).
  6. On success, merge-patch the new `members` doc with `{ migrated_from_auth: true, migrated_at: <now>, migrated_by: actorMemberId }` — additive provenance fields only. **Do not touch `created_by`** (see §7.1 for why).
- Returns `{ results: [{ uid, success, memberId?, error? }] }` per uid.

### 3.2 Frontend

- Add a third tab, **"Migrate"**, to [add-members/index.tsx](Dashboard-Web/features/members/components/modals/add-members/index.tsx), alongside "Send invites" / "Create account".
- Tab content:
  - Fetches first page from `/api/members/migratable` on tab open.
  - Simple list: checkbox + email + display name per row.
  - Client-side text filter box (substring match over the currently loaded page — no server-side search needed at this scale).
  - "Load more" button using `nextPageToken` for pagination.
  - If admin types a full email not present in loaded pages, hit `?email=` on the same endpoint (exact lookup, see §3.1).
  - Role dropdown (reuse `listAssignableRoles`, same as other tabs) — one role applies to the whole selection.
  - "Migrate" button sends all selected uids in one POST `/api/members/migrate` call, shows per-row success/failure (endpoint already returns per-uid results).
  - **No project/team picker in v1** — checked the existing `invite-form.tsx` and it doesn't expose project assignment either; Migrate matches that scope. Project/team assignment stays a separate step via the existing member-management UI after migration.

### 3.3 Explicitly out of scope (for now)

- Server-side fuzzy/full-text search over Firebase Auth users.
- Background sync job that auto-imports mobile users.
- CSV/bulk import.
- Cross-tenant filtering (not applicable — single Firebase project per deployment).
- Project/team assignment as part of the Migrate flow itself (do it as a follow-up action, consistent with how invites work today).

Reconsider these only if the Auth user base grows large enough that manual pagination + client-side filter becomes unusable (thousands of unlinked users).

## 4. Edge cases — resolved by reusing existing guards

- **Banned elsewhere, no member row yet** — a Firebase Auth user could be on the ban list (by email or IP) without ever having had a `members` row here. Resolved: call `assertMemberNotBanned` before promoting; block with the existing ban message on a hit.
- **Disabled Firebase account** — can't sign in, so migrating it is pointless and possibly a signal something's wrong with that identity. Resolved: exclude `disabled === true` users from the migratable list entirely.
- **Email collision** — Auth user's email matches an existing `work_email` on a *different*, not-yet-linked member row (e.g. pre-provisioned via invite but never signed in). Doesn't apply to Migrate the way it applies to organic sign-in: the migratable-list query already excludes any uid present in `pending_auth_members`/`member_auth_index`/linked `members`, and a promotion writes fresh `pending_auth_members` + calls `promotePendingMemberCore`, which creates a brand-new member row keyed by a new id rather than searching by email — so this can't silently merge into an unrelated row. Worth a duplicate-email warning in the UI, but not a correctness risk.
- **Role assignment ceiling** — an Admin migrating someone shouldn't grant a role above their own rank, or grant Owner. Already fully covered by `validateRoleAssignment`, called once per batch. No new logic needed.
- **Dangling `member_auth_index`** — checked the removal paths ([§2](#2-relevant-existing-code)): a hard-deleted member also deletes `member_auth_index` and the Firebase Auth user together, and a demoted-not-deleted member keeps its `members` row (so it's correctly excluded already). There is no removal path that leaves an Auth user alive with a dangling index entry and no member row. Nothing to special-case.

## 5. Decisions

1. **Disabled accounts** — hidden entirely from the migratable list. Confirmed: they're already disabled, not an active concern for admins right now.
2. **Mobile app side-effects** — confirmed purely additive, no mobile-side change or flag needed. Context: not every mobile-app user (agent) is meant to be on Virtual Tracker — Migrate is the deliberate, admin/owner-driven bulk-onboarding tool for the subset who should be. A migrated user keeps their mobile app access unchanged and *additionally* gets a `members` row here. Nothing shared/cross-app needs to track "who's been migrated" beyond what already lives in this app's own `members`/`member_auth_index` collections.

Pool size confirmed at ~40 total users (§7.4) — resolved, no design change needed. One new decision needed on the permission guard — see §7.5.

## 7. Further improvements found on re-review

### 7.1 Don't relabel `created_by` — it's a functional gate, not just an audit field

`promotePendingMemberCore` hardcodes `created_by: "invite-preprovision"` on the new `members` row. My first instinct was to give Migrate its own label (e.g. `"migrated-from-auth"`) for cleaner audit trail. **That would silently break a real feature.**

[`first-login-notify.js:8`](Dashboard-Backend/src/modules/notifications/first-login-notify.js:8) — `isTeamAddedMember()` checks `created_by` against exactly `["invite-preprovision", "self-invite"]` to decide whether to notify the adder/upline when this person's first real login happens. That check runs from [`session-bootstrap.js:119`](Dashboard-Backend/src/modules/auth/session-bootstrap.js:119) — i.e. on the migrated user's *next actual login to Virtual Tracker*, not at migration time. Keeping `created_by: "invite-preprovision"` as-is means the admin who migrated someone automatically gets a "New member joined — completed their first sign-in" notification the first time that person actually opens Virtual Tracker. That's exactly the right behavior for Migrate too, for free, as long as we don't touch the field.

**Fix:** leave `created_by` alone. For provenance/reporting, add new, additive fields after promotion instead: `migrated_from_auth: true`, `migrated_at`, `migrated_by`. Already folded into §3.1 step 6.

### 7.2 Concurrency: prevent one Firebase uid from getting two `members` rows

`promotePendingMemberCore` never checks whether a `members` row already exists for a uid before minting a new `memberId` — it just creates one. In the *organic* flow this is safe because a given uid's promotion is only ever triggered once, by that person's own first-login request. Migrate changes that assumption: an admin batch-selecting from a list is far more likely to double-click, or to act on a list fetched a minute ago where someone else already migrated the same uid in the meantime.

**Fix:** added an explicit "already migrated" check (query `members` by `firebase_uid`) as its own step before writing the pending doc, so a repeat attempt reports a clean per-row failure instead of creating a duplicate member. Already folded into §3.1 step 2. Client-side, disable a row's checkbox immediately after it's submitted (same `isSubmitting` pattern the modal already uses for invites/accounts) so double-clicking isn't the common case in the first place.

### 7.3 Partial-failure cleanup

If `promotePendingMemberCore` throws partway through (it does several sequential `await`s after creating the `members` row, before finally deleting the `pending_auth_members` doc near the end), that uid would be left with a live `members` row **and** a lingering `pending_auth_members` doc. `GET /migratable` already excludes anyone in `pending_auth_members`, so that uid would silently vanish from the list — not broken, but stuck and non-obvious.

**Fix:** wrap the promote call in try/catch; on failure, best-effort delete the `pending_auth_members/{uid}` doc before recording the row as failed, so a retry is possible. Already folded into §3.1 step 5. (This latent risk already exists in the original invite flow too — not something Migrate introduces, just something worth not making worse.)

### 7.4 Candidate pool size — resolved

The Firebase Admin SDK has **no filtered or prefix search** on `listUsers` — only raw pagination (1000/page) plus exact lookups (`getUser`, `getUserByEmail`, `getUserByPhoneNumber`). That matters at scale, since "browse + client-side filter" stops being a realistic way to find one person once the unmigrated pool gets into the hundreds/thousands.

**Confirmed: ~40 total users today.** Browse-first with exact-lookup-as-fallback (the original design) is the right call at this size. No UI redesign needed. Revisit only if that number grows substantially.

### 7.5 Permission guard mismatch — `requireManagementRole` includes Manager, the original ask didn't

Checked [`auth-context.js:42`](Dashboard-Backend/src/http/auth-context.js:42):

```js
export function isManagementRole(roleName) {
  ...
  return ["owner", "superadmin", "admin", "supermanager", "supermanger", "manager"].includes(key);
}
```

`requireManagementRole` — what §3.1 originally assumed meant "Owner/Admin/Super Admin only" — actually also passes for **Manager** and **Super Manager**. That's correct for the ordinary member-management actions it already gates (batch remove, bans, etc.), but this feature was scoped from the start as "the owner, or admin, super admin" wants to migrate people — Manager was never part of that. These two endpoints are also more sensitive than typical member actions: `GET /migratable` returns email/displayName/phone for **every unlinked user in the shared Firebase Auth project**, including mobile-app users who may have nothing to do with a given Manager's team.

**Decided: exclude Manager/Super Manager.** Not their role. Both new endpoints use a narrower inline check scoped just to Migrate — `["owner", "superadmin", "admin"].includes(normalizeRoleKey(actorRoleName))` — leaving the shared `isManagementRole`/`requireManagementRole` helpers untouched for everything else that correctly relies on including Manager.

### 7.6 Routing and file-placement conventions, confirmed

[`handle-request.js`](Dashboard-Backend/src/app/handle-request.js:9) shows the members module splits into focused route files per feature — `member-bans.routes.js`, `member-remove-from-tree.routes.js`, `member-invites.routes.js` — each exporting one `routeXxx(req, res, ...)` handler, wired individually into the top-level dispatcher. Migrate should follow the same shape: a new `member-migration.routes.js` exporting `routeMemberMigration`, imported into `handle-request.js` next to the others — not folded into the already-large `member-invites.routes.js` (it just needs to `import { promotePendingMemberCore } from "./member-invites.routes.js"`, which is already exported).

Frontend-side, [`member-api.ts`](Dashboard-Web/features/members/api/member-api.ts) is the single file holding all member-related API calls (`validateEmailsForAddMembers`, `resolveInviteUrl`, etc.) using a shared `apiFetch`/`apiPath`/`ApiEnvelope` convention. The two new calls (`fetchMigratableUsers`, `migrateAuthUsers`) belong there, following that same pattern, not a new file.

## 8. Status log

- 2026-07-28 — Initial draft written after discussing the idea; nothing implemented yet.
- 2026-07-28 — Revised design after reading `promotePendingMemberCore` / `complete-first-login.js`: Migrate reuses the existing pre-provision pipeline (write `pending_auth_members` + promote immediately) instead of modifying `ensure-member-from-auth.js`. Resolved 4 of 5 original open questions by tracing existing guards (ban check, disabled-account filter, role ceiling, batch endpoint, dangling-index non-issue).
- 2026-07-28 — Both remaining product questions answered: hide disabled accounts, migration is purely additive (deliberate selective onboarding of mobile-app agents into Virtual Tracker, not a full sync). Plan finalized, no open items left.
- 2026-07-28 — Re-review pass (§7): caught that relabeling `created_by` would silently break the existing first-login notification feature ([first-login-notify.js](Dashboard-Backend/src/modules/notifications/first-login-notify.js)) — kept it untouched, added separate `migrated_from_auth` fields instead. Added a concurrency guard (prevent duplicate `members` rows for one uid), partial-failure cleanup on promote, and phone-number lookup.
- 2026-07-28 — Pool size confirmed at ~40 (resolved). Second re-review pass caught a permission-guard mismatch: the natural-fit `requireManagementRole` guard includes Manager/Super Manager, but the feature was scoped as Owner/Admin/Super Admin only — recommending a narrower dedicated check instead. Also confirmed the file/routing conventions to follow (`member-migration.routes.js`, wired into `handle-request.js`; new API calls added to existing `member-api.ts`).
- 2026-07-28 — Confirmed: Manager/Super Manager excluded from Migrate ("not their role"). Both new endpoints use a narrow Owner/Super Admin/Admin-only check, not the shared `requireManagementRole`. Plan finalized, no open items left.
