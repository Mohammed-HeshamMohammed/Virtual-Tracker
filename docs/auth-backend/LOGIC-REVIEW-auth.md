# Logic Bug Review — Auth

Part of the [full logic review](LOGIC-REVIEW.md). Covers sign-in and account/profile endpoints across Auth-Backend and Dashboard-Backend.

---

### ✅ Fixed — `/api/v1/auth/*` requests 404 instead of being served (Auth-Backend)
**File:** `Auth-Backend/src/modules/auth/routes.js:15,17-169`

Line 15 computes a normalized `authPath` (`/api/v1/auth/x` → `/api/auth/x`) but **every** route match in the file compares `url.pathname` directly — `authPath` is computed and never used again.

**Failure scenario:** `handle-request.js` explicitly allows and rate-limits both `/api/auth/*` and `/api/v1/auth/*` (its own gate correctly strips the v1 prefix), so a `/api/v1/auth/verify` request passes the gate, reaches the route matcher, matches nothing, and falls through to a 404. This breaks the documented contract (`/api/auth/*` "supports `/api/v1/auth/*` aliases") and the frontend's dev rewrite that explicitly forwards `/api/v1/auth/*` traffic here — any caller using the v1 alias gets a hard failure on verify, firebase-config, password-policy, validate-password, resolve-sign-in-methods, and readiness.

**Fix direction:** use `authPath` (not `url.pathname`) in every comparison in this file — same pattern already used correctly in `Dashboard-Backend/src/modules/auth/identity-routes.js` for every route except the one below.

**Solution:**

Six route checks in this file need the same one-word swap — `url.pathname` → `authPath` — nothing else about the function changes:

```js
// Auth-Backend/src/modules/auth/routes.js
export async function routeAuth(req, res, url, origin) {
  const authPath = url.pathname.replace(/^\/api\/v1\/auth\//, "/api/auth/");

- if (url.pathname === "/api/auth/password-policy" && req.method === "GET") {          // line 17
+ if (authPath === "/api/auth/password-policy" && req.method === "GET") {
  ...
- if (url.pathname === "/api/auth/readiness" && req.method === "GET") {                // line 24
+ if (authPath === "/api/auth/readiness" && req.method === "GET") {
  ...
- if (url.pathname === "/api/auth/validate-password" && req.method === "POST") {       // line 38
+ if (authPath === "/api/auth/validate-password" && req.method === "POST") {
  ...
- if (url.pathname === "/api/auth/firebase-config" && req.method === "GET") {          // line 78
+ if (authPath === "/api/auth/firebase-config" && req.method === "GET") {
  ...
- if (url.pathname === "/api/auth/verify" && req.method === "POST") {                  // line 94
+ if (authPath === "/api/auth/verify" && req.method === "POST") {
  ...
- if (url.pathname === "/api/auth/resolve-sign-in-methods" && req.method === "POST") { // line 129
+ if (authPath === "/api/auth/resolve-sign-in-methods" && req.method === "POST") {
```
Because `authPath` is already computed at the top of the function and does nothing but strip a `/v1` prefix that isn't there for non-v1 requests, this is a behavior-preserving change for every existing `/api/auth/*` caller — it only adds correct handling for the `/api/v1/auth/*` alias that was silently broken.

**Test to add:** a request to each of the six endpoints via `/api/v1/auth/...` (not just `/api/auth/...`) should return the same status/body as the equivalent `/api/auth/...` call — add this as a parametrized test over the six paths so a future route added to this file without using `authPath` gets caught by the same suite pattern, not just these six.

---

### ✅ Fixed — `POST /api/v1/auth/profile` 404s while the exact same request against `/api/auth/profile` works
**File:** `Dashboard-Backend/src/modules/auth/identity-routes.js:346`

`routeAuthIdentity` computes and correctly uses a normalized `authPath` for every route in the file except one: the profile-update handler compares the raw, un-normalized `url.pathname` instead:
```js
if (url.pathname === "/api/auth/profile" && req.method === "POST") { ... }
```

**Failure scenario:** A client calls `POST /api/v1/auth/profile` with `{firstName, lastName, phone, timezone}`. Because `url.pathname` is `/api/v1/auth/profile`, it never matches `/api/auth/profile`, the handler falls through, and the caller gets a 404 — even though every other v1-aliased endpoint in this same file (send-verification-email, complete-first-login, avatar, deactivation, etc.) works correctly via v1.

**Fix direction:** change the comparison on this one route to use `authPath` instead of `url.pathname`, matching the rest of the file.

**Solution:**
```js
// Dashboard-Backend/src/modules/auth/identity-routes.js:346
- if (url.pathname === "/api/auth/profile" && req.method === "POST") {
+ if (authPath === "/api/auth/profile" && req.method === "POST") {
```
One-line fix — `authPath` is already computed at the top of `routeAuthIdentity` (line 76) and used correctly by every other route in the file; this one just missed the substitution.

**Test to add:** `POST /api/v1/auth/profile` with a valid body should return the same 200 the `/api/auth/profile` equivalent returns today, not a 404. Same parametrized-test suggestion as the Auth-Backend fix above applies here too — worth covering both files with one shared test helper that hits every route twice (plain and `/v1/`-prefixed) and asserts identical responses, so this class of bug can't reappear on the next route added to either file.

---

### ✅ Fixed — auth boot crashes silently (uncaught rejection) on any firebase-config failure, incl. 429 (Dashboard-Web)
**File:** `Dashboard-Web/features/auth/services/auth-boot-prefetch.ts:14-25`, called from `Dashboard-Web/shared/providers/auth/auth-context.tsx:607`

`prefetchAuthBootResources()` runs 5 boot calls in one `Promise.all`. Only 2 of them (`checkBackendReadiness`, `checkDashboardReadiness`) return a `{ok:false}` result on failure — the other 3 are supposed to be safe to await unconditionally, but `prefetchFirebaseWebConfig()` (→ `fetchFirebaseWebConfigFromBackend()` in `backend-config.ts:59-84`) `throw`s on any non-OK response, incl. 429. `fetchPasswordPolicy()` and `prefetchSignInClientExtras()` both already catch internally and fall back to defaults — `firebase-config` is the one path that doesn't.

**Failure scenario:** matches the reported console error exactly — `Auth-Backend` returns 429 for `readiness`/`firebase-config`/`password-policy` (rate-limit bucket `auth`, 60 req/min/IP, shared across boot + repeated reloads — see `Auth-Backend/src/http/rate-limit.js`). `firebase-config`'s 429 makes `fetchFirebaseWebConfigFromBackend` throw, which rejects the `Promise.all` (`Uncaught (in promise) Error: Too many requests... at async Promise.all (index 2)` — index 2 is `prefetchFirebaseWebConfig`). Nothing catches it: `auth-boot-prefetch.ts` doesn't wrap the `Promise.all`, and the caller (`auth-context.tsx:607`) awaits it with no try/catch. The boot effect dies mid-flight — `setInitError`/`setLoading(false)` never run, so the user gets a stuck spinner instead of the offline/retry screen that a `readiness` failure would have shown. The rate limit itself resets in ≤60s, but the UI never recovers on its own because the promise chain silently died.

**Fix direction:** make `firebase-config` fail like `readiness` does — resolve to a status instead of throwing — so its failure flows into the existing `initError`/offline-UI path instead of an uncaught rejection.

**Solution:**
```ts
// Dashboard-Web/features/auth/services/auth-boot-prefetch.ts
export async function prefetchAuthBootResources(signal?: AbortSignal): Promise<BackendReadiness> {
  const [authReadiness, dashboardReadiness, firebaseConfig] = await Promise.all([
    checkBackendReadiness(signal),
    checkDashboardReadiness(signal),
    prefetchFirebaseWebConfig().then(
      () => ({ ok: true as const }),
      (e) => ({
        ok: false as const,
        code: "UNREACHABLE",
        error: e instanceof Error ? e.message : "Firebase config unavailable",
      }),
    ),
    fetchPasswordPolicy(),
    prefetchSignInClientExtras(),
  ])
  if (!authReadiness.ok) return authReadiness
  if (!dashboardReadiness.ok) return dashboardReadiness
  if (!firebaseConfig.ok) return firebaseConfig
  return { ok: true }
}
```
No change needed to `fetchPasswordPolicy`/`prefetchSignInClientExtras` — already defensive. `checkAllBackendsReady` in `backend-availability.ts` (used by `useBackendConnectionMonitor`'s 20s poll and manual retry) doesn't touch `firebase-config` at all, so it's unaffected.

**Test to add:** mock `firebase-config` returning 429/500 and assert `prefetchAuthBootResources()` resolves `{ok:false,...}` (not a rejected promise), and that `AuthProvider` surfaces `initError`/offline screen instead of hanging.

**Note (not a bug, context for the 429s):** `AUTH_LIMIT` is 60 req/min per IP for the whole `auth` rate-limit bucket, and one boot alone spends 4 of those (`readiness`, `firebase-config`, `sign-in-client-extras`, `password-policy` all land in the same bucket per `limitBucket()` in `rate-limit.js`). ~15 page loads/min from one IP (repeated refreshes while debugging, or a shared/office NAT with several people loading the dashboard at once) exhausts it. Limiter is in-memory/per-instance, resets 60s after the last hit in-window — no fix needed there unless this becomes a recurring complaint, in which case the lazy move is raising `AUTH_LIMIT` again or splitting boot calls into their own smaller bucket, not building a distributed limiter.

---

## Checked, ruled out

- `Auth-Backend/src/modules/auth/authn-paths.js` — correct.
- Session cookie issuance, session bootstrap, first-login completion, profile sync/avatar, security login alerts, verification/welcome emails, account deactivation, session authorization — retry/dedupe/authorization logic traced in detail, nothing incorrect found.
- Desktop agent linking (device secret hashing, link-session TTL/state machine, exchange/attempt-limiting, reauth ban/status checks) — no confirmed wrong-behavior bug. One very low-severity note: the two rate limiters for link attempts allow a different number of tries before lockout (10 vs 9) — cosmetic inconsistency, not incorrect behavior.
- Presence module (pub/sub dedupe, Redis/RTDB stores, idle/offline timers) — correct.
- Notifications: cooldown dedupe, transaction-guarded first-login notify, email/phone/push dispatch — correct. Side note: `notifications/routes.js` has no `/api/v1/notifications*` alias like other modules — same class of gap as the two bugs above, but the frontend doesn't call the v1 path for notifications today, so it isn't causing a live failure.
