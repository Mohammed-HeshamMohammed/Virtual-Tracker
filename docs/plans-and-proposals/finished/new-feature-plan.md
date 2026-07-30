# Feature Plan: Migrate Existing Firebase Auth Users into Virtual Tracker

Status: **Implemented — pending manual runtime QA (§7.9)**
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
- Auth-gated: **not** the shared `requireManagementRole` — see §6.5, use a narrower Owner/Super Admin/Admin-only check instead.
- Calls `authAdmin.listUsers(1000, pageToken)`.
- Filters out any uid that already has a `members` doc (`firebase_uid == uid`), is in `member_auth_index`, or is in `pending_auth_members`.
- **Also filters out `user.disabled === true`** — a disabled Firebase account can't sign in, so promoting it is a no-op at best and could mask a ban-elsewhere situation at worst (see Edge Cases).
- Returns `{ users: [{ uid, email, displayName, phoneNumber, creationTime }], nextPageToken }`.
- Also accepts `?email=` or `?phone=` for exact-match lookup via `authAdmin.getUserByEmail(email)` / `getUserByPhoneNumber(phone)` — worth having both, since a mobile app skews toward phone-auth signups more than a web dashboard does. At ~40 total users (confirmed, §6.4) this is a nice-to-have, not load-bearing — browse-first is fine.

**POST `/api/members/migrate`**
- Body: `{ uids: string[], role: MemberRole }` — **batch from day one** (see resolved Q1 below).
- Auth-gated: same narrower check as above (§6.5) + `validateRoleAssignment(db, actorRoleName, { roleName })` (existing guard — blocks assigning Owner, blocks assigning above the actor's own rank). Checked once for the whole batch since all uids in one call share one role.
- Per uid (loop, partial-failure tolerant — mirrors [`batchRemoveMembersFromTree`](Dashboard-Backend/src/modules/members/services/member-remove-from-tree-service.js:133): cap at 100 uids, collect a result row per item instead of failing the whole batch):
  1. `userRecord = await auth.getUser(uid)` — re-validates the uid is still real and grabs current email/displayName.
  2. **Already-migrated guard** — `db.collection("members").where("firebase_uid","==",uid).limit(1).get()`; if found, return `{ uid, success: false, error: "already migrated" }` for this row instead of proceeding. Prevents a double-click or stale-list race from minting two `members` rows for one Firebase identity (see §6.2).
  3. **Ban check** — `assertMemberNotBanned(db, { email, firebaseUid: uid })` (existing helper, [member-ban-service.js:45](Dashboard-Backend/src/modules/members/services/member-ban-service.js:45)). A user could be banned by email/IP without ever having had a `members` row here; block the migration with the existing ban message instead of silently creating a fresh, unbanned member row for them.
  4. Write `pending_auth_members/{uid}` with `role_id` (resolved via `resolveRoleIdByName`), `created_by_uid: actorUid`, `created_at`. No `must_change_password`/`first_login` flags — those exist to force a password reset for *new* credentials; a migrated user's existing password is untouched.
  5. `await promotePendingMemberCore(db, auth, uid)`, wrapped in try/catch — on failure, best-effort delete `pending_auth_members/{uid}` before recording the row as failed, so the uid isn't stuck invisible to future `GET /migratable` calls (see §6.3).
  6. On success, merge-patch the new `members` doc with `{ migrated_from_auth: true, migrated_at: <now>, migrated_by: actorMemberId }` — additive provenance fields only. **Do not touch `created_by`** (see §6.1 for why).
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

Pool size confirmed at ~40 total users (§6.4) — resolved, no design change needed. Permission guard decided — see §6.5.

## 6. Further improvements found on re-review

### 6.1 Don't relabel `created_by` — it's a functional gate, not just an audit field

`promotePendingMemberCore` hardcodes `created_by: "invite-preprovision"` on the new `members` row. My first instinct was to give Migrate its own label (e.g. `"migrated-from-auth"`) for cleaner audit trail. **That would silently break a real feature.**

[`first-login-notify.js:8`](Dashboard-Backend/src/modules/notifications/first-login-notify.js:8) — `isTeamAddedMember()` checks `created_by` against exactly `["invite-preprovision", "self-invite"]` to decide whether to notify the adder/upline when this person's first real login happens. That check runs from [`session-bootstrap.js:119`](Dashboard-Backend/src/modules/auth/session-bootstrap.js:119) — i.e. on the migrated user's *next actual login to Virtual Tracker*, not at migration time. Keeping `created_by: "invite-preprovision"` as-is means the admin who migrated someone automatically gets a "New member joined — completed their first sign-in" notification the first time that person actually opens Virtual Tracker. That's exactly the right behavior for Migrate too, for free, as long as we don't touch the field.

**Fix:** leave `created_by` alone. For provenance/reporting, add new, additive fields after promotion instead: `migrated_from_auth: true`, `migrated_at`, `migrated_by`. Already folded into §3.1 step 6.

### 6.2 Concurrency: prevent one Firebase uid from getting two `members` rows

`promotePendingMemberCore` never checks whether a `members` row already exists for a uid before minting a new `memberId` — it just creates one. In the *organic* flow this is safe because a given uid's promotion is only ever triggered once, by that person's own first-login request. Migrate changes that assumption: an admin batch-selecting from a list is far more likely to double-click, or to act on a list fetched a minute ago where someone else already migrated the same uid in the meantime.

**Fix:** added an explicit "already migrated" check (query `members` by `firebase_uid`) as its own step before writing the pending doc, so a repeat attempt reports a clean per-row failure instead of creating a duplicate member. Already folded into §3.1 step 2. Client-side, disable a row's checkbox immediately after it's submitted (same `isSubmitting` pattern the modal already uses for invites/accounts) so double-clicking isn't the common case in the first place.

### 6.3 Partial-failure cleanup

If `promotePendingMemberCore` throws partway through (it does several sequential `await`s after creating the `members` row, before finally deleting the `pending_auth_members` doc near the end), that uid would be left with a live `members` row **and** a lingering `pending_auth_members` doc. `GET /migratable` already excludes anyone in `pending_auth_members`, so that uid would silently vanish from the list — not broken, but stuck and non-obvious.

**Fix:** wrap the promote call in try/catch; on failure, best-effort delete the `pending_auth_members/{uid}` doc before recording the row as failed, so a retry is possible. Already folded into §3.1 step 5. (This latent risk already exists in the original invite flow too — not something Migrate introduces, just something worth not making worse.)

### 6.4 Candidate pool size — resolved

The Firebase Admin SDK has **no filtered or prefix search** on `listUsers` — only raw pagination (1000/page) plus exact lookups (`getUser`, `getUserByEmail`, `getUserByPhoneNumber`). That matters at scale, since "browse + client-side filter" stops being a realistic way to find one person once the unmigrated pool gets into the hundreds/thousands.

**Confirmed: ~40 total users today.** Browse-first with exact-lookup-as-fallback (the original design) is the right call at this size. No UI redesign needed. Revisit only if that number grows substantially.

### 6.5 Permission guard mismatch — `requireManagementRole` includes Manager, the original ask didn't

Checked [`auth-context.js:42`](Dashboard-Backend/src/http/auth-context.js:42):

```js
export function isManagementRole(roleName) {
  ...
  return ["owner", "superadmin", "admin", "supermanager", "supermanger", "manager"].includes(key);
}
```

`requireManagementRole` — what §3.1 originally assumed meant "Owner/Admin/Super Admin only" — actually also passes for **Manager** and **Super Manager**. That's correct for the ordinary member-management actions it already gates (batch remove, bans, etc.), but this feature was scoped from the start as "the owner, or admin, super admin" wants to migrate people — Manager was never part of that. These two endpoints are also more sensitive than typical member actions: `GET /migratable` returns email/displayName/phone for **every unlinked user in the shared Firebase Auth project**, including mobile-app users who may have nothing to do with a given Manager's team.

**Decided: exclude Manager/Super Manager.** Not their role. Both new endpoints use a narrower inline check scoped just to Migrate — `["owner", "superadmin", "admin"].includes(normalizeRoleKey(actorRoleName))` — leaving the shared `isManagementRole`/`requireManagementRole` helpers untouched for everything else that correctly relies on including Manager.

### 6.6 Routing and file-placement conventions, confirmed

[`handle-request.js`](Dashboard-Backend/src/app/handle-request.js:9) shows the members module splits into focused route files per feature — `member-bans.routes.js`, `member-remove-from-tree.routes.js`, `member-invites.routes.js` — each exporting one `routeXxx(req, res, ...)` handler, wired individually into the top-level dispatcher. Migrate should follow the same shape: a new `member-migration.routes.js` exporting `routeMemberMigration`, imported into `handle-request.js` next to the others — not folded into the already-large `member-invites.routes.js` (it just needs to `import { promotePendingMemberCore } from "./member-invites.routes.js"`, which is already exported).

Frontend-side, [`member-api.ts`](Dashboard-Web/features/members/api/member-api.ts) is the single file holding all member-related API calls (`validateEmailsForAddMembers`, `resolveInviteUrl`, etc.) using a shared `apiFetch`/`apiPath`/`ApiEnvelope` convention. The two new calls (`fetchMigratableUsers`, `migrateAuthUsers`) belong there, following that same pattern, not a new file.

## 7. Full implementation spec (code-level)

Everything below was checked against the actual source in this repo (exact function signatures, import paths, response envelopes, styling conventions) so it can be implemented directly, file by file, without re-deriving patterns.

### 7.0 File change list

| File | Action |
|---|---|
| `Dashboard-Backend/src/http/member-migration-policy.js` | **New** — role gate (Owner/Super Admin/Admin only) |
| `Dashboard-Backend/src/modules/members/routes/member-migration.routes.js` | **New** — the two endpoints |
| `Dashboard-Backend/src/app/handle-request.js` | **Modify** — import + wire the new route |
| `Dashboard-Web/features/members/models/member.ts` | **Modify** — add `MigratableAuthUser`, `MigrateResultRow` types; extend `AddMembersSubmission`/`AddMembersResult` unions |
| `Dashboard-Web/features/members/api/member-api.ts` | **Modify** — add `fetchMigratableUsers`, `migrateAuthUsers` |
| `Dashboard-Web/features/members/components/modals/add-members/migrate-form.tsx` | **New** — tab UI |
| `Dashboard-Web/features/members/components/modals/add-members/index.tsx` | **Modify** — third tab, state, submit branch, message formatting |
| `Dashboard-Web/features/members/hooks/use-member-mutations.ts` | **Modify** — `handleAddMembers` gets a `mode === "migrate"` branch |

No changes to `members-page.tsx` — it already calls `handleAddMembers` generically and formats results via `formatAddMembersSuccess`/`formatAddMembersPending`, both of which live in `index.tsx` and get updated there.

---

### 7.1 New: `Dashboard-Backend/src/http/member-migration-policy.js`

Mirrors [`member-ban-policy.js`](Dashboard-Backend/src/http/member-ban-policy.js) exactly (same shape, different rank cutoff — no Manager/Super Manager per §6.5).

```js
import { getAuthContext } from "./auth-context.js";
import { sendJson } from "./response.js";
import { normalizeRoleKey } from "../modules/members/services/relation-sync.js";

/** Owner, Super Admin, and Admin may migrate existing Firebase Auth users into Virtual Tracker. */
export function canMigrateMembers(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "owner" || key === "superadmin" || key === "admin";
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @returns {boolean}
 */
export function assertMigrationManagementRole(req, res, origin) {
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return false;
  }
  if (!canMigrateMembers(viewer.roleName)) {
    sendJson(res, origin, 403, { success: false, error: "Only Owner, Super Admin, or Admin can migrate members." });
    return false;
  }
  return true;
}
```

### 7.2 New: `Dashboard-Backend/src/modules/members/routes/member-migration.routes.js`

Mirrors the top-of-function shape of [`routeMemberInvites`](Dashboard-Backend/src/modules/members/routes/member-invites.routes.js:208) (`const db = getDb(); if (!db) return false; const auth = getAuthAdmin();`) and imports `promotePendingMemberCore` from that same file (already exported).

```js
import { getDb, getAuthAdmin } from "../../../config/firebase.js";
import { getAuthContext, requireAuthContext } from "../../../http/auth-context.js";
import { assertMigrationManagementRole } from "../../../http/member-migration-policy.js";
import { readJsonBody } from "../../../http/read-json-body.js";
import { rejectUnknownFields } from "../../../http/validate-body.js";
import { sendJson } from "../../../http/response.js";
import { logSafeError, logSafeWarn } from "../../../http/sanitize-error.js";
import { validateRoleAssignment } from "../../../http/role-assignment-guard.js";
import { resolveRoleIdByName } from "../services/relation-sync.js";
import { assertMemberNotBanned } from "../services/member-ban-service.js";
import { promotePendingMemberCore } from "./member-invites.routes.js";

const PENDING_AUTH = "pending_auth_members";
const MEMBER_AUTH_INDEX = "member_auth_index";
const MAX_MIGRATE_BATCH = 100;
const MIGRATABLE_PAGE_SIZE = 1000;

function normalizePathname(pathname) {
  return pathname.replace(/^\/api\/v1\//, "/api/");
}

/** @param {import("firebase-admin/auth").UserRecord} u */
function toMigratableRow(u) {
  return {
    uid: u.uid,
    email: u.email || "",
    displayName: u.displayName || "",
    phoneNumber: u.phoneNumber || "",
    creationTime: u.metadata?.creationTime || null,
  };
}

/**
 * True if this uid is already a member, already indexed, or already pending —
 * i.e. not a valid Migrate candidate. See §2 / §4 for why this is exhaustive.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} uid
 */
async function isUidAlreadyLinked(db, uid) {
  const [memberSnap, indexSnap, pendingSnap] = await Promise.all([
    db.collection("members").where("firebase_uid", "==", uid).limit(1).get(),
    db.collection(MEMBER_AUTH_INDEX).doc(uid).get(),
    db.collection(PENDING_AUTH).doc(uid).get(),
  ]);
  return !memberSnap.empty || indexSnap.exists || pendingSnap.exists;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeMemberMigration(req, res, url, origin) {
  const db = getDb();
  if (!db) return false;
  const auth = getAuthAdmin();
  const pn = normalizePathname(url.pathname);

  if (pn === "/api/members/migratable" && req.method === "GET") {
    if (!assertMigrationManagementRole(req, res, origin)) return true;
    if (!auth) {
      sendJson(res, origin, 503, { success: false, error: "Authentication service is not configured." });
      return true;
    }

    const email = (url.searchParams.get("email") || "").trim().toLowerCase();
    const phone = (url.searchParams.get("phone") || "").trim();

    try {
      if (email || phone) {
        const u = email
          ? await auth.getUserByEmail(email).catch(() => null)
          : await auth.getUserByPhoneNumber(phone).catch(() => null);
        if (!u || u.disabled || (await isUidAlreadyLinked(db, u.uid))) {
          sendJson(res, origin, 200, { success: true, users: [], nextPageToken: null });
          return true;
        }
        sendJson(res, origin, 200, { success: true, users: [toMigratableRow(u)], nextPageToken: null });
        return true;
      }

      const pageToken = url.searchParams.get("pageToken") || undefined;
      const page = await auth.listUsers(MIGRATABLE_PAGE_SIZE, pageToken);
      const candidates = page.users.filter((u) => !u.disabled);
      const linkedFlags = await Promise.all(candidates.map((u) => isUidAlreadyLinked(db, u.uid)));
      const users = candidates.filter((_, i) => !linkedFlags[i]).map(toMigratableRow);

      sendJson(res, origin, 200, { success: true, users, nextPageToken: page.pageToken || null });
    } catch (e) {
      logSafeError("[members/migratable]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load migratable users." });
    }
    return true;
  }

  if (pn === "/api/members/migrate" && req.method === "POST") {
    if (!assertMigrationManagementRole(req, res, origin)) return true;
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!auth) {
      sendJson(res, origin, 503, { success: false, error: "Authentication service is not configured." });
      return true;
    }

    let body;
    try {
      body = await readJsonBody(req);
      rejectUnknownFields(body, ["uids", "role"]);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }

    const uids = Array.isArray(body.uids)
      ? [...new Set(body.uids.filter((u) => typeof u === "string" && u.trim()))].slice(0, MAX_MIGRATE_BATCH)
      : [];
    const roleName = typeof body.role === "string" ? body.role.trim() : "";
    if (uids.length === 0) {
      sendJson(res, origin, 400, { success: false, error: "uids must be a non-empty array." });
      return true;
    }
    if (!roleName) {
      sendJson(res, origin, 400, { success: false, error: "role is required." });
      return true;
    }

    const roleErr = await validateRoleAssignment(db, viewer.roleName, { roleName });
    if (roleErr) {
      sendJson(res, origin, 403, { success: false, error: roleErr });
      return true;
    }

    const role_id = await resolveRoleIdByName(db, roleName);
    const results = [];

    for (const uid of uids) {
      try {
        const userRecord = await auth.getUser(uid);

        if (await isUidAlreadyLinked(db, uid)) {
          results.push({ uid, success: false, error: "Already migrated or pending." });
          continue;
        }

        const email = (userRecord.email || "").trim().toLowerCase();
        const banCheck = await assertMemberNotBanned(db, { email, firebaseUid: uid });
        if (!banCheck.ok) {
          results.push({ uid, success: false, error: banCheck.error });
          continue;
        }

        await db.collection(PENDING_AUTH).doc(uid).set({
          email,
          display_name: userRecord.displayName || "",
          role_id,
          pay_rate: 0,
          created_by_uid: viewer.uid,
          created_at: new Date(),
        });

        try {
          const promoted = await promotePendingMemberCore(db, auth, uid);
          if (promoted.memberId) {
            await db.collection("members").doc(promoted.memberId).set(
              { migrated_from_auth: true, migrated_at: new Date(), migrated_by: viewer.memberId },
              { merge: true },
            );
          }
          results.push({ uid, success: true, memberId: promoted.memberId ?? undefined });
        } catch (promoteErr) {
          await db.collection(PENDING_AUTH).doc(uid).delete().catch(() => {});
          throw promoteErr;
        }
      } catch (e) {
        logSafeWarn("[members/migrate] failed for uid", uid, e);
        results.push({ uid, success: false, error: e instanceof Error ? e.message : "Migration failed." });
      }
    }

    sendJson(res, origin, 200, { success: true, results });
    return true;
  }

  return false;
}
```

Notes on this file:
- `isUidAlreadyLinked` does 3 Firestore reads per candidate on the listing endpoint. At ~40 total users (§6.4) that's nothing; if the pool ever grows into the thousands, batch these checks instead of `Promise.all`-ing per page. Not needed now.
- `getAuthContext(req)` import is present but currently unused directly (we use `requireAuthContext`) — drop it if the linter flags unused imports, or use `getAuthContext(req)` in place of `requireAuthContext` if this codebase's lint config disallows unused named imports across such helper files. Double-check against `member-invites.routes.js`'s actual usage of both when implementing (it imports and uses both in different branches).
- `role.status`/`e.status` isn't used here because nothing in this handler throws a status-carrying error the way `banMember`/`removeMemberFromTree` do — every failure is caught per-uid and turned into a result row instead of an HTTP error, which is intentional (a partial batch failure shouldn't 500 the whole request).

### 7.3 Modify: `Dashboard-Backend/src/app/handle-request.js`

Add the import next to the other member route imports:

```js
import { routeMemberInvites } from "../modules/members/routes/member-invites.routes.js";
import { routeMemberMigration } from "../modules/members/routes/member-migration.routes.js";
```

And wire it into the dispatch chain, next to the other member routes (order among these doesn't matter functionally — paths are disjoint):

```js
    if (await routeMemberBans(req, res, url, origin)) return;
    if (await routeMemberRemoveFromTree(req, res, url, origin)) return;
    if (await routeMemberInvites(req, res, url, origin)) return;
    if (await routeMemberMigration(req, res, url, origin)) return;
    if (await routeMemberOnboarding(req, res, url, origin)) return;
```

### 7.4 Modify: `Dashboard-Web/features/members/models/member.ts`

Add near the other `Add Members` types (after `AccountFormFields`, before `AddMembersSubmission`):

```ts
export type MigratableAuthUser = {
  uid: string
  email: string
  displayName: string
  phoneNumber: string
  creationTime: string | null
}

export type MigrateResultRow = { uid: string; success: boolean; memberId?: string; error?: string }
```

Extend the two discriminated unions (add a third member to each):

```ts
export type AddMembersSubmission =
  | {
      mode: "invites"
      rows: InviteFormRow[]
      role: MemberRole
    }
  | {
      mode: "accounts"
      rows: AccountFormRow[]
      role: MemberRole
      sendWelcomeEmail: boolean
    }
  | {
      mode: "migrate"
      uids: string[]
      role: MemberRole
    }

export type AddMembersResult =
  | {
      mode: "invites"
      count: number
      emailsSent: number
      emailsFailed: number
      inviteUrls: string[]
      emailConfigured: boolean
      emailChannel?: string
    }
  | {
      mode: "accounts"
      email: string
      emailSent: boolean
      tempPassword?: string
    }
  | {
      mode: "migrate"
      results: MigrateResultRow[]
    }
```

### 7.5 Modify: `Dashboard-Web/features/members/api/member-api.ts`

Add near [`validateEmailsForAddMembers`](Dashboard-Web/features/members/api/member-api.ts:871), following its exact `apiFetch`/`apiPath` pattern:

```ts
export async function fetchMigratableUsers(
  params: { pageToken?: string; email?: string; phone?: string } = {},
): Promise<{ users: MigratableAuthUser[]; nextPageToken: string | null }> {
  const q = new URLSearchParams()
  if (params.pageToken) q.set("pageToken", params.pageToken)
  if (params.email) q.set("email", params.email)
  if (params.phone) q.set("phone", params.phone)
  const qs = q.toString()
  const res = await apiFetch(apiPath(`/api/members/migratable${qs ? `?${qs}` : ""}`))
  const json = (await res.json()) as {
    success?: boolean
    error?: string
    users?: MigratableAuthUser[]
    nextPageToken?: string | null
  }
  if (!res.ok || json.success !== true) {
    throw new Error(json.error || `Failed to load migratable users: ${res.status}`)
  }
  return { users: Array.isArray(json.users) ? json.users : [], nextPageToken: json.nextPageToken ?? null }
}

export async function migrateAuthUsers(uids: string[], role: MemberRole): Promise<MigrateResultRow[]> {
  const res = await apiFetch(apiPath("/api/members/migrate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uids, role }),
  })
  const json = (await res.json()) as { success?: boolean; error?: string; results?: MigrateResultRow[] }
  if (!res.ok || json.success !== true) {
    throw new Error(json.error || `Migration failed: ${res.status}`)
  }
  return Array.isArray(json.results) ? json.results : []
}
```

Add `MigratableAuthUser, MigrateResultRow` to the existing `import type { Member, Invite, MemberRole, ... }` line at the top of the file.

### 7.6 New: `Dashboard-Web/features/members/components/modals/add-members/migrate-form.tsx`

Mirrors [`invite-form.tsx`](Dashboard-Web/features/members/components/modals/add-members/invite-form.tsx) / [`account-form.tsx`](Dashboard-Web/features/members/components/modals/add-members/account-form.tsx) styling (`inputCls`, `SimpleSelect`, label conventions) but shaped for a checkbox list instead of form rows:

```tsx
"use client"

import { Search, Loader2 } from "lucide-react"
import { SimpleSelect } from "@/shared/ui/simple-select"
import type { MemberRole, MigratableAuthUser } from "@/features/members/models/member"

interface MigrateFormProps {
  users: MigratableAuthUser[]
  selectedUids: Set<string>
  onToggle: (uid: string) => void
  filterText: string
  onFilterChange: (val: string) => void
  role: MemberRole
  roleOptions: MemberRole[]
  onRoleChange: (role: MemberRole) => void
  isLoading: boolean
  hasMore: boolean
  onLoadMore: () => void
}

const inputCls = "w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors"

export function MigrateForm({
  users,
  selectedUids,
  onToggle,
  filterText,
  onFilterChange,
  role,
  roleOptions,
  onRoleChange,
  isLoading,
  hasMore,
  onLoadMore,
}: MigrateFormProps) {
  const filtered = filterText.trim()
    ? users.filter((u) => {
        const needle = filterText.trim().toLowerCase()
        return u.email.toLowerCase().includes(needle) || u.displayName.toLowerCase().includes(needle)
      })
    : users

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        These people already sign in through the mobile app's Firebase Authentication. Select who should also get
        access to Virtual Tracker.
      </p>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={filterText}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter by email or name"
          className={`${inputCls} pl-8`}
        />
      </div>

      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
        {isLoading && users.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">
            {users.length === 0 ? "No unlinked accounts found." : "No matches for this filter."}
          </div>
        ) : (
          filtered.map((u) => (
            <label
              key={u.uid}
              className="flex cursor-pointer items-center gap-2.5 border-b border-slate-100 px-3 py-2 last:border-b-0 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selectedUids.has(u.uid)}
                onChange={() => onToggle(u.uid)}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-slate-700">{u.displayName || u.email || u.uid}</div>
                {u.displayName && u.email ? <div className="truncate text-[11px] text-slate-400">{u.email}</div> : null}
              </div>
            </label>
          ))
        )}
      </div>

      {hasMore && !filterText.trim() && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoading}
          className="text-xs text-blue-500 hover:text-blue-600 font-semibold transition-colors disabled:text-slate-400"
        >
          {isLoading ? "Loading…" : "Load more"}
        </button>
      )}

      <div>
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
          ROLE*
        </label>
        <SimpleSelect
          value={role}
          onChange={(v) => onRoleChange(v as MemberRole)}
          options={roleOptions}
          portalToBody
          menuMaxVisibleItems={4}
        />
      </div>
    </div>
  )
}
```

### 7.7 Modify: `Dashboard-Web/features/members/components/modals/add-members/index.tsx`

Import the new form + API calls, and the two new types:

```tsx
import { MigrateForm } from "@/features/members/components/modals/add-members/migrate-form"
import { fetchMigratableUsers } from "@/features/members/api/member-api"
import type { MigratableAuthUser } from "@/features/members/models/member"
```

Widen the mode type and tab bar array (currently at [index.tsx:110](Dashboard-Web/features/members/components/modals/add-members/index.tsx:110) and [index.tsx:350](Dashboard-Web/features/members/components/modals/add-members/index.tsx:350)):

```tsx
const [mode, setMode] = useComponentState<"invites" | "accounts" | "migrate">("invites")
```

```tsx
{(
  [
    { id: "invites" as const, label: "Send invites" },
    { id: "accounts" as const, label: "Create account" },
    { id: "migrate" as const, label: "Migrate" },
  ] as const
).map((tab) => { /* unchanged */ })}
```

New state, alongside the existing invite/account state (near [index.tsx:113](Dashboard-Web/features/members/components/modals/add-members/index.tsx:113)):

```tsx
const [migratableUsers, setMigratableUsers] = useComponentState<MigratableAuthUser[]>([])
const [migrateNextPageToken, setMigrateNextPageToken] = useComponentState<string | null>(null)
const [migrateSelectedUids, setMigrateSelectedUids] = useComponentState<Set<string>>(new Set())
const [migrateFilterText, setMigrateFilterText] = useComponentState("")
const [migrateRole, setMigrateRole] = useComponentState<MemberRole>(defaultRole)
const [migrateLoading, setMigrateLoading] = useComponentState(false)
const [migrateLoadedOnce, setMigrateLoadedOnce] = useComponentState(false)
```

Lazy-load the first page when the Migrate tab is opened (mirrors the existing `useEffect` that resets role selection at [index.tsx:133](Dashboard-Web/features/members/components/modals/add-members/index.tsx:133)):

```tsx
useEffect(() => {
  if (mode !== "migrate" || migrateLoadedOnce) return
  setMigrateLoadedOnce(true)
  setMigrateLoading(true)
  fetchMigratableUsers()
    .then(({ users, nextPageToken }) => {
      setMigratableUsers(users)
      setMigrateNextPageToken(nextPageToken)
    })
    .catch((e) => {
      setToast({
        title: "Migrate",
        tone: "error",
        message: e instanceof Error ? e.message : "Could not load unlinked accounts.",
      })
    })
    .finally(() => setMigrateLoading(false))
}, [mode, migrateLoadedOnce])

function toggleMigrateUid(uid: string) {
  setMigrateSelectedUids((prev) => {
    const next = new Set(prev)
    if (next.has(uid)) next.delete(uid)
    else next.add(uid)
    return next
  })
}

function loadMoreMigratable() {
  if (!migrateNextPageToken || migrateLoading) return
  setMigrateLoading(true)
  fetchMigratableUsers({ pageToken: migrateNextPageToken })
    .then(({ users, nextPageToken }) => {
      setMigratableUsers((prev) => [...prev, ...users])
      setMigrateNextPageToken(nextPageToken)
    })
    .catch((e) => {
      setToast({
        title: "Migrate",
        tone: "error",
        message: e instanceof Error ? e.message : "Could not load more accounts.",
      })
    })
    .finally(() => setMigrateLoading(false))
}
```

Add a branch in `handleSend` (alongside the existing `if (mode === "invites")` block at [index.tsx:197](Dashboard-Web/features/members/components/modals/add-members/index.tsx:197); this one can go after the invites block and before the accounts code, guarded the same way):

```tsx
if (mode === "migrate") {
  const uids = [...migrateSelectedUids]
  if (uids.length === 0) {
    setToast({ message: "Select at least one account to migrate.", title: "Add members", tone: "error" })
    return
  }
  setIsSubmitting(true)
  const payload: AddMembersSubmission = { mode: "migrate", uids, role: migrateRole }
  onPending?.(payload)
  onClose()
  void onAdd(payload)
    .then((result) => onSuccess?.(result))
    .catch((e) => onError?.(e instanceof Error ? e.message : "Could not migrate members."))
  setIsSubmitting(false)
  return
}
```

Render the tab body (alongside the existing `mode === "invites" ? <InviteForm .../> : <AccountForm .../>` ternary at [index.tsx:407](Dashboard-Web/features/members/components/modals/add-members/index.tsx:407) — convert to a 3-way):

```tsx
{mode === "invites" ? (
  <InviteForm ... />
) : mode === "accounts" ? (
  <AccountForm ... />
) : (
  <MigrateForm
    users={migratableUsers}
    selectedUids={migrateSelectedUids}
    onToggle={toggleMigrateUid}
    filterText={migrateFilterText}
    onFilterChange={setMigrateFilterText}
    role={migrateRole}
    roleOptions={assignableRoles}
    onRoleChange={setMigrateRole}
    isLoading={migrateLoading}
    hasMore={Boolean(migrateNextPageToken)}
    onLoadMore={loadMoreMigratable}
  />
)}
```

Update the submit button label (near [index.tsx:465](Dashboard-Web/features/members/components/modals/add-members/index.tsx:465)):

```tsx
{isSubmitting ? "Checking…" : mode === "invites" ? "Send invites" : mode === "accounts" ? "Create account" : "Migrate"}
```

Also update `formatAddMembersPending` and `formatAddMembersSuccess` (top of the same file, [index.tsx:36](Dashboard-Web/features/members/components/modals/add-members/index.tsx:36) and [index.tsx:51](Dashboard-Web/features/members/components/modals/add-members/index.tsx:51)) to handle `payload.mode === "migrate"` / `result.mode === "migrate"`:

```tsx
export function formatAddMembersPending(payload: AddMembersSubmission): { title: string; message: string } {
  if (payload.mode === "invites") { /* unchanged */ }
  if (payload.mode === "migrate") {
    const count = payload.uids.length
    return { title: "Add members", message: `Migrating ${count} member${count === 1 ? "" : "s"}…` }
  }
  /* existing accounts branch */
}

export function formatAddMembersSuccess(result: AddMembersResult): { message: string; tone: NotifyAlertTone } {
  if (result.mode === "invites") { /* unchanged */ }
  if (result.mode === "migrate") {
    const succeeded = result.results.filter((r) => r.success).length
    const failed = result.results.length - succeeded
    if (failed === 0) {
      return { tone: "info", message: `${succeeded} member${succeeded === 1 ? "" : "s"} migrated successfully.` }
    }
    const failedList = result.results.filter((r) => !r.success).map((r) => `${r.uid}: ${r.error}`).join("\n")
    return {
      tone: "info",
      message: `${succeeded} migrated, ${failed} failed.\n\n${failedList}`,
    }
  }
  /* existing accounts branch */
}
```

### 7.8 Modify: `Dashboard-Web/features/members/hooks/use-member-mutations.ts`

Add the `migrate` branch to [`handleAddMembers`](Dashboard-Web/features/members/hooks/use-member-mutations.ts:80), right after the `mode === "invites"` block and before the accounts code (which currently assumes it's the only remaining branch — needs an explicit `if (payload.mode === "accounts")` guard once a third mode exists):

```ts
import { fetchMigratableUsers, migrateAuthUsers } from "@/features/members/api/member-api"
// (or add to the existing "@/infrastructure/api" barrel import if migrateAuthUsers is re-exported there — check how
// validateEmailsForAddMembers is imported elsewhere; member-api.ts functions are sometimes re-exported through
// "@/infrastructure/api". Confirm the barrel file before assuming a direct import path.)
```

```ts
if (payload.mode === "migrate") {
  const results = await migrateAuthUsers(payload.uids, payload.role)
  const refreshed = await refreshMembersFromApi()
  setMembers(refreshed)
  return { mode: "migrate", results }
}

if (payload.mode === "accounts") {
  // existing body, unchanged — just gate it behind this explicit check now that there are 3 modes
}
```

**Before implementing this file**, grep for how `Dashboard-Web/infrastructure/api/index.ts` re-exports from `member-api.ts` (the file imports several functions like `preprovisionMember`, `getInvites` from `"@/infrastructure/api"`, not directly from `member-api.ts`) — the two new functions likely need to be added to that barrel export too, following whatever pattern the existing ones use.

---

### 7.9 Build & verification order

1. **Backend first, testable standalone via curl/Postman** before touching the frontend:
   - `GET /api/members/migratable` — confirm it returns the ~40 mobile users, none of which already appear in this app's Members table.
   - `POST /api/members/migrate` with one real uid + `role: "Viewer"` — confirm a new `members` row appears with `firebase_uid` set, `migrated_from_auth: true`, and the chosen role.
   - Re-run the same POST for the same uid — confirm it comes back `{ success: false, error: "Already migrated or pending." }` instead of creating a duplicate (§6.2 guard).
   - Have that migrated user actually log into Virtual Tracker once, confirm the existing "New member joined" notification fires for whoever migrated them (§6.1) — this is the regression check that matters most, since it's easy to break silently.
   - Try migrating as a Manager-role test account — confirm 403 (§6.5 guard).
   - Try assigning a role above the actor's own rank, and `"Owner"` — confirm both rejected by `validateRoleAssignment` (existing guard, no new code, just confirming it's actually wired through).
2. **Then the frontend tab** — open Add members → Migrate, confirm the list loads, checkboxes/role picker/submit work, and the toast shows per-row success/failure.
3. **Manual regression pass on the other two tabs** (Send invites, Create account) — confirms the `index.tsx` 3-way branching didn't break the existing two modes.

## 8. Status log

- 2026-07-28 — Initial draft written after discussing the idea; nothing implemented yet.
- 2026-07-28 — Revised design after reading `promotePendingMemberCore` / `complete-first-login.js`: Migrate reuses the existing pre-provision pipeline (write `pending_auth_members` + promote immediately) instead of modifying `ensure-member-from-auth.js`. Resolved 4 of 5 original open questions by tracing existing guards (ban check, disabled-account filter, role ceiling, batch endpoint, dangling-index non-issue).
- 2026-07-28 — Both remaining product questions answered: hide disabled accounts, migration is purely additive (deliberate selective onboarding of mobile-app agents into Virtual Tracker, not a full sync). Plan finalized, no open items left.
- 2026-07-28 — Re-review pass (§6): caught that relabeling `created_by` would silently break the existing first-login notification feature ([first-login-notify.js](Dashboard-Backend/src/modules/notifications/first-login-notify.js)) — kept it untouched, added separate `migrated_from_auth` fields instead. Added a concurrency guard (prevent duplicate `members` rows for one uid), partial-failure cleanup on promote, and phone-number lookup.
- 2026-07-28 — Pool size confirmed at ~40 (resolved). Second re-review pass caught a permission-guard mismatch: the natural-fit `requireManagementRole` guard includes Manager/Super Manager, but the feature was scoped as Owner/Admin/Super Admin only — recommending a narrower dedicated check instead. Also confirmed the file/routing conventions to follow (`member-migration.routes.js`, wired into `handle-request.js`; new API calls added to existing `member-api.ts`).
- 2026-07-28 — Confirmed: Manager/Super Manager excluded from Migrate ("not their role"). Both new endpoints use a narrow Owner/Super Admin/Admin-only check, not the shared `requireManagementRole`. Plan finalized, no open items left.
- 2026-07-28 — Added §7: full code-level implementation spec — exact new/modified files, complete source for both new backend files, exact diffs for `handle-request.js`/`member.ts`/`member-api.ts`/`use-member-mutations.ts`, full new `migrate-form.tsx` component, and the specific edits needed in `add-members/index.tsx` (state, tab wiring, submit branch, message formatting), all checked against actual conventions already in the codebase (route-file shape, auth-context helpers, response envelopes, Tailwind class patterns). Includes a build-and-verify order (backend via curl first, then frontend, then regression-check the two existing tabs). Ready to implement directly from this document.
- 2026-07-28 — **Implemented per §7.** All 8 files done: new `member-migration-policy.js` and `member-migration.routes.js` (backend), wired into `handle-request.js`; `member.ts`/`member-api.ts` extended; new `migrate-form.tsx`; `add-members/index.tsx` and `use-member-mutations.ts` updated with the third tab end-to-end. Confirmed `@/infrastructure/api` re-exports `member-api.ts` via wildcard, so no barrel-file edit was needed (resolves the open question noted in §7.8). Verified: backend files pass `node --check` and the repo's `lint:config` mobile-collections check; frontend passes a full `tsc --noEmit` with zero errors. **Not yet done:** the manual runtime QA pass from §7.9 (live curl against `/api/members/migratable` and `/api/members/migrate`, confirming the first-login notification still fires post-migration, opening the modal in a browser) — needs a running backend + Firebase credentials, which this session didn't have.
