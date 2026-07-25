# Auth-Backend

Firebase-based authentication API for Virtual Tracker. It handles credential checks, Firebase Web SDK configuration delivery, and password policy validation.

This service is strictly focused on **Authentication (AuthN) only**: it does not handle SMTP routing, transactional emails, profile setup, or session bootstrap. Those operations live on **Dashboard-Backend** (`:5713` / `vt-dashboard-api`).

For detailed documentation on how requests are split and routed between frontends and APIs, see the repo root [explainhere.md](../explainhere.md).

---

## Role in the Stack

| Service | Container | Dev Port | Production Endpoint |
| :--- | :--- | :--- | :--- |
| **Auth-Backend** (this) | `vt-auth-api` | `:5712` | `https://auth.myvirtualtracker.com` |
| **Dashboard-Backend** | `vt-dashboard-api` | `:5713` | `https://dashapi.myvirtualtracker.com` |
| **Dashboard Web** | `vt-dashboard-web` | `:3000` | `https://app.myvirtualtracker.com` |

### Platform Routing Design
- **Single Owner Constraint**: Each `/api/...` route is owned by exactly one backend service. If an Auth-owned route incorrectly hits the Dashboard backend, it returns `404` with a `VT-Routing-Error: AUTH_BACKEND_ROUTE` header.
- **Client Orchestration**: The frontend orchestrates multi-step flows sequentially (e.g., calling `/verify` on Auth-Backend first, then passing details to `/session-bootstrap` on Dashboard-Backend).

---

## API Routes

All endpoints serve JSON and are routed via `/api/auth/*` (supports `/api/v1/auth/*` aliases).

| Path | Method | Purpose | Cache Policy |
| :--- | :--- | :--- | :--- |
| `/api/auth/firebase-config` | `GET` | Fetches the Firebase Web SDK credentials. | `public, max-age=3600` |
| `/api/auth/readiness` | `GET` | Verifies that Firebase Admin is connected and initialized. | None (`no-store`) |
| `/api/auth/password-policy` | `GET` | Fetches password policy rules and rules version. | `public, max-age=0, stale-while-revalidate=3600` |
| `/api/auth/validate-password` | `POST` | Validates password complexity without database checks. | None (`no-store`) |
| `/api/auth/verify` | `POST` | Validates a Firebase ID Token and returns user identifiers. | None (`no-store`) |
| `/api/auth/resolve-sign-in-methods` | `POST` | Resolves the authentication providers linked to an email. | None (`no-store`) |
| `/health` | `GET` | Container liveness check. | None (`no-store`) |

### Request and Response Specifications

#### 1. `GET /api/auth/firebase-config`
Returns the Web SDK credentials needed by the browser to initialize Firebase Client.
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "config": {
        "apiKey": "AIzaSy...",
        "authDomain": "project-id.firebaseapp.com",
        "projectId": "project-id",
        "storageBucket": "project-id.firebasestorage.app",
        "messagingSenderId": "1234567890",
        "appId": "1:1234:web:abcd",
        "measurementId": "G-XXXXXX"
      }
    }
    ```
*   **Error (503 Service Unavailable):** Returned if Firebase Web config is not populated in env or local files.

#### 2. `GET /api/auth/readiness`
Validates that the Firebase Admin SDK has successfully initialized and is ready to query Firebase services.
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "firebase": "ok"
    }
    ```
*   **Error (503 Service Unavailable):** Firebase Admin initialization failed.
    ```json
    {
      "success": false,
      "code": "SERVICE_UNAVAILABLE",
      "error": "Firebase Admin is not configured."
    }
    ```

#### 3. `GET /api/auth/password-policy`
Provides metadata about password requirements. Client applications check the `version` field and compare it against their local storage to invalidate cached policy rules.
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "version": "1.0.0",
      "lastUpdated": "2026-06-11T00:00:00.000Z",
      "passwordPolicy": {
        "minLength": 10,
        "maxLength": 128,
        "requireUppercase": true,
        "requireLowercase": true,
        "requireNumber": true,
        "requireSpecial": true,
        "blockedPasswordsEnabled": true,
        "sequenceDetectionEnabled": true,
        "repeatedPatternDetectionEnabled": true,
        "examplePasswordBlacklistEnabled": true,
        "passwordExpirationDays": null,
        "requireMfa": false
      }
    }
    ```

#### 4. `POST /api/auth/validate-password`
Validates password complexity. Safe to call frequently as it operates locally without database hits.
*   **Body Schema:**
    ```json
    {
      "password": "UserPasswordHere",
      "confirmPassword": "UserPasswordHere"
    }
    ```
*   **Response (200 OK - Valid):**
    ```json
    {
      "success": true,
      "valid": true,
      "requirements": {
        "notBlocked": true,
        "notSimplePattern": true
      }
    }
    ```
*   **Response (400 Bad Request - Invalid):**
    ```json
    {
      "success": false,
      "valid": false,
      "error": "Password is too short (minimum 10 characters).",
      "requirements": {
        "notBlocked": true,
        "notSimplePattern": true
      }
    }
    ```

#### 5. `POST /api/auth/verify`
Authenticates a user session by validating their Firebase Client JWT ID token.
*   **Headers:**
    - `Authorization: Bearer <ID_TOKEN>` (preferred)
*   **Alternative Body Schema:**
    ```json
    {
      "token": "ID_TOKEN_HERE"
    }
    ```
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "user": {
        "uid": "firebase-user-uid",
        "email": "user@example.com",
        "emailVerified": true
      }
    }
    ```
*   **Error (401 Unauthorized):**
    ```json
    {
      "success": false,
      "error": "Firebase ID token has expired."
    }
    ```

#### 6. `POST /api/auth/resolve-sign-in-methods`
Identifies all authentication methods associated with a given email address. Allows the frontend to determine if the user must sign in using Google, password, or another provider before prompting for credentials.
*   **Body Schema:**
    ```json
    {
      "email": "user@example.com"
    }
    ```
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "methods": ["password"],
      "identities": [
        {
          "provider": "password",
          "identifier": "user@example.com"
        }
      ]
    }
    ```

#### 7. `GET /health`
Liveness endpoint for load balancers and container managers. It is parsed early and bypasses CORS security checks and the authn allowlist.
*   **Response (200 OK):**
    ```json
    {
      "ok": true,
      "service": "auth-backend"
    }
    ```

---

## Environment Variables Configuration

Central configuration parameters are defined in [src/config/env.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Auth-Backend/src/config/env.js) and validated on boot using Zod schema assertions in [src/config/env-schema.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Auth-Backend/src/config/env-schema.js).

### Core Server Variables

| Environment Variable | Description | Default / Requirements |
| :--- | :--- | :--- |
| `NODE_ENV` | Mode under which the server runs. | `development`, `production`, or `test`. |
| `PORT` | Local port the HTTP server binds to. | `5712` (dev) / `3000` (production). |
| `FRONTEND_ORIGIN` | Primary web client URL (used in links, not CORS — CORS allows all origins since this API is Bearer-token authenticated). | `http://localhost:3000` (HTTPS required in prod). |
| `APP_PUBLIC_URL` | Public entry URL of the main dashboard site. | HTTPS required in production. |
| `ALLOW_INSECURE_HTTP` | Allows HTTP connections (bypasses TLS enforcement). | `false`. Set to `true` only for dev environments without TLS. |
| `SKIP_ENV_VALIDATION` | Skips Zod environment schema checking. | `false`. Set to `1` or `true` in test suites only. |

### Firebase Web Client Variables
*Required by the client wrapper endpoint `/api/auth/firebase-config`. When any single variable in this group is specified, all **required** keys in this group must be provided.*

| Environment Variable | Zod Rule | Description |
| :--- | :--- | :--- |
| `FIREBASE_API_KEY` | Required | Web app API credential key. |
| `FIREBASE_AUTH_DOMAIN` | Required | Authentication domain target. |
| `FIREBASE_PROJECT_ID` | Required | The ID of the target Firebase Project. |
| `FIREBASE_APP_ID` | Required | Unique Web App registration identifier. |
| `FIREBASE_STORAGE_BUCKET` | Optional | Default Cloud Storage bucket path. |
| `FIREBASE_MESSAGING_SENDER_ID`| Optional | Sender identifier for Cloud Messaging. |
| `FIREBASE_MEASUREMENT_ID` | Optional | Google Analytics measurement tracker code. |

### Firebase Admin (Server SDK) Variables
*Required to run tokens checks on `/verify` and resolve providers on `/resolve-sign-in-methods`.*

| Environment Variable | Description |
| :--- | :--- |
| `FIREBASE_SERVICE_ACCOUNT` | **Recommended.** Full stringified Service Account JSON credentials object. |
| `FIREBASE_CLIENT_EMAIL` | Account email portion of the service certificate (requires `FIREBASE_PRIVATE_KEY`). |
| `FIREBASE_PRIVATE_KEY` | The private key string (escaped newlines `\n` are parsed correctly). |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to a local JSON credentials file containing service credentials. |
| `FIREBASE_DATABASE_URL` | Realtime Database instance URL (only needed if default derived URL differs). |

---

## Firebase Credentials Resolution

To guarantee security and flexibility across dev machines and Docker clusters, Auth-Backend looks for Admin SDK keys in the following prioritized order:

1.  **Inline JSON string (`FIREBASE_SERVICE_ACCOUNT`)**:
    *Best for production Docker containers (avoids creating file system assets).*
    ```text
    FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"vt-prod","private_key":"...","client_email":"..."}
    ```
2.  **Separate Env Fields (`FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`)**:
    *Parsed and cleaned at runtime.*
3.  **Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`)**:
    *Loads config from the local JSON file matching the environment path.*
4.  **Local Gitignored JSON File (`firebase-admin.local.json`)**:
    *Recommended for local development. Copy the template from `firebase-admin.local.json.example` into `firebase-admin.local.json` at the root of `Auth-Backend/`.*

Similarly, Web SDK settings are loaded from environment variables (`FIREBASE_API_KEY`, etc.) or fall back to the local gitignored [firebase-web.local.json](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Auth-Backend/firebase-web.local.json) (which can be copied from the provided example template).

---

## Security Configurations

The service includes multiple protection middleware components configured directly in [src/app/handle-request.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Auth-Backend/src/app/handle-request.js):

-   **TLS Enforcement**: Requests hitting the server over non-secure channels in production are rejected with `403 Forbidden` unless overridden via `ALLOW_INSECURE_HTTP`.
-   **Security Headers**: Adds defensive response headers by default (`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`).
-   **Default Cache Prevention**: The server adds `Cache-Control: no-store, no-cache, must-revalidate` headers on all endpoints unless overridden. Specific cache assets override this policy:
    -   `/api/auth/firebase-config`: Allowed caching for 1 hour (`max-age=3600`).
    -   `/api/auth/password-policy`: Allowed stale-while-revalidate up to 1 hour.
-   **Query Parameter Guard**: Rejects URLs containing sensitive fields (like `?password=...` or `?token=...`) with `400 Bad Request` to prevent exposure in upstream load-balancer log files.
-   **Sensitive Log Redaction**: Request and response log outputs pass through regex sanitization filters. JWT-like values and private credentials are replaced with `[REDACTED_JWT]` or `[REDACTED]`.

---

## Local Development Setup

### 1. File Configuration
Copy the development block from [.env.example](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Auth-Backend/.env.example) to `.env` or create local JSON files in the `Auth-Backend` root directory:
```text
Auth-Backend/firebase-admin.local.json
Auth-Backend/firebase-web.local.json
```

### 2. Execution Commands
```bash
# Navigate to the folder
cd Auth-Backend

# Install dependencies (only firebase-admin and Zod)
npm install

# Start the local server
npm start
```
The console will boot and render a startup route mapping banner. By default, it listens on `http://localhost:5712`.

### 3. Smoke Test Checks
Run the following curl commands in a separate terminal:
```bash
# Check liveness
curl -s http://localhost:5712/health

# Check readiness status
curl -s http://localhost:5712/api/auth/readiness

# Fetch config payloads
curl -s http://localhost:5712/api/auth/firebase-config
curl -s http://localhost:5712/api/auth/password-policy
```

---

## Production Deployment

### Docker Container Build
```bash
# Build the production container
docker build -t vt-auth-api .

# Run the container mapping port 5712
docker run --env-file .env -p 5712:5712 vt-auth-api
```
-   **Base Image**: `node:20-alpine` (production-grade).
-   **Install Flag**: Runs `npm ci --omit=dev` to skip dev dependencies.
-   **Liveness Probe**: Runs a container health check script every 30s using native Node.js fetch:
    ```bash
    node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5712)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
    ```

### Nixpacks and Coolify Integration
*   The repository contains a custom [nixpacks.toml](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Auth-Backend/nixpacks.toml) file.
*   The start command is set to `node index.js` (avoiding `npm start` to eliminate `npm warn config production` warnings under Coolify).
*   **Routing Note**: Downstream reverse proxies (e.g. Caddy or Nginx) must forward traffic from the external domains to the `vt-auth-api` container *only* for the authorized auth endpoints and `/health`. All other traffic goes to `vt-dashboard-api`.

---

## In-Memory Performance Metrics

The application implements a lightweight performance metrics reporter in [src/core/metrics.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Auth-Backend/src/core/metrics.js) with zero external dependencies.
*   **Request Logs**: Implements a sliding-window ring buffer tracking the last 600 requests.
*   **Security Logs**: Buffers the last 100 authentication and restriction incidents.
*   **Calculators**: Gathers latency figures and computes percentiles (p50, p95, p99) and active Requests Per Second (RPS) metrics.
*   **Console Logging**: Console outputs color-code requests based on HTTP statuses (Green: `2xx`, Cyan: `3xx`, Yellow: `4xx`, Red: `5xx`) and include execution times in milliseconds.

---

## Project Structure

```text
Auth-Backend/
├── .dockerignore
├── .env.example
├── .firebaserc.example
├── .npmrc
├── Dockerfile
├── README.md               # This documentation file
├── firebase-admin.local.json.example
├── firebase-web.local.json.example
├── firebase.json           # Firebase CLI deploy manifest
├── firestore.indexes.json  # Firebase security / Index configuration
├── firestore.rules         # Firestore rule security definitions
├── nixpacks.toml           # Nixpacks build template configuration
├── package-lock.json
├── package.json
├── server.js               # createServer() factory wrapper
├── index.js                # App entry point (binds ports, prints banner)
│
├── hosting-public/         # Firebase Hosting public directory
│   └── __/auth/action.html # Static handler page for auth emails
│
└── src/
    ├── app/
    │   └── handle-request.js   # Request distributor and global filter middlewares
    ├── config/
    │   ├── env.js              # Centralized Zod env mapping loader
    │   ├── env-schema.js       # Zod schemas for env strings and JSON credentials
    │   ├── env-public.js       # Helper to sanitize and omit secrets for logs
    │   ├── firebase.js         # Firebase connection manager & credential checkers
    │   └── password-policy/    # Rules parameters, checks, and validators
    ├── core/
    │   ├── create-server.js    # Node.js http instance creator & crash error catcher
    │   ├── logger.js           # Colored status outputs and banner console printer
    │   └── metrics.js          # Ring buffer-based performance & latency trackers
    ├── http/
    │   ├── api-error.js        # Standardized backend API error classes
    │   ├── auth-token.js       # Extract token helper from Headers or body
    │   ├── cors.js             # CORS rules and allowed origin matchers
    │   ├── password-request-guard.js # URL credential checkers and validator wraps
    │   ├── quota-error.js      # Translates Firebase rate quotas to API payloads
    │   ├── rate-limit.js       # Sliding-window local request rate limiter
    │   ├── read-json-body.js   # Safe request body reader with size limit check
    │   ├── request-ip.js       # Extracts client IP addresses through proxies
    │   ├── response.js         # Helper to write standard JSON response headers
    │   ├── sanitize-error.js   # Prevents internal backend stack leaks to clients
    │   ├── sanitize-log.js     # Redacts paths and fields inside terminal logs
    │   ├── security-headers.js # Inject secure protection headers into responses
    │   ├── sensitive-fields.js # Define fields containing credentials or JWTs
    │   ├── tls-enforcement.js  # Restricts raw http requests in production tier
    │   └── validate-body.js    # Verify required body keys and reject unknown ones
    └── modules/
        └── auth/
            ├── authn-paths.js  # Allowlist matching for authentication routes
            └── routes.js       # Execution logic for all 6 auth endpoints
```
