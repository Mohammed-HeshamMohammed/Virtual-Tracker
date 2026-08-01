# Add-client-from-Project-modal — plan

Status: **implemented**. File references relative to `Dashboard-Web/` unless noted.

## 1. The problem

In the Add Project modal, the Clients multiselect
([add-project-dynamic-fields.tsx:81-105](Dashboard-Web/features/projects/components/add-project-dynamic-fields.tsx#L81))
shows "No clients available" / "No clients yet — add one from the Clients page first" and stops
there. Two distinct reasons a client might be missing:

1. **Never added to the app at all** — no Member, no Client record, nothing.
2. **Exists on the mobile app but never migrated** — has a Firestore `users/{uid}` profile with
   `role: "client"`, but no Member row yet (this is exactly what the Migrate tab work from
   earlier this session targets).

Either way, today the only fix is: abandon the Add Project modal, go to the Clients page, resolve
it there, come back and redo the project form. That's the friction being asked about.

## 2. What already exists (don't rebuild any of this)

1. **Clients page → "+ Add client"** → `ClientModal` in create mode
   ([clients-page.tsx:258-266](Dashboard-Web/features/clients/pages/clients-page.tsx#L258),
   [client-modal/index.tsx](Dashboard-Web/features/clients/components/modals/client-modal/index.tsx)).
   Lets you either pick an existing Member as the client, or type a brand-new person's name/email
   inline (a "member draft"). Submits via `createClientWithDetails` →
   `POST /api/clients/with-details`, which creates the Member and the Client together in one
   transaction. **This already fully covers "never added at all" for a person with no mobile
   account.**
2. **Members → Add members → Migrate tab** (built earlier this session). Lists Firebase Auth
   users who *also* have a Firestore `users/{uid}` profile (proves they used the mobile app),
   auto-suggests an app role from their mobile `role` field (`client` → "Client", etc.), and
   migrates them into a real Member via `migrateAuthUsers`. **This already fully covers "not
   migrated from the mobile app."**
3. **Clients page → pending-client-members banner**
   ([pending-client-members-banner.tsx](Dashboard-Web/features/clients/components/pending-client-members-banner.tsx),
   [unlinked-client-members.ts](Dashboard-Web/features/clients/utils/unlinked-client-members.ts)).
   Any Member whose role is already "Client" but has no Client row yet → one click to promote.
   Bridges (2) → a full Client record automatically, no extra work needed once role mapping is
   right.

**So the underlying capability isn't missing — the entry point is.** Nothing above is reachable
from inside the Add Project modal.

## 3. Proposed fix

Add a single "+ Add client" affordance directly on the Clients field in
`add-project-dynamic-fields.tsx` — shown always (not just on the empty state), since the problem
also happens when *some* clients exist but the one you need isn't one of them. Clicking it opens
a small, purpose-built picker with two paths, mapping 1:1 to the two capabilities in §2:

- **"New contact"** — reuses `ClientMemberInvitePanel` (the exact same name/email component
  `ClientModal`'s own "Member" tab uses — not rebuilt) → `provisionClientMemberFromDraft` (invite
  or full account, role "Client") → `createClientWithDetails` with `emptyClient()` defaults for
  everything else (no budget/invoicing/team fields — irrelevant mid-project-creation; those stay
  configurable later from the Clients page). This mirrors `useClientMutations.saveClient`'s
  create-with-new-member branch exactly, just without the rest of `ClientModal`'s surface.
- **"From mobile app"** — reuses the Migrate tab's data source (`fetchMigratableUsers`), filtered
  by default to people whose suggested role is already "Client" (checkbox to show everyone else
  too). **Correction found while implementing**: migrating someone with role "Client" only
  creates a *Member* with that role — it does **not** create a *Client* record on its own (those
  are separate entities; today's bridge is the "unlinked client members" banner in §2, which is a
  manual click-through, not automatic). So this tab does two calls, not one:
  `migrateAuthUsers([{uid, role: "Client"}])` → take the returned `memberId` →
  `createClientWithDetails({...emptyClient(), clientMember: memberId, name, email})` using the
  name/email already known from the picked `MigratableAuthUser` (the migrate result itself
  doesn't carry them back). Also: this tab ended up **single-select**, not reusing `MigrateForm`'s
  multi-select rows — pairing multiple simultaneous migrations back to their own
  `createClientWithDetails` call each added complexity with no real benefit for a "get one client
  usable in this form right now" action; a plain click-to-select list was simpler and still
  reuses the same underlying avatar/initials helpers `MigrateForm` uses.

After either path succeeds: refetch `getProjectFormConfig()` in `project-modal.tsx` (the exact
same call it already makes once on mount — no new merge/caching logic), then run the new client's
id through `handleProjectFormChange("clientIds", …)` — the same path the dropdown itself uses, so
budget aggregation and every other side effect that already reacts to a client selection stays
correct instead of being bypassed with a raw state write.

## 4. Permissions — the two tabs are NOT equally gated (verified in code, not assumed)

Traced both role checks end to end; they use **different role sets**, which the picker has to
respect rather than copy one gate for both tabs.

| Action | Backend gate | Roles allowed |
|---|---|---|
| Add / create a client (today's `ClientModal`, and the new "New contact" tab) | `assertManagementRole` → `isManagementRole` ([auth-context.js:42-48](Dashboard-Backend/src/http/auth-context.js#L42)) | Owner, Super Admin, Admin, Super Manager, Manager (5) |
| Migrate a mobile-app user (today's Migrate tab, and the new "From mobile app" tab) | `assertMigrationManagementRole` → `canMigrateMembers` ([member-migration-policy.js:6-9](Dashboard-Backend/src/http/member-migration-policy.js#L6)) | Owner, Super Admin, Admin (3) — **no Manager/Super Manager** |

Frontend today: `canManageClients`/`canManageProjects` (both `isManagementRole`,
[member-role-access.ts:125-132](Dashboard-Web/features/auth/permissions/member-role-access.ts#L125))
already matches the 5-role client gate correctly. But there is **no frontend equivalent of
`canMigrateMembers` at all** — the existing Migrate tab is shown to anyone who can open "Add
members" (`canManageMembers`, same 5 roles), so Manager/Super Manager see it today and get a
backend 403 if they try it. Pre-existing bug, not introduced by this plan, but the new picker
would inherit it if built naively.

**What this means for the new picker:**
- "New contact" tab: gate with the existing 5-role `canManageProjects`/`canManageClients` check —
  already correct, no new logic.
- "From mobile app" tab: needs a **new frontend permission helper** mirroring the backend's
  3-role `canMigrateMembers`, and the tab should only render for viewers who pass it. A Manager
  or Super Manager creating a project would then see only "New contact" — accurately reflecting
  what they're actually allowed to do, instead of showing an option that 403s.
- Worth fixing the pre-existing gap too while touching this code: hide the Migrate tab in the
  Add Members modal itself for Manager/Super Manager, using the same new helper. Small, separate,
  same root cause — flagging it here so it doesn't get forgotten, not bundling it silently.

## 5. Explicitly out of scope

- **Not rebuilding `ClientModal` or `MigrateForm`.** Reusing their existing API calls
  (`createClientWithDetails`, `fetchMigratableUsers`, `migrateAuthUsers`) behind a smaller picker,
  not embedding either full modal (both carry fields — budget, invoicing, team assignment — that
  don't belong mid-project-creation).
- **Not touching `MultiSelectField`.** It's a shared component used elsewhere in the app; the
  add-client affordance sits beside it in `add-project-dynamic-fields.tsx`, scoped to just this
  one field, so there's no shared-component blast radius.

## 6. Open questions — resolved during implementation

1. `GET /api/projects/form-config` filters only `status !== "archived"`
   ([routes.js:395-410](Dashboard-Backend/src/modules/projects/routes.js#L395)) — active and
   inactive-but-not-archived clients both show up. A freshly-added client (always created active)
   reliably appears after refetch.
2. "New contact" defaults budget/invoicing/status via `emptyClient()` — same defaults `ClientModal`
   itself starts a brand-new client with. Full setup stays available later on the Clients page.
3. "From mobile app" defaults to Client-suggested only, with a checkbox to reveal everyone else.
   Whoever is picked is submitted with role `"Client"` regardless of what their mobile profile
   originally suggested — the whole point of this tab is "make this person a client," so the
   suggestion is a *filter to find the right person faster*, not a constraint on the outcome.
4. Built as a Radix `Popover` anchored to the Clients field (`z-[100]`, safely above both the Add
   Project modal and its own backdrop, both `z-50`) — confirmed no stacking conflict.
5. Fixed in the same pass: the Migrate tab in `add-members/index.tsx` now only renders for
   viewers who pass the new `canMigrateMembers` helper (Manager/Super Manager no longer see a tab
   that would 403 on submit); a defensive effect also bumps `mode` back to `"invites"` if it were
   somehow left on `"migrate"` without permission.

## 7. File checklist — all done

- [x] `Dashboard-Web/features/auth/permissions/member-role-access.ts` — new `canMigrateMembers`
      helper (Owner/Super Admin/Admin only), exported via `features/auth/index.ts`
- [x] `Dashboard-Web/features/projects/components/add-project-dynamic-fields.tsx` — "+ Add
      client" popover trigger under the Clients field; new `onClientAdded` prop
- [x] `Dashboard-Web/features/projects/components/quick-add-client-popover.tsx` (new) — the
      picker itself (New contact / From mobile app, second tab gated by `canMigrateMembers`). No
      new endpoints — reuses `createClientWithDetails`, `provisionClientMemberFromDraft`,
      `fetchMigratableUsers`, `migrateAuthUsers`, `ClientMemberInvitePanel`, `SegmentedControl`,
      `Avatar`
- [x] `Dashboard-Web/features/projects/components/modals/project-modal.tsx` — `handleClientAdded`:
      refetches `formConfig`, runs the new client id through the existing
      `handleProjectFormChange("clientIds", …)` path; wired into all 4 call sites of
      `AddProjectDynamicFields`
- [x] `Dashboard-Web/features/members/components/modals/add-members/index.tsx` — Migrate tab now
      conditionally rendered on `canMigrateMembers(memberRole)`

Verified: `tsc --noEmit` clean across `Dashboard-Web`; smoke-tested `QuickAddClientPopover` in
isolation (logged out, so `canMigrateMembers` correctly evaluates false) — "From mobile app" tab
correctly absent, "New contact" tab renders and reuses `ClientMemberInvitePanel` correctly, submit
error path surfaces cleanly ("Not authenticated") with no console errors or unhandled rejections.
Not verified against a live backend/real roles (none available in this environment) — worth a
manual pass as Owner/Admin and as Manager/Super Manager to confirm the tab actually appears/hides
as expected end-to-end.
