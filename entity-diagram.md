# Virtual Tracker — Entity Relationship Diagram

Firestore-backed backend (`Dashboard-Backend/src`). Canonical field names are **snake_case**; APIs accept **camelCase** aliases where noted in services.

**Source of truth (code):**

| Artifact | Path |
|----------|------|
| Bootstrap registry (all collections + policies) | `Dashboard-Backend/src/bootstrap/entity-bootstrap-manifest.js` |
| Schema CRUD entities | `Dashboard-Backend/src/modules/schema/catalog/` → `schemaEntities` |
| Canonical collection names | `Dashboard-Backend/src/lib/firestore/collections.js` |
| Org startup seeds | `Dashboard-Backend/src/bootstrap/entity-bootstrap.js` |
| Manual UI test fixtures | `Dashboard-Backend/tooling/seeds/` (not loaded by the server) |

Dedicated route modules live under `src/modules/*`; shared HTTP helpers under `src/http/`. Paths below are relative to `Dashboard-Backend/`.

---

## Backend module map

| Module | Path prefix | Implementation |
|--------|-------------|----------------|
| Auth | `/api/auth/*` | `src/modules/auth/routes.js` — verify, `User_profiles`, profile settings, avatar, deactivation |
| Members (compat) | `/api/members/*` | `src/modules/compat/routes.js` — list/CRUD, profile GET/PATCH, batch delete, SSE, `GET /members/current` |
| Member invites | `/api/members/*`, `/api/public/invites/*` | `src/modules/members/routes/member-invites.routes.js` |
| Member profile | `/api/members/:id/profile` | `src/modules/members/services/member-profile.service.js` |
| Member onboarding | `/api/member-onboarding/*` | `src/modules/member-onboarding/routes.js` |
| Member relationships | `/api/member-relationships/*` | `src/modules/member-relationships/routes.js`, `service.js` — tree, scoped-members, visibility |
| Hierarchy / transfer | `/api/member-transfer-requests/*`, `/api/public/member-transfer-requests/*` | `src/modules/hierarchy/routes.js`, `transfer-request.service.js` |
| Schema CRUD | `/api/{entity-key}`, `/api/schema/entities` | `src/modules/schema/routes.js` (catalog keys → Firestore collections) |
| Clients | `/api/clients/*` | `src/modules/clients/routes.js`, `services/*` |
| Projects | `/api/projects/*` | `src/modules/projects/routes.js` |
| Tasks | `/api/tasks/*`, task child keys | `src/modules/tasks/routes.js` + schema CRUD |
| Activity | `/api/activity/*` | `src/modules/activity/routes.js`, `activity-alerts.js` |
| Dashboard | `/api/dashboard/*` | `src/modules/dashboard/routes.js` |
| Notifications | `/api/notifications/*` | `src/modules/notifications/routes.js` |
| Presence | `/api/presence/events`, `/api/presence/ws` | `src/modules/presence/` — RTDB `presence/{memberId}` + in-memory fallback |
| Compat bridges | `/api/invites`, `/api/member-invites`, `/api/organization-field-options` | `src/modules/compat/routes.js` |
| Org bootstrap | (server start) | `src/bootstrap/entity-bootstrap.js` ← `index.js` |

**Router order** (`src/app/handle-request.js`): auth → member invites → **transfer requests** → relationships → onboarding → activity → projects → **dashboard** → bootstrap → clients → tasks → notifications → **presence events** → compat → schema CRUD.

---

## Entity diagram

> All Firestore collections are **top-level** (`db.collection(name)`). Cross-domain links use **FK tables** — fetch only the domain you need per screen. Live presence is **not** a Firestore collection (see § Presence).

### Diagram index

| # | Domain | Collections | When to load together |
|---|--------|-------------|------------------------|
| 1 | [Identity & roles](#diagram-1--identity-auth--roles) | 6 + RTDB | Auth verify, `GET /members/current`, presence SSE/WS |
| 2 | [Invites](#diagram-2--invites--pre-provision) | 5 + stubs | Invite admin, registration |
| 3 | [Member HR](#diagram-3--member-hr--profile-extensions) | 9 + stub | Member profile modal only |
| 4 | [Teams & tree](#diagram-4--teams--member-tree) | 5 + stub | Tree / visibility / transfer routes |
| 5 | [Clients](#diagram-5--clients) | 4 + stubs | Client enriched list / edit |
| 6 | [Projects & tasks](#diagram-6--projects-tasks--team-links) | 12 + stubs | Per-project workspace, assignments, timers |
| 7 | [Activity](#diagram-7--activity-tracking-runtime) | 5 + stub | Tracking session & feed |
| 8 | [Timesheets](#diagram-8--timesheets) | 2 | Timesheet UI, payroll period submit |
| 9 | [Notifications](#diagram-9--notifications) | 1 | In-app notification bell |

### Domain map (read order / bandwidth)

Collections are **not nested under** `members/{id}/…` (see `INVALID_MEMBER_SUBCOLLECTIONS`). Cross-domain links use **FK tables** — fetch only the domain you need per screen.

```mermaid
flowchart LR
  subgraph d1 [Identity]
    members
    User_profiles
    member_roles
  end
  subgraph d2 [Invites]
    invites
    pending_auth
  end
  subgraph d3 [Member HR]
    employment
    pay_rates
  end
  subgraph d4 [Tree]
    member_relationships
    teams
  end
  subgraph d5 [Clients]
    clients
  end
  subgraph d6 [Projects]
    projects_VirtualTacker
    tasks
    task_assignments
  end
  subgraph d7 [Activity]
    activity_sessions
  end
  subgraph d8 [Timesheets]
    time_entries
    timesheets
  end
  subgraph d9 [Notify]
    notifications_VirtualTacker
  end
  d1 --> d3
  d1 --> d4
  d1 --> d6
  d5 --> d6
  d6 --> d7
  d6 --> d8
  d1 --> d7
  d1 --> d9
```

### Bandwidth guidelines

| Screen / flow | Prefer these collections | Avoid loading at the same time |
|---------------|--------------------------|--------------------------------|
| Login bootstrap | `member_auth_index`, `members`, `member_roles`, `roles`, `User_profiles`, RTDB `presence/{id}` | `activity_*`, full `tasks`, all `members` (500) |
| Members list | `members` (capped), presence via SSE/WS + `last_seen_at`, enrich roles/teams in batch | `activity_screenshots`, per-member `employment` |
| Member manage modal | `members` + profile service tables (§3) | Org-wide `projects_VirtualTacker`, `tasks` |
| Projects / tasks UI | `projects_VirtualTacker`, `project_members`, `tasks` **filtered by project_id** | All members, activity feed |
| Activity feed | `activity_sessions`, `activity_screenshots` / logs **for one member** | `GET /api/members` repeat polling |
| Client edit | `clients`, `client_budgets`, `client_invoicing`, `client_projects` | Unrelated member HR rows |
| Timesheets | `time_entries` and/or `timesheets` **for one member + period** | Org-wide `time_entries` |
| Scoped members tree | `member_relationships`, `member_tree_cache`, `GET /scoped-members` | Full unscoped `members` list |

**List enrichment** (`GET /api/members`): merges live presence (runtime store / RTDB) and denormalized `role` / `role_name` on read — still backed by FK tables in §1–2, not extra subcollections. `last_seen_at` on `members` is written on WebSocket disconnect only.

### Diagram 1 — Identity, auth & roles

Login, profile, role assignment, live presence. Fetch together on auth verify — not with project/task lists.

```mermaid
erDiagram
    direction TB

  MEMBERS {
    uuid id PK
    string first_name
    string last_name
    string work_email
    string personal_email
    string employee_id
    string ip_address
    string firebase_uid UK
    uuid role_id FK
    string role_name
    string role
    string status
    string hierarchy_status
    object hierarchy_entitlements
    boolean independent_hierarchy
    timestamp hierarchy_status_updated_at
    object privileges
    timestamp last_seen_at
    timestamp profile_linked_records_at
    timestamp date_added
    uuid created_by FK
    string created_by_uid
    uuid updated_by FK
    timestamp updated_at
  }

  USER_PROFILES {
    string uid PK
    string primaryEmail
    string photoURL
    boolean must_change_password
    timestamp updatedAt
  }

  MEMBER_AUTH_INDEX {
    string firebase_uid PK
    uuid member_id FK
    timestamp updated_at
  }

  ROLES {
    uuid id PK
    string name
    text description
    timestamp created_at
    uuid created_by FK
    uuid updated_by FK
  }

  MEMBER_ROLES {
    uuid id PK
    uuid member_id FK
    uuid role_id FK
    string role_name
    string member_name
    string member_work_email
    timestamp assigned_at
    uuid assigned_by FK
  }

  ACCESS_REQUESTS {
    string id PK
    string name
    string email
    string phone
    string source
    timestamp createdAt
  }

  MEMBERS ||--o| USER_PROFILES : "firebase_uid = uid"
  MEMBER_AUTH_INDEX ||--|| MEMBERS : "one uid to one member"
  MEMBERS }o--o| ROLES : "role_id"
  MEMBERS ||--o{ MEMBER_ROLES : has
  ROLES ||--o{ MEMBER_ROLES : assigned_via
```

> **Live presence** is stored in Firebase Realtime Database at `presence/{memberId}` (`status`, `lastSeenAt`, `lastActivityAt`, `connectionCount`). The in-process presence service mirrors RTDB when `FIREBASE_DATABASE_URL` is set; otherwise dev uses an in-memory store. Only `members.last_seen_at` and `profile_linked_records_at` persist in Firestore.

### Diagram 2 — Invites & pre-provision

Invite flows and pending auth. Load only on People › Invites or register — avoid with activity feeds.

```mermaid
erDiagram
    direction TB

  INVITES {
    uuid id PK
    string email
    uuid role_id FK
    string role_name
    string invite_token UK
    string invite_kind
    string project_ids_csv
    string firebase_uid
    decimal pay_rate
    string weekly_limit
    string currency
    string status
    timestamp sent_at
    timestamp accepted_at
    uuid created_by FK
    string created_by_uid
    uuid updated_by FK
  }

  INVITE_PROJECTS {
    uuid id PK
    uuid invite_id FK
    uuid project_id FK
    uuid created_by FK
  }

  PENDING_AUTH_MEMBERS {
    string uid PK
    string email
    string display_name
    string role_name
    decimal pay_rate
    string created_by_uid
    timestamp created_at
  }

  PENDING_AUTH_PROJECTS {
    uuid id PK
    string pending_uid FK
    uuid project_id FK
    timestamp created_at
  }

  MEMBER_ONBOARDING {
    uuid id PK
    uuid member_id FK
    uuid invite_id FK
    boolean created_account
    timestamp created_account_at
    boolean downloaded_app
    timestamp downloaded_app_at
    boolean tracked_time
    timestamp tracked_time_at
    timestamp last_reminder_sent_at
    uuid last_reminder_sent_by FK
    timestamp created_at
    uuid created_by FK
    uuid updated_by FK
    timestamp updated_at
  }

  MEMBERS {
    uuid id PK
    string firebase_uid UK
    uuid role_id FK
  }

  ROLES {
    uuid id PK
    string name
  }

  PROJECTS {
    uuid id PK
    string name
  }

  USER_PROFILES {
    string uid PK
  }

  MEMBERS ||--o| USER_PROFILES : "firebase_uid = uid"
  MEMBERS }o--o| ROLES : "role_id"
  MEMBERS ||--o| MEMBER_ONBOARDING : tracks
  INVITES ||--o{ MEMBER_ONBOARDING : invite_flow
  INVITES ||--|| ROLES : given
  INVITES ||--o{ INVITE_PROJECTS : includes
  PROJECTS ||--o{ INVITE_PROJECTS : pre_assigned
  PENDING_AUTH_MEMBERS ||--o{ PENDING_AUTH_PROJECTS : includes
  PROJECTS ||--o{ PENDING_AUTH_PROJECTS : pre_assigned_pending
  PENDING_AUTH_MEMBERS ||--|| USER_PROFILES : "doc id = uid"
  MEMBERS ||--o{ INVITES : created_by
```

### Diagram 3 — Member HR & profile extensions

Manage-modal tabs. Load per `GET /api/members/:id/profile` — not on every members list poll.

```mermaid
erDiagram
    direction TB

  EMPLOYMENT {
    uuid id PK
    uuid member_id FK
    uuid job_title_id FK
    uuid department_id FK
    uuid job_type_id FK
    uuid tax_type_id FK
    string job_title_label
    string department_label
    string job_type_label
    string tax_type_label
    string work_address
    boolean mailing_address
    string employment_type
    string employed_through
    string workplace_model
    decimal pct_in_office
    decimal pct_remote
    string tax_info
    string account_code
    string currency
    date start_date
    date end_date
    string termination_reason
    text employment_comments
    uuid created_by FK
    uuid updated_by FK
    timestamp created_at
    timestamp updated_at
  }

  PAY_RATES {
    uuid id PK
    uuid member_id FK
    string type
    decimal rate
    string currency
    string pay_period
    boolean require_timesheet_approval
    date effective_date
    string status
    text note
    uuid created_by FK
    uuid updated_by FK
    timestamp created_at
    timestamp updated_at
  }

  TIME_SETTINGS {
    uuid id PK
    uuid member_id FK
    boolean able_to_track_time
    string keep_idle_time
    string idle_timeout
    string modify_time
    boolean require_approval
    array work_days
    boolean disable_tracking_specific_days
    uuid updated_by FK
    timestamp created_at
    timestamp updated_at
  }

  LIMITS {
    uuid id PK
    uuid member_id FK
    string limit_type
    decimal value
    uuid updated_by FK
    timestamp updated_at
  }

  MEMBERS_FIELD_DATA {
    uuid id PK
    string type
    string recordType
    string label
    int position
    uuid memberDocId FK
    json formData
    string modifiedBy
    timestamp created_at
    timestamp updated_at
  }

  JOB_TITLES {
    uuid id PK
    string name
    string list_ranking
    timestamp created_at
    uuid created_by FK
    uuid updated_by FK
  }

  DEPARTMENTS {
    uuid id PK
    string name
    string list_ranking
    timestamp created_at
    uuid created_by FK
    uuid updated_by FK
  }

  JOB_TYPES {
    uuid id PK
    string name
    string list_ranking
    timestamp created_at
    uuid created_by FK
    uuid updated_by FK
  }

  TAX_TYPES {
    uuid id PK
    string name
    string list_ranking
    timestamp created_at
    uuid created_by FK
    uuid updated_by FK
  }

  MEMBERS {
    uuid id PK
    string firebase_uid UK
    uuid role_id FK
  }

  MEMBERS ||--o| EMPLOYMENT : has
  EMPLOYMENT }o--o| JOB_TITLES : references
  EMPLOYMENT }o--o| DEPARTMENTS : references
  EMPLOYMENT }o--o| JOB_TYPES : references
  EMPLOYMENT }o--o| TAX_TYPES : references
  MEMBERS ||--o{ PAY_RATES : has
  MEMBERS ||--o| TIME_SETTINGS : has
  MEMBERS ||--o{ LIMITS : has
  MEMBERS ||--o{ MEMBERS_FIELD_DATA : options_and_snapshots
```

### Diagram 4 — Teams & member tree

Org structure and visibility. Tree routes batch relationships + cache — separate from flat members list.

```mermaid
erDiagram
    direction TB

  TEAMS {
    uuid id PK
    string name
    boolean schedule_weekly_report
    timestamp last_weekly_report_sent_at
    timestamp created_at
    uuid created_by FK
    uuid updated_by FK
  }

  TEAM_MEMBERS {
    uuid id PK
    uuid team_id FK
    uuid member_id FK
    boolean is_lead
    timestamp joined_at
    uuid assigned_by FK
    uuid updated_by FK
  }

  MEMBER_RELATIONSHIPS {
    uuid id PK
    uuid parent_member_id FK
    uuid child_member_id FK
    string relationship_type
    array projects
    timestamp created_at
    uuid created_by FK
  }

  MEMBER_TREE_CACHE {
    uuid id PK
    array ancestors
    array descendants
    uuid root_id FK
    int depth
    timestamp updated_at
  }

  MEMBER_TRANSFER_REQUESTS {
    uuid id PK
    uuid requester_member_id FK
    string target_email
    uuid target_member_id FK
    string token UK
    string status
    timestamp expires_at
    timestamp created_at
    timestamp responded_at
    timestamp completed_at
  }

  MEMBERS {
    uuid id PK
    string firebase_uid UK
    uuid role_id FK
  }

  MEMBERS ||--o{ TEAM_MEMBERS : belongs_to
  TEAMS ||--o{ TEAM_MEMBERS : contains
  MEMBERS ||--o{ MEMBER_RELATIONSHIPS : parent_in
  MEMBERS ||--o{ MEMBER_RELATIONSHIPS : child_in
  MEMBER_RELATIONSHIPS ||--o| MEMBERS : created_by
  MEMBERS ||--o| MEMBER_TREE_CACHE : cached_tree
  MEMBER_TREE_CACHE }o--|| MEMBERS : root_of
  MEMBERS ||--o{ MEMBER_TRANSFER_REQUESTS : requests
  MEMBERS ||--o| MEMBER_TRANSFER_REQUESTS : target
```

> `hierarchy_status`, `hierarchy_entitlements`, and `independent_hierarchy` on `members` gate suspended / read-only / independent-tree modes. `GET /api/member-relationships/scoped-members` applies role-based visibility (Owner org tree for employees, manageable subtree for managers).

### Diagram 5 — Clients

Client module aggregate (`/api/clients/enriched`). One client + budgets + invoicing + project links per screen.

```mermaid
erDiagram
    direction TB

  CLIENTS {
    uuid id PK
    uuid member_id FK
    string name
    string status
    string street_address
    string city
    string state
    string zip
    string country
    string phone_number
    text email_addresses
    uuid created_by FK
    uuid updated_by FK
    timestamp created_at
    timestamp updated_at
  }

  CLIENT_BUDGETS {
    uuid id PK
    uuid client_id FK
    string type
    string based_on
    decimal cost
    decimal notify_at_pct
    string resets
    date start_date
    uuid created_by FK
    uuid updated_by FK
    timestamp created_at
    timestamp updated_at
  }

  CLIENT_INVOICING {
    uuid id PK
    uuid client_id FK
    boolean custom_for_client
    text notes
    int net_terms_days
    decimal tax_rate
    boolean auto_invoicing
    string auto_invoice_amount_based_on
    decimal auto_fixed_amount
    string auto_invoice_frequency
    int auto_invoice_delay_days
    int auto_invoice_reminder_days
    string auto_invoice_line_items
    boolean include_non_billable_time
    boolean include_expenses
    uuid created_by FK
    uuid updated_by FK
    timestamp created_at
    timestamp updated_at
  }

  CLIENT_PROJECTS {
    uuid id PK
    uuid client_id FK
    uuid project_id FK
    uuid assigned_by FK
    timestamp assigned_at
  }

  MEMBERS {
    uuid id PK
    string firebase_uid UK
    uuid role_id FK
  }

  PROJECTS {
    uuid id PK
    string name
  }

  MEMBERS ||--o| CLIENTS : "client role profile"
  CLIENTS ||--o| CLIENT_BUDGETS : has
  CLIENTS ||--o| CLIENT_INVOICING : has
  CLIENTS ||--o{ CLIENT_PROJECTS : linked_to
  PROJECTS ||--o{ CLIENT_PROJECTS : linked_to
  PROJECTS }o--o| CLIENTS : belongs_to
```

### Diagram 6 — Projects, tasks & team links

Project workspace. Scope tasks query by `project_id`; do not load all tasks with org-wide members.

```mermaid
erDiagram
    direction TB

  PROJECTS {
    uuid id PK
    string name
    boolean billable
    boolean disable_activity
    boolean allow_project_tracking
    boolean disable_idle_time
    uuid client_id FK
    text managers_notes
    text users_notes
    text viewers_notes
    string status
    timestamp created_at
    uuid created_by FK
    uuid updated_by FK
    timestamp updated_at
    uuid archived_by FK
    timestamp archived_at
  }

  PROJECT_MEMBERS {
    uuid id PK
    uuid project_id FK
    uuid member_id FK
    string project_role
    timestamp assigned_at
    uuid assigned_by FK
    uuid updated_by FK
  }

  PROJECT_BUDGETS {
    uuid id PK
    uuid project_id FK
    string type
    string based_on
    decimal cost
    boolean notify_project_members
    decimal notify_at_pct
    string who_to_notify
    boolean stop_timers_when_reached
    decimal stop_timers_at_pct
    string resets
    date start_date
    boolean include_non_billable_time
    timestamp created_at
    uuid created_by FK
    uuid updated_by FK
  }

  PROJECT_MEMBER_LIMITS {
    uuid id PK
    uuid project_id FK
    uuid member_id FK
    string type
    string based_on
    decimal cost
    string resets
    date start_date
    decimal notify_at_pct
    boolean notify_project_members
    timestamp created_at
    uuid created_by FK
    uuid updated_by FK
  }

  TASKS {
    uuid id PK
    uuid project_id FK
    uuid team_id FK
    string title
    text description
    string status
    string priority
    int order_index
    float duration_hours_per_day
    int duration_days
    int working_days
    float overtime_hours_per_day
    uuid assigned_to FK
    timestamp start_date
    timestamp due_date
    string review_state
    uuid reviewed_by FK
    timestamp reviewed_at
    timestamp created_at
    timestamp updated_at
    uuid created_by FK
    uuid updated_by FK
  }

  TASK_SUBTASKS {
    uuid id PK
    uuid task_id FK
    string title
    boolean completed
    int order_index
    timestamp created_at
    uuid created_by FK
    uuid updated_by FK
  }

  TASK_COMMENTS {
    uuid id PK
    uuid task_id FK
    text body
    timestamp created_at
    uuid created_by FK
    uuid updated_by FK
  }

  TASK_ATTACHMENTS {
    uuid id PK
    uuid task_id FK
    string file_url
    string file_name
    timestamp uploaded_at
    uuid uploaded_by FK
  }

  TASK_ASSIGNMENTS {
    uuid id PK
    uuid task_id FK
    uuid user_id FK
    uuid project_id FK
    string status
    int expected_seconds
    boolean required
    string review_state
    uuid reviewed_by FK
    timestamp reviewed_at
    text review_notes
    timestamp entered_review_at
    timestamp created_at
    timestamp updated_at
  }

  TASK_HOURS {
    uuid id PK
    uuid task_id FK
    uuid user_id FK
    float hours_spent
    string status
    timestamp submitted_at
    timestamp created_at
    timestamp updated_at
    uuid created_by FK
    uuid updated_by FK
  }

  TASK_TIME_TRACKING {
    uuid id PK
    uuid task_id FK
    uuid user_id FK
    uuid project_id FK
    int active_seconds
    int idle_seconds
    timestamp started_at
    timestamp last_activity_at
    string session_id
    text review_notes
    timestamp created_at
    timestamp updated_at
  }

  TEAM_PROJECTS {
    uuid id PK
    uuid team_id FK
    uuid project_id FK
    timestamp assigned_at
    uuid assigned_by FK
  }

  MEMBERS {
    uuid id PK
    string firebase_uid UK
    uuid role_id FK
  }

  TEAMS {
    uuid id PK
    string name
  }

  CLIENTS {
    uuid id PK
    string name
  }

  MEMBERS ||--o| CLIENTS : "client role profile"
  PROJECTS }o--o| CLIENTS : belongs_to
  MEMBERS ||--o{ PROJECT_MEMBERS : assigned_to
  PROJECTS ||--o{ PROJECT_MEMBERS : has
  PROJECTS ||--o| PROJECT_BUDGETS : has
  PROJECTS ||--o{ PROJECT_MEMBER_LIMITS : has
  MEMBERS ||--o{ PROJECT_MEMBER_LIMITS : limited_in
  PROJECTS ||--o{ TASKS : contains
  TEAMS ||--o{ TASKS : optional_scope
  MEMBERS ||--o{ TASKS : created_by
  MEMBERS ||--o{ TASKS : assigned_to
  TASKS ||--o{ TASK_COMMENTS : has
  MEMBERS ||--o{ TASK_COMMENTS : authored
  TASKS ||--o{ TASK_SUBTASKS : contains
  MEMBERS ||--o{ TASK_SUBTASKS : created_by
  TASKS ||--o{ TASK_ATTACHMENTS : has
  MEMBERS ||--o{ TASK_ATTACHMENTS : uploaded_by
  TASKS ||--o{ TASK_ASSIGNMENTS : assigns
  MEMBERS ||--o{ TASK_ASSIGNMENTS : assignee
  PROJECTS ||--o{ TASK_ASSIGNMENTS : scoped
  TASKS ||--o{ TASK_HOURS : logged
  MEMBERS ||--o{ TASK_HOURS : contributor
  TASKS ||--o{ TASK_TIME_TRACKING : timer
  MEMBERS ||--o{ TASK_TIME_TRACKING : tracker
  TEAMS ||--o{ TEAM_PROJECTS : tracks
  PROJECTS ||--o{ TEAM_PROJECTS : tracked_by
```

> Firestore collection for projects is `projects_VirtualTacker` (see `COLLECTIONS.projects` in `collections.js`). Schema entity key remains `projects`.

### Diagram 7 — Activity tracking (runtime)

High-volume runtime data. Sessions + incremental events — never bundle screenshots into members SSE.

```mermaid
erDiagram
    direction TB

  ACTIVITY_SESSIONS {
    uuid id PK
    uuid member_id FK
    string status
    timestamp started_at
    timestamp ended_at
    int active_seconds
    int idle_seconds
    uuid task_id FK
    timestamp updated_at
  }

  ACTIVITY_SCREENSHOTS {
    uuid id PK
    uuid member_id FK
    uuid session_id FK
    text image_data
    string app_name
    string page_title
    int activity_level
    timestamp captured_at
  }

  ACTIVITY_APP_LOGS {
    uuid id PK
    uuid member_id FK
    uuid session_id FK
    string app_name
    timestamp started_at
    timestamp ended_at
    int duration_seconds
  }

  ACTIVITY_URL_LOGS {
    uuid id PK
    uuid member_id FK
    uuid session_id FK
    string url
    string domain
    string page_title
    timestamp visited_at
    int duration_seconds
  }

  ACTIVITY_ALERT_LOG {
    uuid id PK
    uuid subject_member_id FK
    string alert_type
    array recipient_ids
    timestamp sent_at
  }

  MEMBERS {
    uuid id PK
    string firebase_uid UK
    uuid role_id FK
  }

  MEMBERS ||--o{ ACTIVITY_SESSIONS : tracks
  ACTIVITY_SESSIONS ||--o{ ACTIVITY_SCREENSHOTS : captures
  ACTIVITY_SESSIONS ||--o{ ACTIVITY_APP_LOGS : logs
  ACTIVITY_SESSIONS ||--o{ ACTIVITY_URL_LOGS : logs
  MEMBERS ||--o{ ACTIVITY_ALERT_LOG : subject
```

### Diagram 8 — Timesheets

Pay-period submissions and logged time rows. Load per member + date range — not with org-wide members list.

```mermaid
erDiagram
    direction TB

  TIME_ENTRIES {
    uuid id PK
    uuid member_id FK
    uuid project_id FK
    uuid task_id FK
    string date
    string start_time
    string end_time
    int duration
    text description
    boolean billable
    string status
    timestamp created_at
    timestamp updated_at
    uuid created_by FK
    uuid updated_by FK
  }

  TIMESHEETS {
    uuid id PK
    uuid member_id FK
    string period_start
    string period_end
    string status
    number total_hours
    number billable_hours
    timestamp submitted_at
    timestamp approved_at
    uuid approved_by FK
    timestamp created_at
    timestamp updated_at
  }

  MEMBERS {
    uuid id PK
  }

  PROJECTS {
    uuid id PK
  }

  TASKS {
    uuid id PK
  }

  MEMBERS ||--o{ TIME_ENTRIES : logs
  PROJECTS ||--o{ TIME_ENTRIES : billed_to
  TASKS ||--o{ TIME_ENTRIES : optional_task
  MEMBERS ||--o{ TIMESHEETS : submits
  MEMBERS ||--o| TIMESHEETS : approved_by
```

### Diagram 9 — Notifications

In-app notification feed per recipient.

```mermaid
erDiagram
    direction TB

  NOTIFICATIONS {
    uuid id PK
    uuid recipient_id FK
    string type
    string title
    string message
    string link
    boolean read
    timestamp created_at
  }

  MEMBERS {
    uuid id PK
  }

  MEMBERS ||--o{ NOTIFICATIONS : receives
```

> Firestore collection: `notifications_VirtualTacker` (`COLLECTIONS.notifications`).

> **Firestore collection names** match the diagram entities (snake_case plural). Exceptions: `USER_PROFILES` → `User_profiles`; `PROJECTS` → `projects_VirtualTacker`; `NOTIFICATIONS` → `notifications_VirtualTacker`; `MEMBER_AUTH_INDEX` uses document id = `firebase_uid`.

> **List/API enrichment:** `GET /api/members` merges live presence (`tracking_status`, `lastSeenAt`) from the runtime/RTDB store and may surface mirrored `pay_rate`, `weekly_limit`, `role` from `pay_rates`, `limits`, and `member_roles` — those are not always the canonical storage location for assignments.

> **Denormalization (console / fast reads):** `members` carries `role_name` and `role` (display) next to `role_id`. Each `member_roles` row carries `role_name`, `member_name`, and `member_work_email` beside the foreign keys so the assignment is readable without joining `roles` or `members`. `syncMemberPrimaryRole` keeps these fields aligned when the primary role changes.
> **Never nest** `employment`, `limits`, `pay_rates`, `time_settings`, etc. under `members/{id}/…`. See `Dashboard-Backend/src/lib/firestore/collections.js` (`INVALID_MEMBER_SUBCOLLECTIONS`).

---

## Schema catalog entities (CRUD)

Registered in `src/modules/schema/catalog/index.js` as `schemaEntities`. HTTP paths use the **entity key** (kebab-case); Firestore uses the **collection** column below.

| Entity key (API path segment) | Firestore collection |
|------------------------------|----------------------|
| `members` | `members` |
| `roles` | `roles` |
| `member-roles` | `member_roles` |
| `member-onboarding` | `member_onboarding` |
| `invites` | `invites` |
| `invite-projects` | `invite_projects` |
| `job-titles` | `job_titles` |
| `departments` | `departments` |
| `job-types` | `job_types` |
| `tax-types` | `tax_types` |
| `employment` | `employment` |
| `pay-rates` | `pay_rates` |
| `time-settings` | `time_settings` |
| `limits` | `limits` |
| `clients` | `clients` |
| `client-budgets` | `client_budgets` |
| `client-invoicing` | `client_invoicing` |
| `client-projects` | `client_projects` |
| `projects` | `projects_VirtualTacker` |
| `project-members` | `project_members` |
| `project-budgets` | `project_budgets` |
| `project-member-limits` | `project_member_limits` |
| `tasks` | `tasks` |
| `task-subtasks` | `task_subtasks` |
| `task-comments` | `task_comments` |
| `task-attachments` | `task_attachments` |
| `task-assignments` | `task_assignments` |
| `task-hours` | `task_hours` |
| `task-time-tracking` | `task_time_tracking` |
| `teams` | `teams` |
| `team-members` | `team_members` |
| `team-projects` | `team_projects` |
| `member-relationships` | `member_relationships` |
| `member-tree-cache` | `member_tree_cache` |
| `member-transfer-requests` | `member_transfer_requests` |
| `time-entries` | `time_entries` |
| `timesheets` | `timesheets` |
| `notifications` | `notifications_VirtualTacker` |
| `activity-sessions` | `activity_sessions` |
| `activity-screenshots` | `activity_screenshots` |
| `activity-app-logs` | `activity_app_logs` |
| `activity-url-logs` | `activity_url_logs` |
| `activity-alert-log` | `activity_alert_log` |

`GET /api/schema/entities` returns the catalog metadata. Generic CRUD: `GET/POST /api/{key}`, `GET/PATCH/DELETE /api/{key}/:id`.

**Dedicated routes (not only schema CRUD):**

| Route | Notes |
|-------|--------|
| `PATCH /api/tasks/batch/reorder` | Bulk `order_index` updates (`schema/routes.js`) |
| `/api/clients/*`, `/api/projects/*`, `/api/members/:id/profile` | See module map above |

**Collections managed outside schema catalog** (services / auth flows):

| Collection | Handled by |
|------------|------------|
| `User_profiles` | `auth/routes.js`, `profile-sync.js` |
| `member_auth_index` | `members/services/member-dedupe.js`, `ensure-member-from-auth.js` |
| `pending_auth_members`, `pending_auth_projects` | `members/routes/member-invites.routes.js` |
| `access_requests` | `auth/routes.js` |
| `deactivation_requests` | `auth/account-deactivation.js` |
| `members_field_data` | Org field options + `memberFormSnapshot` (`compat/routes.js`, profile save) |
| `system_meta` | Bootstrap markers (`entity_bootstrap`, legacy id migration) |
| `member_tree` | Legacy only (`member-relationships/migrate.js`) |
| RTDB `presence/{memberId}` | `modules/presence/` — not Firestore |

**Cascade deletes (`schema/routes.js`):**

- Delete **team** → `team_members`, `team_projects`, then team.
- Delete **client** → `client_budgets`, `client_invoicing`, `client_projects`, then client.

---

## FK tables as source of truth

Assignment and role data must not be duplicated on `members` documents. List views enrich on read; writes go through `relation-sync.js` and profile services.

| Concern | Source-of-truth table | Enriched on list as |
|---------|----------------------|---------------------|
| Primary role | `member_roles` + `roles.name` | `role` / `role_name` |
| Teams | `team_members` + `teams.name` | `teams[]` |
| Projects | `project_members` | project count / ids |
| Invite projects | `invite_projects` | invite `project_count` (FK preferred over CSV) |
| Pre-provision projects | `pending_auth_projects` → promoted to `project_members` | pending invite rows |
| Client ↔ project | `client_projects` | client `projects[]` on enriched client |
| Project roles | `project_members.project_role` | `manager` / `user` / `viewer` / `member` |

**Default roles** (`roles.name`, seeded by `ensureDefaultRoles` in `relation-sync.js`): Owner, Super Admin, Admin, Super Manager, Manager, Employee L2, Employee L1, Employee L0, Client, Viewer.

**Project roles** (`project_members.project_role`): `manager`, `user`, `viewer`, `member`.

---

## Member lifecycle & auth

| Stage | Collection | Becomes on sign-in |
|-------|------------|-------------------|
| Admin pre-provisions | `pending_auth_members` (doc id = Firebase UID) | `members` + `project_members` |
| Pre-assigned projects | `pending_auth_projects` | via `syncProjectMembersForMember` |
| Email invite (token) | `invites` + `invite_projects` | `members` + `project_members` on register |
| Open invite link | `invites` (`invite_kind=open_link`) | `members` on register |
| First sign-in (no row) | — | `ensureMemberFromAuth` creates `members` |
| Auth profile | `User_profiles` | linked by `members.firebase_uid` |
| Auth verify bootstrap | — | `ensureMemberLinkedRecordsForUserRecord` (full diagram policy) |
| Server startup bootstrap | — | `ensureOrganizationEntities` |

**Bootstrap registry** — mirrors `ENTITY_BOOTSTRAP_MANIFEST` in `src/bootstrap/entity-bootstrap-manifest.js`:

| Firestore collection | Policy | Notes |
|----------------------|--------|--------|
| `User_profiles` | `auth_flow` | Upsert on `/api/auth/verify` |
| `members` | `auth_flow` | `ensureMemberRowForUserRecord` on verify |
| `pending_auth_members` | `auth_flow` | Admin pre-provision |
| `pending_auth_projects` | `auth_flow` | With pending auth member |
| `access_requests` | `on_demand` | Public access-request form |
| `roles` | `org_seed` | Default Owner → Viewer (10 roles) |
| `member_roles` | `member_ensure` | |
| `member_auth_index` | `auth_flow` | `firebase_uid` → `members.id` |
| `member_onboarding` | `member_ensure` | |
| `invites` | `on_demand` | |
| `invite_projects` | `on_demand` | |
| `members_field_data` | `org_seed` | Org dropdowns + per-member snapshots |
| `job_titles` | `org_seed` | |
| `departments` | `org_seed` | |
| `job_types` | `org_seed` | |
| `tax_types` | `org_seed` | |
| `employment` | `member_ensure` | |
| `pay_rates` | `member_ensure` | |
| `time_settings` | `member_ensure` | |
| `limits` | `member_ensure` | weekly + daily rows |
| `member_relationships` | `org_seed` | `initializeMemberRelationships` when empty |
| `member_tree_cache` | `member_ensure` | |
| `member_tree` | `on_demand` | Legacy; migration only |
| `clients` | `on_demand` | |
| `client_budgets` | `on_demand` | |
| `client_invoicing` | `on_demand` | |
| `client_projects` | `on_demand` | |
| `projects_VirtualTacker` | `on_demand` | Schema key `projects` |
| `project_members` | `on_demand` | |
| `project_budgets` | `on_demand` | |
| `project_member_limits` | `on_demand` | |
| `teams` | `on_demand` | |
| `team_members` | `on_demand` | |
| `team_projects` | `on_demand` | |
| `tasks` | `on_demand` | |
| `task_subtasks` | `on_demand` | |
| `task_comments` | `on_demand` | |
| `task_attachments` | `on_demand` | |
| `task_assignments` | `on_demand` | Per-user task assignment + review |
| `task_hours` | `on_demand` | Submitted hours per task |
| `task_time_tracking` | `runtime` | Active timer state per user/task |
| `activity_sessions` | `runtime` | |
| `activity_screenshots` | `runtime` | Ingest disabled unless env flags set |
| `activity_app_logs` | `runtime` | |
| `activity_url_logs` | `runtime` | |
| `system_meta` | `org_marker` | `entity_bootstrap` + id migration markers |

**Schema catalog only** (not in `ENTITY_BOOTSTRAP_MANIFEST`; created on first API write):

| Firestore collection | Entity key | Notes |
|----------------------|------------|--------|
| `time_entries` | `time-entries` | Logged work rows |
| `timesheets` | `timesheets` | Pay-period submissions |
| `notifications_VirtualTacker` | `notifications` | In-app notifications |
| `member_transfer_requests` | `member-transfer-requests` | Hierarchy transfer workflow |
| `activity_alert_log` | `activity-alert-log` | Activity alert dedupe log |
| `deactivation_requests` | — | Account deactivation approval queue |

**Policy meanings**

| Policy | When data appears |
|--------|-------------------|
| `org_seed` | Server startup (`ensureOrganizationEntities` in `index.js`) if collection empty |
| `org_marker` | Bootstrap metadata only |
| `member_ensure` | Auth verify (`ensureMemberLinkedRecordsForUserRecord`) per member |
| `auth_flow` | Verify / invite / pre-provision flows |
| `on_demand` | UI or API only (e.g. clients, projects, tasks, invites) |
| `runtime` | Activity tracking while app runs |

**Server startup** (`index.js` → `src/bootstrap/entity-bootstrap.js`): seeds `roles`, lookups, `members_field_data` options, `member_relationships` (if empty), writes `system_meta/entity_bootstrap`.

**Auth verify** (`src/modules/members/services/ensure-member-linked-records.js`): org bootstrap + `members` row + `member_auth_index` + dedupe + `members.profile_linked_records_at` + `ensureMemberScopedEntities` (`employment`, `pay_rates`, `time_settings`, `limits`, `member_onboarding`, `member_tree_cache`).

**Presence:** WebSocket `/api/presence/ws` and SSE `/api/presence/events` read/write the in-process presence service, which syncs to RTDB `presence/{memberId}` when configured. On disconnect, `members.last_seen_at` is persisted. Management override `PATCH` presence updates runtime only (no Firestore write). Legacy nested `members.presence` object is read for migration only (`presence-status.js`).

**One Firebase user → one member:** canonical map is `member_auth_index/{firebase_uid}` → `members.id` (verify runs `dedupeMembersForFirebaseUid`). `members.firebase_uid` is still written for queries and legacy compat.

**Manual test data:** `tooling/seeds/seed-variant-data.mjs` (`npm run seed:variants`) seeds People/Profile/Projects fixtures with `_seedTag` — not run by the API server.

---

## Member profile API

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/members/:id/profile` | Load manage-modal form + enriched member |
| PATCH/PUT | `/api/members/:id/profile` | Save all manage-modal tabs; upserts `memberFormSnapshot` |
| DELETE | `/api/members/:id` | Cascade profile rows + delete member |

Service: `src/modules/members/services/member-profile.service.js`

**Delete cascade** (`deleteMemberProfileData` + `cascadeDeleteMemberRelations`):

`employment`, `pay_rates`, `time_settings`, `limits`, `member_roles`, `team_members`, `project_members`, `member_onboarding`, `members_field_data` (snapshots), then `members` document.

---

## Member manage modal → entity fields

| Modal tab | Form field | Entity table.column | Notes |
|-----------|------------|---------------------|-------|
| Info | First / last name | `members.first_name`, `last_name` | List `name` derived |
| Info | Work / personal email | `members.work_email`, `personal_email` | |
| Info | Employee ID, IP | `members.employee_id`, `ip_address` | IP from client on save |
| Employment | Job title, department, job type, tax type | `employment.*_id` + `*_label` | Creates lookup row if label is new |
| Employment | Address, type, dates, comments | `employment.*` | Direct columns |
| Roles | Role | `members.role_id` + `member_roles` | `syncMemberPrimaryRole` |
| Pay & bill | Pay rate, pay period, approval | `pay_rates.*` + `members.pay_rate` | Hourly mirrored on member |
| Work limits | Weekly / daily limit | `limits` + `members.weekly_limit` | `limit_type` = weekly \| daily |
| Work limits | Work days, disable specific days | `time_settings.work_days`, `disable_tracking_specific_days` | Weekday indices 0–6 |
| Settings | Track / idle / manual / approval | `time_settings.*`; live tracking status → runtime presence store | |
| (backup) | Full form JSON | `members_field_data` (`type=memberFormSnapshot`) | Per `memberDocId` |

---

## Clients module API

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/clients/enriched` | List clients + budget + invoicing + project ids |
| GET | `/api/clients/form-config` | Add/edit modal field layout + options |
| GET | `/api/clients/:id/edit-state` | Load client for edit modal |
| GET | `/api/clients/:id/invoicing` | Resolved invoicing (global vs custom) |
| POST | `/api/clients/with-details` | Create client + budget + invoicing + `client_projects` |
| PUT | `/api/clients/:id/with-details` | Update client aggregate |

Service: `src/modules/clients/services/client-service.js`, `budget-logic.js`, `invoicing-logic.js`

### Add / edit client modal → entity fields

| Modal tab | Form field | Entity table.column |
|-----------|------------|---------------------|
| General | Client member | `clients.member_id` |
| General | Name | `clients.name` |
| General | Address | `clients.street_address`, `city`, `state`, `zip`, `country` |
| Contact | Phone, email | `clients.phone_number`, `email_addresses` |
| Projects | Project list | `client_projects.project_id` |
| Budget | Type, based on, cost, notify %, resets, start | `client_budgets.*` |
| Invoicing | Custom, notes, terms, tax, auto rules | `client_invoicing.*` |
| (list) | Active / archived | `clients.status` |

---

## Projects module API

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/projects/form-config` | Add/edit modal tabs, fields, client/member options |
| GET | `/api/projects/:id/edit-state` | Load project for edit (members by role, budget, limits) |
| GET | `/api/projects/:id/teams` | Teams linked via `team_projects` |
| GET | `/api/projects/team-links` | All `team_projects` with team names |
| GET/POST/PATCH/DELETE | `/api/projects` (schema key) | Core project CRUD via schema catalog |
| PATCH | `/api/tasks/batch/reorder` | Reorder task `order_index` (schema routes) |
| — | Frontend `createProjectWithDetails` | Creates `projects`, `project_members`, `project_budgets`, `project_member_limits`, `team_projects` via schema + detail helpers |

### Add / edit project modal → entity fields

| Modal tab | Form field | Entity table.column |
|-----------|------------|---------------------|
| General | Project name(s) | `projects.name` |
| General | Billable, activity, tracking, idle | `projects.billable`, `disable_activity`, `allow_project_tracking`, `disable_idle_time` |
| General | Client | `projects.client_id` |
| Members | Managers, users, viewers, members | `project_members` (`project_role`) |
| Teams | Team list | `team_projects.team_id` |
| Budget | Type, based on, cost, notify, resets, dates | `project_budgets.*` |
| Budget | Member limits | `project_member_limits.*` + member multiselect |

**Task ↔ team rule:** When `tasks.team_id` is set, that team must already be linked to the same `tasks.project_id` via `team_projects` (enforced in `schema-crud.service.js` on create/update).

---

## Tasks module API

| Method | Route | Purpose |
|--------|-------|---------|
| GET/POST/PATCH/DELETE | `/api/tasks` (schema key) | Task CRUD via schema catalog |
| PATCH | `/api/tasks/batch/reorder` | Bulk `order_index` updates |
| GET | `/api/projects/:id/teams` | Teams linked to project via `team_projects` (used by task forms) |
| GET/POST/PATCH/DELETE | `/api/task-subtasks`, `/api/task-comments`, `/api/task-attachments` | Task child entities |
| GET/POST/PATCH/DELETE | `/api/task-assignments`, `/api/task-hours`, `/api/task-time-tracking` | Assignments, submitted hours, active timers |

### Add / edit task modal → entity fields

| Form field | Entity table.column | Notes |
|------------|---------------------|-------|
| Name | `tasks.title` | Required |
| Description | `tasks.description` | |
| Team | `tasks.team_id` | Must exist in `team_projects` for `project_id` |
| Duration | `tasks.duration_hours_per_day`, `duration_days`, `working_days`, `overtime_hours_per_day` | Scheduling fields |
| List / status | `tasks.status` | `todo`, `in_progress`, `in_review`, `blocked`, `done` |
| Priority | `tasks.priority` | `low`, `medium`, `high`, `urgent` |
| Assignee | `tasks.assigned_to` | Member on selected team; multi-assign via `task_assignments` |
| Review | `tasks.review_state`, `reviewed_by`, `reviewed_at` | Task-level review |
| Start date | `tasks.start_date` | Optional ISO date |
| Due date | `tasks.due_date` | Optional ISO date |
| Position (create) | `tasks.order_index` | Top vs bottom of list |

---

## Activity tracking

| Collection | Purpose |
|------------|---------|
| `activity_sessions` | Timer session (`active` / `idle` / `stopped`), seconds tallies, optional `task_id` |
| `activity_screenshots` | Thumbnails (`image_data`, `app_name`, `page_title`, `activity_level`) |
| `activity_app_logs` | App usage segments per session |
| `activity_url_logs` | URL visits per session |
| `activity_alert_log` | Deduped alert sends (`subject_member_id`, `alert_type`, `recipient_ids`) |

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/activity/session` | Current/open session for member |
| POST | `/api/activity/session` | Start/stop/idle session; updates runtime presence |
| POST | `/api/activity/events` | Batch screenshots, app logs, URL logs |
| GET | `/api/activity/feed` | Activity feed (screenshots, apps, URLs) |
| POST | `/api/activity/agent/register` | Desktop agent registration |

---

## Timesheets

| Method | Route | Purpose |
|--------|-------|---------|
| GET/POST/PATCH/DELETE | `/api/time-entries` | Logged time rows (schema CRUD) |
| GET/POST/PATCH/DELETE | `/api/timesheets` | Pay-period submissions (schema CRUD) |

Visibility rules in `schema/visibility.js` scope time entries and timesheets by member hierarchy.

---

## Notifications

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/notifications` | List notifications for current member |
| POST | `/api/notifications/:id/read` | Mark one read |
| POST | `/api/notifications/read-all` | Mark all read |
| DELETE | `/api/notifications/:id` | Delete notification |

Collection: `notifications_VirtualTacker`. Created by task assignment flows, activity alerts, and other modules.

---

## Member hierarchy transfer

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/member-transfer-requests` | Owner / Super Admin / Admin creates transfer request |
| GET | `/api/public/member-transfer-requests/:token` | Preview (no auth) |
| POST | `/api/public/member-transfer-requests/:token/accept` | Target accepts (auth required) |
| POST | `/api/public/member-transfer-requests/:token/decline` | Target declines (auth required) |

Collection: `member_transfer_requests`. On completion, `member_relationships` parent is updated.

---

## Presence (live status)

| Store | Path | Fields |
|-------|------|--------|
| RTDB (production) | `presence/{memberId}` | `status`, `lastSeenAt`, `lastActivityAt`, `connectionCount`, `updatedAt` |
| Firestore (persisted) | `members.last_seen_at` | Written on WebSocket disconnect |
| In-process | `modules/presence/` | Source of truth for API enrichment when WS connected |

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/presence/events` | SSE stream of presence changes |
| WS | `/api/presence/ws` | Client heartbeat + live status |

---

## Organization field options

`GET/POST /api/organization-field-options` → `members_field_data` where `type` is one of:

| type | Purpose |
|------|---------|
| `jobTitle`, `department`, `jobType`, `employmentType`, `employedThrough`, `workplaceModel`, `taxType`, `terminationReason` | Employment dropdown options |
| `memberFormSnapshot` | Per-member manage-modal JSON backup (`memberDocId` required) |

---

## Member relationships tree

| Collection | Purpose |
|------------|---------|
| `member_relationships` | `parent_member_id` added `child_member_id`; `relationship_type`: invite, preprovision, self_signup, admin_create; optional `projects[]` for visibility |
| `member_tree_cache` | Denormalized ancestors/descendants for fast reads |

Key routes under `/api/member-relationships/*`: visual-tree, ancestors, descendants, tree-path, shared-projects, visible, check-ancestor, initialize, reinitialize, **scoped-members**, **team-staffable-members**, **audit**, **repair-orphans**, **repair-status**.

---

## Invites & compat (legacy bridges)

| Route | Purpose |
|-------|---------|
| `GET/POST/PATCH/DELETE /api/invites` | Invite CRUD (compat) |
| `POST /api/invites/bulk` | Bulk invite create |
| `GET /api/members` (enriched) | Members list with roles, teams, project counts |
| `GET /api/members/events` | SSE member list stream |
| `POST /api/members/batch-delete` | Batch delete with relation cascade |
| `GET /api/members/current` | Resolve member from Firebase token |

Invite implementation: `src/modules/members/routes/member-invites.routes.js` (register, redeem, pre-provision, open-link).

---

## Indexes & conventions

- Primary keys: UUID v4 (`generateUUID()` in catalog), except `pending_auth_members` and `User_profiles` use Firebase UID as document id.
- Timestamps: `created_at`, `updated_at`, `assigned_at`, etc. — stored as Firestore `Timestamp`.
- API inputs: services accept snake_case and camelCase (e.g. `client_id` / `clientId`).
- Archived: `projects.status = archived`, `clients.status = archived`; list endpoints filter active by default where applicable.
