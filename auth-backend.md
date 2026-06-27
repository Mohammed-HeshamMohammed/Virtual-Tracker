# Auth-Backend — Revision & Branch Guide

**Last updated:** 2026-06-27  
**Canonical code:** `main` @ `1be9b36` — *Complete AuthN-only split: slim Auth-Backend, Dashboard identity routes, and boot resilience.*

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
core/            create-server, logger, metrics
http/            cors, rate-limit, response, security, tls, auth-token, …
modules/auth/    authn-paths.js, routes.js
```

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

## 4. `main` vs `Auth-Production`

| | **`main` (`1be9b36`)** | **`Auth-Production` (`cec99e2`)** |
| --- | --- | --- |
| **Router** | 6 AuthN routes | ~20+ fat `/api/auth/*` routes |
| **`authn-paths.js`** | ✅ | ❌ |
| **`src/` size** | 33 files | ~116+ files (old modules) |
| **`.env.example`** | Local DEV + Production; Firebase only | Production-only block; Firebase only |
| **`README.md`** | Full service doc | Short outdated blurb |
| **`COOLIFY.md`** | ❌ (use `deploy/README.md`) | ✅ Coolify cheat sheet |
| **`scripts/`** | ❌ removed | ✅ still present |
| **Coolify deploy** | **Not updated until you merge & redeploy** | **Still runs old fat API** |

```text
  main (1be9b36)  ──►  target for all new work
        │
        │  merge / cherry-pick + redeploy vt-auth-api
        ▼
  Auth-Production  ──►  what Coolify builds today (behind)
```

### After merging to `Auth-Production`, keep:

- `Auth-Backend/COOLIFY.md` — add back if merge deletes it; or point Coolify doc to `deploy/README.md`.
- Production `.env.example` — merge with `main`'s `#Local DEV` block if devs use that branch locally.

### Drop or relocate from production branch:

- `Auth-Backend/scripts/` — ops scripts; move to repo tooling or Dashboard if still needed.
- Any duplicate `src/app.js` / old `core/middleware/` tree if merge reintroduces them.

---

## 5. Sync checklist (`Auth-Production`)

- [ ] Merge `main` into `Auth-Production` (or cherry-pick `1be9b36`).
- [ ] Resolve conflicts — **keep slim `routes.js` + `authn-paths.js` from `main`**.
- [ ] Preserve `COOLIFY.md` (or copy settings into deploy docs).
- [ ] Redeploy **`vt-auth-api`** on Coolify from updated branch.
- [ ] Redeploy **`vt-dashboard-api`** and **`vt-dashboard-web`** (same commit — identity routes + client routing).
- [ ] Confirm gateway sends only six Auth paths to auth container (`deploy/Caddyfile`).
- [ ] Smoke test (below).

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

## 8. Optional follow-ups (not in `1be9b36`)

| Item | Notes |
| --- | --- |
| Remove `nodemailer`, `ws` from `Auth-Backend/package.json` | Likely unused after slim; verify no imports |
| Push `main` to `origin` | Local branch is ahead 3 commits |
| Multi-instance rate limiting | In-memory limiter today; add gateway or Redis at scale |
| Delete dead `Dashboard-Backend/src/modules/auth/routes.js` | Old fat router if nothing imports it |

---

## 9. Git log (Auth-Backend milestones)

| Commit | Branch | Summary |
| --- | --- | --- |
| **`1be9b36`** | `main` | **Full AuthN slim + Dashboard identity + boot resilience** |
| `df2b2ce` | `main` | `.env.example` AuthN scope (pre-route slim) |
| `f9837dc` | `main` | Removed scripts/duplicate tree; invites→Dashboard; routes still fat |
| `cec99e2` | `Auth-Production` | Production `.env` Firebase-only |
| `06c1600` | `Auth-Production` | Partial sync from main (routes still fat) |

---

## 10. One-line summary

**`main` ships the final 6-route Auth-Backend; `Auth-Production` still runs the old fat router until you merge `1be9b36`, redeploy Coolify, and deploy matching Dashboard + frontend from the same commit.**
