# NoSQL Table / Collection Names (Firestore & RTDB)

Quick-reference of every collection stored in **Firestore** and path stored in the **Realtime Database** (RTDB). 

> [!NOTE]
> In this architecture, PostgreSQL is the **canonical and mandatory source of truth** for all transactional records (`time_entries`, `timesheets`) and configuration lookup options (`roles`, `job_titles`, etc.). Any fallback behaviors to Firestore for these entities have been removed from the codebase.

---

## Firestore — Top-Level Collections

### 1. Identity, Roles & Auth (Source of Truth: NoSQL)
*These identity mappings exist only in Firestore.*

| Collection Name     | Doc ID Key   | Description                                                                     |
| :------------------ | :----------- | :------------------------------------------------------------------------------ |
| `members`           | UUID v4      | Canonical organization member accounts.                                          |
| `User_profiles`     | Firebase UID | Profile data synced from Firebase Auth (avatars, basic settings).                |
| `member_auth_index` | Firebase UID | O(1) index mapping Firebase Auth UIDs to internal member UUIDs.                 |
| `access_requests`   | String       | Publicly submitted sign-up requests to join the workspace.                       |

### 2. Invites & Onboarding (Source of Truth: NoSQL)

| Collection Name          | Doc ID Key   | Description                                                                     |
| :----------------------- | :----------- | :------------------------------------------------------------------------------ |
| `invites`                | UUID v4      | Workspace registration invitations.                                             |
| `invite_projects`        | UUID v4      | Auto-project mapping templates associated with workspace invites.                |
| `pending_auth_members`   | Firebase UID | Pre-provisioned user records awaiting initial login validation.                 |
| `pending_auth_projects`  | UUID v4      | Pending project assignments to link when the user logs in.                      |
| `member_onboarding`      | UUID v4      | Checklist monitoring system tracking onboarding milestones for new members.     |

### 3. HR, Profile Extensions & Lookups (Source of Truth: NoSQL)

| Collection Name      | Doc ID Key  | Description                                                                     |
| :------------------- | :---------- | :------------------------------------------------------------------------------ |
| `employment`         | UUID v4     | Details on job title roles, department scopes, tax codes, and addresses.        |
| `pay_rates`          | UUID v4     | Member hourly pay rate configs and period settings.                             |
| `time_settings`      | UUID v4     | Core tracking settings (inactivity timeout, manual edits, shift approvals).     |
| `limits`             | Member UUID | Consolidated daily and weekly tracking limits (document ID is the `member_id`). |
| `members_field_data` | UUID v4     | Custom dropdown forms and user input snapshot structures.                        |

### 4. Teams & Tree Hierarchy (Source of Truth: NoSQL)

| Collection Name            | Doc ID Key  | Description                                                                     |
| :------------------------- | :---------- | :------------------------------------------------------------------------------ |
| `teams`                    | UUID v4     | Named organizational departments.                                               |
| `team_members`             | UUID v4     | Mapping link defining which members are assigned to which teams.                |
| `member_relationships`     | UUID v4     | Hierarchy links capturing supervisor ↔ subordinate relationship edges.          |
| `member_tree_cache`        | Member UUID | Flat ancestor and descendant structures for O(1) tree crawls.                   |
| `member_transfer_requests` | UUID v4     | Workflow requests for changing supervisor connections.                          |

### 5. Clients, Projects & Tasks (Source of Truth: NoSQL)

| Collection Name          | Doc ID Key | Description                                                                     |
| :----------------------- | :--------- | :------------------------------------------------------------------------------ |
| `clients`                | UUID v4    | Billed organization account profiles.                                           |
| `client_budgets`         | UUID v4    | Invoicing limits and budget alerts mapping to clients.                          |
| `client_invoicing`       | UUID v4    | Auto-invoicing net terms and tax rate properties.                               |
| `client_projects`        | UUID v4    | Association joins linking clients to active projects.                           |
| `projects_VirtualTacker` | UUID v4    | Projects database collection (API key: `projects`).                             |
| `project_members`        | UUID v4    | Member role permissions defined per-project.                                    |
| `project_budgets`        | UUID v4    | Active cost limitations mapped to projects.                                     |
| `project_member_limits`  | UUID v4    | Individual member budget caps enforced per-project.                             |
| `tasks`                  | UUID v4    | Project items assigned to members.                                              |
| `task_assignments`       | UUID v4    | Links assignees to tasks with expected durations.                               |
| `team_projects`          | UUID v4    | Maps project visibility permissions to team groups.                             |

### 6. High-Frequency Logs & Activity (Source of Truth: NoSQL)

| Collection Name        | Doc ID Key | Description                                                                       |
| :--------------------- | :--------- | :-------------------------------------------------------------------------------- |
| `activity_sessions`    | UUID v4    | Base telemetry chunks wrapping active/idle tracking cycles.                       |
| `activity_alert_log`   | UUID v4    | Warning alerts created for low keyboard/mouse activity or missing telemetry.     |

Screenshots, app logs, and URL logs all moved to PostgreSQL (`activity_screenshots`, `activity_app_logs`, `activity_url_logs`) — no per-event Firestore write anymore, and the corresponding generic schema-CRUD entities were removed so nothing can write to Firestore for these through that path either. Screenshot rows older than 7 days get cold-archived to GCS as a per-member ZIP and deleted; see `scripts/archive-screenshots.mjs`.

### 7. System (Source of Truth: NoSQL)

| Collection Name                | Doc ID Key   | Description                                                                     |
| :----------------------------- | :----------- | :------------------------------------------------------------------------------ |
| `system_meta`                  | String Keys  | Migration status markers, bootstrap keys, and active dashboard snapshots.        |

Notifications moved to PostgreSQL (`notifications` table) — see SQL-RT-TableNames.md. Not stored in Firestore anymore.

---

## Firestore — Task Subcollections

These sub-collections are stored nested under `tasks/{taskId}/`:

| Subcollection Path                    | Entity Key           | Description                                                     |
| :------------------------------------ | :------------------- | :-------------------------------------------------------------- |
| `tasks/{taskId}/comments`             | `task-comments`      | Thread comments left on a task.                                 |
| `tasks/{taskId}/subtasks`             | `task-subtasks`      | Core checklists nested in tasks.                                |
| `tasks/{taskId}/attachments`          | `task-attachments`   | Blob attachment links saved on GCS buckets.                     |
| `tasks/{taskId}/hours`                | `task-hours`         | Submissions capturing hours spent on a task.                    |
| `tasks/{taskId}/time_tracking`        | `task-time-tracking` | Real-time tracking timer heartbeats active on desktop clients.  |

---

## Firebase Realtime Database (RTDB)

Transient websocket presence mapping, stored at:

| Path                       | Description                                                                    |
| :------------------------- | :----------------------------------------------------------------------------- |
| `presence/{memberId}`      | Connection status, system activity heartbeats, and timestamp indices.          |

---

## Legacy Mobile Collections (Ignored)

Older collections unused by the backend: `users`, `referrals`, `notifications`, `chatRooms`, `candidates`, `projects`.
