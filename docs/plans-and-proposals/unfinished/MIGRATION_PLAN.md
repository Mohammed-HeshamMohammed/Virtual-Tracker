# Mobile-app user migration — plan

Status: **Phases 1–3 implemented** (style/avatar fix, Firestore `users` join + eligibility gate,
role auto-mapping with no manual role dropdown). Phase 4 (Clients page) intentionally left as-is —
see §3 Phase 4, nothing to build there. File references below are relative to `Dashboard-Web/`
and `Dashboard-Backend/` unless noted.

## 0. Answered while researching this

**Are the People > Members filters (Role + Projects) working correctly?** Yes, both of them.
Traced end-to-end:
- [features/members/pages/members-page.tsx:413-416](Dashboard-Web/features/members/pages/members-page.tsx#L413) —
  `filteredMembers` runs every member through `memberMatchesFilters`, and it's `filteredMembers`
  (not the raw list) that gets rendered and counted.
- Selecting a project filter changes `memberFilters` → changes the resolved API `fields` list
  ([resolve-members-list-fields.ts](Dashboard-Web/features/members/utils/resolve-members-list-fields.ts#L59)
  adds `project_ids` only once a project filter is active) → changes `fieldSignature` → triggers a
  real refetch in [use-members-list-data.ts:178-189](Dashboard-Web/features/members/hooks/use-members-list-data.ts#L178),
  so `member.projectIds` is actually populated by the time filtering runs.
- No dead wiring found. This one's solid, no work needed.

## 1. What's being fixed / built

1. **Migrate tab row styling** — bring `migrate-form.tsx` rows in line with the rest of the app
   (currently a bare checkbox+label list, not the row style used everywhere else).
2. **Show real avatars** in the Migrate tab when the mobile-app user has one.
3. **Tighten migration eligibility** — cross-check against the Firestore `users` collection (the
   one visible in your screenshot: `avatarUrl`, `country`, `displayName`, `email`, `isActive`,
   `phone`, `referralCode`, `referredBy`, `role`, `fcmTokens`). Only people who actually have a
   profile doc there (i.e. have really signed into the mobile app) should be migration candidates.
4. **Role auto-mapping** from the Firestore `role` field: `agent` → Employee L1, `super manager`
   → Super Manager, `client` → Client (exact value list needs a quick confirm — see Open
   Questions).
5. **Client migration on the Clients page** — surface the same capability there.

## 2. Current state (what exists today)

### Migrate tab data flow
- Frontend: [migrate-form.tsx](Dashboard-Web/features/members/components/modals/add-members/migrate-form.tsx) renders the list; state is owned by [add-members/index.tsx](Dashboard-Web/features/members/components/modals/add-members/index.tsx#L159-L231).
- Fetch: `fetchMigratableUsers()` → `GET /api/members/migratable` → [member-migration.routes.js](Dashboard-Backend/src/modules/members/routes/member-migration.routes.js#L61-L96).
- **Backend today only reads Firebase Auth** (`auth.listUsers()`), then excludes anyone already
  linked (`members`, `member_auth_index`, `pending_auth_members`). It never touches the Firestore
  `users` collection, so it has no `avatarUrl` and no `role` — that's why the modal can't show a
  photo or suggest a role right now. Model: [`MigratableAuthUser`](Dashboard-Web/features/members/models/member.ts#L97-L103) — `uid, email, displayName, phoneNumber, creationTime` only.
- Submit: one role for the **entire batch** — `migrateAuthUsers(uids, role)` → `POST /api/members/migrate`
  ([member-migration.routes.js:98-184](Dashboard-Backend/src/modules/members/routes/member-migration.routes.js#L98)).
  This is the part that has to change to support per-person auto-suggested roles (see §4.2).
- `getDb()` in that same backend file is the **same Firebase project** your screenshot is from —
  no new credentials/config needed to read `users`.

### Avatar component already exists — just isn't used here
[shared/ui/avatar.tsx](Dashboard-Web/shared/ui/avatar.tsx) already does exactly what's needed:
takes `imageUrl` + `initials` + `color`, renders the real photo via `UserAvatarImage` with
automatic fallback to initials. It's already used in the main Members table
([members-tab.tsx:401](Dashboard-Web/features/members/components/tables/members-tab.tsx#L401)).
Migrate tab should use the same component — that's most of the styling fix.

### Clients page already has an equivalent flow — for a different trigger
[features/clients/utils/unlinked-client-members.ts](Dashboard-Web/features/clients/utils/unlinked-client-members.ts)
+ [pending-client-members-banner.tsx](Dashboard-Web/features/clients/components/pending-client-members-banner.tsx)
+ [unlinked-client-members-modal.tsx](Dashboard-Web/features/clients/components/modals/unlinked-client-members-modal.tsx),
wired into [clients-page.tsx](Dashboard-Web/features/clients/pages/clients-page.tsx#L27-L29,#L147,#L277,#L348).

This already does: "any Member whose role is Client but isn't in the `clients` table yet → show
a banner → let you add them as a Client with one click." It's driven purely by `Member.role`.

**Implication:** once migration correctly sets `role = "Client"` for Firestore users whose mobile
role maps to Client, they will **automatically** appear in this existing Clients-page banner —
no new UI needs to be built there. This is the cheap, consistent way to satisfy "add client
migration to the clients page."

## 3. Proposed work, in phases

### Phase 1 — Style + avatar fix — ✅ done
- `migrate-form.tsx` rows now use the shared `Avatar` component (`imageUrl` from the Firestore
  join in Phase 2, falls back to initials via `initialsFromName`/`memberAvatarColor` from
  `build-tree.ts`) with the same row treatment (hover/selected state, name+email stack) used
  elsewhere in Members.

### Phase 2 — Backend: join Firestore `users` into `/api/members/migratable` — ✅ done
- `member-migration.routes.js` now batch-reads `users/{uid}` docs (`FieldPath.documentId()` `in`
  queries, chunked to 30 per Firestore's limit) for every unlinked Auth-user candidate.
- **Eligibility gate applied**: a candidate is only returned if a `users/{uid}` doc exists AND
  `isActive !== false`. No profile doc (or `isActive: false`) = excluded.
- `toMigratableRow` now includes `avatarUrl` and `suggestedRole` (already mapped — see Phase 3)
  when available.
- `MigratableAuthUser` ([member.ts](Dashboard-Web/features/members/models/member.ts#L97)) extended
  with `avatarUrl?: string` and `suggestedRole?: MemberRole`.

### Phase 3 — Role auto-mapping — ✅ done, no manual dropdown
- Mapping lives in the backend (`MOBILE_ROLE_MAP` in `member-migration.routes.js` — single source
  of truth, computed once per candidate, sent to the frontend as `suggestedRole`):
  ```
  agent            → Employee L1
  candidate        → Employee L0
  manager          → Manager
  supermanager     → Super Manager     (also matches "super manager" / "super_manager" — spaces/underscores are stripped before lookup)
  client           → Client
  <anything else / missing> → no suggestion; frontend falls back to the viewer's lowest assignable role
  ```
- **Batch submit shape changed** (option (a) from the original plan): `POST /api/members/migrate`
  now takes `{ migrations: [{ uid, role }, ...] }` instead of `{ uids, role }`. Each migration
  entry gets its own `role_id`; `validateRoleAssignment` runs once per *unique* role in the batch
  (not per uid) before anything is written, so a batch with one invalid role is rejected wholesale
  — no partial-invalid-role writes.
- Per user instruction: **the shared "ROLE*" dropdown is gone.** Each row instead shows a small
  read-only role badge (the resolved role — suggested-and-clamped-to-what-the-viewer-may-assign,
  via `resolveMigrateRole` in `add-members/index.tsx`). No per-row override control was added
  either, matching "no need for the dropdown" — if a future need for manual override comes up,
  that's a separate, explicit ask.

### Phase 4 — Clients page
- No new backend/data work required if Phase 3's mapping sets `Member.role = "Client"` correctly
  — the existing banner/modal on `clients-page.tsx` will pick it up automatically.
- Optional convenience: add a small "Migrate from mobile app" button in the Clients page toolbar
  that just navigates to People > Members and opens `AddMembersModal` pre-set to
  `mode: "migrate"` (the modal already supports a `mode` tab, so this is a prop/entry-point
  addition, not new modal logic).

## 4. Open questions still outstanding

1. **Exact Firestore `role` values.** Mapped so far: `client`, `agent`, `candidate`, `manager`,
   `super manager`/`supermanager`/`super_manager`. The normalizer lowercases and strips
   spaces/underscores, so casing/separator variants of these five are covered — but there could be
   other role values in the collection we haven't seen yet; anything unmapped just gets no
   suggestion (falls back to the viewer's lowest assignable role) rather than erroring, so it's
   safe either way. Worth a one-off distinct-values query against `users` when convenient to check
   for stragglers, not blocking.
2. **`isActive` gate** — implemented as: `isActive === false` excludes; missing field or `true`
   is treated as eligible. Flag if you actually want the opposite (missing field = excluded).
3. **Clients toolbar shortcut** — not built. §Phase 4 below explains why it isn't needed for the
   core ask; say the word if you still want the direct button.

## 5. File checklist

- [x] `Dashboard-Web/features/members/models/member.ts` — extended `MigratableAuthUser`,
      changed `AddMembersSubmission["migrate"]` to `{ migrations: [{uid, role}] }`
- [x] `Dashboard-Web/features/members/components/modals/add-members/migrate-form.tsx` — row
      styling + `Avatar` + read-only role badge, dropdown removed
- [x] `Dashboard-Web/features/members/components/modals/add-members/index.tsx` — removed
      `migrateRole` state, added `resolveMigrateRole`, new submit payload
- [x] `Dashboard-Web/features/members/api/member-api.ts` — `migrateAuthUsers` payload change
- [x] `Dashboard-Web/features/members/hooks/use-member-mutations.ts` — updated call site +
      unrelated `AddMembersSubmission["role"]` type error fixed (switched to `MemberRole`)
- [x] `Dashboard-Backend/src/modules/members/routes/member-migration.routes.js` — Firestore
      `users` join, eligibility gate, role mapping table, per-uid role handling in `/migrate`
- [ ] `Dashboard-Web/features/clients/pages/clients-page.tsx` — optional shortcut button, not
      built (see open question 3)

Verified: `tsc --noEmit` clean across `Dashboard-Web`; `node --check` clean on the modified
backend route file. Not yet verified against a live Firestore `users` collection / real login —
that needs the backend running with real credentials (out of scope for this environment).
