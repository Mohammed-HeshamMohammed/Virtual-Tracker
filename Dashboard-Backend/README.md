# Dashboard-Backend (`vt-dashboard-api`)

Business-domain and identity API for the Virtual Tracker platform. It handles Firestore profiles, organization members, projects/tasks/clients/teams data, real-time activity tracking, presence status, and organization hierarchy.

---

## Role in the Stack

| Service | Container | Dev Port | Production Endpoint |
| :--- | :--- | :--- | :--- |
| **Dashboard-Backend** (this) | `vt-dashboard-api` | `:5713` | `https://dashapi.myvirtualtracker.com` |
| **Auth-Backend** | `vt-auth-api` | `:5712` | `https://auth.myvirtualtracker.com` |
| **Notify-Backend** | `vt-notify-api` | `:5715` | `https://notify.myvirtualtracker.com` |
| **Dashboard Web** | `vt-dashboard-web` | `:3000` | `https://app.myvirtualtracker.com` |

### Platform Design Philosophy
- **One Capability, One Backend**: Each `/api/...` route is implemented on exactly one backend service. Auth-Backend and Dashboard-Backend have zero route overlap.
- **Auth Separation (AuthN vs. AuthZ)**:
  - Auth-Backend verifies credentials and issues Firebase ID tokens.
  - Dashboard-Backend maps validated Firebase UIDs to Firestore member records, checks organization roles, and authorizes specific business actions (AuthZ).

---

## API Routes & Controller Map

Dashboard-Backend hosts the core application routes. All endpoints (except `/health` and `/api/readiness`) require client authentication via a valid Firebase ID Token passed in the `Authorization: Bearer <ID_TOKEN>` header.

### 1. General and Verification Routes
| Path | Method | Description | Controller / Handler |
| :--- | :--- | :--- | :--- |
| `/health` | `GET` | Container liveness check. | [handle-request.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/app/handle-request.js) |
| `/api/readiness` | `GET` | Validates database connectivity (boot gate). | [readiness.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/auth/readiness.js) |
| `/monitor` | `GET` | HTML Ops dashboard reporting memory/rps/error counters. | [routeMonitor](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/monitor/routes.js) |

### 2. User & Identity Management
| Path | Method | Description | Controller / Handler |
| :--- | :--- | :--- | :--- |
| `/api/auth/sign-in-client-extras` | `GET` | Returns platform capabilities (e.g., web push config). | [identity-routes.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/auth/identity-routes.js) |
| `/api/auth/session-bootstrap` | `POST` | Upserts Firestore profile, maps member record, updates status. | [session-bootstrap.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/auth/session-bootstrap.js) |
| `/api/auth/complete-first-login` | `POST` | Exchanges temp password for permanent key & promotes member status. | [complete-first-login.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/auth/complete-first-login.js) |
| `/api/auth/profile` | `POST` | Updates Firestore user details and avatar metadata. | [profile-settings.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/auth/profile-settings.js) |
| `/api/auth/access-request` | `POST` | Submits form requesting membership access to an org. | [identity-routes.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/auth/identity-routes.js) |
| `/api/bootstrap` | `GET` | Resolves permissions and metadata immediately post-login. | [routes.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/bootstrap/routes.js) |

### 3. Organization & Work Entities (CRUD)
| Route Group | Methods | Purpose | Controller / Handler |
| :--- | :--- | :--- | :--- |
| `/api/members` | `GET`, `POST`, `PATCH`, `DELETE` | Org membership records, boarding, & status toggling. | [members/routes](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/members) |
| `/api/member-roles` | `GET`, `POST`, `DELETE` | Role mapping and access privilege level assignments. | [member-roles/routes](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/members) |
| `/api/member-onboarding`| `GET`, `POST` | Workspace invite applications and sign-up requests. | [member-onboarding](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/member-onboarding/routes.js) |
| `/api/member-relationships`| `GET`, `POST` | Manager/report structures and org level hierarchies. | [member-relationships](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/member-relationships/routes.js) |
| `/api/projects` | `GET`, `POST`, `PATCH`, `DELETE` | Target workspace projects and budgets. | [projects](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/projects/routes.js) |
| `/api/tasks` | `GET`, `POST`, `PATCH`, `DELETE` | Target task identifiers, assignees, and stages. | [tasks](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/tasks/routes.js) |
| `/api/clients` | `GET`, `POST`, `PATCH`, `DELETE` | Client company profiles and target assignments. | [clients](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/clients/routes.js) |
| `/api/teams` | `GET`, `POST`, `PATCH`, `DELETE` | Team configurations and member groups. | [teams/routes](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/teams) |

### 4. Telemetry, Real-time & Messaging
| Path | Method | Description | Controller / Handler |
| :--- | :--- | :--- | :--- |
| `/api/activity` | `GET`, `POST` | Captures key events and pushes logs. | [activity](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/activity/routes.js) |
| `/api/presence` | `GET`, `POST` | Sets heartbeat state & starts SSE streams. | [presence](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/presence/index.js) |
| `/api/dashboard` | `GET` | Compiles widgets, active counts, and timelines. | [dashboard](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/dashboard/routes.js) |
| `/api/public/invites/*` | `GET`, `POST` | Handles public link evaluations and profile connections. | [invites](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/bootstrap/routes.js) |
| `/api/auth/send-verification-email` | `POST` | *Pending extraction.* Sends email verification link. | [verification-email.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/auth/verification-email.js) |
| `/api/notifications/*` | `GET`, `POST` | *Pending extraction.* FCM push registration and logs. | [notifications](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/notifications/routes.js) |

---

## Security Architecture

The server processes incoming traffic through a middleware chain in [handle-request.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/app/handle-request.js):

1.  **CORS Handler**: Checks incoming origins against allowed environments ([cors.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/cors.js)).
2.  **HTTPS Enforcement**: In production, blocks unsecured HTTP connections ([tls-enforcement.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/tls-enforcement.js)).
3.  **Query Parameter Guard**: Rejects URLs containing credentials in the query string ([password-request-guard.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/password-request-guard.js)).
4.  **Auth Routing Guard**: Bounces any request mapping to Auth-Backend endpoints with `404 AUTH_BACKEND_ROUTE` to enforce routing separation.
5.  **IP Rate Limiter**: Enforces sliding-window limits based on route categories ([rate-limit.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/rate-limit.js)).
6.  **Token Validator**: Decodes the Firebase ID token, validates expiration, and sets the auth context ([auth-middleware.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/auth-middleware.js)).
7.  **Resource Access Guards**: Checks role permissions ([role-hierarchy.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/role-hierarchy.js)) and resource ownership (e.g., [project-access.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/project-access.js) and [task-access.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/task-access.js)).

---

## Environment Variables Configuration

Central variables are loaded by [env.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/config/env.js) and validated on boot by [env-schema.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/config/env-schema.js).

### Core Server Settings

| Variable | Scope | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | Mode | `development`, `production`, or `test`. |
| `PORT` | Network | Local port mapping. Defaults to `5713`. |
| `FRONTEND_ORIGIN` | CORS | Allowed frontend browser client origin. |
| `APP_PUBLIC_URL` | Redirects | URL of the frontend dashboard site (HTTPS required in prod). |
| `CORS_ORIGINS` | CORS | Comma-separated list of additional allowed CORS origins. |
| `ALLOW_INSECURE_HTTP` | Dev Override | Disable SSL check. Do not enable in production. |
| `SKIP_ENV_VALIDATION` | Test Override| Skips Zod env verification during test suites. |

### Database & Admin SDK (Firestore Access)

| Variable | Description |
| :--- | :--- |
| `FIREBASE_SERVICE_ACCOUNT` | **Recommended.** Full stringified Service Account JSON credentials object. |
| `FIREBASE_PROJECT_ID` | Project ID string. |
| `FIREBASE_CLIENT_EMAIL` | Credentials certificate email. |
| `FIREBASE_PRIVATE_KEY` | Private certificate key (newline characters `\n` resolved dynamically). |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to a local JSON credentials file containing service credentials. |
| `FIREBASE_DATABASE_URL` | Realtime Database target URL (derived from project ID if omitted). |

### Outbound Messaging (Temporary — Pending Migration)
*These settings will be removed from Dashboard-Backend once the migration to Notify-Backend is complete.*

| Variable | Target Service | Purpose / Scope |
| :--- | :--- | :--- |
| `RESEND_API_KEY` | Resend API | Outbound email delivery. |
| `RESEND_FROM` | Resend API | From display address for branding. |
| `FIREBASE_WEB_PUSH_VAPID_PUBLIC_KEY` | FCM Push | VAPID identifier for webpush keys. |
| `NOTIFY_BACKEND_URL` | Notify-Backend| Target internal messaging API (e.g., `http://localhost:5715`). Required for phone validation. |
| `INTERNAL_SERVICE_SECRET` | Notify-Backend| Shared secret used to authorize calls to Notify-Backend. |

---

## Local Development & Setup

### 1. Database Configuration
For local development, copy the project's Firebase Service Account JSON credentials file to the root directory as:
```text
Dashboard-Backend/firebase-admin.local.json
```
If this file is present, the Firebase Admin SDK will automatically load it, bypassing the need for env variables.

### 2. Environment Configuration
Create a `.env` file in the root of `Dashboard-Backend/` using [.env.example](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/.env.example):
```text
PORT=5713
```

### 3. Execution Commands
```bash
# Navigate to directory
cd Dashboard-Backend

# Install dependencies
npm install

# Run in watch mode (using nodemon wrapper script)
npm run dev
```

### 4. Admin CLI Scripts
The project provides several convenience scripts inside the [scripts](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/scripts) directory:
```bash
# Assign Owner role to a user in Firestore
npm run assign-owner -- --email=admin@example.com

# Manually verify a user's email address in Firebase Auth
npm run verify-user-email -- --email=user@example.com

# Deploy Firestore security rules and index constraints
npm run deploy:firestore

# Deploy Firebase Storage security rules
npm run deploy:storage
```

---

## Production Deployment

### Docker Setup
```bash
# Build the image
docker build -t vt-dashboard-api .

# Run the container
docker run --env-file .env -p 5713:5713 vt-dashboard-api
```
-   **Image**: `node:20-alpine`.
-   **Healthcheck**: Pings the local `/health` route using native Node.js fetch:
    ```bash
    node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5713)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
    ```

---

## Codebase Project Structure

```text
Dashboard-Backend/
├── .dockerignore
├── .env.example
├── .firebaserc.example
├── .gitignore
├── Dockerfile
├── README.md               # This documentation file
├── firebase-admin.local.json.example
├── firebase-web.local.json.example
├── firebase.json           # Firebase CLI deploy configuration
├── firestore.indexes.json  # Database indexes structure definition
├── firestore.rules         # Firestore security logic rules
├── package-lock.json
├── package.json
├── server.js               # createServer() factory wrapper
├── index.js                # App entry point (binds ports, starts maintenance tasks)
│
├── hosting-public/         # Hosting assets
│
├── scripts/                # Administration & database migrations
│   ├── assign-owner.mjs
│   ├── clean-member-presence.mjs
│   ├── dev-watch.mjs       # Dev watcher configuration
│   ├── lint-env-access.mjs
│   └── verify-user-email.mjs
│
└── src/
    ├── app.js              # HTTP server configurations (CORS, body parsing limits)
    ├── server.js           # Server initializer wrapper
    │
    ├── app/
    │   └── handle-request.js # Entry request distributor & middleware chain
    │
    ├── bootstrap/
    │   └── entity-bootstrap.js # Database checkers, index validation, maintenance scheduling
    │
    ├── config/
    │   ├── env.js          # Central env configuration schema loader
    │   ├── env-schema.js   # Zod environment schemas and validators
    │   ├── env-public.js   # Logs-safe environment configurations mapping
    │   ├── firebase.js     # Firebase connection initiator & database instance exporter
    │   ├── deployment-profiles.js # Platform port mapping registries
    │   └── password-policy/# Password requirements models (matching Auth-Backend)
    │
    ├── core/
    │   ├── create-server.js # Node HTTP listener creator with port error catches
    │   ├── logger.js       # Status-based logs colorizer & banner printer
    │   └── metrics.js      # Ring-buffer request trackers and percentiles aggregator
    │
    ├── http/               # Middleware pipeline guards & access checks
    │   ├── api-error.js    # Standard application error objects
    │   ├── auth-context.js # Active context helpers mapping
    │   ├── auth-middleware.js # Firebase Auth verification and session mapping
    │   ├── auth-token.js   # Bearer JWT extraction helper
    │   ├── authorization.js # General client permissions check middleware
    │   ├── field-policy.js # Profile updates field validation policies
    │   ├── invite-abuse-guard.js # Rate limiters for link sharing
    │   ├── invite-scope.js # Validates invite scope strings
    │   ├── member-ban-policy.js # Restricts access for banned members
    │   ├── member-self-manage-policy.js # Rules for self-service actions
    │   ├── project-access.js # Verification logic for workspace projects
    │   ├── role-hierarchy.js # Member authorization level checkers
    │   ├── sensitive-fields.js # Define fields containing credentials or tokens
    │   ├── task-access.js  # Verification logic for project tasks
    │   ├── tls-enforcement.js # Blocks unsecured connections in production
    │   └── validate-body.js # Enforces structured payloads and blocks extra fields
    │
    └── modules/            # Domain controllers & route modules
        ├── activity/       # Captures user log activities
        ├── auth/           # Identity setup, session boot, complete first login
        ├── bootstrap/      # Resolves permissions immediately post-login
        ├── clients/        # Clients management models & controllers
        ├── compat/         # Legacy systems integration controllers
        ├── dashboard/      # Compiles operational widgets & active data charts
        ├── hierarchy/      # Team structures, reporting relationships, transfers
        ├── member-onboarding/ # Manage user workspace applications
        ├── member-relationships/ # Manage hierarchical supervisor links
        ├── members/        # Org membership management and bans
        ├── monitor/        # Metrics visualizer dashboard
        ├── notifications/  # Client registration & push dispatch (FCM)
        ├── presence/       # Real-time state syncing & SSE heartbeats
        ├── projects/       # Projects and budgets CRUD
        ├── schema/         # Org custom fields metadata configurations
        ├── tasks/          # Tasks, stages, and assignments CRUD
        └── teams/          # Workspace team grouping models
```