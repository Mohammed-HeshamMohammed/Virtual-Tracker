# Dashboard-Backend (`vt-dashboard-api`)

Business-domain and identity API for the Virtual Tracker platform. It handles Firestore profiles, organization members, projects/tasks/clients/teams data, real-time activity tracking, presence status, organization hierarchy, timesheets, and notification logging.

For a detailed blueprint of how requests are partitioned and routed across the stack, see the repo root [explainhere.md](../explainhere.md).

---

## Role in the Stack

| Service | Container | Dev Port | Production Endpoint |
| :--- | :--- | :--- | :--- |
| **Dashboard-Backend** (this) | `vt-dashboard-api` | `:5713` | `https://dashapi.myvirtualtracker.com` |
| **Auth-Backend** | `vt-auth-api` | `:5712` | `https://auth.myvirtualtracker.com` |
| **Notify-Backend** | `vt-notify-api` | `:5715` | `https://notify.myvirtualtracker.com` |
| **Dashboard Web** | `vt-dashboard-web` | `:3000` | `https://app.myvirtualtracker.com` |

### Platform Design Philosophy
- **One Capability, One Backend**: Each `/api/...` route is implemented on exactly one backend service. Auth-Backend and Dashboard-Backend have zero route overlap. Dashboard-Backend protects this separation on production using an auth routing guard that returns `404 AUTH_BACKEND_ROUTE` for Auth-owned routes.
- **Authorization Separation (AuthN vs. AuthZ)**:
  - **Auth-Backend** verifies user credentials and validates tokens (AuthN).
  - **Dashboard-Backend** maps validated Firebase UIDs to Firestore member records, checks role-based hierarchical permissions, and authorizes specific business actions (AuthZ).

---

## API Routes & Controller Map

Dashboard-Backend hosts the core application routes. All endpoints (except `/health` and `/api/readiness`) require client authentication via a valid Firebase ID Token passed in the `Authorization: Bearer <ID_TOKEN>` header (or query param in SSE/WS streams).

### 1. System & Readiness Routes
| Path | Method | Description | Controller / Handler |
| :--- | :--- | :--- | :--- |
| `/health` | `GET` | Container liveness check. | [handle-request.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/app/handle-request.js) |
| `/api/readiness` | `GET` | Validates Firestore and optional Postgres database connectivity (boot gate). | [readiness.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/auth/readiness.js) |
| `/monitor` | `GET` | HTML Ops dashboard reporting memory/rps/error counters. | [routeMonitor](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/monitor/routes.js) |

### 2. User & Session Bootstrap
| Path | Method | Description | Controller / Handler |
| :--- | :--- | :--- | :--- |
| `/api/auth/sign-in-client-extras` | `GET` | Returns platform capabilities (e.g., OTP requirements). | [identity-routes.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/auth/identity-routes.js) |
| `/api/auth/session-bootstrap` | `POST` | Upserts Firestore profile, maps member record, updates status, and issues session verification. | [session-bootstrap.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/auth/session-bootstrap.js) |
| `/api/auth/complete-first-login` | `POST` | Exchanges temp password for permanent key & promotes member status. | [complete-first-login.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/auth/complete-first-login.js) |
| `/api/auth/profile` | `POST` | Updates Firestore user details and avatar base64 data. | [profile-settings.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/auth/profile-settings.js) |
| `/api/auth/access-request` | `POST` | Submits form requesting membership access to an org. | [identity-routes.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/auth/identity-routes.js) |
| `/api/bootstrap` | `GET` | Resolves permissions, settings, and shell aggregations immediately post-login. | [routes.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/bootstrap/routes.js) |
| `/api/bootstrap/warm` | `GET` | Pre-warms cache and returns basic member attributes. | [routes.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/bootstrap/routes.js) |

### 3. Business Entities & Organization CRUD (Schema Catalog)
Registered in `src/modules/schema/catalog/index.js` as `schemaEntities`. Standard CRUD endpoints (`GET/POST /api/{key}`, `GET/PATCH/DELETE /api/{key}/:id`) are mapped directly to Firestore collections (or PostgreSQL tables for time tracking).

| Entity / Route Key | Firestore Collection | PostgreSQL Table (if enabled) | Description |
| :--- | :--- | :--- | :--- |
| `members` | `members` | - | Member profile and metadata |
| `roles` | `roles` | - | Available workspace roles |
| `member-onboarding` | `member_onboarding` | - | Onboarding tasks checkpoints |
| `invites` | `invites` | - | Pending user registrations |
| `invite-projects` | `invite_projects` | - | Projects mapped to invites |
| `job-titles` | `job_titles` | - | Employment lookup seeds |
| `departments` | `departments` | - | Department lookup seeds |
| `job-types` | `job_types` | - | Job type lookup seeds |
| `tax-types` | `tax_types` | - | Tax configuration lookup seeds |
| `employment` | `employment` | - | Individual HR contract settings |
| `pay-rates` | `pay_rates` | - | Base pay rates and currencies |
| `time-settings` | `time_settings` | - | Track timers and idle rules |
| `limits` | `limits` | - | Weekly/daily tracking limits |
| `clients` | `clients` | - | Client profile details |
| `client-budgets` | `client_budgets` | - | Client financial budget details |
| `client-invoicing` | `client_invoicing` | - | Client invoice scheduling and templates |
| `client-projects` | `client_projects` | - | Client-to-project mappings |
| `projects` | `projects_VirtualTacker` | - | Core project records |
| `project-members` | `project_members` | - | Project roles and access scopes |
| `project-budgets` | `project_budgets` | - | Project budget constraints |
| `project-member-limits` | `project_member_limits` | - | Member budgets within a project scope |
| `teams` | `teams` | - | Operational team labels |
| `team-members` | `team_members` | - | Team user lists and leaders |
| `team-projects` | `team_projects` | - | Team project visibility allocations |
| `tasks` | `tasks` | - | Task status, assignee, and estimates |
| `task-subtasks` | `task_subtasks` | - | Subtask list checklists |
| `task-comments` | `task_comments` | - | Comments and discussions |
| `task-attachments` | `task_attachments` | - | GCS links for files |
| `task-assignments` | `task_assignments` | - | Task assignees and statuses |
| `task-hours` | `task_hours` | - | Billed tracking duration inputs |
| `task-time-tracking` | `task_time_tracking` | - | Active runtime tracking timer states |
| `member-relationships`| `member_relationships` | - | Hierarchical supervisor mappings |
| `member-tree-cache` | `member_tree_cache` | - | Flattened ancestors/descendants cache |
| `member-transfer-requests`| `member_transfer_requests` | - | Organizational node change logs |
| `time-entries` | `time_entries` | `time_entries` | Work time slots |
| `timesheets` | `timesheets` | `timesheets` | Periodic payroll sheets |
| `notifications` | - | `notifications` | Workspace notification alerts |
| `activity-sessions` | `activity_sessions` | - | Work session logging triggers |
| `activity-screenshots`| `activity_screenshots` | - | Telemetry base64 image captures |
| `activity-app-logs` | `activity_app_logs` | - | Captured desktop app telemetry |
| `activity-url-logs` | `activity_url_logs` | - | Visited web page telemetry logs |
| `activity-alert-log` | `activity_alert_log` | - | System notification dispatch records |

### 4. Special Telemetry & Real-Time Sync
| Path | Method | Description | Controller / Handler |
| :--- | :--- | :--- | :--- |
| `/api/activity/session` | `GET` / `POST` | Check or update currently running tracking session. | [activity](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/activity/routes.js) |
| `/api/activity/events` | `POST` | Pushes batch logs (screenshots, app segments, URLs) from tracking agent. | [activity](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/activity/routes.js) |
| `/api/activity/feed` | `GET` | Returns consolidated activity feeds (screenshots, apps, URLs) for review. | [activity](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/activity/routes.js) |
| `/api/presence/events` | `GET` | SSE (Server-Sent Events) live presence stream. | [presence](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/presence/index.js) |
| `/api/presence/ws` | `Upgrade` | WebSocket server heartbeats, live activity status checks, and client counts. | [presence](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/modules/presence/index.js) |

---

## Security Architecture

The server routes incoming HTTP traffic through a strict middleware chain in [handle-request.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/app/handle-request.js):

1. **CORS Handler**: Checks incoming origins against configuration rules ([cors.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/cors.js)).
2. **HTTPS Enforcement**: Blocks unencrypted HTTP traffic in production tier environments ([tls-enforcement.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/tls-enforcement.js)).
3. **Query Parameter Guard**: Rejects URLs containing plain credentials or security tokens in the query string ([password-request-guard.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/password-request-guard.js)).
4. **Auth Routing Guard**: Bounces any request mapping to Auth-Backend endpoints with `404 AUTH_BACKEND_ROUTE` to protect route segregation.
5. **IP Rate Limiter**: Enforces sliding-window limits based on route categories ([rate-limit.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/rate-limit.js)).
6. **Token Validator**: Decodes the Firebase ID token, validates expiration, and sets the auth context ([auth-middleware.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/auth-middleware.js)).
7. **Resource Access Guards**: Checks role permissions ([role-hierarchy.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/role-hierarchy.js)) and resource ownership (e.g., [project-access.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/project-access.js) and [task-access.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/http/task-access.js)).

---

## Environment Variables Configuration

Central variables are loaded by [env.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/config/env.js) and validated on boot by [env-schema.js](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/src/config/env-schema.js).

### Core Server Settings

| Variable | Scope | Type | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Mode | `development` \| `production` \| `test` | Target environment. |
| `PORT` | Network | `number` (1-65535, default `5713`) | Server port binding. |
| `FRONTEND_ORIGIN` | Links | `string` | Primary dashboard client host origin (used in invite links/emails, not CORS — CORS allows all origins since this API is Bearer-token authenticated). |
| `APP_PUBLIC_URL` | Redirects | `string` (HTTPS required in prod) | Public redirect origin of the client dashboard. |
| `ALLOW_INSECURE_HTTP` | Dev Override | `boolean` | Disable TLS checking. Do not enable in production. |
| `SKIP_ENV_VALIDATION` | Test Override| `boolean` | Bypasses Zod env schema validation rules. |

### Database & Cloud Integrations (Firestore & Storage)

| Variable | Type | Description |
| :--- | :--- | :--- |
| `FIREBASE_SERVICE_ACCOUNT` | `string` | Stringified JSON credentials of the Firebase Service Account. |
| `FIREBASE_PROJECT_ID` | `string` | Target Firebase project ID. |
| `FIREBASE_CLIENT_EMAIL` | `string` | Service account email certificate index. |
| `FIREBASE_PRIVATE_KEY` | `string` | Service account private key string (resolves newlines `\n` on boot). |
| `FIREBASE_PRIVATE_KEY_ID` | `string` | Mapped private key identifier. |
| `GOOGLE_APPLICATION_CREDENTIALS` | `string` | Path to a local credentials JSON file. |
| `FIREBASE_DATABASE_URL` | `string` | Realtime Database target URL — presence fallback, only used when `REDIS_URL` is unset. |
| `REDIS_URL` | `string` | Redis connection string — shared live presence store across instances. Preferred over Realtime Database when set. |
| `GCS_BUCKET_NAME` / `FIREBASE_STORAGE_BUCKET` | `string` | Target Google Cloud Storage bucket name for file uploads. |
| `POSTGRES_URL` | `string` | Optional PostgreSQL connection string. If set, redirects `time-entries` and `timesheets` to SQL instead of Firestore. |

### Outbound Integrations (SMTP & Notifications)

| Variable | Type | Description |
| :--- | :--- | :--- |
| `NOTIFY_BACKEND_URL` | `string` | URL of the `vt-notify-api` instance. Required in production. |
| `INTERNAL_SERVICE_SECRET` | `string` | Shared token to authorize outbound messaging via Notify-Backend. |
| `FIREBASE_WEB_PUSH_VAPID_PUBLIC_KEY` | `string` | VAPID public key (must be URL-safe base64). |
| `RESEND_API_KEY` | `string` | Outbound email delivery key (fallback email provider). |
| `RESEND_FROM` | `string` | From display address for emails. |
| `SMTP_HOST` | `string` | SMTP mail server host address. |
| `SMTP_PORT` | `number` | SMTP mail server port (defaults to `587`). |
| `SMTP_SECURE` | `boolean` | Set to `true` to force TLS secure sockets. |
| `SMTP_USER` | `string` | SMTP username credential. |
| `SMTP_PASS` | `string` | SMTP password credential (auto-strips spacing). |
| `SMTP_FROM` | `string` | Sender line string (e.g. `Virtual Tracker <noreply@...>` ). |

### Telemetry & Heartbeat Timers

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PRESENCE_ONLINE_MS` | `number` | `30000` (30s) | Threshold defining if member is actively online. |
| `PRESENCE_IDLE_MS` | `number` | `600000` (10m) | Idle duration threshold. |
| `PRESENCE_ACTIVITY_WINDOW_MS`| `number` | `60000` (1m) | Time scale chunk for presence metrics. |
| `PRESENCE_SIGNAL_MIN_INTERVAL_MS`| `number`| `5000` (5s) | Throttling limit between heartbeats. |
| `INVITE_SHARE_LINK_TTL_HOURS`| `number` | `48` | Lifetime duration for open registration invites. |
| `MONITOR_USERNAME` | `string` | `admin` | Username credentials for `/monitor` logs dashboard. |
| `MONITOR_PASSWORD` | `string` | `admin` | Password credentials for `/monitor` logs dashboard. |
| `ACTIVITY_CAPTURE_MODE` | `string` | `screenshots` | Telemetry mode rules (`screenshots` \| `logs`). |
| `ACTIVITY_WEB_CAPTURE_ENABLED`| `boolean` | `true` | Allows web domain tracking. |
| `ACTIVITY_TASK_SCREENSHOTS_ENABLED`| `boolean`| `true` | Allows screenshot logging for tasks. |
| `ACTIVITY_DESKTOP_AGENT_INGEST_ENABLED`| `boolean`| `true` | Enables active agent screenshots ingest. |
| `ACTIVITY_SESSION_STALE_MS` | `number` | `900000` (15m)| Max idle gap before closing tracking session. |

---

## Local Development & Setup

### 1. Database Setup
For local development, copy the project's Firebase Service Account JSON credentials file to the root directory as:
```text
Dashboard-Backend/firebase-admin.local.json
```
If this file is present, the Firebase Admin SDK will automatically load it, bypassing the need for env variables.

### 2. Environment Configuration
Create a `.env` file in the root of `Dashboard-Backend/` using [.env.example](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/.env.example):
```env
PORT=5713
FRONTEND_ORIGIN=http://localhost:3000
APP_PUBLIC_URL=http://localhost:3000
NOTIFY_BACKEND_URL=http://localhost:5715
INTERNAL_SERVICE_SECRET=dev-local-secret
```

### 3. PostgreSQL Option (Optional)
If you wish to log `time-entries` and `timesheets` in a PostgreSQL database instead of Firestore:
1. Provide a `POSTGRES_URL` in your `.env` file:
   ```env
   POSTGRES_URL=postgresql://user:password@localhost:5432/virtual_tracker
   ```
2. Initialize the tables once by running the script:
   ```bash
   # Run against your Postgres instance
   psql -d virtual_tracker -f src/lib/postgres/schema.sql
   ```

### 4. Run the Dev Server
```bash
# Install dependencies
npm install

# Run in watch mode (using nodemon wrapper script)
npm run dev
```

### 5. CLI Utility Scripts
Several convenience scripts are available under the [scripts](file:///x:/Work/Virtual-Tracker-Test/Virtual-Tracker/Dashboard-Backend/scripts) directory:
```bash
# Assign Owner role to a user in Firestore
npm run assign-owner -- --email=admin@example.com

# Manually verify a user's email address in Firebase Auth
npm run verify-user-email -- --email=user@example.com

# Run schema migrations
npm run migrate:profile-images
npm run migrate:clean-presence
npm run migrate:client-budget-start-date
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
├── DatabaseScheme.md       # Detailed database schema and mappings documentation
├── README.md               # This documentation file
├── entity-diagram.md       # Entity relationship diagrams
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
    │   ├── entity-bootstrap.js # Database checkers, index validation, maintenance scheduling
    │   └── entity-bootstrap-manifest.js # Canonical entities definitions and seeds
    │
    ├── config/
    │   ├── env.js          # Central env configuration schema loader
    │   ├── env-schema.js   # Zod environment schemas and validators
    │   ├── env-public.js   # Logs-safe environment configurations mapping
    │   ├── firebase.js     # Firebase connection initiator & database instance exporter
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
    ├── lib/
    │   ├── firestore/
    │   │   └── collections.js # Canonical Firestore collection names definitions
    │   └── postgres/
    │       ├── client.js   # PostgreSQL pg-pool client wrapper
    │       └── schema.sql  # SQL schema tables setup statements
    │
    └── modules/            # Domain controllers & route modules
        ├── activity/       # Captures user log activities (screenshots, app-usage)
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