# Auth-Backend — Full Revision Guide

**Purpose:** Read this before modifying Auth-Backend. It records what exists on **`main`** (committed), what is **uncommitted WIP** on your machine, what **`Auth-Production`** still runs in Coolify, and what you need to sync.

**Last reviewed:** 2026-06-27  
**Related docs:** [`Auth-Backend/README.md`](Auth-Backend/README.md) (target service doc), [`explainhere.md`](explainhere.md) (full platform routing)

---

## 1. Three states at a glance

| State | Branch / location | Routes | Module count (`src/`) | `.env.example` | README |
| --- | --- | --- | --- | --- | --- |
| **A — Committed `main` (HEAD)** | `main` @ `df2b2ce` | ~20+ `/api/auth/*` handlers (fat router) | ~116 files | Slim intent, still mentions SMTP/VAPID in comments on older commit; `df2b2ce` partially updated | Short, outdated |
| **B — Target (uncommitted WIP)** | Working tree on `main` | **6 AuthN routes** + `/health` | **33 files** in `src/` | Firebase + CORS only, rate-limit note | Full 297-line README |
| **C — Production branch** | `Auth-Production` @ `cec99e2` | Same fat router as **A** | Similar to **A** + `scripts/` + `COOLIFY.md` | Production-only, Firebase + CORS | Short, outdated |

```text
                    ┌─────────────────────────────────────┐
                    │  BEFORE (A + C — committed today)   │
                    │  Auth-Backend = auth + identity +   │
                    │  email + Firestore member logic     │
                    └─────────────────┬───────────────────┘
                                      │
                    f9837dc removed duplicate tree, scripts,
                    invites→Dashboard; routes still fat
                                      │
                    ┌─────────────────▼───────────────────┐
                    │  TARGET (B — uncommitted on main)   │
                    │  Auth-Backend = 6 AuthN routes only │
                    │  Identity → Dashboard-Backend       │
                    └─────────────────────────────────────┘
```

**Critical:** Production (`Auth-Production`) and committed `main` still expose identity routes on Auth-Backend. The **slim 6-route service exists only in uncommitted files** until you commit and merge/sync branches.

---

## 2. Git history (Auth-Backend only)

### `main`

| Commit | Summary |
| --- | --- |
| `df2b2ce` | Update `.env.example` for AuthN-only scope (still some legacy comment drift vs WIP) |
| `f9837dc` | **Major partial slim:** delete old `src/app.js`, `scripts/`, duplicate `core/middleware/` tree, invites→Dashboard; **did not** reduce `routes.js` to 6 endpoints |
| `2fdcdd1` | Full module expansion + Docker |
| `b6e2dc1` | `deployment-profiles.js` (local vs production URLs) |
| `08128d4` | Initial Auth/Dashboard split |

### `Auth-Production`

| Commit | Summary |
| --- | --- |
| `cec99e2` | Production `.env.example` — AuthN-only template |
| `5e21a08` | Slim `.env.example` to Firebase + CORS |
| `06c1600` | Sync from main (“authentication-only”) — **code still fat** |
| `d761957` | Full module sync from main |
| `4a22d72` | Coolify / myvirtualtracker.com defaults |

**Branch relationship:** `main` is **ahead 2 commits** of `origin/main` (local only). `Auth-Production` diverged — has **`COOLIFY.md`** and **`scripts/`** that `main` deleted; missing WIP slim refactor entirely.

---

## 3. Target architecture (state B — what you're building)

### Design rule

One capability, one backend. Auth-Backend owns **credential and policy APIs only**. Dashboard-Backend owns **Firestore identity, email, OTP, invites, session bootstrap**.

### Canonical routes (Auth-Backend ONLY)

Defined in `Auth-Backend/src/modules/auth/authn-paths.js`:

| Path | Method | Purpose |
| --- | --- | --- |
| `/api/auth/firebase-config` | GET | Firebase web SDK config |
| `/api/auth/readiness` | GET | Firebase Admin probe (boot gate) |
| `/api/auth/password-policy` | GET | Public rules + `version` |
| `/api/auth/validate-password` | POST | Strength check (no DB) |
| `/api/auth/verify` | POST | ID token → `{ uid, email, emailVerified }` |
| `/api/auth/resolve-sign-in-methods` | POST | Email → provider list |
| `/health` | GET | Liveness (not in authn allowlist) |

### HTTP caching (WIP)

| Route | `Cache-Control` | Notes |
| --- | --- | --- |
| `firebase-config` | `public, max-age=3600` | Stable |
| `password-policy` | `public, max-age=0, stale-while-revalidate=3600` | Revalidates every load; client uses `cache: no-cache` + `version` in `sessionStorage` |
| Everything else | `no-store` (default via `security-headers.js`) | Overridden explicitly in `routes.js` via `sendJson` `extraHeaders` |

### Rate limiting

`src/http/rate-limit.js` — in-memory per IP:

| Bucket | Limit |
| --- | --- |
| `/api/auth/*` | 25 / min / IP |
| `/api/auth/validate-password` | 40 / min / IP |
| Loopback | Exempt in dev |

Returns `429` + `Retry-After`.

### Request dispatch (`handle-request.js` — WIP)

```text
OPTIONS → CORS
TLS check
/health          → 200 (BEFORE authn allowlist)
/api/auth/*      → isAuthnApiPath? → rate limit → routes.js
unknown path     → 404
```

Removed in WIP: Firestore `503` fallback block (no Firestore routes on this service).

---

## 4. Route migration map (A/C → target B)

Routes that **exist on committed `main` and `Auth-Production`** but **must move to or already live on Dashboard-Backend** in the target architecture:

| Old path on Auth-Backend | New owner | Dashboard module (WIP) |
| --- | --- | --- |
| `POST /api/auth/send-verification-email` | Dashboard | `identity-routes.js` |
| `POST /api/auth/profile` | Dashboard | `identity-routes.js` |
| `POST /api/auth/check-email` | Dashboard | *(review — may deprecate)* |
| `POST /api/auth/phone-verification/*` | Dashboard | `identity-routes.js` |
| `POST /api/auth/access-request` | Dashboard | `identity-routes.js` |
| `POST /api/auth/complete-first-login` | Dashboard | `identity-routes.js` |
| `POST /api/auth/promote-pending-member` | Dashboard | `identity-routes.js` |
| `POST /api/auth/notify-*` | Dashboard | `identity-routes.js` |
| `POST /api/auth/presence` | Dashboard | presence module |
| `POST /api/auth/profile-avatar` | Dashboard | `identity-routes.js` |
| `GET/POST /api/auth/deactivation-*` | Dashboard | `identity-routes.js` |
| `POST /api/auth/delete-account` | Dashboard | `identity-routes.js` |
| Session bootstrap (was inline in old verify) | Dashboard | `session-bootstrap.js` |

**Client routing (WIP):** `Dashboard Web/infrastructure/api/api-backend-routes.ts` sends only the six Auth paths to `auth.myvirtualtracker.com`; gateway `deploy/Caddyfile` matches the same regex.

**Dashboard guard:** `Dashboard-Backend/src/app/handle-request.js` returns `404` + `AUTH_BACKEND_ROUTE` if Auth-owned paths hit dashapi.

---

## 5. Files removed in uncommitted WIP (~70 files, ~11k lines)

These deletions are **staged/unstaged on `main` working tree**, not on `Auth-Production`:

### HTTP middleware (identity / RBAC — no longer needed on Auth)

```text
src/http/auth-context.js
src/http/auth-middleware.js
src/http/authorization.js
src/http/invite-abuse-guard.js
src/http/invite-scope.js
src/http/member-ban-policy.js
src/http/password-validation.js
src/http/role-assignment-guard.js
src/http/role-cache.js
src/http/role-hierarchy.js
src/http/role-manage-policy.js
src/http/role-owner-policy.js
src/http/team-member-assign-policy.js
src/lib/firestore/collections.js
src/bootstrap/entity-bootstrap.js
src/bootstrap/entity-bootstrap-manifest.js
```

### Auth modules (moved to Dashboard-Backend)

```text
src/modules/auth/account-deactivation.js
src/modules/auth/app-public-url.js
src/modules/auth/auth-email-template.js
src/modules/auth/complete-first-login.js
src/modules/auth/email-config.js
src/modules/auth/invite-email.js
src/modules/auth/migrate-profile-image-fields.js
src/modules/auth/phone-verification.service.js
src/modules/auth/preprovision-email.js
src/modules/auth/profile-avatar.js
src/modules/auth/profile-collection-name.js
src/modules/auth/profile-image-resolve.js
src/modules/auth/profile-settings.js
src/modules/auth/profile-sync.js
src/modules/auth/promote-pending-member.js
src/modules/auth/readiness.js          ← Firestore probe; Auth uses Admin-only readiness inline
src/modules/auth/registration-welcome-email.js
src/modules/auth/security-login-alerts.js
src/modules/auth/security-notification-emails.js
src/modules/auth/session-authorization.js
src/modules/auth/transactional-email.js
src/modules/auth/verification-email.js
```

### Member / hierarchy / notifications (never belonged on slim Auth)

```text
src/modules/activity/activity-scope.js
src/modules/hierarchy/*
src/modules/member-relationships/*
src/modules/members/services/*         (18 files)
src/modules/notifications/*
```

### Added in WIP

```text
src/modules/auth/authn-paths.js        ← route allowlist
```

### Rewritten in WIP

```text
src/modules/auth/routes.js             976 lines → ~180 lines (6 handlers)
src/app/handle-request.js              authn allowlist + no Firestore gate
src/http/response.js                     comment: extraHeaders overrides no-store
index.js                                 explicit route list; no email startup log
src/config/env-schema.js               removed production SMTP/Resend requirement
.env.example                           Firebase + CORS only
README.md                              full service documentation
```

---

## 6. What remains in target tree (`src/` — 33 files)

```text
src/app/handle-request.js
src/config/
  deployment-profiles.js    ← local :5712 / prod auth.myvirtualtracker.com
  env.js, env-public.js, env-schema.js
  firebase.js               ← Admin SDK + web config readers
  password-policy/          ← definition, validation, blacklists, public JSON
src/core/
  create-server.js, logger.js, metrics.js
src/http/                   ← cors, rate-limit, response, security, tls, auth-token, …
src/modules/auth/
  authn-paths.js
  routes.js
src/server.js
```

**Root (unchanged across branches):**

```text
index.js, server.js, package.json, Dockerfile, .dockerignore
firebase.json, firestore.rules, firestore.indexes.json, storage.rules
hosting-public/__/auth/action.html   ← Firebase Hosting email action page (not Node API)
firebase-admin.local.json.example
firebase-web.local.json.example
.firebaserc.example
```

---

## 7. Environment variables by branch

### Target / WIP `.env.example`

```env
# AuthN only — no SMTP, no Firestore app config
PORT, NODE_ENV
FRONTEND_ORIGIN, APP_PUBLIC_URL, CORS_ORIGINS
FIREBASE_* (web + Admin)
# Rate limit note → src/http/rate-limit.js
```

### Committed `main` HEAD `.env.example` (`df2b2ce`)

- Header says AuthN-only but file **still lists** `RESEND_*`, `SMTP_*`, `FIREBASE_WEB_PUSH_VAPID_PUBLIC_KEY`, `PHONE_VERIFICATION_DEV_MODE`
- Production block still requires email in **`env-schema.js`** (removed only in WIP)

### `Auth-Production` `.env.example` (`cec99e2`)

- **Production-only** block (no `#Local DEV` section)
- Firebase + CORS only — **matches target intent**
- Coolify: `PORT=3000`, `auth.myvirtualtracker.com`

### WIP `env-schema.js` change

Removed production validator:

```text
"Production requires email delivery (RESEND_API_KEY or full SMTP)"
```

Email is no longer an Auth-Backend concern.

---

## 8. Branch-specific extras

### Only on `Auth-Production`

| File | Purpose |
| --- | --- |
| `Auth-Backend/COOLIFY.md` | Deploy settings: branch `Auth-Production`, base dir `Auth-Backend`, container `vt-auth-api`, domain `auth.myvirtualtracker.com`, health `GET /health` |
| `Auth-Backend/scripts/` | Dev/ops scripts (`sync-firebase-local.mjs`, `verify-user-email.mjs`, etc.) — **deleted on `main` in f9837dc** |

### Only in WIP (not committed anywhere)

| File | Purpose |
| --- | --- |
| `authn-paths.js` | Explicit 6-path allowlist |
| Updated `README.md` | Full Auth-Backend service doc |
| `CACHE_*` constants in `routes.js` | Explicit cache header overrides |

### `package.json` (all branches — cleanup opportunity)

Still lists dependencies possibly unused after slim:

```json
"nodemailer": "^9.0.1",
"ws": "^8.21.0"
```

Safe follow-up: remove if no imports remain after WIP commit.

---

## 9. Production deployment today vs target

### What Coolify runs (`Auth-Production`)

| Setting | Value |
| --- | --- |
| Branch | `Auth-Production` |
| Base directory | `Auth-Backend` |
| Container | `vt-auth-api` |
| Domain | `auth.myvirtualtracker.com` |
| Port | `3000` |
| Health | `GET /health` |

### Gateway routing (`deploy/Caddyfile`)

Auth paths forwarded to `auth-backend:5712`:

```text
/api/auth/(firebase-config|readiness|password-policy|validate-password|verify|resolve-sign-in-methods)
```

**Important:** If production Auth-Backend still serves fat routes (state A/C), clients using **split hosts** may hit old endpoints on auth until you deploy state B. Frontend WIP already routes only six paths to Auth.

### Boot flow (frontend WIP — needs both backends)

```text
Promise.all([
  GET auth…/api/auth/readiness
  GET dashapi…/api/readiness          ← Dashboard Firestore probe (WIP on Dashboard-Backend)
  GET auth…/firebase-config
  GET auth…/password-policy
  GET dash…/sign-in-client-extras
])
```

Either readiness failure → offline UI.

---

## 10. Cross-repo changes tied to Auth slim (uncommitted on `main`)

Auth-Backend slim is **not isolated**. Same working tree includes:

| Area | Change |
| --- | --- |
| `Dashboard-Backend` | `identity-routes.js`, `session-bootstrap.js`, `authn-paths.js` deny list, `GET /api/readiness` |
| `Dashboard Web` | `api-backend-routes.ts`, `auth-boot-prefetch.ts`, `verify-session.ts` (verify → session-bootstrap), `backend-availability.ts` |
| `deploy/` | Caddy/nginx path regex for six Auth routes |
| `explainhere.md` | Platform architecture source of truth |

Deploy Auth-Backend WIP **without** these → broken sign-in.

---

## 11. `main` vs `Auth-Production` diff summary

| Topic | `main` HEAD | `Auth-Production` |
| --- | --- | --- |
| `routes.js` | Fat (~20+ routes) | Fat (same family) |
| `authn-paths.js` | ❌ | ❌ |
| `scripts/` | ❌ deleted | ✅ still present |
| `COOLIFY.md` | ❌ | ✅ |
| `.env.example` | Local + Production blocks; legacy SMTP comments | Production-only; clean Firebase |
| `README.md` | Short | Short (older wording) |
| WIP slim refactor | ✅ on disk, uncommitted | ❌ |

**Small code delta between branches:** `promote-pending-member` import path; firebase-config error message wording — not architectural.

---

## 12. Action checklist — what to modify

### To finish the refactor (recommended order)

- [ ] **Commit WIP on `main`** — Auth-Backend slim + Dashboard identity routes + frontend routing + deploy + `explainhere.md`
- [ ] **Remove dead deps** — `nodemailer`, `ws` from `Auth-Backend/package.json` if unused
- [ ] **Sync `Auth-Production`** — merge/cherry-pick slim commit; **keep** `COOLIFY.md`; decide fate of `scripts/` (delete or move to Dashboard/monorepo tooling)
- [ ] **Update `Auth-Production` `.env.example`** — add `#Local DEV` block from main WIP if developers deploy from that branch locally
- [ ] **Copy `README.md`** to production branch after merge
- [ ] **Redeploy `vt-auth-api`** on Coolify after merge
- [ ] **Verify gateway** — only six paths hit auth container; old paths return 404 on auth
- [ ] **Smoke test** — boot (dual readiness), register, sign-in, first-login, password policy version refresh

### If you must patch production before full merge

- Minimum: ensure Coolify env has **Firebase only** (no SMTP on auth container)
- Do **not** add new identity routes on Auth-Backend — add on Dashboard-Backend + update gateway + frontend

### Files to keep in sync when adding an Auth route

1. `Auth-Backend/src/modules/auth/routes.js`
2. `Auth-Backend/src/modules/auth/authn-paths.js`
3. `Dashboard Web/infrastructure/api/api-backend-routes.ts`
4. `Dashboard-Backend/src/modules/auth/authn-paths.js` (deny list)
5. `deploy/Caddyfile` + `deploy/nginx/default.conf`
6. `Dashboard Web/next.config.mjs` (dev rewrites)
7. `Auth-Backend/README.md`, `explainhere.md`, this file

---

## 13. Quick reference — committed fat routes (states A & C)

If you are reading production logs or an old deploy, these paths may still exist on Auth-Backend:

```text
GET  /api/auth/password-policy
GET  /api/auth/readiness
GET  /api/auth/firebase-config
POST /api/auth/validate-password
POST /api/auth/verify
POST /api/auth/resolve-sign-in-methods
POST /api/auth/send-verification-email
POST /api/auth/profile
POST /api/auth/check-email
POST /api/auth/access-request
POST /api/auth/complete-first-login
POST /api/auth/promote-pending-member
POST /api/auth/phone-verification/send|confirm|exchange
POST /api/auth/notify-password-changed|notify-password-reset|notify-email-verified
POST /api/auth/presence
POST /api/auth/profile-avatar
GET  /api/auth/deactivation-requests
POST /api/auth/deactivation-request
POST /api/auth/delete-account
GET  /health
```

**Target (B):** only the first six `/api/auth/*` rows + `/health`.

---

## 14. Local dev commands

```bash
cd Auth-Backend
cp .env.example .env          # fill Firebase blocks
npm install
npm start                     # http://localhost:5712
```

```bash
# Smoke (target service)
curl -s http://localhost:5712/health
curl -s http://localhost:5712/api/auth/readiness
curl -s http://localhost:5712/api/auth/firebase-config
curl -s http://localhost:5712/api/auth/password-policy

# Should 404 after WIP deploy
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5712/api/auth/profile
```

Pair with Dashboard-Backend on `:5713` and Dashboard Web on `:3000`.

---

## 15. Summary sentence

**Auth-Backend is mid-migration:** committed `main` and `Auth-Production` still run a **fat auth+identity router**; your **working tree** implements the **final 6-route AuthN service** documented in `Auth-Backend/README.md` and `explainhere.md`. Production env templates are ahead of production **code** on `Auth-Production`. Commit WIP, sync branches, redeploy Coolify, then delete or 404 legacy paths on auth.
