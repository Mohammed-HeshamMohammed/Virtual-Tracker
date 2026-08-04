# Logic Bug Review — Members & Org Chart

Part of the [full logic review](LOGIC-REVIEW.md). Covers member management, transfers, and the reporting-structure tree.

---

### 🟠 Medium — "Remove from tree" silently orphans the removed member's entire subordinate subtree
**File:** `Dashboard-Backend/src/modules/members/services/member-remove-from-tree-service.js:76`

`removeMemberFromTree` deletes **every** `member_relationships` edge touching the target — both their own parent link *and* all edges where they are the parent of someone else. The only removability check blocks removing an Owner; it never checks whether the target has direct reports.

**Failure scenario:** An Admin removes a Manager with 5 direct reports from the tree (demoting them to Viewer). The Manager is correctly demoted, but all 5 direct reports simultaneously lose their `parent_member_id` edge and become orphaned (`hierarchy_status: hierarchy_assignment_required`) — nobody asked to touch them. They silently drop out of the org tree and need a separate manual "repair orphans" pass (which reassigns them to org root, not back to any sensible manager) to become manageable again.

**Fix direction:** before removing, either reassign the target's direct reports to the target's own parent, or block the removal with a clear error until reports are manually reassigned.

**Solution:**

Re-point the target's direct reports to the target's own parent *before* wiping the target's edges, instead of letting `removeMemberHierarchyRelationships` delete both directions at once. `getMemberParentId` (`member-relationships/service.js:432`) already gives the target's parent; the direct-report edges are the same `asParentSnap` query `removeMemberHierarchyRelationships` already runs internally.

```js
// Dashboard-Backend/src/modules/members/services/member-remove-from-tree-service.js
import {
  removeMemberHierarchyRelationships,
+ getMemberParentId,
} from "../../member-relationships/service.js";

+ /** Re-point a removed member's direct reports to the removed member's own
+  *  parent, instead of leaving them dangling once the member's edges are cut. */
+ async function reassignDirectReportsToGrandparent(db, memberId, actorMemberId) {
+   const newParentId = await getMemberParentId(db, memberId);
+   const reportsSnap = await db
+     .collection("member_relationships")
+     .where("parent_member_id", "==", memberId)
+     .limit(200)
+     .get();
+   if (reportsSnap.empty) return { reassigned: 0, orphaned: 0 };
+
+   const batch = db.batch();
+   let reassigned = 0;
+   let orphaned = 0;
+   for (const doc of reportsSnap.docs) {
+     if (newParentId) {
+       batch.update(doc.ref, {
+         parent_member_id: newParentId,
+         updated_at: new Date(),
+         updated_by: actorMemberId,
+       });
+       reassigned += 1;
+     } else {
+       // Target had no parent of their own (was already a root) - nothing
+       // sensible to re-point to. Leave this edge for the existing
+       // repair-orphans flow rather than silently deleting it here.
+       orphaned += 1;
+     }
+   }
+   await batch.commit();
+   return { reassigned, orphaned };
+ }

export async function removeMemberFromTree(db, input) {
  ...
  const currentRole = await resolveMemberRoleName(db, memberId);
  if (isOwnerRole(currentRole)) {
    throw Object.assign(new Error(OWNER_REMOVE_BLOCKED_MESSAGE), { status: 403 });
  }

+ const reportsResult = await reassignDirectReportsToGrandparent(db, memberId, actorMemberId);
  const hierarchyEdgesRemoved = await removeMemberHierarchyRelationships(db, memberId);
  ...
  return {
    memberId,
    previousRole: currentRole,
    role: "Viewer",
    hierarchyStatus: "unassigned",
    hierarchyEdgesRemoved,
+   directReportsReassigned: reportsResult.reassigned,
+   directReportsOrphaned: reportsResult.orphaned,
    teamLinksRemoved,
    projectLinksRemoved,
    tasksUnassigned,
  };
}
```
Because the direct-report edges are re-pointed to the grandparent *before* `removeMemberHierarchyRelationships` runs, that function's own `parent_member_id == memberId` query returns nothing by the time it runs — it now only deletes the target's own `child_member_id == memberId` edge, which is exactly what "demote to Viewer, detach from the tree" should mean. Surface `directReportsReassigned`/`directReportsOrphaned` in the API response so the caller (and the UI) can show "5 direct reports were moved up to [grandparent]" instead of that happening invisibly.

**Edge case to decide explicitly:** if the removed member had no parent (they were already a root, e.g. reported directly to nothing), their direct reports have nowhere sensible to go — the code above leaves them as-is rather than orphaning them, but that means they're still pointing at a member who's about to lose their place in the tree. Worth blocking removal in that specific case with a clear error ("reassign this person's reports before removing them") rather than choosing silently.

**Test to add:** member M has parent P and two direct reports A, B. Remove M from tree. Assert A and B's `parent_member_id` is now P, and M has no remaining `member_relationships` rows at all.

---

### 🟠 Medium — Accepting a transfer request twice concurrently creates duplicate org-chart edges
**File:** `Dashboard-Backend/src/modules/hierarchy/transfer-request.service.js:249-333`

`acceptMemberTransferRequest` does a plain read-check-write with no transaction or optimistic lock: it reads `status`, branches on `!== "pending"`, and only writes `"completed"` at the very end.

**Failure scenario:** A user double-clicks "Accept" (or two devices race). Both requests read `status === "pending"` before either write lands, so both pass the guard and both call `recordMemberRelationship`. That function's own "already exists" check is *also* non-transactional read-then-write, so both concurrent calls can see "no existing edge" and each insert one — leaving two duplicate parent/child edges for the same pair, plus duplicate "transfer completed" notifications sent to both parties.

**Fix direction:** wrap the read-check-write in a Firestore transaction (`runTransaction`) keyed on the transfer request doc, and make `recordMemberRelationship`'s existence check part of the same transaction.

**Solution:**

The double-click case is the one actually worth closing here: lock the transfer-request document itself inside a transaction so only one of the two racing calls can ever see `status === "pending"` and proceed.

```js
// Dashboard-Backend/src/modules/hierarchy/transfer-request.service.js:249-313
export async function acceptMemberTransferRequest(db, { token, acceptorMemberId, acceptorEmail }) {
  const found = await findTransferByToken(db, token);
  if (!found) {
    return { ok: false, httpStatus: 404, error: "Transfer invitation not found or invalid." };
  }

- const row = found.data;
- if (row.status !== "pending") {
-   return { ok: false, httpStatus: 410, error: `This invitation has already been ${row.status}.` };
- }
- if (isTransferExpired(row)) {
-   await found.ref.update({ status: "expired", responded_at: new Date() });
-   return { ok: false, httpStatus: 410, error: "This invitation has expired." };
- }
- if (row.target_member_id !== acceptorMemberId) {
-   return { ok: false, httpStatus: 403, error: "This invitation is not for your account." };
- }
- const normalizedEmail = typeof acceptorEmail === "string" ? acceptorEmail.trim().toLowerCase() : "";
- if (row.target_email !== normalizedEmail) {
-   return { ok: false, httpStatus: 403, error: "Email does not match this invitation." };
- }

+ const normalizedEmail = typeof acceptorEmail === "string" ? acceptorEmail.trim().toLowerCase() : "";
+ // Atomically claim the request: only the first caller to reach this
+ // transaction sees status "pending" and can flip it to "processing".
+ // A second, racing call sees "processing" (or "completed") and bails
+ // before ever calling recordMemberRelationship.
+ let row;
+ try {
+   row = await db.runTransaction(async (tx) => {
+     const snap = await tx.get(found.ref);
+     const data = snap.data();
+     if (!snap.exists || data.status !== "pending") {
+       throw Object.assign(new Error(`This invitation has already been ${data?.status ?? "used"}.`), { httpStatus: 410 });
+     }
+     if (isTransferExpired(data)) {
+       tx.update(found.ref, { status: "expired", responded_at: new Date() });
+       throw Object.assign(new Error("This invitation has expired."), { httpStatus: 410 });
+     }
+     if (data.target_member_id !== acceptorMemberId) {
+       throw Object.assign(new Error("This invitation is not for your account."), { httpStatus: 403 });
+     }
+     if (data.target_email !== normalizedEmail) {
+       throw Object.assign(new Error("Email does not match this invitation."), { httpStatus: 403 });
+     }
+     tx.update(found.ref, { status: "processing" });
+     return data;
+   });
+ } catch (e) {
+   return { ok: false, httpStatus: e.httpStatus ?? 400, error: e.message };
+ }

  const requesterId = row.requester_member_id;   // unchanged from here down
  const existingParent = await getMemberParentId(db, acceptorMemberId);
  ... // rest of the function unchanged, except the final status write:

- await found.ref.update({
-   status: "completed",
-   responded_at: now,
-   completed_at: now,
-   token: null,
- });
+ await found.ref.update({
+   status: "completed",   // was "processing" since the transaction above; only this call can reach here
+   responded_at: now,
+   completed_at: now,
+   token: null,
+ });
```
The `"already assigned to another hierarchy"` branch (existing code, `found.ref.update({ status: "declined", ... })`) needs the same treatment conceptually — it's now moving *from* `"processing"`, which is fine since it's still only reachable by the single caller who won the transaction lock.

This closes the double-click race on the transfer-request document itself, which is the concrete failure scenario described. It does **not** fully close `recordMemberRelationship`'s own separate "already exists" TOCTOU (that function is shared by every relationship-creation path, not just transfers, so hardening it is a bigger, separate change) — but since only one caller can now reach `recordMemberRelationship` per transfer request at all, the transfer-specific duplicate-edge scenario is fixed. A belt-and-suspenders follow-up: add a unique index on `(parent_member_id, child_member_id)` in wherever `member_relationships` is backed, so even a caller reaching `recordMemberRelationship` from a different path can't create a true duplicate.

**Test to add:** create a pending transfer request, fire two concurrent `acceptMemberTransferRequest` calls with the same token; assert exactly one succeeds (`ok: true`) and the other gets a 410 "already completed" — and that `member_relationships` ends up with exactly one edge for the pair, not two.

---

### 🟠 Medium — Employee ID generation can hand out the same ID to two members created concurrently
**File:** `Dashboard-Backend/src/modules/members/services/generate-employee-id.service.js` (candidate generation) + `Dashboard-Backend/src/modules/members/services/member-profile.service.js:444` (write)

`generateMemberEmployeeId` only *reads* a snapshot of existing members to build a `takenIds` set and returns a candidate — it never reserves it. The actual write, in `updateMemberProfile`, persists `employee_id` with **no uniqueness check** at write time.

**Failure scenario:** Two new members are created within the same window (e.g. two invite registrations completing back-to-back). Both clients call the generate-ID endpoint before either has persisted an ID; neither sees the other's pending ID in `takenIds`, so both can land on the same candidate. Both profile-save requests succeed since nothing re-validates uniqueness — two members end up sharing one `employee_id`.

**Fix direction:** add a uniqueness constraint on `employee_id` at the database level, or reserve the candidate atomically (transaction or unique-insert-then-retry) at generation time.

**Solution:**

Firestore has no native unique-column constraint, so the standard pattern is a reservation document whose ID *is* the value being reserved — `tx.create()` throws `ALREADY_EXISTS` if that document already exists, giving atomic reserve-or-fail semantics.

```js
// Dashboard-Backend/src/modules/members/services/member-profile.service.js
+ async function reserveEmployeeId(db, employeeId, memberId) {
+   const lockRef = db.collection("employee_id_locks").doc(employeeId.trim().toUpperCase());
+   await db.runTransaction(async (tx) => {
+     const existing = await tx.get(lockRef);
+     if (existing.exists && existing.data()?.member_id !== memberId) {
+       throw Object.assign(new Error(`Employee ID "${employeeId}" is already in use.`), { status: 409 });
+     }
+     tx.set(lockRef, { member_id: memberId, reserved_at: new Date() });
+   });
+ }

  ...
  if (typeof info.employeeId === "string") {
+   await reserveEmployeeId(db, info.employeeId.trim(), memberId);
    memberUpdates.employee_id = info.employeeId.trim();
  }
  ...
  await memberRef.update(memberUpdates);   // existing write, now only reached after the reservation succeeds
```
Normalizing to uppercase (or whatever case-folding the ID format already uses) in the lock doc's key matters — otherwise `"EMP-001"` and `"emp-001"` would reserve separately while still colliding as the same visible ID. If member deletion/employee-ID reassignment is a real workflow, also delete the old lock doc when a member's `employee_id` changes, so freed IDs can be reused; skip that if IDs are meant to be permanent once assigned.

**Simpler alternative if a reservation collection feels like overkill:** since `generateMemberEmployeeId`'s `takenIds` set is already built from a live `members` scan, the two-caller collision only actually happens inside a race window measured in milliseconds. Retrying the *write* on conflict — catch the case where `updateMemberProfile` would create a duplicate (requires a query-before-write check inside a transaction on the `members` write itself, scoped to `employee_id`) and re-generate a candidate — gets the same correctness with one transaction instead of a whole side collection. The reservation-collection approach above is more explicit and easier to reason about, but either closes the race.

**Test to add:** call `reserveEmployeeId` (or the full generate-then-save flow) twice concurrently for two different members with the same candidate ID; assert exactly one succeeds and the other throws a 409.

---

### 🟠 Medium — Owners never get excluded from onboarding because the exclusion check reads a field that's never set
**File:** `Dashboard-Backend/src/modules/member-onboarding/routes.js:100` and `:388`

`isOwnerRole(d.role)` / `isOwnerRole(data.role)` check `member.role` — but member documents only ever store `role_id` (resolved separately against the `roles` collection). No code path anywhere writes a literal `role` string onto a member doc.

**Failure scenario:** An Owner account exists (role assigned via `role_id`, never `role`). `ownerMemberIds` never contains the Owner's id, so — contrary to the code's own comment "Owner role is excluded from onboarding" — the Owner shows up in the onboarding checklist, and `PATCH`/`POST .../reminder` calls on the Owner's synthetic id silently succeed instead of returning the intended 400. Onboarding reminder emails can end up sent to the Owner.

**Fix direction:** resolve `role_id` → role name (same lookup used elsewhere in the codebase) before calling `isOwnerRole`, or check against the Owner's `role_id` directly.

**Solution:**

Reuse the existing `role_id` → role name resolver (`resolveRoleNameById`, already used by `resolveMemberRoleName` in `activity-scope.js`) instead of reading the never-populated `role` field. There are two call sites; the single-member one is a direct swap, the bulk one is worth batching so it doesn't turn into one extra lookup per member.

```js
// Dashboard-Backend/src/modules/member-onboarding/routes.js
import { getDb } from "../../config/firebase.js";
+ import { resolveRoleNameById } from "../members/services/relation-sync.js";
  ...

  // — single-member check (line 382-389):
  async function isOwnerMemberById(memberId) {
    const db = getDb();
    if (!db || !memberId) return false;
    const snap = await db.collection("members").doc(memberId).get();
    if (!snap.exists) return false;
    const data = snap.data() || {};
-   return isOwnerRole(data.role);
+   const roleName = await resolveRoleNameById(db, typeof data.role_id === "string" ? data.role_id : "");
+   return isOwnerRole(roleName);
  }

  // — bulk check inside the GET /api/member-onboarding handler (line 94-101):
  const memberById = new Map();
  const ownerMemberIds = new Set();
+ // Resolve each distinct role_id once instead of once per member.
+ const distinctRoleIds = [...new Set(
+   membersDocs.map((doc) => doc.data()?.role_id).filter((id) => typeof id === "string" && id),
+ )];
+ const roleNameById = new Map(
+   await Promise.all(distinctRoleIds.map(async (roleId) => [roleId, await resolveRoleNameById(db, roleId)])),
+ );
  for (const doc of membersDocs) {
    const d = doc.data() || {};
    const email = typeof d.work_email === "string" ? d.work_email : typeof d.email === "string" ? d.email : "";
    memberById.set(doc.id, email);
-   if (isOwnerRole(d.role)) ownerMemberIds.add(doc.id);
+   if (isOwnerRole(roleNameById.get(d.role_id))) ownerMemberIds.add(doc.id);
  }
```
This makes both checks agree with how role is actually stored everywhere else in the codebase (`role_id` → resolved name), and the bulk path does one lookup per *distinct role*, not per member, so an org with a handful of roles and thousands of members still does only a handful of resolver calls.

**Test to add:** seed an Owner member with `role_id` pointing at the Owner role (no `role` field set, matching real data). Assert `GET /api/member-onboarding` excludes them from the checklist, and `POST /api/member-onboarding/member:<ownerId>/reminder` returns 400 "Owner role is excluded from onboarding" instead of succeeding.

---

### 🔴 High — `GET /api/member-onboarding` crashes with a Firestore composite-index error, making the entire onboarding modal non-functional
**File:** `Dashboard-Backend/src/modules/member-onboarding/routes.js:89` + `Dashboard-Backend/src/lib/firestore/paginate-all.js:10`

The GET handler passes a query that already has `.orderBy("updated_at", "desc")` into `fetchAllDocs`, which internally adds its own `.orderBy("__name__")` for cursor-based pagination. Firestore requires a composite index for any query with multiple `orderBy` clauses — without one, the query throws `Error 9 FAILED_PRECONDITION: The query requires an index` at runtime.

The same issue applies to the `members` and `invites` queries on lines 90–91 (`.orderBy("date_added", "desc")` and `.orderBy("sent_at", "desc")`), which also get a second `.orderBy("__name__")` from `fetchAllDocs`.

**Failure scenario:** A manager opens the onboarding modal → the frontend calls `GET /api/member-onboarding` → all three `fetchAllDocs` calls crash → the catch block on line 160 fires → the frontend shows "Failed to load onboarding data" and the entire modal is an empty error state. No onboarding data can be viewed, no reminders can be sent, and no checkboxes can be toggled — the feature is fully broken.

**Fix direction:** Remove the `.orderBy(...)` from the queries passed to `fetchAllDocs`, since `fetchAllDocs` already applies its own `orderBy("__name__")` for pagination. The order these results are consumed in doesn't depend on Firestore-side sorting — the GET handler builds lookup maps (`byMemberId`, `byInviteId`, `memberById`) and the final `withEmail` array is built by iterating those maps, so the original ordering is lost anyway:

```js
// Dashboard-Backend/src/modules/member-onboarding/routes.js:88-91
  const [onboardingDocs, membersDocs, invitesDocs] = await Promise.all([
-   fetchAllDocs(db.collection("member_onboarding").orderBy("updated_at", "desc")),
-   fetchAllDocs(db.collection("members").orderBy("date_added", "desc")),
-   fetchAllDocs(db.collection("invites").orderBy("sent_at", "desc")),
+   fetchAllDocs(db.collection("member_onboarding")),
+   fetchAllDocs(db.collection("members")),
+   fetchAllDocs(db.collection("invites")),
  ]);
```

If a specific final ordering is needed (e.g. newest members first in the modal), add a sort to the `withEmail` array after assembly, not to the Firestore query.

**Alternatively**, if the sort is intentional and other callers of `fetchAllDocs` rely on the `__name__` ordering, make `fetchAllDocs` detect and skip its own `orderBy("__name__")` when the incoming query already has an `orderBy` — or add a parameter to opt out:

```js
// Dashboard-Backend/src/lib/firestore/paginate-all.js
- export async function fetchAllDocs(queryOrCollectionRef, pageSize = 1000) {
+ export async function fetchAllDocs(queryOrCollectionRef, pageSize = 1000, { skipAutoOrder = false } = {}) {
    const docs = [];
    let last = null;
    for (;;) {
-     let q = queryOrCollectionRef.orderBy("__name__").limit(pageSize);
+     let q = skipAutoOrder
+       ? queryOrCollectionRef.limit(pageSize)
+       : queryOrCollectionRef.orderBy("__name__").limit(pageSize);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      ...
```

Then the onboarding route would call `fetchAllDocs(query, 1000, { skipAutoOrder: true })`.

**Test to add:** call `GET /api/member-onboarding` with at least one member, one invite, and one onboarding row in the database; assert a 200 response with a non-empty `data` array instead of a 500.

---

### 🟠 Medium — "Send reminder" button only writes a timestamp — no email is actually sent
**File:** `Dashboard-Backend/src/modules/member-onboarding/routes.js:231-301`

The `POST .../reminder` handler updates `last_reminder_sent_at` and `last_reminder_sent_by` in the `member_onboarding` document, but never calls any email-sending service (Resend, SMTP, or otherwise). The codebase has working email infrastructure (used by invites in `Dashboard-Backend/src/modules/invites/` and report delivery in `Dashboard-Backend/src/modules/reports/`), but the onboarding reminder route doesn't import or call any of it.

**Failure scenario:** A manager clicks "Send reminder" on an un-onboarded member → the button shows a brief loading state → the `last_reminder_sent_at` field is updated → the frontend shows success (no error thrown) → **the member never receives any email**. The manager believes the reminder was sent; the member never sees it.

**Fix direction:** integrate the existing email service to actually send a reminder email. The invite system (`invite-email.service.js`) already has working templates and delivery; the onboarding reminder should follow the same pattern — resolve the target's email address from `memberById`/`inviteById`, compose a reminder message, and call the email sender. If the email service isn't configured (no `RESEND_API_KEY` or SMTP), the route should either fail with a clear error ("Email not configured") instead of silently pretending it worked, or log a warning and still update the timestamp (with a response field like `emailSent: false` so the frontend can show an appropriate message).

```js
// Dashboard-Backend/src/modules/member-onboarding/routes.js
+ import { sendEmail } from "../../lib/email/send-email.js"; // or whichever sender is used by invites

  // Inside the POST .../reminder handler, after updating the document:
+ const targetEmail = /* resolve from member doc or invite doc */;
+ if (targetEmail) {
+   await sendEmail({
+     to: targetEmail,
+     subject: "Reminder: Complete your onboarding",
+     html: `<p>Your organization is waiting for you to complete onboarding. ...</p>`,
+   });
+ }
```

**Test to add:** call `POST /api/member-onboarding/member:<id>/reminder` with a valid member ID; assert that the email service was called with the correct recipient (mock the email sender to avoid actually sending).

---

### 🟠 Medium — PATCH/POST on synthetic onboarding IDs creates orphaned documents that are never retrieved
**File:** `Dashboard-Backend/src/modules/member-onboarding/routes.js:186-228` (PATCH) and `:242-300` (POST reminder)

When a PATCH or POST arrives with a synthetic ID (e.g. `member:abc123` or `invite:xyz789`), the handler creates a **new** `member_onboarding` document with a random UUID (`crypto.randomUUID()`) as its doc ID. But the GET handler on line 110–112 builds its lookup maps (`byMemberId`, `byInviteId`) from the `member_id`/`invite_id` *fields* inside existing onboarding documents — it never uses the doc ID for synthetic rows. The next GET request re-synthesizes `member:abc123` from scratch (since `byMemberId` correctly finds the new doc by its `member_id` field), but the *returned row's `id`* is now the Firestore doc ID (the random UUID), not the original synthetic `member:abc123`.

This means:
1. The frontend sends PATCH with `id = "member:abc123"` → backend creates doc with `id = randomUUID()`.
2. Frontend refreshes via GET → gets back the row with `id = randomUUID()` (correct data, different ID).
3. The frontend's optimistic update on line 87–93 of `onboarding-modal.tsx` tries to match `it.id === row.id` where `row.id` was the synthetic `"member:abc123"` — but the updated row from the server now has `id = randomUUID()`. The match fails, so the local state doesn't update optimistically; the row appears unchanged until a full page refresh.

**Additionally**, if PATCH is called **twice** for the same synthetic member (e.g. toggling "downloaded app" then "tracked time" in quick succession), two separate `member_onboarding` documents are created for the same `member_id` — because each PATCH with a synthetic ID always creates a new doc (`crypto.randomUUID()`), never checking if one was already created moments ago. The GET handler's `byMemberId` map overwrites with the last one it sees, silently dropping the first.

**Fix direction:** before creating a new document for a synthetic ID, check if a `member_onboarding` row already exists for that `member_id`/`invite_id`, and update it instead of creating a duplicate:

```js
// Dashboard-Backend/src/modules/member-onboarding/routes.js — PATCH handler
  if (isSyntheticMember) {
    const memberId = id.slice("member:".length);
    // ... owner check ...
-   await ref.set({ ... });
+   const existing = await db.collection("member_onboarding")
+     .where("member_id", "==", memberId).limit(1).get();
+   const targetRef = existing.empty
+     ? db.collection("member_onboarding").doc(crypto.randomUUID())
+     : existing.docs[0].ref;
+   if (existing.empty) {
+     await targetRef.set({ id: targetRef.id, member_id: memberId, invite_id: null,
+       created_at: new Date(), created_by: typeof body.updatedBy === "string" ? body.updatedBy : "system",
+       ...patch });
+   } else {
+     await targetRef.update(patch);
+   }
  }
```

Apply the same pattern to the POST reminder handler (line 251–270) and the invite-synthetic branch.

**Test to add:** PATCH `member:abc123` twice in sequence with different checkbox states. Assert that only one `member_onboarding` document exists with `member_id === "abc123"`, and that both patches are reflected in it.

---

## Checked, ruled out

- Ancestor/descendant cycle-prevention (`member-relationships/relationship-integrity.js`) — correctly blocks self-loops and cycles, including in the migration/bootstrap path.
- `getMemberDescendants` `maxDepth` semantics — correct for the `/children` route.
- Orphan classification in `hierarchy-placement.js`/`hierarchy-repair.js` — internally consistent.
