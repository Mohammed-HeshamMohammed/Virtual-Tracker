# Virtual Tracker — Firestore Schema

> **Reference version**: Reorganized schema. See "Changed from previous" sections to know what to update in the backend.

---

## What moved and where

| Was in Firestore | Now in |
|---|---|
| `activity_screenshots.image_data` (base64 field) | GCS — see `GCS_STORAGE.md` |
| `User_profiles.profileImageData` + `profileImageMimeType` + `profileImageUpdatedAt` | GCS — see `GCS_STORAGE.md` |
| `time_entries` collection | PostgreSQL — see `POSTGRESQL_SCHEMA.md` |
| `timesheets` collection | PostgreSQL — see `POSTGRESQL_SCHEMA.md` |
| `task_comments` (flat collection) | Subcollection: `tasks/{taskId}/comments` |
| `task_subtasks` (flat collection) | Subcollection: `tasks/{taskId}/subtasks` |
| `task_attachments` (flat collection) | Subcollection: `tasks/{taskId}/attachments` |
| `task_hours` (flat collection) | Subcollection: `tasks/{taskId}/hours` |
| `task_time_tracking` (flat collection) | Subcollection: `tasks/{taskId}/time_tracking` |

---

## Collection map

All collections are **top-level** (`db.collection(name)`) unless listed under **Task subcollections** below.
`INVALID_MEMBER_SUBCOLLECTIONS` rule remains in force — nothing nested under `members/{id}/`.

---

## Domain 1 — Identity & auth

### `members`
No field changes. Fields unchanged from previous schema.

```
id                          uuid       PK
first_name                  string     required
last_name                   string     required
work_email                  string     required
personal_email              string
employee_id                 string
ip_address                  string
firebase_uid                string     unique
role_id                     uuid       FK → roles
role_name                   string     denormalized
role                        string     denormalized display
status                      string     active | inactive | paused
hierarchy_status            string
hierarchy_entitlements      object
privileges                  object
independent_hierarchy       boolean
hierarchy_status_updated_at timestamp
date_added                  timestamp
last_seen_at                timestamp  written on WS disconnect only
profile_linked_records_at   timestamp
created_by                  uuid
updated_by                  uuid
updated_at                  timestamp
```

### `User_profiles`
**Changed** — image fields removed. `photoURL` is now always a GCS URL.

```
uid                    string     PK (Firebase UID)
primaryEmail           string
photoURL               string     GCS URL — format: /profile-avatars/{uid}/{filename}
must_change_password   boolean
updatedAt              timestamp

REMOVED: profileImageData
REMOVED: profileImageMimeType
REMOVED: profileImageUpdatedAt
```

> **Backend**: `profile-sync.js` — on avatar upload, write to GCS first, store the returned URL in `photoURL`. Remove any base64 handling.

### `member_auth_index`
No changes.

```
firebase_uid   string   PK / doc ID
member_id      uuid     FK → members
updated_at     timestamp
```

### `roles`
No changes.

```
id           uuid    PK
name         string  unique
description  text
created_at   timestamp
created_by   uuid
updated_by   uuid
```

### `member_roles`
No changes.

```
id                  uuid    PK
member_id           uuid    FK → members
role_id             uuid    FK → roles
role_name           string  denormalized
member_name         string  denormalized
member_work_email   string  denormalized
assigned_at         timestamp
assigned_by         uuid
```

### `access_requests`
No changes.

```
id         string    PK
name       string
email      string
phone      string
source     string
createdAt  timestamp
```

---

## Domain 2 — Invites & onboarding

No collection changes. All fields unchanged.

### `invites`
```
id             uuid    PK
email          string  required
role_id        uuid    FK → roles
invite_token   string  unique
invite_kind    string  open_link | email
firebase_uid   string  set on acceptance
pay_rate       decimal
weekly_limit   string
currency       string
status         string  pending | accepted | revoked
sent_at        timestamp
accepted_at    timestamp
created_by     uuid
updated_by     uuid
```

### `invite_projects`
```
id          uuid   PK
invite_id   uuid   FK → invites
project_id  uuid   FK → projects_VirtualTacker
created_by  uuid
```

### `pending_auth_members`
```
uid              string   PK (Firebase UID)
email            string
display_name     string
role_name        string
pay_rate         decimal
created_by_uid   string
created_at       timestamp
```

### `pending_auth_projects`
```
id           uuid    PK
pending_uid  string  FK → pending_auth_members
project_id   uuid    FK → projects_VirtualTacker
created_at   timestamp
```

### `member_onboarding`
```
id                      uuid    PK
member_id               uuid    FK → members
invite_id               uuid    FK → invites
created_account         boolean
created_account_at      timestamp
downloaded_app          boolean
downloaded_app_at       timestamp
tracked_time            boolean
tracked_time_at         timestamp
last_reminder_sent_at   timestamp
last_reminder_sent_by   uuid
created_at              timestamp
created_by              uuid
updated_by              uuid
updated_at              timestamp
```

---

## Domain 3 — Member HR & profile extensions

No collection changes. All stay flat (never nest under members).

### `employment`
```
id                    uuid    PK
member_id             uuid    FK → members
job_title_id          uuid    FK → job_titles
department_id         uuid    FK → departments
job_type_id           uuid    FK → job_types
tax_type_id           uuid    FK → tax_types
job_title_label       string  denormalized
department_label      string  denormalized
job_type_label        string  denormalized
tax_type_label        string  denormalized
work_address          string
mailing_address       boolean
employment_type       string
employed_through      string
workplace_model       string
pct_in_office         decimal
pct_remote            decimal
tax_info              string
account_code          string
currency              string
start_date            string  ISO date
end_date              string  ISO date
termination_reason    string
employment_comments   text
created_by            uuid
updated_by            uuid
created_at            timestamp
updated_at            timestamp
```

### `pay_rates`
```
id                           uuid    PK
member_id                    uuid    FK → members
type                         string  hourly | salary
rate                         decimal
currency                     string
pay_period                   string  weekly | monthly
require_timesheet_approval   boolean
effective_date               string  ISO date
status                       string
note                         text
created_by                   uuid
updated_by                   uuid
created_at                   timestamp
updated_at                   timestamp
```

### `time_settings`
```
id                              uuid      PK
member_id                       uuid      FK → members
able_to_track_time              boolean
keep_idle_time                  string
idle_timeout                    string
modify_time                     string
require_approval                boolean
work_days                       array
disable_tracking_specific_days  boolean
use_shifts_for_limits           boolean
updated_by                      uuid
created_at                      timestamp
updated_at                      timestamp
```

### `limits`
```
id           uuid    PK
member_id    uuid    FK → members
limit_type   string  weekly | daily
value        decimal
updated_by   uuid
updated_at   timestamp
```

### `members_field_data`
```
id          uuid    PK
type        string  jobTitle | department | memberFormSnapshot | ...
recordType  string
label       string
position    int
memberDocId uuid    FK → members (snapshots only)
formData    json
modifiedBy  string
created_at  timestamp
updated_at  timestamp
```

### Lookup tables: `job_titles`, `departments`, `job_types`, `tax_types`
```
id           uuid    PK
name         string
list_ranking string
created_at   timestamp
created_by   uuid
updated_by   uuid
```

---

## Domain 4 — Teams & tree

No collection changes.

### `teams`
```
id                         uuid    PK
name                       string
schedule_weekly_report     boolean
last_weekly_report_sent_at timestamp
created_at                 timestamp
created_by                 uuid
updated_by                 uuid
```

### `team_members`
```
id           uuid    PK
team_id      uuid    FK → teams
member_id    uuid    FK → members
is_lead      boolean
joined_at    timestamp
assigned_by  uuid
updated_by   uuid
```

### `member_relationships`
```
id                  uuid    PK
parent_member_id    uuid    FK → members
child_member_id     uuid    FK → members
relationship_type   string  invite | preprovision | self_signup | admin_create
projects            array   project IDs for scoped visibility
created_at          timestamp
created_by          uuid
```

### `member_tree_cache`
```
id           uuid    PK (matches member_id)
ancestors    array   [{member_id, level, relationship_type}]
descendants  array   [{member_id, level, relationship_type}]
root_id      uuid    FK → members
depth        number
updated_at   timestamp
```

### `member_transfer_requests`
```
id                  uuid    PK
requester_member_id uuid    FK → members
target_email        string
target_member_id    uuid    FK → members
token               string  unique
status              string  pending | accepted | declined | expired
expires_at          timestamp
created_at          timestamp
responded_at        timestamp
completed_at        timestamp
```

---

## Domain 5 — Clients

No collection changes.

### `clients`
```
id              uuid    PK
member_id       uuid    FK → members (client role profile)
name            string  required
street_address  string
city            string
state           string
zip             string
country         string
phone_number    string
email_addresses text
status          string  active | archived
created_by      uuid
updated_by      uuid
created_at      timestamp
updated_at      timestamp
```

### `client_budgets`
```
id              uuid    PK
client_id       uuid    FK → clients
type            string  hourly | fixed | retainer | none
based_on        string  per_person | per_project | total
cost            decimal
notify_at_pct   decimal
resets          string  monthly | quarterly | yearly | never
start_date      string  ISO date
created_by      uuid
updated_by      uuid
created_at      timestamp
updated_at      timestamp
```

### `client_invoicing`
```
id                             uuid    PK
client_id                      uuid    FK → clients
custom_for_client              boolean
notes                          text
net_terms_days                 int
tax_rate                       decimal
auto_invoicing                 boolean
auto_invoice_amount_based_on   string  hourly | fixed
auto_fixed_amount              decimal
auto_invoice_frequency         string  weekly | biweekly | monthly
auto_invoice_delay_days        int
auto_invoice_reminder_days     int
auto_invoice_line_items        string
include_non_billable_time      boolean
include_expenses               boolean
created_by                     uuid
updated_by                     uuid
created_at                     timestamp
updated_at                     timestamp
```

### `client_projects`
```
id           uuid    PK
client_id    uuid    FK → clients
project_id   uuid    FK → projects_VirtualTacker
assigned_by  uuid
assigned_at  timestamp
```

---

## Domain 6 — Projects & tasks

### `projects_VirtualTacker`
No changes.

```
id                    uuid    PK
name                  string  required
billable              boolean
disable_activity      boolean
allow_project_tracking boolean
disable_idle_time     boolean
client_id             uuid    FK → clients
managers_notes        text
users_notes           text
viewers_notes         text
status                string  active | archived | completed
created_at            timestamp
created_by            uuid
updated_by            uuid
updated_at            timestamp
archived_by           uuid
archived_at           timestamp
```

### `project_members`
```
id            uuid    PK
project_id    uuid    FK → projects_VirtualTacker
member_id     uuid    FK → members
project_role  string  manager | user | viewer | member
assigned_at   timestamp
assigned_by   uuid
updated_by    uuid
```

### `project_budgets`
```
id                      uuid    PK
project_id              uuid    FK → projects_VirtualTacker
type                    string
based_on                string
cost                    decimal
notify_project_members  boolean
notify_at_pct           decimal
who_to_notify           string
stop_timers_when_reached boolean
stop_timers_at_pct      decimal
resets                  string
start_date              string  ISO date
include_non_billable_time boolean
created_at              timestamp
created_by              uuid
updated_by              uuid
```

### `project_member_limits`
```
id                      uuid    PK
project_id              uuid    FK → projects_VirtualTacker
member_id               uuid    FK → members
type                    string
based_on                string
cost                    decimal
resets                  string
start_date              string  ISO date
notify_at_pct           decimal
notify_project_members  boolean
created_at              timestamp
created_by              uuid
updated_by              uuid
```

### `tasks`
No changes to the top-level collection.

```
id                      uuid    PK
project_id              uuid    FK → projects_VirtualTacker  required
team_id                 uuid    FK → teams
title                   string  required
description             text
status                  string  todo | in_progress | in_review | blocked | done
priority                string  low | medium | high | urgent
order_index             int     required
duration_hours_per_day  float
duration_days           int
working_days            int
overtime_hours_per_day  float
assigned_to             uuid    FK → members
start_date              timestamp
due_date                timestamp
review_state            string  approved | rejected
reviewed_by             uuid
reviewed_at             timestamp
created_at              timestamp
updated_at              timestamp
created_by              uuid
updated_by              uuid
```

---

## Task subcollections

**Previously**: five flat collections (`task_comments`, `task_subtasks`, `task_attachments`, `task_hours`, `task_time_tracking`) filtered by `task_id`.

**Now**: subcollections under each task document.

```
tasks/{taskId}/comments
tasks/{taskId}/subtasks
tasks/{taskId}/attachments
tasks/{taskId}/hours
tasks/{taskId}/time_tracking
```

**Benefits**:
- Deleting a task with `ref.delete()` combined with a batch delete of subcollections is straightforward — no need for a manual cascade across flat collections.
- Reading task detail fetches only that task's children, no `where('task_id', '==', id)` query needed.
- Subcollection reads are scoped; no cross-task data leaks in queries.

**Collection group queries** (when you need org-wide access):
```js
// All active timers across the org
db.collectionGroup('time_tracking').where('session_id', '!=', null)

// All unreviewed hours
db.collectionGroup('hours').where('status', '==', 'pending')
```

### `tasks/{taskId}/comments`
```
id          uuid    PK
task_id     uuid    (implicit from path — kept for compat reads)
body        text
created_at  timestamp
created_by  uuid
updated_by  uuid
```

### `tasks/{taskId}/subtasks`
```
id           uuid    PK
task_id      uuid    (implicit from path)
title        string  required
completed    boolean default false
order_index  int
created_at   timestamp
created_by   uuid
updated_by   uuid
```

### `tasks/{taskId}/attachments`
```
id          uuid    PK
task_id     uuid    (implicit from path)
file_url    string  GCS path — /task-attachments/{taskId}/{attachmentId}_{filename}
file_name   string
uploaded_at timestamp
uploaded_by uuid
```

### `tasks/{taskId}/hours`
```
id            uuid    PK
task_id       uuid    (implicit from path)
user_id       uuid    FK → members
hours_spent   float
status        string
submitted_at  timestamp
created_at    timestamp
updated_at    timestamp
created_by    uuid
updated_by    uuid
```

### `tasks/{taskId}/time_tracking`
```
id                uuid    PK
task_id           uuid    (implicit from path)
user_id           uuid    FK → members
project_id        uuid    FK → projects_VirtualTacker
active_seconds    int
idle_seconds      int
started_at        timestamp
last_activity_at  timestamp
session_id        string
review_notes      text
created_at        timestamp
updated_at        timestamp
```

---

## Domain 7 — Activity tracking

### `activity_sessions`
No changes.

```
id              uuid    PK
member_id       uuid    FK → members
status          string  active | idle | stopped
started_at      timestamp
ended_at        timestamp
active_seconds  int
idle_seconds    int
task_id         uuid    FK → tasks
updated_at      timestamp
```

### `activity_screenshots`
**Changed** — `image_data` removed. `screenshot_url` added.

```
id              uuid    PK
member_id       uuid    FK → members
session_id      uuid    FK → activity_sessions
screenshot_url  string  GCS object path — /activity-screenshots/{memberId}/{sessionId}/{id}
app_name        string
page_title      string
activity_level  int     0–100
captured_at     timestamp

REMOVED: image_data (was base64 text — now in GCS)
```

> **Backend**: `activity/routes.js` POST /events handler — upload image to GCS first, write the returned object path to `screenshot_url`. On GET /activity/feed, generate a signed URL from the stored path before returning to the client.

### `activity_app_logs`
```
id               uuid    PK
member_id        uuid    FK → members
session_id       uuid    FK → activity_sessions
app_name         string
started_at       timestamp
ended_at         timestamp
duration_seconds int
```

### `activity_url_logs`
```
id               uuid    PK
member_id        uuid    FK → members
session_id       uuid    FK → activity_sessions
url              string
domain           string
page_title       string
visited_at       timestamp
duration_seconds int
```

### `activity_alert_log`
```
id                uuid    PK
subject_member_id uuid    FK → members
alert_type        string  activity_no_screenshot | low_activity
recipient_ids     array
sent_at           timestamp
```

---

## Domain 8 — Notifications

### `notifications_VirtualTacker`
No changes. Schema CRUD key: `notifications`.

```
id            uuid    PK
recipient_id  uuid    FK → members
type          string  task_assignment | activity_alert | ...
title         string
message       string
link          string
read          boolean default false
created_at    timestamp
```

---

## RTDB — Presence (unchanged)

Not a Firestore collection. Stored in Firebase Realtime Database.

```
presence/{memberId}
  status          string  online | idle | offline
  lastSeenAt      number  epoch ms
  lastActivityAt  number  epoch ms
  connectionCount number
  updatedAt       number  epoch ms
```

---

## Backend changes required

### Schema CRUD entity key map (updated)

| Entity key (API path) | Storage location | Notes |
|---|---|---|
| `members` | `members` | unchanged |
| `roles` | `roles` | unchanged |
| `member-roles` | `member_roles` | unchanged |
| `invites` | `invites` | unchanged |
| `invite-projects` | `invite_projects` | unchanged |
| `member-onboarding` | `member_onboarding` | unchanged |
| `employment` | `employment` | unchanged |
| `pay-rates` | `pay_rates` | unchanged |
| `time-settings` | `time_settings` | unchanged |
| `limits` | `limits` | unchanged |
| `clients` | `clients` | unchanged |
| `client-budgets` | `client_budgets` | unchanged |
| `client-invoicing` | `client_invoicing` | unchanged |
| `client-projects` | `client_projects` | unchanged |
| `projects` | `projects_VirtualTacker` | unchanged |
| `project-members` | `project_members` | unchanged |
| `project-budgets` | `project_budgets` | unchanged |
| `project-member-limits` | `project_member_limits` | unchanged |
| `tasks` | `tasks` | unchanged |
| `task-comments` | `tasks/{taskId}/comments` | **route change** |
| `task-subtasks` | `tasks/{taskId}/subtasks` | **route change** |
| `task-attachments` | `tasks/{taskId}/attachments` | **route change** |
| `task-hours` | `tasks/{taskId}/hours` | **route change** |
| `task-time-tracking` | `tasks/{taskId}/time_tracking` | **route change** |
| `teams` | `teams` | unchanged |
| `team-members` | `team_members` | unchanged |
| `team-projects` | `team_projects` | unchanged |
| `member-relationships` | `member_relationships` | unchanged |
| `member-tree-cache` | `member_tree_cache` | unchanged |
| `member-transfer-requests` | `member_transfer_requests` | unchanged |
| `notifications` | `notifications_VirtualTacker` | unchanged |
| `activity-sessions` | `activity_sessions` | unchanged |
| `activity-screenshots` | `activity_screenshots` | field change |
| `activity-app-logs` | `activity_app_logs` | unchanged |
| `activity-url-logs` | `activity_url_logs` | unchanged |
| `activity-alert-log` | `activity_alert_log` | unchanged |
| `time-entries` | **PostgreSQL** | removed from Firestore |
| `timesheets` | **PostgreSQL** | removed from Firestore |

### Task child route pattern

Routes that were `GET /api/task-comments?task_id=X` should become `GET /api/tasks/:taskId/comments`.
The schema CRUD layer needs to resolve the parent `taskId` from the URL and return `db.collection('tasks').doc(taskId).collection('comments')` as the reference.

### Cascade delete for tasks

With subcollections, deleting a task requires deleting all subcollection documents first (Firestore does not auto-delete subcollections). Use a batch delete helper:

```js
async function deleteTaskWithChildren(taskId) {
  const subcollections = ['comments', 'subtasks', 'attachments', 'hours', 'time_tracking'];
  const batch = db.batch();
  for (const sub of subcollections) {
    const snap = await db.collection('tasks').doc(taskId).collection(sub).get();
    snap.docs.forEach(doc => batch.delete(doc.ref));
  }
  batch.delete(db.collection('tasks').doc(taskId));
  await batch.commit();
}
```
