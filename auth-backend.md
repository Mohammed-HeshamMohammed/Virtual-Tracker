# Auth-Backend — Revision & Branch Guide

**Last updated:** 2026-06-27  
**Canonical code:** `main` @ `0f95db1` (includes **`1be9b36`** — the AuthN split commit).

| Doc | Role |
| --- | --- |
| This file | What changed, branch drift, how to modify safely |
| [`Auth-Backend/README.md`](Auth-Backend/README.md) | Service reference (routes, setup, Docker) |
| [`explainhere.md`](explainhere.md) | Full platform routing (Auth + Dashboard + frontend) |

---

## 1. Current truth on `main`

Auth-Backend is a **6-route AuthN microservice**. It does not send email, touch Firestore for app data, or bootstrap members.

### Routes (only these)

| Path | Method | Owner purpose |
| --- | --- | --- |
| `/api/auth/firebase-config` | GET | Firebase web SDK config |
| `/api/auth/readiness` | GET | Firebase Admin up (boot gate) |
| `/api/auth/password-policy` | GET | Public rules + `version` |
| `/api/auth/validate-password` | POST | Password strength (no DB) |
| `/api/auth/verify` | POST | ID token → `{ uid, email, emailVerified }` |
| `/api/auth/resolve-sign-in-methods` | POST | Email → provider list |
| `/health` | GET | Liveness (Docker / Coolify) |

Allowlist: `Auth-Backend/src/modules/auth/authn-paths.js`  
Handlers: `Auth-Backend/src/modules/auth/routes.js`  
Any other `/api/auth/*` on this service → **404**.

### Environment (`.env.example`)

Firebase web + Admin, CORS URLs, `PORT` only. **No SMTP, Resend, VAPID, or phone flags.**

Production email requirement was removed from `src/config/env-schema.js`.

### Performance & security (shipped in `1be9b36`)

| Feature | Where |
| --- | --- |
| `firebase-config` cache | `public, max-age=3600` — explicit in `routes.js` |
| `password-policy` cache | `public, max-age=0, stale-while-revalidate=3600` + client `cache: no-cache` + `version` |
| Default JSON cache | `no-store` via `security-headers.js`; overridden by `sendJson` `extraHeaders` (merge order in `response.js`) |
| Rate limit | 25/min/IP on `/api/auth/*`; 40 on `validate-password`; loopback exempt |
| `/health` dispatch | Matched **before** authn allowlist in `handle-request.js` |

### Source tree (`Auth-Backend/src/` — 33 files)

```text
app/handle-request.js
config/          env, firebase, deployment-profiles, password-policy/
core/            create-server, logger, metrics.js
http/            cors, rate-limit, response, security, tls, auth-token, …
modules/auth/    authn-paths.js, routes.js
```

**`metrics.js`:** in-memory request counters (fed by `logger.js` on each request). No public HTTP route on Auth-Backend — no `GET /metrics` or `/monitor` here (ops dashboard is on Dashboard-Backend).

Root extras: `Dockerfile`, `firebase.json`, `hosting-public/__/auth/action.html` (Firebase Hosting only, not Node API).

---

## 2. What commit `1be9b36` did

### Auth-Backend (~11k lines removed)

- **`routes.js`:** ~976 lines → ~180 lines; six handlers only.
- **Deleted:** identity middleware, member/hierarchy/notification modules, email stack, Firestore bootstrap, session authorization, phone OTP, profile CRUD, deactivation, etc.
- **Added:** `authn-paths.js`, explicit cache constants in `routes.js`.
- **`handle-request.js`:** authn allowlist; removed Firestore 503 gate; `/health` comment.
- **`index.js`:** lists six routes at startup; removed email delivery log.
- **`.env.example` + README:** AuthN-only documentation.

### Moved to Dashboard-Backend (same commit)

| Capability | New home |
| --- | --- |
| Profile, avatar, settings | `identity-routes.js` |
| Session bootstrap (member link, bans, authz) | `session-bootstrap.js` |
| Verification / security emails | `identity-routes.js` |
| Phone OTP | `identity-routes.js` |
| Access request, first-login, promote member | `identity-routes.js` |
| Auth path deny list | `authn-paths.js` + `handle-request.js` |
| Dashboard boot readiness | `GET /api/readiness` (Firestore probe) |

### Frontend + deploy (same commit)

- Parallel boot: `auth-boot-prefetch.ts` (auth + dashboard readiness, config, policy, extras).
- Session: `verify` (Auth) → `session-bootstrap` (Dashboard) in `verify-session.ts`.
- Path routing: `api-backend-routes.ts`, `next.config.mjs`, `Caddyfile`, `nginx/default.conf`.
- Architecture docs: `explainhere.md`, this file.

---

## 3. Route migration reference (legacy → new owner)

Use this when reading old logs, Coolify builds, or `Auth-Production` code.

| Legacy path (was on Auth-Backend) | Now on |
| --- | --- |
| `POST /api/auth/send-verification-email` | Dashboard `identity-routes.js` |
| `POST /api/auth/profile`, `profile-avatar` | Dashboard |
| `POST /api/auth/phone-verification/*` | Dashboard |
| `POST /api/auth/access-request` | Dashboard |
| `POST /api/auth/complete-first-login` | Dashboard |
| `POST /api/auth/promote-pending-member` | Dashboard |
| `POST /api/auth/notify-*` | Dashboard |
| `POST /api/auth/presence` | Dashboard presence module |
| Deactivation / delete-account | Dashboard |
| App session identity | `POST /api/auth/session-bootstrap` (Dashboard) |

**Sign-in flow today:**

```text
POST auth…/api/auth/verify              ← token only
POST dashapi…/api/auth/session-bootstrap ← Firestore identity
```

---

## 4. Production branches (synced 2026-06-27)

| | **`main`** | **`Auth-Production`** | **`DashboardBackend-Prod`** |
| --- | --- | --- | --- |
| **Scope** | Full monorepo | `Auth-Backend/` only | `Dashboard-Backend/` only |
| **Auth router** | 6 AuthN routes | ✅ same as `main` + `COOLIFY.md` | N/A (deny list for Auth paths) |
| **Identity auth** | Dashboard modules | N/A | ✅ `identity-routes.js`, `session-bootstrap.js`, `GET /api/readiness` |
| **Remote** | `origin/main` @ `0f95db1` | `origin/Auth-Production` (pending dep sync push) | `origin/DashboardBackend-Prod` @ `983549d` |

```text
  main ──► Auth-Production     (0373304 + merge → pushed)
  main ──► DashboardBackend-Prod (983549d → pushed)
```

**Diff vs `main` (intentional):** each prod branch keeps its own `COOLIFY.md` in the service folder.

---

## 5. Deploy checklist (Coolify)

- [x] `Auth-Production` — slim Auth-Backend copied from `main`, pushed
- [x] `DashboardBackend-Prod` — identity routes + session-bootstrap from `main`, pushed
- [ ] Redeploy **`vt-auth-api`** from `Auth-Production`
- [ ] Redeploy **`vt-dashboard-api`** from `DashboardBackend-Prod`
- [ ] Redeploy **`vt-dashboard-web`** from `main` (or your dashboard web prod branch)
- [ ] Confirm gateway routes six Auth paths to auth (`deploy/Caddyfile`)
- [x] Remove dead deps (`nodemailer`, `ws`) from `Auth-Backend` on `main` — verified no `src/` imports
- [x] Sync `package.json` + `package-lock.json` to `Auth-Production` (with next push)

- [ ] Smoke test (below)

---

## 6. Smoke tests

```bash
# Auth-Backend (local :5712)
curl -s http://localhost:5712/health
curl -s http://localhost:5712/api/auth/readiness
curl -s http://localhost:5712/api/auth/firebase-config
curl -s http://localhost:5712/api/auth/password-policy

# Must 404 on slim service
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5712/api/auth/profile
# → 404

# Dashboard boot gate
curl -s http://localhost:5713/api/readiness
```

**App flows:** boot (offline UI if either readiness fails), register, sign-in, first-login, password policy refresh after server `version` change.

---

## 7. Adding or changing an Auth route

1. `Auth-Backend/src/modules/auth/routes.js`
2. `Auth-Backend/src/modules/auth/authn-paths.js`
3. `Dashboard Web/infrastructure/api/api-backend-routes.ts`
4. `Dashboard-Backend/src/modules/auth/authn-paths.js` (deny list)
5. `deploy/Caddyfile` + `deploy/nginx/default.conf`
6. `Dashboard Web/next.config.mjs`
7. Update `Auth-Backend/README.md`, `explainhere.md`, this file

**Do not** add identity, email, or Firestore routes on Auth-Backend.

---

## 8. Optional follow-ups

| Item | Notes |
| --- | --- |
| Multi-instance rate limiting | In-memory limiter today; add gateway or Redis at scale |
| Delete dead `Dashboard-Backend/src/modules/auth/routes.js` | Old fat router if nothing imports it |

---

## 9. Git log (Auth-Backend milestones)

| Commit | Branch | Summary |
| --- | --- | --- |
| **`1be9b36`** | `main` | **Full AuthN slim + Dashboard identity + boot resilience** |
| `df2b2ce` | `main` | `.env.example` AuthN scope (pre-route slim) |
| `f9837dc` | `main` | Removed scripts/duplicate tree; invites→Dashboard; routes still fat |
| **`c50b836`** | `Auth-Production` | Slim Auth-Backend from `main` + remote merge, pushed |
| **`983549d`** | `DashboardBackend-Prod` | Identity routes + session-bootstrap from `main`, pushed |
| `cec99e2` | `Auth-Production` | (superseded) Production `.env` Firebase-only |

---

## 10. One-line summary

**`main`, `Auth-Production`, and `DashboardBackend-Prod` are aligned on code. Redeploy all three Coolify services + dashboard web to activate the split in production.**
