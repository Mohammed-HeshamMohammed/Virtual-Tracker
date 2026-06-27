# Virtual Tracker — Production Backend & Auth Routing Architecture

How **Dashboard Web** auth flows map to **Auth-Backend** and **Dashboard-Backend** on Coolify — with **no duplicated API surface** between the two services.

---

## Design rule: one capability, one backend, one HTTP call

| Rule | Meaning |
| --- | --- |
| **No overlap** | Each `/api/...` route is implemented on **exactly one** service. The other service must not expose the same behavior. |
| **AuthN → Auth-Backend** | Token checks, Firebase web config, password policy, provider lookup — **only** on `vt-auth-api`. |
| **Identity / app → Dashboard-Backend** | Firestore profile, member link, email delivery, OTP, invites, permissions — **only** on `vt-dashboard-api`. |
| **Client orchestrates** | The browser calls Auth first, then Dashboard, in sequence. Dashboard does **not** re-expose Auth routes as shortcuts. |
| **Routing is explicit** | `api-backend-routes.ts`, `authn-paths.js`, and `deploy/Caddyfile` must list the same six Auth paths. |

If something is needed during sign-in, it is **ready as a single API** on the owning backend — not copy-pasted on both.

**Not duplication (intentional):**

| Pattern | Why it is OK |
| --- | --- |
| `verify` then `session-bootstrap` | Two steps, two jobs: (1) prove token cryptographically, (2) load app identity from Firestore. Not the same endpoint. |
| Firebase Admin on both `.env` files | Each process is separate; both need Admin for **their own** routes. API routes still do not overlap. |
| `/api/auth/*` prefix on both hosts | URL grouping only. Paths are **partitioned** — six on Auth, the rest on Dashboard. |

**Dashboard guard:** if a request hits `dashapi.*` for an Auth-owned path, Dashboard returns `404` + `AUTH_BACKEND_ROUTE` (see `Dashboard-Backend/src/app/handle-request.js`).

---

## Services

| Service | Container | Production URL | Dev | Owns |
| --- | --- | --- | --- | --- |
| **Auth-Backend** | `vt-auth-api` | https://auth.myvirtualtracker.com | `:5712` | 6 AuthN routes (below) |
| **Dashboard-Backend** | `vt-dashboard-api` | https://dashapi.myvirtualtracker.com | `:5713` | Identity + app routes (below) |
| **Dashboard Web** | `vt-dashboard-web` | https://app.myvirtualtracker.com | `:3000` | UI only — calls APIs via `apiFetch` / `apiPath` |
| **Landing Web** | `vt-landing-web` | https://myvirtualtracker.com | `:3001` | Marketing static/SSR — no auth APIs |
| **Landing API** | `vt-landing-api` *(profile only)* | https://api.myvirtualtracker.com | `:5714` | **Not deployed** in `deploy/docker-compose.yml` today. Add only if landing needs server routes (contact form, newsletter, webhooks). Otherwise collapse into Dashboard-Backend or a serverless function. |

**Production entry:**

- **Split hosts:** client uses `isAuthBackendApiPath()` → auth URL vs dashapi URL.
- **Single gateway:** `NEXT_PUBLIC_API_URL`; gateway forwards the six Auth paths to `vt-auth-api`, everything else to `vt-dashboard-api`.

---

## Canonical route ownership (no repeats)

### Auth-Backend ONLY — `authn-paths.js` / `api-backend-routes.ts`

| Path | Method | Single purpose |
| --- | --- | --- |
| `/api/auth/firebase-config` | GET | Firebase **web** SDK config |
| `/api/auth/readiness` | GET | Auth service + Firebase Admin up |
| `/api/auth/password-policy` | GET | Public password rules JSON |
| `/api/auth/validate-password` | POST | Password strength check (no Firestore) |
| `/api/auth/verify` | POST | Validate ID token only → `{ uid, email, emailVerified }` |
| `/api/auth/resolve-sign-in-methods` | POST | Email → Firebase provider list |

**Auth-Backend `.env`:** `PORT`, CORS URLs, `FIREBASE_*` only. No SMTP, Resend, phone flags, VAPID.

### Dashboard-Backend ONLY — identity & app

| Path | Method | Single purpose |
| --- | --- | --- |
| `/api/readiness` | GET | Dashboard service + Firestore probe (boot gate) |
| `/api/auth/sign-in-client-extras` | GET | Phone OTP mode + VAPID (app flags, not Firebase web config) |
| `/api/auth/session-bootstrap` | POST | Profile upsert, member link, bans, session authorization |
| `/api/auth/send-verification-email` | POST | Outbound verification email (Resend/SMTP) |
| `/api/auth/complete-first-login` | POST | Temp password → real password + member promote |
| `/api/auth/profile` | POST | Firestore profile fields |
| `/api/auth/phone-verification/*` | POST | OTP send / confirm / exchange |
| `/api/auth/access-request` | POST | Request-access form |
| `/api/auth/notify-*` | POST | Security / welcome emails |
| `/api/bootstrap` | GET | Post-login permissions |
| `/api/public/invites/*` | GET/POST | Invite flows |
| `/api/activity/agent/link/complete` | POST | Agent pairing |

Dashboard **must not** implement the six Auth rows above. Auth **must not** implement Firestore profile, SMTP, or member bootstrap.

---

## UI → API map (auth page)

| UI | Primary API calls | Owner |
| --- | --- | --- |
| Boot / loader | `readiness` (Auth), `readiness` (`GET /api/readiness` Dashboard) | Auth + Dashboard |
| Boot / loader | `firebase-config`, `password-policy` | Auth |
| Boot / loader | `sign-in-client-extras` | Dashboard |
| Sign-in sync | `verify` → `session-bootstrap` | Auth → Dashboard |
| Register guards | `resolve-sign-in-methods`, `validate-password` | Auth |
| Register save | `profile`, `send-verification-email` | Dashboard |
| Request access | `access-request` | Dashboard |
| First-login gate | `validate-password`, `complete-first-login` | Auth → Dashboard |
| Email action page | Firebase SDK; then `notify-email-verified` / `notify-password-reset` | Client → Dashboard |
| Invite / agent / transfer | `/api/public/...`, `/api/activity/...` | Dashboard |

---

## Flows (sequential API calls, no double implementation)

### Boot (parallel — one wall-clock round)

Implemented in `features/auth/services/auth-boot-prefetch.ts` → `prefetchAuthBootResources()`:

```ts
await Promise.all([
  checkBackendReadiness(),           // auth → GET /api/auth/readiness
  checkDashboardReadiness(),         // dashapi → GET /api/readiness (Firestore probe)
  prefetchFirebaseWebConfig(),       // auth
  fetchPasswordPolicy(),             // auth
  prefetchSignInClientExtras(),      // dashapi
])
// then initFirebase() — config already cached
```

Five HTTP calls across two hosts, **not** five sequential waits (~80ms perceived vs ~400ms sequential at 80ms/call).

**HTTP caching (Auth-Backend):**

| Route | `Cache-Control` | Why |
| --- | --- | --- |
| `firebase-config` | `public, max-age=3600` | Stable; rarely changes |
| `password-policy` | `public, max-age=0, stale-while-revalidate=3600` | Instant from cache; browser revalidates every load so server `version` is checked |

Client also caches policy in `sessionStorage`, keyed by server **`version`** — network fetch uses `cache: no-cache`; cache is replaced when `version` changes (offline fallback uses last cached copy).

### Session (must stay sequential)

```
POST auth.myvirtualtracker.com/api/auth/verify              ← token only
POST dashapi.myvirtualtracker.com/api/auth/session-bootstrap ← app identity
```

Code: `verify-session.ts` → `verifyIdTokenWithBackend()`; `auth-context.tsx` → `syncBackend()`.

`isLoggedIn` = Firebase user **and** successful `session-bootstrap`.

**Transient dashboard failures:** `syncBackend()` wraps `verifyIdTokenWithBackend()` in `retryWithBackoff()` (`auth-context.tsx`, `AUTH_SYNC_RETRY`). A short `vt-dashboard-api` blip retries before clearing session. User can also hit **Retry** (`retrySessionSync` / `retryConnection`).

**Auth-Backend down at boot:** `prefetchAuthBootResources()` fails auth readiness → `initError` + offline UI (`ServerConnectionOfflineScreen`), not a hung spinner.

**Dashboard-Backend down at boot:** same path — `checkDashboardReadiness()` fails → `initError` + offline UI (not silent degradation via default phone-OTP flags).

### Register

```
POST auth  …/validate-password
POST auth  …/resolve-sign-in-methods
     Firebase createUser
POST dash  …/profile
POST dash  …/send-verification-email   (or Firebase client fallback)
     Firebase signOut
```

### First login (`mustChangePassword`)

```
POST auth  …/validate-password
POST dash  …/complete-first-login
     sign out → sign in → normal session flow
```

---

## Client routing (single source of truth)

```ts
// Dashboard Web/infrastructure/api/api-backend-routes.ts
const AUTHN_EXACT = new Set([
  "/api/auth/firebase-config",
  "/api/auth/readiness",
  "/api/auth/password-policy",
  "/api/auth/validate-password",
  "/api/auth/verify",
  "/api/auth/resolve-sign-in-methods",
])
```

Keep in sync with:

- `Auth-Backend/src/modules/auth/authn-paths.js`
- `Dashboard-Backend/src/modules/auth/authn-paths.js` (deny list)
- `deploy/Caddyfile` / `deploy/nginx/default.conf`
- `Dashboard Web/next.config.mjs` (dev rewrites)

`apiFetch("/api/auth/verify")` and `apiPath("/api/...")` pick the host automatically.

---

## Environment (split by ownership, not duplicated features)

### Auth-Backend (`vt-auth-api`)

```env
NODE_ENV=production
PORT=3000

FRONTEND_ORIGIN=https://app.myvirtualtracker.com
APP_PUBLIC_URL=https://app.myvirtualtracker.com
CORS_ORIGINS=https://app.myvirtualtracker.com,https://myvirtualtracker.com

FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_PROJECT_ID=
FIREBASE_APP_ID=
# … other FIREBASE_* web fields
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

**Rate limiting (Auth-Backend):** in-memory sliding window per client IP (`src/http/rate-limit.js`), applied in `handle-request.js` before route handlers. Defaults: `/api/auth/*` → **25 req/min/IP**; `validate-password` → **40**; loopback exempt in local dev. Returns `429` + `Retry-After`. For multi-instance production, add gateway-level limits (Caddy/nginx) or Redis-backed limiter.

### Dashboard-Backend (`vt-dashboard-api`)

```env
NODE_ENV=production
PORT=3000

APP_PUBLIC_URL=https://app.myvirtualtracker.com
FRONTEND_ORIGIN=https://app.myvirtualtracker.com

RESEND_API_KEY=
RESEND_FROM=Virtual Tracker <noreply@myvirtualtracker.com>

PHONE_VERIFICATION_DEV_MODE=false
FIREBASE_WEB_PUSH_VAPID_PUBLIC_KEY=

FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

---

## Frontend file → owning API

| File | Calls | Owner |
| --- | --- | --- |
| `backend-availability.ts` | `readiness` (Auth), `/api/readiness` (Dashboard) | Auth + Dashboard |
| `auth-boot-prefetch.ts` | parallel boot (above) | Auth + Dashboard |
| `backend-config.ts` | `firebase-config` | Auth |
| `backend-config.ts` | `sign-in-client-extras` | Dashboard |
| `password-policy/fetch-policy.ts` | `password-policy` | Auth |
| `validate-password-api.ts` | `validate-password` | Auth |
| `resolve-sign-in-methods-api.ts` | `resolve-sign-in-methods` | Auth |
| `verify-session.ts` | `verify` | Auth |
| `verify-session.ts` | `session-bootstrap` | Dashboard |
| `send-verification-email-api.ts` | `send-verification-email` | Dashboard |
| `complete-first-login.ts` | `complete-first-login` | Dashboard |
| `profile-settings-api.ts` | `profile` | Dashboard |
| `phone-verification-api.ts` | `phone-verification/*` | Dashboard |
| `access-request.ts` | `access-request` | Dashboard |
| `security-notify-api.ts` | `notify-*` | Dashboard |
| `bootstrap.ts` | `/api/bootstrap` | Dashboard |

---

## Performance & resilience checklist

| Area | Status | Notes |
| --- | --- | --- |
| Route ownership / no duplication | ✅ | Single owner per path |
| Boot parallelization | ✅ | `prefetchAuthBootResources()` + `Promise.all` |
| Session flow sequencing | ✅ | `verify` → `session-bootstrap` (required order) |
| Two-domain split (`auth.*` / `dashapi.*`) | ✅ | One-time TLS/DNS per session; HTTP/2 multiplexing after |
| Cache headers on stable Auth routes | ✅ | `firebase-config` — 1h; `password-policy` — `stale-while-revalidate` |
| Policy cache invalidation | ✅ | `max-age=0` + client `cache: no-cache` + server `version` in `sessionStorage` |
| Dashboard readiness at boot | ✅ | `GET /api/readiness` in `checkDashboardReadiness()` |
| Session-bootstrap retry | ✅ | `retryWithBackoff` in `syncBackend()` |
| Auth or Dashboard down at boot | ✅ | Both readiness gates → offline UI |
| Rate limiting on Auth routes | ✅ | 25/min/IP on `/api/auth/*` (`rate-limit.js`); document gateway limits at scale |
| `vt-landing-api` | ⚠️ | Reserved in `deployment-profiles.js`; not in Coolify stack yet — justify before deploying |

---

## Summary

- **Auth-Backend** = credential and policy APIs (stateless AuthN).  
- **Dashboard-Backend** = who the user is in Virtual Tracker (stateful identity + messaging).  
- **No route is implemented twice** — the client chains HTTP calls where a flow needs both.  
- Adding a new **auth** capability → add it only on Auth-Backend and register it in `authn-paths.js` + `api-backend-routes.ts` + gateway.
