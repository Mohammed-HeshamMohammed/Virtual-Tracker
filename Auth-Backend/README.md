# Auth-Backend

Firebase **authentication** API for Virtual Tracker — credential checks, web SDK config, and password policy only.

**AuthN only:** no SMTP, no Firestore routes, no transactional email, no member/profile/session bootstrap. Those live on **Dashboard-Backend** (`:5713` / `vt-dashboard-api`).

Full platform routing (Auth vs Dashboard split, boot flows, gateway) → repo root [`explainhere.md`](../explainhere.md).

---

## Role in the stack

| Service | Container | Dev | Production |
| --- | --- | --- | --- |
| **Auth-Backend** (this) | `vt-auth-api` | `:5712` | `https://auth.myvirtualtracker.com` |
| Dashboard-Backend | `vt-dashboard-api` | `:5713` | `https://dashapi.myvirtualtracker.com` |
| Dashboard Web | `vt-dashboard-web` | `:3000` | `https://app.myvirtualtracker.com` |

**Design rule:** each `/api/...` route is implemented on **exactly one** backend. Dashboard returns `404` + `AUTH_BACKEND_ROUTE` if an Auth-owned path hits `dashapi.*`.

The browser orchestrates multi-step flows (e.g. `verify` on Auth, then `session-bootstrap` on Dashboard). Auth-Backend never duplicates Dashboard identity logic.

---

## Routes

Six AuthN endpoints plus liveness. Allowlist: `src/modules/auth/authn-paths.js`.

| Path | Method | Purpose | Cache |
| --- | --- | --- | --- |
| `/api/auth/firebase-config` | GET | Firebase **web** SDK config (`FIREBASE_*` or `firebase-web.local.json`) | `public, max-age=3600` |
| `/api/auth/readiness` | GET | Firebase Admin configured and reachable (boot gate) | none |
| `/api/auth/password-policy` | GET | Public password rules JSON + `version` field | `public, max-age=0, stale-while-revalidate=3600` |
| `/api/auth/validate-password` | POST | Password strength check (no Firestore) | none |
| `/api/auth/verify` | POST | Validate Firebase ID token → `{ uid, email, emailVerified }` | none |
| `/api/auth/resolve-sign-in-methods` | POST | Email → Firebase provider list | none |
| `/health` | GET | Container liveness (`{ ok: true, service: "auth-backend" }`) | none |

### Response shapes (summary)

- **`firebase-config`** — `{ success: true, config: { apiKey, authDomain, projectId, appId, … } }`
- **`readiness`** — `{ success: true, firebase: "ok" }` or `503` + `SERVICE_UNAVAILABLE`
- **`password-policy`** — `{ success: true, version, lastUpdated, passwordPolicy: { minLength, … } }`
- **`validate-password`** — `{ success, valid, error?, requirements? }`
- **`verify`** — Bearer ID token in body/header → `{ success: true, user: { uid, email, emailVerified } }`
- **`resolve-sign-in-methods`** — `{ email }` → `{ success: true, methods, identities }`

Handlers: `src/modules/auth/routes.js`. Unknown `/api/auth/*` paths → `404`.

**Dispatch order (`handle-request.js`):** `GET /health` is matched **before** the `/api/auth/*` authn allowlist. `/health` is not in `authn-paths.js`; if it were checked against that set it would 404.

### Not on this service

| Capability | Owner |
| --- | --- |
| `session-bootstrap`, profile, member link | Dashboard-Backend |
| Verification / security emails (Resend/SMTP) | Dashboard-Backend |
| Phone OTP, invites, `/api/bootstrap` | Dashboard-Backend |
| Dashboard boot readiness (`GET /api/readiness`) | Dashboard-Backend |

---

## Client integration

Dashboard Web calls this service via `apiPath()` / `apiFetch()` when the path is in `Dashboard Web/infrastructure/api/api-backend-routes.ts` (same six paths as `authn-paths.js`).

### Boot (parallel with Dashboard)

```ts
await Promise.all([
  checkBackendReadiness(),        // GET /api/auth/readiness  ← this service
  checkDashboardReadiness(),      // GET /api/readiness       ← Dashboard-Backend
  prefetchFirebaseWebConfig(),    // GET /api/auth/firebase-config
  fetchPasswordPolicy(),          // GET /api/auth/password-policy
  prefetchSignInClientExtras(),   // Dashboard only
])
```

If auth readiness fails → offline UI (`ServerConnectionOfflineScreen`), not a hung spinner.

**Policy cache:** server returns a `version` field; client revalidates every load (`cache: no-cache` + `stale-while-revalidate` header). `sessionStorage` holds last good copy for offline fallback.

### Session (Auth step only)

```
POST /api/auth/verify              ← this service (token only)
POST /api/auth/session-bootstrap   ← Dashboard-Backend (identity)
```

Code: `Dashboard Web/features/auth/services/verify-session.ts`.

---

## Rate limiting

Applied in `src/app/handle-request.js` before route handlers (`src/http/rate-limit.js`).

| Bucket | Limit | Window |
| --- | --- | --- |
| `/api/auth/*` (except below) | 25 req | per IP, per minute |
| `/api/auth/validate-password` | 40 req | per IP, per minute |

- Loopback (`127.0.0.1`, `::1`) is **exempt** in local dev.
- Over limit → `429` + `Retry-After` JSON body.
- In-memory per process — fine for single instance; use gateway limits or Redis at scale.

---

## Setup

### 1. Environment

Copy the `#Local DEV` or `#Production` block from [`.env.example`](.env.example) into `.env` (never commit `.env`).

**Required variables:**

| Variable | Purpose |
| --- | --- |
| `PORT` | `5712` (dev) / `3000` (production container) |
| `FRONTEND_ORIGIN` | Primary allowed CORS origin |
| `APP_PUBLIC_URL` | App URL (redirects / links) |
| `CORS_ORIGINS` | Optional comma-separated extra origins |
| `FIREBASE_*` | Web client config (or use local JSON file) |
| `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` | Admin SDK (or service account JSON) |

No SMTP, Resend, phone flags, or VAPID — those belong in Dashboard-Backend.

### 2. Firebase credentials

**Option A — local JSON (recommended for dev):**

```text
Auth-Backend/firebase-admin.local.json   ← copy from firebase-admin.local.json.example
Auth-Backend/firebase-web.local.json     ← copy from firebase-web.local.json.example
```

**Option B — `.env` fields:** set `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, and Admin credentials.

### 3. Run

```bash
cd Auth-Backend
npm install
npm start
```

Listens on `http://localhost:5712` by default. Pair with **Dashboard-Backend** on `:5713` and **Dashboard Web** on `:3000`.

### 4. Smoke test

```bash
curl -s http://localhost:5712/health
curl -s http://localhost:5712/api/auth/readiness
curl -s http://localhost:5712/api/auth/firebase-config
curl -s http://localhost:5712/api/auth/password-policy
```

---

## Docker

```bash
docker build -t vt-auth-api .
docker run --env-file .env -p 5712:5712 vt-auth-api
```

- **Image:** `node:20-alpine`, production `npm ci --omit=dev`
- **Healthcheck:** `GET /health` every 30s
- **Coolify:** container `vt-auth-api`, domain `auth.myvirtualtracker.com`

Gateway path routing (Caddy/nginx) must forward **only** the six Auth paths to this container — see `deploy/Caddyfile` and `deploy/nginx/default.conf`.

---

## Firebase Hosting (email action page)

Static Firebase Auth action handler for email verification / password reset links:

| Path | File |
| --- | --- |
| `/__/auth/action` | `hosting-public/__/auth/action.html` |

Deploy separately via Firebase CLI (`firebase.json` in this folder). Not served by the Node HTTP server.

Also in repo (Firebase project config, not runtime API):

- `firestore.rules`, `firestore.indexes.json`, `storage.rules` — deploy with Firebase; **no Firestore API routes** in this service.

---

## Project layout

```text
Auth-Backend/
├── index.js                 # Entry — startServer(), route banner
├── server.js                # createServer() wrapper
├── Dockerfile
├── .env.example             # Local DEV + Production templates
├── firebase.json            # Hosting + rules deploy config
├── hosting-public/          # Firebase Auth action HTML
│
└── src/
    ├── app/
    │   └── handle-request.js    # CORS, TLS, rate limit, route dispatch
    ├── config/
    │   ├── env.js               # Zod-validated env
    │   ├── firebase.js          # Admin SDK + web config readers
    │   ├── deployment-profiles.js
    │   └── password-policy/     # Rules, validation, public JSON
    ├── core/
    │   ├── create-server.js     # Node HTTP server + error shell
    │   ├── logger.js
    │   └── metrics.js
    ├── http/                    # Shared HTTP utilities
    │   ├── cors.js
    │   ├── rate-limit.js
    │   ├── response.js          # sendJson + extra headers (Cache-Control)
    │   ├── security-headers.js
    │   ├── tls-enforcement.js
    │   ├── auth-token.js
    │   ├── password-request-guard.js
    │   └── …
    └── modules/
        └── auth/
            ├── authn-paths.js   # Route allowlist (keep in sync with frontend + gateway)
            └── routes.js        # Six AuthN handlers
```

---

## Security

| Layer | Implementation |
| --- | --- |
| CORS | `src/http/cors.js` — origins from env / `deployment-profiles.js` defaults |
| HTTPS | `tls-enforcement.js` — rejects insecure requests in production |
| Headers | `security-headers.js` — `Cache-Control: no-store` default on JSON via `sendJson` |
| Cache overrides | `routes.js` passes explicit `Cache-Control` in `sendJson` `extraHeaders`; merged **after** security headers in `response.js`, so cacheable routes win intentionally |
| Rate limit | Per-IP sliding window on all `/api/auth/*` routes |
| Password in URL | `password-request-guard.js` — rejects sensitive query params |
| Body validation | `validate-body.js`, size limits via `read-json-body.js` |
| Errors | `sanitize-error.js` — safe client messages |

Firebase handles Firebase-side abuse (Auth quotas). This service adds backend rate limits on public Auth routes (`verify`, `resolve-sign-in-methods`, etc.).

**Cache-Control merge (do not rely on defaults for cacheable routes):**

```js
// response.js — extraHeaders overrides no-store
{ ...getSecurityHeaders(req), ...extraHeaders }

// routes.js — named constants, passed on every cacheable handler
sendJson(res, origin, 200, payload, req, { "Cache-Control": CACHE_FIREBASE_CONFIG })
sendJson(res, origin, 200, payload, req, { "Cache-Control": CACHE_PASSWORD_POLICY })
```

All other Auth routes omit `extraHeaders` and keep `no-store`.

---

## Adding or changing a route

1. Implement handler in `src/modules/auth/routes.js`
2. Add path to `src/modules/auth/authn-paths.js`
3. Sync to:
   - `Dashboard Web/infrastructure/api/api-backend-routes.ts`
   - `Dashboard-Backend/src/modules/auth/authn-paths.js` (deny list)
   - `deploy/Caddyfile` / `deploy/nginx/default.conf`
   - `Dashboard Web/next.config.mjs` (dev rewrites)
4. Update [`explainhere.md`](../explainhere.md) and this README

**Do not** add identity, email, or Firestore routes here — use Dashboard-Backend.

---

## Checklist (Auth-Backend scope)

| Area | Status |
| --- | --- |
| Six AuthN routes only | ✅ |
| No overlap with Dashboard-Backend | ✅ |
| Boot readiness (`/api/auth/readiness`) | ✅ |
| Cache: explicit overrides in `routes.js` (merge order in `response.js`) | ✅ |
| `/health` before authn allowlist in `handle-request.js` | ✅ |
| Policy `version` for client invalidation | ✅ |
| Rate limiting on `/api/auth/*` | ✅ |
| `.env` Firebase + CORS only (no SMTP) | ✅ |
| Gateway + frontend path sync documented | ✅ |

---

## Related docs

- [`../explainhere.md`](../explainhere.md) — full auth routing architecture, boot/session flows, env split
- [`../Dashboard-Backend/README.md`](../Dashboard-Backend/README.md) — identity and app APIs
- [`../deploy/README.md`](../deploy/README.md) — Coolify / gateway deployment
