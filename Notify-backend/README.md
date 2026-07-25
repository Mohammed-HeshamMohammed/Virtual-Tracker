# Notify-Backend (`vt-notify-api`)

Outbound messaging service for the Virtual Tracker platform. It handles templated emails and push notifications.

This service is strictly **internal-only**. No public web browser ever communicates with it directly. It is designed to be called exclusively by **Dashboard-Backend** (`vt-dashboard-api`) or internal services carrying the shared `INTERNAL_SERVICE_SECRET`.

---

## Role in the Stack

| Service | Container | Dev Port | Production Endpoint |
| :--- | :--- | :--- | :--- |
| **Notify-Backend** (this) | `vt-notify-api` | `:5715` | `https://notify.myvirtualtracker.com` |
| **Dashboard-Backend** | `vt-dashboard-api` | `:5713` | `https://dashapi.myvirtualtracker.com` |
| **Auth-Backend** | `vt-auth-api` | `:5712` | `https://auth.myvirtualtracker.com` |

### Blast Radius Isolation Design
To prevent outbound communication abuse in the event of an application exploit, the platform isolates all communication credentials inside this service:

```
Browser
   └─► vt-dashboard-api    (Firebase Admin, Firestore — NO SMTP keys)
             │
             │  Authorization: Bearer INTERNAL_SERVICE_SECRET
             │  Restricted: Template IDs only, never raw email/HTML payloads
             ▼
       vt-notify-api        (SMTP credentials, FCM Push tokens)
             │
             ├─► SMTP               (Outbound Email Dispatch)
             └─► Firebase FCM Host  (WebPush Notifications)
```

**Security Benefit:** If the public-facing Dashboard-Backend is compromised, the attacker may obtain database access but *cannot* send arbitrary emails or phish users as `noreply@myvirtualtracker.com`.

---

## API Routes

All endpoints serve JSON and reside under `/api/notify/*`.

| Path | Method | Purpose | Authentication |
| :--- | :--- | :--- | :--- |
| `/health` | `GET` | Container liveness check. | None |
| `/api/notify/readiness` | `GET` | Service readiness check. | None |
| `/api/notify/email` | `POST` | Dispatches templated transactional email. | Shared Secret |
| `/api/notify/phone/validate` | `POST` | Validates phone numbers (country + format via libphonenumber-js). | Shared Secret |
| `/api/notify/push` | `POST` | Dispatches push notifications via Firebase Cloud Messaging. | Shared Secret |

### Authentication Guard
All POST endpoints require the shared internal secret passed in the HTTP header:
```http
Authorization: Bearer <INTERNAL_SERVICE_SECRET>
```
*Note: In local development, if `INTERNAL_SERVICE_SECRET` is left undefined in `.env`, the server logs a warning and bypasses validation to simplify testing.*

---

## Endpoint Specifications

### 1. `POST /api/notify/email`
Dispatches a branded HTML email. To ensure isolation, arbitrary HTML code or custom subject fields are rejected. Callers must pass an allowed `template` key.

*   **Allowed Template Keys**: `verification`, `password-updated`, `new-sign-in-alert`
*   **Body Schema (Verification Link template):**
    ```json
    {
      "template": "verification",
      "email": "user@example.com",
      "verificationLink": "https://firebase.auth.link/...",
      "appPublicUrl": "https://app.myvirtualtracker.com"
    }
    ```
    *Note: When `appPublicUrl` is supplied, Firebase action links are automatically rewritten into application routes (`/auth/action?apiKey=...`).*
*   **Body Schema (Password Updated template):**
    ```json
    {
      "template": "password-updated",
      "email": "user@example.com",
      "recipientName": "John Doe",
      "reason": "changed"
    }
    ```
*   **Body Schema (New Sign-In Alert template):**
    ```json
    {
      "template": "new-sign-in-alert",
      "email": "user@example.com",
      "recipientName": "John Doe",
      "ip": "192.168.1.100",
      "deviceSummary": "Chrome on macOS",
      "signedInAt": "2026-06-29T02:00:00.000Z"
    }
    ```
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "sent": true,
      "channel": "smtp"
    }
    ```
    *Channels can be: `smtp`, `console` (dev SMTP fallback), or `smtp_failed`.*

---

### 2. `POST /api/notify/phone/validate`
Validates a phone number using **libphonenumber-js** (Google libphonenumber). Checks country calling code, national number length, and number validity — e.g. Egypt (`+20`) requires a valid 10-digit mobile number after the country code.

*   **Body Schema:**
    ```json
    {
      "phone": "+201012345678",
      "defaultCountry": "EG",
      "required": true,
      "label": "Phone number"
    }
    ```
    *`defaultCountry` is optional ISO-3166 alpha-2 (e.g. `EG`, `US`) used when the input omits a `+` prefix.*
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "data": {
        "valid": true,
        "e164": "+201012345678",
        "nationalNumber": "1012345678",
        "countryCallingCode": "20",
        "country": "EG",
        "nationalFormat": "010 12345678",
        "internationalFormat": "+20 10 12345678"
      }
    }
    ```

---

### 3. `POST /api/notify/push`
Sends a push notification via Firebase Cloud Messaging (FCM HTTP v1 API) utilizing the Firebase Admin SDK.
*   **Body Schema:**
    ```json
    {
      "token": "fcm-registration-token-or-device-token",
      "title": "Alert Title",
      "body": "Alert message body details.",
      "imageUrl": "https://example.com/image.png",
      "icon": "https://example.com/icon.png",
      "link": "https://app.myvirtualtracker.com/dashboard",
      "data": {
        "customKey": "customValue"
      }
    }
    ```
    *Note: One of `token`, `topic`, or `condition` is required. The `data` record is automatically flattened into string key-values required by FCM.*
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "messageId": "projects/vt-project/messages/0:1234..."
    }
    ```

---

## Environment Variables Configuration

Parsed values are validated on startup in [src/config/env.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Notify-backend/src/config/env.js).

| Variable | Scope | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | Core | Running environment (`development` / `production`). |
| `PORT` | Core | Server port binding. Defaults to `5715` (dev) / `3000` (production). |
| `INTERNAL_SERVICE_SECRET` | Security | Auth token validation. Required in production. |
| `FRONTEND_ORIGIN` | CORS | Allowed cross-origin caller URL. |
| `CORS_ORIGINS` | CORS | Comma-separated list of alternative CORS origins. |
| `SMTP_HOST` | Email | Target outbound SMTP host address. |
| `SMTP_PORT` | Email | Outbound SMTP connection port (defaults to `587`). |
| `SMTP_SECURE` | Email | Set to `true` to force TLS (automatically active for port `465`). |
| `SMTP_USER` | Email | Authentication username for SMTP. |
| `SMTP_PASS` | Email | Password key. Spaces are stripped automatically for Google App Keys. |
| `SMTP_FROM` | Email | Sender representation line. Defaults to `Virtual Tracker <user>`. |
| `FIREBASE_SERVICE_ACCOUNT` | Push | Single-line JSON credentials string. Required for FCM Push. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Push | Path to a local GCP service account JSON key file. |

*In production (`NODE_ENV=production`), `INTERNAL_SERVICE_SECRET`, `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` are strictly required, failing fast on boot if missing.*

---

## Operational Details

### 1. SMTP Delivery and Console Fallback
At startup, [logEmailDeliveryStatusAsync](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Notify-backend/src/modules/email/email-config.js) runs an active `.verify()` socket handshake check on the SMTP transporter.
*   **If configured correctly:** Real transactional emails will be sent out using NodeMailer.
*   **If SMTP settings are missing in dev:** The email pipeline logs the full text-based contents directly to the server terminal, letting developers test registration links without setting up SMTP servers.

### 2. Firebase SDK Setup (FCM Only)
*   The connection checks the `FIREBASE_SERVICE_ACCOUNT` variable first.
*   If not set, it attempts to load credentials via `GOOGLE_APPLICATION_CREDENTIALS` or GCP environment settings.
*   If no credentials exist, FCM initialization is bypassed, and the `/push` endpoint will return a `503 Service Unavailable` error when hit.

---

## Local Setup

### 1. Configure the Environment
Create a `.env` file in `Notify-Backend/` using [.env.example](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Notify-backend/.env.example):
```text
PORT=5715
```

### 2. Run Commands
```bash
# Navigate to directory
cd Notify-Backend

# Install packages
npm install

# Run in watch mode (Node 20 watch feature)
npm run dev
```

### 3. Test Integration
```bash
# Health check
curl -s http://localhost:5715/health

# Trigger verification email (prints to console in dev mode)
curl -s -X POST http://localhost:5715/api/notify/email \
  -H "Content-Type: application/json" \
  -d '{"template":"verification","email":"test@example.com","verificationLink":"https://example.com/verify"}'
```

---

## Project Structure

```text
Notify-Backend/
├── .env.example
├── README.md               # This documentation file
├── package-lock.json
├── package.json
├── server.js               # createServer() factory wrapper
├── index.js                # App entry point (verifies SMTP on boot, binds ports)
│
└── src/
    ├── app/
    │   └── handle-request.js   # Request pipeline (CORS -> health -> auth -> modules)
    ├── config/
    │   ├── env.js              # Zod env schema parser & configuration registry
    │   └── firebase.js         # Firebase Admin initializer (FCM Messaging only)
    ├── core/
    │   └── logger.js           # Console output templates & status formatting
    ├── http/
    │   ├── internal-auth.js    # INTERNAL_SERVICE_SECRET verification check
    │   └── response.js         # sendJson HTTP helper
    └── modules/
        ├── email/
        │   ├── email-config.js         # SMTP readiness checker and status validation
        │   ├── email-template.js       # Branded HTML skeleton & path rewriter
        │   ├── email-builders.js       # HTML/Text templates builder dispatcher
        │   ├── transactional-email.js   # Nodemailer transporter & dev fallback
        │   └── routes.js               # POST /api/notify/email handler
        ├── phone/
        │   ├── phone-validation.service.js  # libphonenumber-js validation
        │   └── routes.js                    # POST /api/notify/phone/validate
        └── push/
            └── routes.js               # POST /api/notify/push FCM gateway
```
