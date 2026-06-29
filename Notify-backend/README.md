# Notify-Backend (`vt-notify-api`)

Outbound messaging service for the Virtual Tracker platform.  
**Internal only** — no browser ever calls this service directly.

> **Design rule — blast radius isolation.**  
> Messaging credentials (SMTP host credentials, Firebase Admin SDK service account, SMS provider tokens) live **only here**.  
> A breach of Dashboard-Backend cannot send phishing email or SMS to users.

Pair with **Dashboard-Backend** (`../Dashboard-Backend`, port `5713`) which is the only
caller. Authorization is enforced via `INTERNAL_SERVICE_SECRET`.

---

## Platform Services

| Service | Container | Production URL | Dev port | Owns |
| --- | --- | --- | --- | --- |
| **Auth-Backend** | `vt-auth-api` | https://auth.myvirtualtracker.com | `:5712` | 6 AuthN routes |
| **Dashboard-Backend** | `vt-dashboard-api` | https://dashapi.myvirtualtracker.com | `:5713` | Identity + app routes |
| **Notify-Backend** | `vt-notify-api` | https://notify.myvirtualtracker.com | `:5715` | Email, OTP, push — internal only |
| **Dashboard Web** | `vt-dashboard-web` | https://app.myvirtualtracker.com | `:3000` | UI only |

---

## Blast Radius Design

```
Browser
  └─► vt-dashboard-api    (Firebase Admin, Firestore — no messaging creds)
            │
            │  Authorization: Bearer INTERNAL_SERVICE_SECRET
            │  template IDs only, never raw email content
            ▼
      vt-notify-api        (SMTP, SMS provider, Firebase Admin FCM — nothing else)
            │
            ├─► SMTP            (email)
            ├─► SMS provider    (OTP)
            └─► Firebase FCM    (push)
```

**What this prevents:** if Dashboard-Backend is compromised, the attacker gets
Firestore data but cannot send phishing email, SMS, or push messages to users
as `noreply@myvirtualtracker.com`.

---

## Route Ownership

| Path | Method | Single purpose |
| --- | --- | --- |
| `/health` | GET | Process health (unauthenticated) |
| `/api/notify/readiness` | GET | Service health (unauthenticated) |
| `/api/notify/email` | POST | Send templated email via SMTP |
| `/api/notify/otp/send` | POST | Send OTP via SMS provider |
| `/api/notify/otp/verify` | POST | Verify OTP code → verification token |
| `/api/notify/otp/exchange` | POST | Exchange Firebase phone auth → verification token |
| `/api/notify/push` | POST | Send push notification via Firebase FCM |

All routes except `/health` and `/api/notify/readiness` require:

```
Authorization: Bearer INTERNAL_SERVICE_SECRET
```

**No public browser access.** Only `vt-dashboard-api` should ever call this service.

---

## Email Security — Template IDs Only

Dashboard-Backend sends `{ template, email, ... }` — never raw email content:

```js
// Dashboard-Backend → Notify-Backend (correct)
await notifyFetch('/api/notify/email', {
  template: 'verification',
  email: user.email,
  verificationLink: link,
})

// Never allowed — arbitrary content would defeat blast-radius isolation
await notifyFetch('/api/notify/email', {
  subject: 'Your account',
  html: '<a href="...">Click here</a>',
})
```

Allowed templates: `verification`, `password-updated`, `new-sign-in-alert`, `phone-verified`.

---

## Directory Structure

```text
src/
├── app/
│   └── handle-request.js     # Pipeline: CORS → health → internal-auth → routing
├── config/
│   ├── env.js                # Zod env schema + getEnv()
│   └── firebase.js           # Firebase Admin SDK init (FCM only, no Firestore)
├── core/
│   └── logger.js             # Startup banner, request/response logging
├── http/
│   ├── internal-auth.js      # Bearer INTERNAL_SERVICE_SECRET guard
│   └── response.js           # sendJson() helper
└── modules/
    ├── email/
    │   ├── email-config.js       # SMTP status check
    │   ├── email-template.js     # Branded HTML template
    │   ├── email-builders.js     # Per-template builders + send functions
    │   ├── transactional-email.js # SMTP sender with dev console fallback
    │   └── routes.js             # POST /api/notify/email
    ├── otp/
    │   ├── otp-service.js        # OTP send/verify/exchange (in-memory; replace with Redis)
    │   └── routes.js             # /api/notify/otp/*
    └── push/
        └── routes.js             # POST /api/notify/push (FCM helper)
```

---

## Request Pipeline

```
1. CORS preflight         OPTIONS handled immediately
2. Health check           GET /health (no auth)
3. Readiness              GET /api/notify/readiness (no auth)
4. Internal-auth guard    Authorization: Bearer INTERNAL_SERVICE_SECRET
5. Domain routing         email | otp | push
```

---

## Environment Variables

```env
NODE_ENV=production
PORT=3000              # dev default: 5715

# Internal auth — required in production
INTERNAL_SERVICE_SECRET=

# Email (SMTP credentials)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# OTP
PHONE_VERIFICATION_DEV_MODE=false

# Firebase Admin (FCM push credentials)
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
```

**Does not need:** Firestore access, session tokens, or any user identity credentials.

---

## Setup

```bash
cd Notify-Backend
npm install
npm run dev    # watch mode, port 5715
npm start      # production
```

### Smoke tests

```bash
# Health (no auth)
curl -s http://localhost:5715/health

# Readiness (no auth)
curl -s http://localhost:5715/api/notify/readiness

# Email (requires secret — skip auth in dev by leaving INTERNAL_SERVICE_SECRET unset)
curl -s -X POST http://localhost:5715/api/notify/email \
  -H "Content-Type: application/json" \
  -d '{"template":"verification","email":"test@example.com","verificationLink":"https://example.com/verify"}'

# OTP send (dev mode)
curl -s -X POST http://localhost:5715/api/notify/otp/send \
  -H "Content-Type: application/json" \
  -d '{"phone":"+1234567890"}'
```

---

## Adding a New Email Template

1. Add builder function in `src/modules/email/email-builders.js`
2. Add send function in the same file
3. Register the template name in the `ALLOWED_TEMPLATES` set in `src/modules/email/routes.js`
4. Add the dispatch case in `dispatchEmailTemplate()`

Never add raw-content paths — only template IDs.

---

## Related Docs

- [`../Dashboard-Backend/README.md`](../Dashboard-Backend/README.md) — caller service; see "What Needs to Move Out"
- [`../Auth-Backend/README.md`](../Auth-Backend/README.md) — the six AuthN routes
- [`../explainhere.md`](../explainhere.md) — full platform architecture
- [`../deploy/README.md`](../deploy/README.md) — Coolify / gateway deployment
