# notify-Production Branch — Notification Backend Service

> **Branch**: `notify-Production`  
> **Latest Commit**: `52e3dbe` — chore(notify-backend): add programmatic env loading and clean start script  
> **Tracks**: `origin/notify-Production`  
> **Role**: Production deployment branch containing the Notify-backend with supporting services

---

## 1. Branch Purpose

The `notify-Production` branch contains the **Notify-backend notification service** along with the full supporting ecosystem (Dashboard-Backend, Landing-Web, deploy infrastructure). It serves as both the production branch for the notification service and a full-stack reference deployment.

### What's Included
- `Notify-backend/` — Notification microservice (email, phone, push)
- `Dashboard-Backend/` — Core business API
- `Landing-Web/` — Marketing site
- `deploy/` — Docker Compose + Caddy gateway

### What's Excluded
- Auth-Backend (separate `Auth-Production` branch)
- Dashboard-Web (separate `dashboard-web-production` branch)
- `.env.example` files
- Root-level markdown documentation

---

## 2. Notify-Backend — Complete Service Documentation

### 2.1 Purpose
Internal-only microservice that handles all outbound notifications: transactional emails, phone number validation, and push notifications via Firebase Cloud Messaging (FCM). It is designed to be called by other backend services using a shared internal secret — **not directly accessible from the public internet**.

### 2.2 Architecture

```
Notify-backend/
├── index.js                  # Entry point (env loading, server start)
├── package.json              # Dependencies & scripts
├── server.js                 # HTTP server bootstrap
└── src/
    ├── app/
    │   └── handle-request.js # Central request router
    ├── config/
    │   ├── env.js            # Environment configuration
    │   └── firebase.js       # Firebase Admin (FCM, Firestore)
    ├── core/
    │   └── logger.js         # Structured request/response logging
    ├── http/
    │   ├── internal-auth.js  # INTERNAL_SERVICE_SECRET auth guard
    │   └── response.js       # JSON response helpers
    ├── lib/
    │   ├── db.js             # PostgreSQL client
    │   └── postgres/
    │       └── schema.sql    # Notification log table DDL
    └── modules/
        ├── email/
        │   ├── email-builders.js       # Template-specific email constructors
        │   ├── email-config.js         # SMTP/Resend transport setup
        │   ├── email-template.js       # HTML email template engine
        │   ├── routes.js               # POST /api/notify/email
        │   └── transactional-email.js  # Email dispatch service
        ├── notify-log/
        │   └── notify-log.service.js   # Delivery logging & dedup
        ├── phone/
        │   ├── phone-validation.service.js  # libphonenumber-js validation
        │   └── routes.js                    # POST /api/notify/phone/validate
        └── push/
            └── routes.js               # POST /api/notify/push
```

### 2.3 Request Pipeline

```
Incoming Request
    │
    ├─ OPTIONS → 204 (CORS preflight)
    ├─ GET /health → 200 { status: "ok" }
    ├─ GET /api/notify/readiness → 200 { status: "ok" }
    │
    └─ ALL OTHER ROUTES
        │
        ├─ requireInternalAuth() ← Validates INTERNAL_SERVICE_SECRET header
        │   └─ 401 if missing/invalid
        │
        ├─ POST /api/notify/email → routeEmail()
        ├─ POST /api/notify/phone/validate → routePhone()
        └─ POST /api/notify/push → routePush()
```

---

## 3. Email Service (`modules/email/`)

### 3.1 Supported Templates

| Template ID | Purpose | Required Fields |
|-------------|---------|-----------------|
| `verification` | Email address verification link | `email`, `verificationLink`, `appPublicUrl` |
| `password-updated` | Password change confirmation | `email`, `recipientName`, `reason` |
| `new-sign-in-alert` | Security alert for new login | `email`, `recipientName`, `ip`, `deviceSummary`, `signedInAt` |
| `member-invite` | Organization invitation | `email`, `inviteUrl`, `roleName` |
| `preprovision-welcome` | Pre-created account welcome | `email`, `displayName`, `temporaryPassword`, `signInUrl` |
| `registration-welcome` | New registration welcome | `email`, `displayName`, `signInUrl` |
| `transfer-invite` | Hierarchy transfer request | `email`, `transferUrl`, `requesterName` |
| `member-ban` | Ban notification | `email`, `memberName`, `reason` |
| `team-weekly-report` | Weekly team report | `email`, `teamName`, `memberCount`, `appUrl` |

### 3.2 Email Transport
The service supports two email transports:

| Transport | Config | Priority |
|-----------|--------|----------|
| **SMTP** | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Primary |
| **Resend API** | `RESEND_API_KEY`, `RESEND_FROM` | Fallback |

- Uses `nodemailer` for SMTP delivery
- HTML email templates with responsive design
- Configurable sender address via `SMTP_FROM` or `RESEND_FROM`

### 3.3 Deduplication & Logging
- **Cooldown Check**: `isDuplicate()` prevents repeat sends to the same recipient within a configurable window
- **Delivery Logging**: Every send attempt is logged to PostgreSQL with:
  - Channel (email/push)
  - Template ID
  - Recipient (email/token)
  - Status (sent/failed/skipped)
  - Error message (if failed)
  - Metadata (transport channel, messageId)

---

## 4. Phone Validation Service (`modules/phone/`)

### 4.1 Endpoint
`POST /api/notify/phone/validate`

### 4.2 Functionality
Validates phone numbers using `libphonenumber-js`:
- Parses international phone numbers
- Supports default country code fallback
- Returns normalized international format
- Handles optional/required field validation
- Custom label for error messages

### 4.3 Request Body
```json
{
  "phone": "+1-555-123-4567",
  "defaultCountry": "US",
  "required": true,
  "label": "Mobile phone"
}
```

---

## 5. Push Notification Service (`modules/push/`)

### 5.1 Endpoint
`POST /api/notify/push`

### 5.2 Functionality
Sends push notifications via Firebase Cloud Messaging (FCM) HTTP v1 API:
- **Token-based**: Send to specific device
- **Topic-based**: Broadcast to topic subscribers
- **Condition-based**: Send based on topic conditions
- **Web Push**: WebPush-specific notification with click-through links
- **Custom Data**: Arbitrary key-value data payload

### 5.3 Request Body
```json
{
  "token": "fcm-device-token",
  "title": "New Task Assigned",
  "body": "You have been assigned to 'Q3 Report'",
  "icon": "/stopwatch-green.png",
  "link": "https://app.virtualtracker.com/tasks/123",
  "imageUrl": "https://...",
  "data": { "taskId": "123", "type": "task_assigned" },
  "template": "task_assigned",
  "recipientMemberId": "member-uuid"
}
```

### 5.4 Features
- **Deduplication**: Cooldown-based duplicate detection
- **Delivery Logging**: Full audit trail to PostgreSQL
- **Error Handling**: FCM error mapping with descriptive messages
- **Data Flattening**: Automatically converts data payload values to strings (FCM requirement)

---

## 6. PostgreSQL Schema

### Notification Log Table (`schema.sql`)
```sql
CREATE TABLE IF NOT EXISTS notify_log (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  channel     TEXT NOT NULL,       -- 'email' | 'push'
  template    TEXT NOT NULL,       -- template identifier
  recipient   TEXT NOT NULL,       -- email address or FCM token
  recipient_member_id TEXT,        -- optional member UUID
  status      TEXT NOT NULL,       -- 'sent' | 'failed' | 'skipped'
  error_message TEXT,              -- error details if failed
  metadata    JSONB DEFAULT '{}',  -- additional context
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## 7. Security

### Internal Authentication
All routes (except health/readiness) require the `INTERNAL_SERVICE_SECRET` header:

```
Authorization: Bearer <INTERNAL_SERVICE_SECRET>
```

This ensures only trusted backend services can send notifications — the service is **never** exposed to public traffic.

### CORS
- Configurable via `CORS_ORIGINS` / `FRONTEND_ORIGIN`
- Supports multiple comma-separated origins

---

## 8. Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `firebase-admin` | ^14.1.0 | FCM push notifications, Firestore |
| `nodemailer` | ^9.0.1 | SMTP email delivery |
| `pg` | ^8.13.3 | PostgreSQL client for delivery logs |
| `libphonenumber-js` | ^1.13.7 | Phone number validation |
| `zod` | ^3.25.76 | Schema validation |

---

## 9. Environment Variables

| Variable | Required | Purpose |
|----------|:---:|---------|
| `PORT` | ✗ | Server port |
| `INTERNAL_SERVICE_SECRET` | ✓ | Shared secret for service-to-service auth |
| `SMTP_HOST` | ✗ | SMTP server hostname |
| `SMTP_PORT` | ✗ | SMTP port (default: 587) |
| `SMTP_USER` | ✗ | SMTP username |
| `SMTP_PASS` | ✗ | SMTP password |
| `SMTP_FROM` | ✗ | Sender email address |
| `RESEND_API_KEY` | ✗ | Resend API key (fallback transport) |
| `RESEND_FROM` | ✗ | Resend sender address |
| `FIREBASE_SERVICE_ACCOUNT` | ✗ | JSON service account for FCM |
| `DATABASE_URL` | ✗ | PostgreSQL connection string |
| `CORS_ORIGINS` | ✗ | Allowed CORS origins |

---

## 10. Branch Evolution (Commit History)

| SHA | Message |
|-----|---------|
| `52e3dbe` | chore(notify-backend): add programmatic env loading and clean start script |
| `f1b3153` | chore: sync with main (excluding docs/env/example) |
| `3fe55af` | docs: document database layout, dashboard web and dashboard backend |
| `92ad44f` | chore: sync Notify-backend updates from main (no docs/env.example) |
| `d40af99` | refactor: delegate auth/notify concerns across services and add delivery logging |
| `3253a18` | chore(landing): configure stopwatch brand icons for metadata and social previews |
| `7cca5d6` | chore: apply simplified firebase configuration changes |
| `5691e32` | chore: remove all markdown files |
| `1573813` | chore: simplify firebase configuration to use service account only |
| `66a6bae` | fix(landing): copy static and public assets into standalone output |
| `44fa156` | fix(notify): patch moderate uuid advisory via firebase-admin bump |
| `662a2d0` | fix(notify): patch moderate uuid advisory via firebase-admin bump |
| `1a909cb` | chore: remove all .env.example files from production branch |
| `4891d67` | feat(landing): make health checks dynamic and set fallback dashboard URL |
| `e064582` | feat: align Landing-Web, Dashboard-Web and Dashboard-Backend with production architecture |
| `4ebd9f5` | feat: initialize Notify-Backend on notify-Production branch |
