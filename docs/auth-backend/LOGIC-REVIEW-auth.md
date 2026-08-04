# Logic Bug Review — Auth

Part of the [full logic review](LOGIC-REVIEW.md). Covers sign-in and account/profile endpoints across Auth-Backend and Dashboard-Backend.

---

### 🔴 High — `/api/v1/auth/*` requests 404 instead of being served (Auth-Backend)
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

### 🟠 High — `POST /api/v1/auth/profile` 404s while the exact same request against `/api/auth/profile` works
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

## Checked, ruled out

- `Auth-Backend/src/modules/auth/authn-paths.js` — correct.
- Session cookie issuance, session bootstrap, first-login completion, profile sync/avatar, security login alerts, verification/welcome emails, account deactivation, session authorization — retry/dedupe/authorization logic traced in detail, nothing incorrect found.
- Desktop agent linking (device secret hashing, link-session TTL/state machine, exchange/attempt-limiting, reauth ban/status checks) — no confirmed wrong-behavior bug. One very low-severity note: the two rate limiters for link attempts allow a different number of tries before lockout (10 vs 9) — cosmetic inconsistency, not incorrect behavior.
- Presence module (pub/sub dedupe, Redis/RTDB stores, idle/offline timers) — correct.
- Notifications: cooldown dedupe, transaction-guarded first-login notify, email/phone/push dispatch — correct. Side note: `notifications/routes.js` has no `/api/v1/notifications*` alias like other modules — same class of gap as the two bugs above, but the frontend doesn't call the v1 path for notifications today, so it isn't causing a live failure.
