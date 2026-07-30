# DashboardBackend-Prod Branch — Dashboard Backend Service

> **Branch**: `DashboardBackend-Prod`  
> **Latest Commit**: `0a99a0a` — fix(dashboard-backend): map Firestore auto-ids to stable Postgres uuids in lookup migration  
> **Tracks**: `origin/DashboardBackend-Prod`  
> **Role**: Production-isolated deployment branch for the Dashboard-Backend service

---

## 1. Branch Purpose

The `DashboardBackend-Prod` branch contains **only the Dashboard-Backend service**, isolated for Coolify/Docker deployment. This is the core business logic API that powers the entire Virtual Tracker dashboard application.

### What's Included
- `Dashboard-Backend/` — The complete business API microservice
- `.gitignore` — Repository-level ignore rules

### What's Excluded
- All markdown documentation (removed for production)
- `.env.example` files (removed for security)
- Auth-Backend, Dashboard-Web, Landing-Web, Notify-backend, deploy/
- Development scripts directory (removed from production)

---

## 2. Service Architecture

The Dashboard-Backend is organized into a modular architecture with domain-driven modules:

```
Dashboard-Backend/
├── .dockerignore
├── .firebaserc.example
├── .npmrc
├── Dockerfile
├── firebase.json
├── firestore.indexes.json
├── firestore.rules
├── hosting-public/__/auth/action.html
├── index.js                          # Entry point
├── nixpacks.toml                     # Coolify build config
├── package.json
├── server.js                         # HTTP server bootstrap
├── storage.rules
└── src/
    ├── app/
    │   └── handle-request.js         # Central request router
    ├── config/
    │   ├── deployment-profiles.js    # Env-aware defaults
    │   ├── env.js                    # Environment configuration
    │   ├── env-public.js             # Public env vars
    │   ├── env-schema.js             # Zod schema validation
    │   ├── firebase.js               # Firebase Admin init
    │   ├── index.js                  # Config exports
    │   └── password-policy/          # Password policy (4 files)
    ├── core/
    │   ├── create-server.js          # Server factory
    │   ├── logger.js                 # Structured logging
    │   └── metrics.js                # Metrics collection
    ├── http/                         # HTTP middleware (16 files)
    │   ├── api-error.js
    │   ├── auth-middleware.js        # Firebase token auth gate
    │   ├── auth-token.js
    │   ├── cors.js
    │   ├── email-client.js           # Transactional email sender
    │   ├── password-request-guard.js
    │   ├── quota-error.js
    │   ├── rate-limit.js
    │   ├── read-json-body.js
    │   ├── request-ip.js
    │   ├── response.js
    │   ├── sanitize-error.js
    │   ├── sanitize-log.js
    │   ├── security-headers.js
    │   ├── sensitive-fields.js
    │   ├── tls-enforcement.js
    │   └── validate-body.js
    └── modules/                      # Domain modules
        ├── activity/
        ├── auth/
        ├── bootstrap/
        ├── clients/
        ├── compat/
        ├── dashboard/
        ├── hierarchy/
        ├── member-onboarding/
        ├── member-relationships/
        ├── members/
        ├── monitor/
        ├── notifications/
        ├── presence/
        ├── projects/
        ├── schema/
        ├── tasks/
        └── teams/
```

---

## 3. Domain Modules (Detailed)

### 3.1 Auth Module (`modules/auth/`)
Handles identity-related operations that go beyond simple authentication:
- **Session Bootstrap** (`session-bootstrap.js`): First-login member provisioning
- **Profile Sync** (`profile-sync.js`): Syncs Firebase Auth profile changes to Firestore
- **Identity Routes** (`identity-routes.js`): Session authorization, profile settings
- **Security Alerts** (`security-login-alerts.js`, `security-notification-emails.js`): Login alerts, security emails
- **Verification** (`verification-email.js`): Email verification flow
- **Invite System** (`invite-email.js`, `preprovision-email.js`): Member invitation emails
- **Account Deactivation** (`account-deactivation.js`): Account disable/delete flow
- **Profile Avatar** (`profile-avatar.js`, `profile-image-resolve.js`): Avatar upload and resolution

### 3.2 Members Module (`modules/members/`)
Comprehensive member/employee management:
- **Routes**: Bans, invites, hierarchy removal (3 route files)
- **Services** (20+ files):
  - `member-ban-service.js` — Ban/unban with email notification
  - `invite-lifecycle.js` / `invite-management.service.js` — Full invite lifecycle
  - `member-dedupe.js` — Duplicate member detection and merge
  - `member-entity-bootstrap.js` — Auto-create linked entities on member creation
  - `member-presence.service.js` — Online/idle/offline presence
  - `member-role-change.service.js` — Role management with governance
  - `member-list-enrichment.js` / `member-list-fetch.js` — Paginated member lists
  - `generate-employee-id.service.js` — Auto-generated employee IDs
  - `shift-allowance-feature.js` — Shift allowance calculations
  - `privileged-role-governance.js` — Role change authorization

### 3.3 Hierarchy Module (`modules/hierarchy/`)
Organizational tree management:
- **Hierarchy Placement** (`hierarchy-placement.js`): Node positioning
- **Hierarchy Sync** (`hierarchy-sync.js`): Tree consistency maintenance
- **Hierarchy Access Guard** (`hierarchy-access-guard.js`): Permission checking
- **Hierarchy Audit** (`hierarchy-audit.js`): Change tracking
- **Hierarchy Repair** (`hierarchy-repair.js`): Self-healing tree operations
- **Transfer Requests** (`transfer-request.service.js`): Member transfer between nodes
- **Membership Entitlements** (`membership-entitlements.js`): Node-based access rights

### 3.4 Tasks Module (`modules/tasks/`)
Task and time tracking:
- **Task Assignments** (`task-assignments.js`): Assign members to tasks
- **Task Time Tracking** (`task-time-tracking.js`): Timer start/stop/log
- **Task Workload Validation** (`task-workload-validation.js`): Overwork prevention
- **Timer Limit Service** (`timer-limit.service.js`): Concurrent timer limits
- **Task Assignee API** (`task-assignee-api.js`): Assignee resolution

### 3.5 Clients Module (`modules/clients/`)
Client/customer management:
- **Client Service** (`client-service.js`): CRUD operations
- **Budget Logic** (`budget-logic.js`): Budget calculation and tracking
- **Budget Usage** (`client-budget-usage.js`): Real-time budget consumption
- **Budget Notifications** (`client-budget-notify.js`): Budget threshold alerts
- **Invoicing Logic** (`invoicing-logic.js`): Invoice generation support
- **Form Config** (`form-config.js`): Dynamic form field configuration

### 3.6 Projects Module (`modules/projects/`)
Project management:
- **Overview Service** (`overview-service.js`): Project dashboard stats
- **Budget from Clients** (`project-budget-from-clients.js`): Client-linked budgets
- **Form Config** (`form-config.js`): Project form field definitions
- **Member Filter** (`project-form-member-filter.js`): Role-based member filtering

### 3.7 Dashboard Module (`modules/dashboard/`)
Analytics and overview:
- **Command Center** (`command-center-service.js`): Aggregated dashboard widgets
- **General Dashboard** (`general-dashboard-service.js`): Overview metrics
- **Dashboard Cache** (`dashboard-cache.js`): In-memory caching layer
- **Base Loader** (`dashboard-base-loader.js`): Data fetching foundations

### 3.8 Presence Module (`modules/presence/`)
Real-time presence tracking:
- **WebSocket Gateway** (`presence-gateway.js`): WebSocket server
- **Presence Manager** (`presence-manager.js`): Online/idle/offline state machine
- **Presence PubSub** (`presence-pubsub.js`): Cross-service presence broadcasting
- **RTDB Store** (`presence-store-rtdb.js`): Firebase RTDB-backed presence
- **Firestore Store** (`presence-store.js`): Firestore-backed presence fallback

### 3.9 Schema Module (`modules/schema/`)
Generic CRUD with catalog validation:
- **Catalog** (12 entity catalogs): Activity, clients, employment, hierarchy, member-relationships, members, notifications, projects, tasks, teams, timesheets
- **Collection Reference** (`collection-ref.js`): Firestore collection path builder
- **Schema CRUD Service** (`schema-crud.service.js`): Generic Firestore CRUD
- **Postgres CRUD Service** (`postgres-crud.service.js`): PostgreSQL lookup table CRUD
- **Visibility** (`visibility.js`): Role-based field visibility

### 3.10 Monitor Module (`modules/monitor/`)
Admin-facing monitoring:
- **Dashboard HTML** (`dashboard.html.js`): Server-rendered admin dashboard
- **Login HTML** (`login.html.js`): Monitor login page
- **Session Store** (`session-store.js`): In-memory session management

### 3.11 Activity Module (`modules/activity/`)
Activity tracking and screenshots:
- **Agent Link Sessions** (`agent-link-sessions.js`): Desktop agent session management
- **Activity Routes** (`routes.js`): Screenshot upload, session tracking

### 3.12 Bootstrap Module (`modules/bootstrap/`)
First-login provisioning:
- **Bootstrap Service** (`bootstrap-service.js`): Creates member profile, linked entities
- **Warm Service** (`bootstrap-warm-service.js`): Pre-warms Firestore connections

---

## 4. API Routes Summary

| Route Prefix | Module | Auth | Description |
|-------------|--------|:---:|-------------|
| `GET /health` | core | ✗ | Container health check |
| `GET /` | core | ✗ | Default healthcheck (alias) |
| `GET /api/readiness` | auth | ✗ | Firestore readiness probe |
| `/api/auth/*` | auth | Mixed | Session bootstrap, identity, profile |
| `/api/bootstrap/*` | bootstrap | ✓ | First-login provisioning |
| `/api/members/bans/*` | members | ✓ | Member ban management |
| `/api/members/invites/*` | members | ✓ | Invitation lifecycle |
| `/api/members/remove-from-tree/*` | members | ✓ | Hierarchy removal |
| `/api/member-onboarding/*` | onboarding | ✓ | Onboarding workflow |
| `/api/hierarchy/*` | hierarchy | ✓ | Transfer requests |
| `/api/member-relationships/*` | relationships | ✓ | Supervisor/subordinate |
| `/api/activity/*` | activity | ✓ | Activity/screenshot tracking |
| `/api/projects/*` | projects | ✓ | Project CRUD and budget |
| `/api/dashboard/*` | dashboard | ✓ | Analytics, command center |
| `/api/clients/*` | clients | ✓ | Client CRUD, budget, invoicing |
| `/api/tasks/*` | tasks | ✓ | Task CRUD, assignments, timer |
| `/api/notifications/*` | notifications | ✓ | In-app notifications |
| `/api/presence/*` | presence | ✓ | WebSocket + REST presence |
| `/api/compat/*` | compat | ✓ | Legacy compatibility |
| `/api/schema/*` | schema | ✓ | Generic entity CRUD |
| `/monitor/*` | monitor | Session | Admin monitoring dashboard |

---

## 5. Database Strategy

### Firestore (Primary)
- All entity data (members, projects, tasks, clients, timesheets, etc.)
- Hierarchical collection structure per organization
- Security rules enforce per-document access control

### PostgreSQL (Supplementary)
- **Lookup Tables**: Migrated from Firestore for faster reads
- **Auto-creation**: Tables created on startup if missing
- **Migration Path**: `migrate-to-postgres.mjs`, `migrate-lookups-to-postgres.mjs`
- **Fallback**: Falls back to Firestore if Postgres schema is missing

### Firebase RTDB
- Real-time presence data (online/idle/offline status)

---

## 6. Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `firebase-admin` | ^13.8.0 | Firestore, Auth, Storage, RTDB |
| `pg` | ^8.16.3 | PostgreSQL client |
| `sharp` | ^0.34.3 | Image processing (avatar resizing) |
| `ws` | ^8.21.0 | WebSocket server for presence |
| `zod` | ^3.25.76 | Schema validation |

---

## 7. Branch Evolution (Commit History)

| SHA | Message |
|-----|---------|
| `0a99a0a` | fix(dashboard-backend): map Firestore auto-ids to stable Postgres uuids in lookup migration |
| `db96702` | fix(dashboard-backend): ignore non-uuid Firestore actor ids in Postgres lookup writes |
| `aabcbde` | fix(dashboard-backend): replace Postgres lookup seeds before Firestore import |
| `b221022` | fix(dashboard-backend): treat empty Firestore UUID fields as null in Postgres |
| `3655845` | fix(dashboard-backend): complete first-login bootstrap without client retry |
| `6b4e5b0` | fix(auth): avoid duplicate session-bootstrap on Google sign-in |
| `28e762b` | fix(auth): survive transient session-bootstrap failures on Google sign-in |
| `2b2277b` | fix(dashboard-backend): fall back to Firestore when Postgres lookup schema is missing |
| `8ae20f5` | fix(dashboard-backend): auto-create Postgres lookup tables on startup |
| `77b6337` | Sync Dashboard-Backend from main: Postgres lookup tables and services |
| `628b751` | chore(dashboard-backend): clean up dev scripts from production package.json |
| `e5e0a5d` | chore(dashboard-backend): remove redundant env CLI flag from start script |
| `eeb27ff` | fix(dashboard-backend): support GET / for default container healthcheck |
| `4be3fb1` | fix(dashboard-backend): fix relative import of email-client in ban-email.js |
| `5d81bd4` | chore(dashboard-backend): remove non-essential scripts directory from production branch |
| `6e7659e` | fix(dashboard-backend): fix relative import path of task-subcollections in collection-ref.js |
| `fcf6fdc` | chore: sync Dashboard-Backend updates from main (no docs/env.example) |
| `1207e88` | chore: remove all markdown files |
| `bdaa7cb` | chore: remove .env.example from production branch |
| `b6ca9cb` | chore: sync Dashboard-Backend updates from main |
| `983549d` | Sync Dashboard-Backend from main: identity routes, session-bootstrap, and readiness |
| `2d3f2b8` | Serve member invites and onboarding from Dashboard-Backend (sync from main) |
| `b13471a` | Sync Dashboard-Backend from main with full module structure and Docker deploy |
| `50dd1b5` | DashboardBackend-Prod: isolated Dashboard-Backend with Coolify production config |
