# Dashboard-Backend (`vt-dashboard-api`)

Business-domain and identity API for the Virtual Tracker platform. Handles Firestore
profiles, member management, project/task/client data, real-time activity and presence,
and org hierarchy.

> **Design rule — one capability, one backend, one HTTP call.**  
> Every `/api/...` route is implemented on exactly one service.
> Auth-Backend and Dashboard-Backend have zero route overlap.

Pair with **Auth-Backend** (`../Auth-Backend`, port `5712`) which owns the six AuthN
routes, and **Notify-Backend** (`../Notify-Backend`, port `5715`) which owns all
outbound messaging (email, SMS, push).  
Frontend: **Dashboard Web** (`../Dashboard Web`, `vt-dashboard-web`).

---

## Platform Services

| Service | Container | Production URL | Dev port | Owns |
| --- | --- | --- | --- | --- |
| **Auth-Backend** | `vt-auth-api` | https://auth.myvirtualtracker.com | `:5712` | 6 AuthN routes |
| **Dashboard-Backend** | `vt-dashboard-api` | https://dashapi.myvirtualtracker.com | `:5713` | Identity + all app routes |
| **Notify-Backend** | `vt-notify-api` | https://notify.myvirtualtracker.com | `:5715` | Email, SMS/OTP, push — internal only |
| **Dashboard Web** | `vt-dashboard-web` | https://app.myvirtualtracker.com | `:3000` | UI only |
| **Landing Web** | `vt-landing-web` | https://myvirtualtracker.com | `:3001` | Marketing static/SSR |

---

## Blast Radius Design

Dashboard-Backend holds Firebase Admin credentials and Firestore access.  
Outbound messaging credentials live **only** on Notify-Backend — a breach here
cannot send email, SMS, or push notifications to users.

```
Browser
  └─► vt-dashboard-api    (Firebase Admin, Firestore, VAPID-free)
            │
            │  internal only · shared secret · template IDs only
            ▼
      vt-notify-api        (Resend, SMS provider, VAPID — nothing else)
            │
            ├─► Resend          (email)
            ├─► SMS provider    (OTP)
            └─► FCM / VAPID     (push)
```

**What this prevents:** if Dashboard-Backend is compromised, the attacker gets
Firestore data but cannot send phishing email, SMS, or push messages to your users
as `noreply@myvirtualtracker.com`.

---

## Route Ownership (no repeats)

### Auth-Backend ONLY — `authn-paths.js` / `api-backend-routes.ts`

| Path | Method | Single purpose |
| --- | --- | --- |
| `/api/auth/firebase-config` | GET | Firebase web SDK config |
| `/api/auth/readiness` | GET | Auth service + Firebase Admin up |
| `/api/auth/password-policy` | GET | Public password rules JSON |
| `/api/auth/validate-password` | POST | Password strength check (no Firestore) |
| `/api/auth/verify` | POST | Validate ID token → `{ uid, email, emailVerified }` |
| `/api/auth/resolve-sign-in-methods` | POST | Email → Firebase provider list |

### Dashboard-Backend ONLY — identity & app routes

| Path | Method | Single purpose | Extraction status |
| --- | --- | --- | --- |
| `/api/readiness` | GET | Dashboard + Firestore probe (boot gate) | — |
| `/api/auth/sign-in-client-extras` | GET | Phone OTP mode flags (no VAPID key) | — |
| `/api/auth/session-bootstrap` | POST | Profile upsert, member link, bans, authz | — |
| `/api/auth/complete-first-login` | POST | Temp password → real + member promote | — |
| `/api/auth/profile` | POST | Firestore profile fields | — |
| `/api/auth/access-request` | POST | Request-access form | — |
| `/api/bootstrap` | GET | Post-login permissions | — |
| `/api/public/invites/*` | GET/POST | Invite flows | — |
| `/api/activity/agent/link/complete` | POST | Agent pairing | — |
| `/api/members`, `/api/roles`, `/api/member-roles` | CRUD | Org members and roles | — |
| `/api/projects`, `/api/tasks`, `/api/clients`, `/api/teams` | CRUD | Core work entities | — |
| `/api/dashboard`, `/api/activity`, `/api/presence` | GET/POST | Telemetry + real-time | — |
| `/monitor` | GET | Ops dashboard (gateway IP-restricted) | — |
| `/api/auth/send-verification-email` | POST | Verification email | ⚠️ Move to `vt-notify-api` |
| `/api/auth/notify-*` | POST | Security / welcome emails | ⚠️ Move to `vt-notify-api` |
| `/api/auth/phone-verification/*` | POST | OTP send / confirm / exchange | ⚠️ Move to `vt-notify-api` |
| `/api/notifications/*` | GET/POST | Push notification delivery | ⚠️ Move to `vt-notify-api` |

### Notify-Backend ONLY (after extraction)

| Path | Method | Single purpose |
| --- | --- | --- |
| `/api/notify/readiness` | GET | Notify service health |
| `/api/notify/email` | POST | Send templated email via Resend |
| `/api/notify/otp/send` | POST | Send OTP via SMS provider |
| `/api/notify/otp/verify` | POST | Verify OTP code |
| `/api/notify/otp/exchange` | POST | Exchange OTP for session token |
| `/api/notify/push` | POST | Send push notification via VAPID/FCM |

**Notify-Backend is not public.** No browser ever calls it directly. Only
`vt-dashboard-api` can reach it via `INTERNAL_SERVICE_SECRET`.

**Dashboard guard:** requests to `dashapi.*` for an Auth-owned path return
`404 AUTH_BACKEND_ROUTE` (see `src/app/handle-request.js`).

---

## What Needs to Move Out of This Service

### Step 1 — Move to `Notify-Backend/` (do this first)

```
Dashboard-Backend/src/modules/auth/
  identity-routes.js          ← extract email handlers to Notify-Backend
  phone-verification.js       ← move entirely to Notify-Backend

Dashboard-Backend/src/modules/notifications/
  *.js                        ← move entirely to Notify-Backend
```

**Credentials to remove from this service after extraction:**

```env
# Remove these from Dashboard-Backend .env once vt-notify-api is live:
RESEND_API_KEY              → moves to Notify-Backend
RESEND_FROM                 → moves to Notify-Backend
FIREBASE_WEB_PUSH_VAPID_PUBLIC_KEY → moves to Notify-Backend
# SMS provider key (Twilio or equivalent) → moves to Notify-Backend
```

**Replace outbound calls in `identity-routes.js` with:**

```js
// Before — direct Resend call inside Dashboard-Backend
await resend.emails.send({ to, subject, html })

// After — internal POST to Notify-Backend (template ID only, never raw content)
await notifyFetch('/api/notify/email', {
  template: 'verification',
  userId: uid,               // Notify-Backend resolves the address itself
})
// Authorization: Bearer INTERNAL_SERVICE_SECRET (set in notifyFetch wrapper)
```

**Why template IDs only:** if Dashboard-Backend is compromised, the attacker
can only trigger known templates for real users — they cannot send arbitrary
content to arbitrary addresses.

### Step 2 — Restrict `/monitor` at the gateway (do this before first production deploy)

`/monitor` exposes internal system state. Restrict it at Caddy/nginx level —
no code change required:

```nginx
# deploy/nginx/default.conf
location /monitor {
    allow YOUR_OFFICE_OR_VPN_IP;
    deny all;
    proxy_pass http://vt-dashboard-api;
}
```

```
# deploy/Caddyfile
dashapi.myvirtualtracker.com {
    @monitor path /monitor*
    handle @monitor {
        @allowed remote_ip YOUR_OFFICE_OR_VPN_IP
        handle @allowed {
            reverse_proxy vt-dashboard-api:3000
        }
        respond 403
    }
}
```

### Step 3 — `vt-landing-api` (defer until justified)

Still not in the Coolify stack. Add only when Landing Web needs a server route
(contact form, newsletter, webhooks). Until then do not deploy.

---

## Architecture & Directory Structure

```text
src/
├── app.js                      # TLS, CORS, security headers
├── server.js                   # HTTP server factory
├── app/
│   └── handle-request.js       # Pipeline + routing controller
├── config/                     # env.js, firebase.js, env-schema.js
├── core/                       # logger.js, metrics.js (internal), create-server.js
├── http/                       # Middleware, guards, access policies (34 files)
│   ├── cors.js
│   ├── rate-limit.js
│   ├── security-headers.js
│   ├── tls-enforcement.js
│   ├── validate-body.js
│   ├── sanitize-error.js
│   ├── role-hierarchy.js
│   ├── role-assignment-guard.js
│   ├── project-access.js
│   ├── task-access.js
│   └── …
└── modules/
    ├── auth/                   # authn-paths.js (deny list), identity-routes.js,
    │                           # session-bootstrap.js
    │                           # ⚠️ email + OTP handlers → extract to Notify-Backend
    ├── members/
    ├── member-relationships/
    ├── hierarchy/
    ├── member-onboarding/
    ├── projects/
    ├── tasks/
    ├── clients/
    ├── teams/
    ├── activity/
    ├── presence/
    ├── dashboard/
    ├── notifications/          # ⚠️ move entirely to Notify-Backend
    ├── schema/
    ├── compat/
    ├── bootstrap/
    └── monitor/                # ⚠️ gateway IP-restrict before first deploy
```

---

## Request Pipeline

All requests flow through `src/app/handle-request.js` in this order:

```
1. CORS preflight              OPTIONS handled immediately
2. TLS enforcement             rejects non-HTTPS in production
3. Sensitive query guard       prevents credential leaks in logs
4. Auth-Backend guard          404 + AUTH_BACKEND_ROUTE for Auth-owned paths
5. Rate limiting               per-IP sliding window before any domain logic
6. Authentication              enforceApiAuthentication → Firebase Admin verify
7. Domain routing              dispatches to src/modules/
```

Step 6 means every domain route is authenticated by default.
No handler runs without a verified Firebase token.

---

## Environment Variables

```env
NODE_ENV=production
PORT=3000              # dev default: 5713

APP_PUBLIC_URL=https://app.myvirtualtracker.com
FRONTEND_ORIGIN=https://app.myvirtualtracker.com

# Outbound messaging — present until vt-notify-api extraction is complete
RESEND_API_KEY=                         # ⚠️ remove after extraction
RESEND_FROM=Virtual Tracker <noreply@myvirtualtracker.com>  # ⚠️ remove after extraction
PHONE_VERIFICATION_DEV_MODE=false       # ⚠️ remove after extraction
FIREBASE_WEB_PUSH_VAPID_PUBLIC_KEY=     # ⚠️ remove after extraction

# Internal service auth — add when vt-notify-api is live
# NOTIFY_BACKEND_URL=https://notify.myvirtualtracker.com
# INTERNAL_SERVICE_SECRET=

# Firebase Admin (Firestore + identity)
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
# Or full service account JSON:
# FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
```

**Does not need:** `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID` —
those are Auth-Backend only.

---

## Auth & Session Flows

### Boot (parallel — one wall-clock round)

```ts
await Promise.all([
  checkBackendReadiness(),         // Auth-Backend: GET /api/auth/readiness
  checkDashboardReadiness(),       // Dashboard:    GET /api/readiness
  prefetchFirebaseWebConfig(),     // Auth-Backend
  fetchPasswordPolicy(),           // Auth-Backend
  prefetchSignInClientExtras(),    // Dashboard
])
```

### Session (must stay sequential)

```
POST auth.myvirtualtracker.com/api/auth/verify
POST dashapi.myvirtualtracker.com/api/auth/session-bootstrap
```

`isLoggedIn` = Firebase user + successful `session-bootstrap`.
`retryWithBackoff` in `syncBackend()` handles transient blips.

---

## Setup

```bash
cd Dashboard-Backend
npm install
npm run dev    # watch mode
npm start      # production
```

Run Auth-Backend on `:5712` in parallel for full platform behaviour.

### Smoke tests

```bash
# Boot gate
curl -s http://localhost:5713/api/readiness

# Auth deny list — must 404
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:5713/api/auth/firebase-config
# → 404
```

---

## Performance & Resilience Checklist

| Area | Status | Notes |
| --- | --- | --- |
| Route ownership / no duplication | ✅ | Single owner per path |
| Boot parallelization | ✅ | `Promise.all` across both backends |
| Session flow sequencing | ✅ | `verify` → `session-bootstrap` |
| Cache headers on stable Auth routes | ✅ | Owned by Auth-Backend |
| Dashboard readiness at boot | ✅ | `GET /api/readiness` Firestore probe |
| Session-bootstrap retry | ✅ | `retryWithBackoff` in `syncBackend()` |
| Auth or Dashboard down at boot | ✅ | Both gates → offline UI |
| Rate limiting | ✅ | Per-IP sliding window; Redis/gateway at scale |
| Role + resource guards on every route | ✅ | `src/http/` policies |
| `/monitor` gateway IP restriction | ⚠️ | Do before first production deploy |
| Blast radius — email extraction | ⚠️ | `RESEND_API_KEY` still here; extract to `vt-notify-api` |
| Blast radius — OTP extraction | ⚠️ | Phone verification still here; extract to `vt-notify-api` |
| Blast radius — push extraction | ⚠️ | VAPID key still here; extract to `vt-notify-api` |
| `vt-landing-api` | ⚠️ | Not deployed; justify before adding |

---

## Related Docs

- [`../explainhere.md`](../explainhere.md) — full auth routing, boot/session flows, env split
- [`../Auth-Backend/README.md`](../Auth-Backend/README.md) — the six AuthN routes
- [`../Notify-Backend/README.md`](../Notify-Backend/README.md) — email, OTP, push (build next)
- [`../deploy/README.md`](../deploy/README.md) — Coolify / gateway deployment