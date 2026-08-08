# NoSQL Table / Collection Names (Firestore & RTDB)

Quick-reference of every collection stored in **Firestore** and path stored in the **Realtime Database** (RTDB).

> [!NOTE]
> In this architecture, PostgreSQL is the **canonical and mandatory source of truth** for all transactional records (`time_entries`, `timesheets`), configuration lookup options (`roles`, `job_titles`, etc.), the entire activity/compliance domain, and — as of the projects migration — the **projects, clients, and tasks domains** (`projects`, `project_members`, `project_budgets`, `project_member_limits`, `clients`, `client_budgets`, `client_invoicing`, `client_projects`, `team_projects`, `tasks`, `task_assignments`). Any fallback behaviors to Firestore for these entities have been removed from the codebase. See `SQL-RT-TableNames.md` for the full Postgres inventory.
>
> Member **identity** itself (`members`, `teams`, `team_members`, `member_relationships`, `invites`, and the collections below) has *not* migrated — this is an intentional, ongoing piecemeal migration, not an oversight. Each member-domain satellite table (pay rate, employment, limits, roles, bans, onboarding, hierarchy cache) has moved to Postgres one at a time as it was tackled; the core `members`/`teams` documents are the remaining, larger piece.

---

## Firestore — Top-Level Collections

### 1. Identity, Roles & Auth (Source of Truth: NoSQL)
*These identity mappings exist only in Firestore.*

| Collection Name     | Doc ID Key   | Description                                                                     |
| :------------------- | :----------- | :------------------------------------------------------------------------------ |
| `members`            | UUID v4      | Canonical organization member accounts.                                          |
| `User_profiles`      | Firebase UID | Profile data synced from Firebase Auth (avatars, basic settings).                |
| `member_auth_index`  | Firebase UID | O(1) index mapping Firebase Auth UIDs to internal member UUIDs.                 |
| `access_requests`    | String       | Publicly submitted sign-up requests to join the workspace.                       |

`roles` (system role definitions) moved to PostgreSQL — see `SQL-RT-TableNames.md`. Not stored in
Firestore anymore; every remaining read goes through `loadRoleNameById`/`resolveRoleIdsWhere`/
`resolveRoleNameById` (`src/modules/members/services/relation-sync.js`), not a live `db.collection("roles")` scan.

### 2. Invites & Onboarding (Source of Truth: NoSQL)

| Collection Name          | Doc ID Key   | Description                                                                     |
| :------------------------ | :----------- | :------------------------------------------------------------------------------ |
| `invites`                 | UUID v4      | Workspace registration invitations.                                             |
| `invite_projects`         | UUID v4      | Auto-project mapping templates associated with workspace invites.                |
| `pending_auth_members`    | Firebase UID | Pre-provisioned user records awaiting initial login validation.                 |
| `pending_auth_projects`   | UUID v4      | Pending project assignments to link when the user logs in.                      |

`member_onboarding` (onboarding milestone checklist) moved to PostgreSQL — see `SQL-RT-TableNames.md`.
Not stored in Firestore anymore.

### 3. HR, Profile Extensions & Lookups

| Collection Name      | Doc ID Key  | Description                                                                     |
| :--------------------- | :---------- | :------------------------------------------------------------------------------ |
| `members_field_data` | UUID v4     | Custom dropdown forms and user input snapshot structures.                        |

`employment`, `pay_rates`, `time_settings`, and `limits` all moved to PostgreSQL — see
`SQL-RT-TableNames.md`. Not stored in Firestore anymore.

### 4. Teams & Tree Hierarchy

| Collection Name            | Doc ID Key  | Description                                                                     |
| :--------------------------- | :---------- | :------------------------------------------------------------------------------ |
| `teams`                      | UUID v4     | Named organizational departments.                                               |
| `team_members`               | UUID v4     | Mapping link defining which members are assigned to which teams.                |
| `member_relationships`       | UUID v4     | Hierarchy links capturing supervisor ↔ subordinate relationship edges.          |
| `member_transfer_requests`   | UUID v4     | Workflow requests for changing supervisor connections.                          |

`member_tree_cache` (flat ancestor/descendant structures for O(1) tree crawls) moved to PostgreSQL —
see `SQL-RT-TableNames.md`. Not stored in Firestore anymore. (A separate, older `member_tree`
collection still exists but is legacy, touched only by the one-off id-normalization script
`src/modules/members/services/normalize-member-doc-ids.js`, not live application reads.)

`team_projects` (team ↔ project visibility links) moved to PostgreSQL along with the rest of the
projects domain — see `SQL-RT-TableNames.md`, §4/§14. Because the `teams` documents themselves stay in
Firestore, `team_projects.team_id` carries no foreign key on the Postgres side; deleting a team must
explicitly clean up its `team_projects` rows in application code
(`deleteTeamProjectsForTeamPg`, called from the `DELETE /api/teams/:id` handler).

### 5. Clients, Projects & Tasks — fully moved to PostgreSQL

Every collection formerly listed in this section — `clients`, `client_budgets`, `client_invoicing`,
`client_projects`, `projects_VirtualTacker` (API key `projects`), `project_members`, `project_budgets`,
`project_member_limits`, `team_projects`, `tasks`, `task_assignments` — moved to PostgreSQL. See
`SQL-RT-TableNames.md` §4–5 for the full current schema. Nothing in this domain is written to or read
from Firestore anymore; the generic schema-CRUD entities for these keys were removed so nothing can
write to Firestore for them through that path either.

### 6. High-Frequency Logs & Activity

The entire activity domain (`activity_sessions`, `activity_screenshots`, `activity_app_logs`, `activity_url_logs`, `activity_alert_log`, `activity_integrity_flags`, `apps`) moved to PostgreSQL — no per-event Firestore write anymore, and the corresponding generic schema-CRUD entities were removed so nothing can write to Firestore for these through that path either. See SQL-RT-TableNames.md. Screenshots older than 7 days get their image data archived to GCS individually (`screenshot_url` set, `image_data` cleared); app/url logs and fully-archived screenshot rows older than 90 days are deleted outright — see `scripts/archive-screenshots.mjs` (run manually or on a schedule; both windows are configurable via flags).

The compliance/monitoring config set (`monitoring_capabilities`, `monitoring_policy_audit`,
`member_monitoring_consent`, `capture_exclusions`, `capture_minimization_settings`,
`data_retention_settings`, `screenshot_access_log`, `activity_scoring_settings`, `activity_categories`)
was added directly in PostgreSQL and has no Firestore equivalent — see `SQL-RT-TableNames.md` §6.

### 7. System

`system_meta` (migration status markers, bootstrap keys, small keyed JSON payloads) moved to
PostgreSQL — see `SQL-RT-TableNames.md`. Not stored in Firestore anymore.

Notifications moved to PostgreSQL (`notifications` table) — see SQL-RT-TableNames.md. Not stored in Firestore anymore.

Agent link/device state (`agent_link_sessions`, `agent_devices`) and scheduled report deliveries
(`report_schedules`) were added directly in PostgreSQL and have no Firestore equivalent — see
`SQL-RT-TableNames.md` §7–8.

---

## Firestore — Task Subcollections

These sub-collections are stored nested under `tasks/{taskId}/` — genuinely still Firestore-resident,
by explicit design (`src/lib/firestore/task-subcollections.js`), even though the parent `tasks` row
itself is now the Postgres `tasks` table:

| Subcollection Path                    | Entity Key           | Description                                                     |
| :------------------------------------- | :-------------------- | :---------------------------------------------------------------- |
| `tasks/{taskId}/comments`              | `task-comments`       | Thread comments left on a task.                                 |
| `tasks/{taskId}/subtasks`              | `task-subtasks`       | Core checklists nested in tasks.                                 |
| `tasks/{taskId}/attachments`           | `task-attachments`    | Blob attachment links saved on GCS buckets.                      |
| `tasks/{taskId}/hours`                 | `task-hours`          | Submissions capturing hours spent on a task.                      |

`deleteTaskWithChildren` deletes these four subcollections plus the now-vestigial Firestore `tasks`
doc mirror when a task is deleted; `task_assignments` is not touched by it — that table's `task_id`
FK is `ON DELETE CASCADE`, so deleting the Postgres `tasks` row (which happens separately, right
before this call) already cascades it.

`tasks/{taskId}/time_tracking` (`task-time-tracking`) moved to PostgreSQL `task_member_progress` (implementation.md Phase 2) — see SQL-RT-TableNames.md. Not stored in Firestore anymore.

---

## Firebase Realtime Database (RTDB)

Transient websocket presence mapping, stored at:

| Path                       | Description                                                                    |
| :--------------------------- | :--------------------------------------------------------------------------------- |
| `presence/{memberId}`        | Connection status, system activity heartbeats, and timestamp indices.              |

---

## Legacy Mobile Collections (Ignored)

Older collections unused by the backend: `users`, `referrals`, `notifications`, `chatRooms`, `candidates`, `projects`.
