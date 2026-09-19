# Confidential Owner-Access Overlay Plan

## 1. Goal

Add a confidential, additive access layer that gives a selected member owner-equivalent application permissions without changing the member's public role.

Example:

- Public role: `Employee`
- Confidential access: `Owner-equivalent`
- What ordinary users see: `Employee`
- What authorization enforces: the Employee permissions plus the approved confidential capabilities
- Who can discover, grant, or revoke it in the product: only the enrolled controller account for `mohamedhms3102@gmail.com`

This should not be implemented as another normal role. Internally it should be called `confidential_owner_access` or `protected_access`, not `hidden_role`, because it is a separate privilege overlay above the public role.

## 2. Non-negotiable safety boundary

The overlay may be absent from ordinary member lists, role badges, profile responses, filters, exports, notifications, and management screens. It must not be absent from protected security records.

- Every request and data change remains attributed to the real member ID.
- Grant, verification, revocation, expiration, and protected-access use are written to a restricted, append-only audit trail.
- The grantee must never appear to the audit system as the real Owner, `System`, or another user.
- A confidential grantee cannot grant this access, revoke it, edit its controller identity, erase its audit, or take over the real Owner account.
- Database, server, and infrastructure administrators can still discover the records. Product UI privacy cannot truthfully make server-side authorization invisible to infrastructure operators.

This boundary prevents the feature from becoming an unaudited backdoor while meeting the requested product behavior.

## 3. Chosen product behavior

### 3.1 Public identity and role

The member's existing `members.role_id` is never replaced by this feature. A member can remain an Employee, Manager, Viewer, or any other existing role.

All ordinary surfaces continue using that public role:

- Members table and member profile
- Role column, search, filters, and exports
- Team and project views
- Activity cards, comments, and visible history
- Standard API responses, bootstrap payloads, and realtime events

Actions remain displayed as actions by the actual member. The application must not falsify authorship or claim the action was performed by the real Owner.

### 3.2 Effective authority

At authentication time, the backend resolves two separate values:

```text
public role (Employee) -----> display, lists, profile, ordinary responses
                             \
confidential access grant ----> effective authorization capabilities
```

An active grant adds a server-side capability set. It does not rewrite `roleName` to `Owner` in public objects.

Recommended first release: **owner-equivalent with governance exclusions**. It can see and operate the application like an Owner, except it cannot:

- Grant, inspect, or revoke confidential access
- Change the confidential controller identity
- Remove, demote, disable, or take over the real Owner
- Delete or alter protected security audit records
- Change authentication, signing, notification-delivery, or encryption secrets

This is safer than cloning the Owner role byte-for-byte and prevents a grantee from making the access permanent. The capability set should be centralized so any deliberately allowed exception is explicit and tested.

### 3.3 Who can manage it

Only the authenticated account enrolled for `mohamedhms3102@gmail.com` can discover or manage the feature.

The backend must not trust an email supplied by the browser. Enrollment works as follows:

1. Configure the normalized controller email in a private Dashboard Backend environment variable.
2. On the first valid use, resolve that verified Firebase email to its Firebase UID and member UUID.
3. Persist or configure the stable UID/member identity as the controller binding.
4. On later requests, require the authenticated UID, member UUID, verified email, and normalized email to match the enrolled controller.

Changing another member's work email to the controller address must not grant access. No controller email or feature flag should be shipped in public browser environment variables.

## 4. Members-page experience

### Controller view

In the existing Members page, open a member and go to the existing **Roles** tab. Only the enrolled controller receives a server-approved `canManageProtectedAccess` capability. When it is true, a second card appears under the normal role selector:

**Protected access**

- Public role: `Employee`
- Effective protected access: `Not granted`, `Pending verification`, or `Owner-equivalent`
- `Grant protected access` or `Revoke protected access`
- If active: grant date and optional expiry

Grant and revoke both require verification; revocation is not weaker than granting because an attacker could otherwise remove the controller's emergency access from a legitimate grantee.

Interaction:

1. Controller presses Grant or Revoke.
2. A confirmation explains exactly which member and action will be authorized.
3. Backend sends a one-time code only to the fixed controller mailbox.
4. UI shows a masked destination such as `m••••••••••2@gmail.com`, expiry countdown, resend cooldown, and attempts remaining.
5. Controller enters the code.
6. Successful verification applies the requested grant/revoke in the same backend transaction.
7. The card updates; the ordinary role selector and role value do not change.

The code modal must never accept or display an editable destination email.

### Everyone else

For every non-controller, including an overlay grantee:

- The Roles tab is byte-for-byte equivalent in behavior to the current Roles tab.
- No empty card, disabled button, special badge, field, tooltip, response property, or count hints that protected access exists.
- Direct calls to protected endpoints return the same generic `404 Not found` response.
- The overlay is excluded from member/profile/list/export/realtime schemas.

Client code can be inspected by a determined technical user, so UI conditional rendering is privacy rather than cryptographic secrecy. Authorization and non-disclosure are enforced by the backend.

## 5. Verification flow

Email code alone is not a strong independent second factor when it belongs to the same signed-in identity. Use all of these checks:

- Authenticated, enabled Firebase account
- Verified controller email
- Stable controller UID/member binding
- Recent authentication, recommended `auth_time` no older than 10 minutes
- One-time email code

Recommended code policy:

- Cryptographically random 8-digit code
- Valid for 10 minutes
- Store only `HMAC-SHA-256(server_secret, challenge_id + code)`, never the raw code
- Constant-time comparison
- Maximum 5 failed attempts
- 60-second resend cooldown and maximum 3 sends per hour
- Resending invalidates the previous code
- One active challenge per controller + target + action
- A challenge is bound to controller ID, target member ID, action, and current session/security stamp
- A challenge is consumed once, including under concurrent requests
- Grant/revoke and challenge consumption occur in one PostgreSQL transaction

If recent authentication is missing, return `REAUTH_REQUIRED` before sending a code. If email delivery fails, no usable challenge remains and no privilege changes.

The email must say which action was requested, which member is affected, when the code expires, and what to do if the request was not initiated by the controller. The Notify service must use the challenge ID as its deduplication key so legitimate resends are not accidentally suppressed by the current template-level duplicate check.

## 6. Data model

Create dedicated PostgreSQL tables; do not reuse `members.privileged_role_owner_granted`. That existing column proves that an ordinary Admin/Super Admin role assignment was approved by an Owner and has different semantics.

### `confidential_access_grants`

| Column | Purpose |
| --- | --- |
| `id UUID PK` | Grant identifier |
| `member_id UUID UNIQUE FK` | Grantee |
| `access_profile` | Initially `owner_equivalent` |
| `status` | `active`, `revoked`, or `expired` |
| `granted_by UUID` | Controller member ID |
| `granted_at TIMESTAMPTZ` | Activation time |
| `expires_at TIMESTAMPTZ NULL` | Optional expiry |
| `revoked_by UUID NULL` | Controller member ID |
| `revoked_at TIMESTAMPTZ NULL` | Revocation time |
| `grant_challenge_id UUID` | Verification evidence |
| `revoke_challenge_id UUID NULL` | Revocation verification evidence |
| `version INT` | Optimistic concurrency / idempotency |

### `confidential_access_challenges`

| Column | Purpose |
| --- | --- |
| `id UUID PK` | Public opaque challenge ID |
| `controller_member_id UUID` | Bound controller |
| `target_member_id UUID` | Bound target |
| `action` | `grant` or `revoke` |
| `code_hash` | HMAC of challenge and code |
| `security_stamp` | Binds to the initiating security session |
| `attempt_count / max_attempts` | Brute-force limit |
| `expires_at` | Hard expiry |
| `delivered_at NULL` | Code was actually sent |
| `consumed_at NULL` | One-time use marker |
| `invalidated_at NULL` | Resend, cancellation, or session change |
| `created_at` | Creation time |

Expired challenge rows can be removed after a short retention period. Never include `code_hash` in any API, ordinary audit record, error, or log.

### `confidential_access_audit`

Append-only restricted events:

- `challenge_requested`
- `challenge_delivered` / `delivery_failed`
- `verification_failed` / `verification_succeeded`
- `access_granted` / `access_revoked` / `access_expired`
- `protected_access_used` for sensitive mutations
- `controller_binding_changed` through an offline recovery procedure

Record actor ID, target ID, event, request correlation ID, timestamp, and minimal non-secret metadata. Do not attach this table to the ordinary audit report, but keep the existing general audit's real `performed_by` value for all data mutations.

## 7. API contract

All routes require normal authentication and then the controller identity gate. Unauthorized callers receive generic 404 responses.

```text
GET  /api/confidential-access/members/:memberId
POST /api/confidential-access/challenges
POST /api/confidential-access/challenges/:challengeId/verify
POST /api/confidential-access/challenges/:challengeId/resend
```

Challenge request body:

```json
{
  "targetMemberId": "uuid",
  "action": "grant"
}
```

Verification body:

```json
{
  "code": "12345678"
}
```

There is intentionally no recipient email in either body. Successful verification performs the action immediately; there is no separate replayable “apply grant” endpoint.

Before creating a challenge, reject targets that are missing, inactive, banned, the real Owner, or otherwise ineligible. Repeated verification after success should return the already-completed result without applying a second change.

## 8. Authorization integration

The current backend mixes `roleName` comparisons, hierarchy values, and PostgreSQL functions. The overlay will be unsafe if only one path learns about it.

Introduce one server-side authority resolver during authentication:

```text
resolveEffectiveAuthority(memberId, publicRole)
  -> publicRoleName
  -> publicHierarchyLevel
  -> effectiveHierarchyLevel
  -> effectiveCapabilities
  -> authoritySource: public_role | confidential_owner_access
```

Then migrate authorization entry points to the effective values while preserving public values for output:

- `Dashboard-Backend/src/http/auth-middleware.js`
- `Dashboard-Backend/src/http/auth-context.js`
- `Dashboard-Backend/src/http/authorization.js`
- role-name-only admin/owner guards
- hierarchy and member visibility helpers
- `fn_can_actor_manage_target`
- `fn_member_has_permission`
- any route that directly checks `viewer.roleName`

Do not solve this by setting `context.roleName = "Owner"`; that risks leaking the overlay and misattributing behavior. Keep `publicRoleName` and effective authorization separate.

Revocation must take effect on the next request. The grant/revoke transaction should rotate the target member's `security_stamp`, invalidate any cached authorization result, publish only a generic `scope-changed` event to that member, and force token/session refresh where required. The event must not expose the reason to ordinary clients.

## 9. Service and file map

Expected implementation areas:

- `Dashboard-Backend/src/config/env-schema.js`, `env.js`, and `.env.example`
  - Private controller email/UID, HMAC secret, feature kill switch, expiry policy
- `Dashboard-Backend/src/lib/postgres/schema.sql`
- `Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js`
  - New grants, challenges, protected audit, constraints, and indexes
- New `Dashboard-Backend/src/modules/confidential-access/`
  - Controller identity gate, repository, service, routes, verification, audit
- `Dashboard-Backend/src/http/auth-middleware.js` and authorization helpers
  - Effective capability resolution
- `Notify-backend/src/modules/email/email-builders.js` and `routes.js`
  - Dedicated `confidential-access-code` template and challenge-aware dedupe
- `Dashboard-Web/features/members/components/modals/member-manage/tabs/roles-tab.tsx`
  - Controller-only Protected access card
- New Dashboard Web API/types/components scoped to confidential access
- Backend and frontend tests covering discovery, verification, authorization, and presentation

The existing `members.privileged_role_owner_granted` flow remains unchanged.

## 10. Failure and recovery behavior

- **Unknown or unlinked controller email:** deny the operation and return a private controller-only message explaining that the configured email is not linked to a verified active member; never guess another recipient.
- **Unknown target member:** generic 404; no email is sent.
- **Email unavailable:** display “Code could not be delivered; no access was changed.” Do not create a usable challenge.
- **Wrong or expired code:** keep the public role and current grant unchanged; show remaining attempts without revealing code details.
- **Too many attempts:** invalidate the challenge and require a new one after cooldown.
- **Concurrent grant/revoke:** row lock and version check ensure only one final state and one successful audit event.
- **Notify timeout with uncertain delivery:** mark delivery unknown, do not allow verification, and require resend with a new code.
- **Controller account lost:** use a documented offline database/admin recovery procedure with two-person operational approval; do not add a second hidden UI controller.
- **Emergency shutdown:** `CONFIDENTIAL_ACCESS_ENABLED=false` makes all overlays ineffective immediately while preserving records for recovery.
- **Expired grant:** treat as inactive on authorization reads even before the cleanup job updates its status.

## 11. Test plan

### Identity and non-disclosure

- Only the enrolled verified UID/member/email combination gets the controller capability.
- Matching a request-body email or editable work email does not authorize access.
- Non-controller controller-status and grant endpoints return 404.
- Non-controller member/profile/list/export/realtime payloads contain no overlay fields.
- Overlay grantees cannot see or call the management feature.
- Controller UI appears in the Roles tab and nowhere else.

### Code security

- Raw codes never reach the database or logs.
- Code expires, is one-time-use, has attempt limits, and is constant-time verified.
- Challenge cannot be reused for another target, action, controller, or session.
- Resend invalidates the old code and respects cooldown/rate limits.
- Concurrent verification can produce only one grant/revoke transition.
- Delivery failure and ambiguous timeout cannot change access.

### Authorization

- Public role remains Employee before, during, and after an active grant.
- Active overlay allows each intended owner-equivalent operation.
- Governance exclusions remain denied.
- Direct role-name checks and PostgreSQL permission/manage functions honor the effective capability model.
- Revocation, expiration, ban, disable, and feature kill switch stop elevated access on the next request.
- Cached/session authorization cannot preserve a revoked overlay.

### Accountability

- All ordinary data changes retain the actual member in `performed_by`.
- Protected grant/revoke/use events are append-only and unavailable through ordinary audit reports.
- Neither a grantee nor normal administrator can edit or delete protected audit records.

### UI

- Controller sees public role and protected state as two distinct values.
- Grant/revoke confirmation names the correct target and action.
- Code field supports paste, keyboard submission, expiry, errors, resend state, and accessibility labels.
- Everyone else's Roles tab has no visual gap or changed behavior.

## 12. Rollout sequence

1. **Policy lock:** confirm the owner-equivalent capability allowlist/exclusions and expiry default.
2. **Schema and controller gate:** add private configuration, tables, constraints, and controller identity tests with the feature disabled.
3. **Verification pipeline:** build code generation, HMAC storage, Notify template, delivery states, retry limits, and audit events.
4. **Effective authorization:** add the central resolver and migrate every owner/admin/hierarchy/permission decision. Keep the feature disabled until the authorization audit is complete.
5. **Controller UI:** add the protected card and code modal in the Members Roles tab.
6. **End-to-end tests:** test multiple public roles, grant, revoke, expiry, concurrency, email failures, token/cache invalidation, and leakage.
7. **Controlled enablement:** bind the stable controller UID, deploy with no grants, enable the feature, grant one short-lived test overlay, verify, then revoke.
8. **Production policy:** monitor only protected security failures and rate-limit events without putting target/grant details in ordinary logs.

Rollback order: disable the feature flag, invalidate authorization caches/sessions, revoke active rows, then roll back UI/routes. Preserve protected audit records.

## 13. Acceptance criteria

The feature is complete only when all statements are true:

- A member can hold a normal public role and a separate confidential access grant.
- Only the enrolled `mohamedhms3102@gmail.com` identity can discover, grant, or revoke it through the product.
- Grant and revoke require a freshly authenticated session and a one-time code emailed only to that fixed address.
- The ordinary UI and ordinary API responses continue showing only the public role.
- The grantee receives the approved owner-equivalent capabilities but cannot control the overlay or protected governance.
- Revocation/expiration is effective by the next authorized request.
- All actions remain attributed to the actual actor and protected access has an append-only restricted audit trail.
- Unknown controller, target, delivery, and verification states fail closed with a clear controller-only result; the system never sends to or substitutes an unknown address.
- The feature passes non-disclosure, security, authorization, failure, and UI tests before it is enabled.

## 14. Decisions to lock before implementation

Recommended defaults are included so implementation is not blocked:

| Decision | Recommended default |
| --- | --- |
| Access duration | 7 days, renewable with a new code |
| Permission scope | Owner-equivalent with the governance exclusions in section 3.2 |
| Verification | Recent sign-in plus 8-digit email code |
| Controller identity | Exact verified email initially, then stable UID/member binding |
| Visibility | Controller-only product UI; restricted server audit retained |
| Revocation | Code required, immediate session/cache invalidation |
| Emergency recovery | Offline admin procedure plus global kill switch |

If permanent grants are required, `expires_at` can be nullable, but a time-limited default is strongly preferred because the public role does not advertise the extra authority.
