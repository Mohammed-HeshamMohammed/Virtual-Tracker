# PLAN — Agent version tracking and update reminders

Status: **implemented — verification results are recorded below**

Scope:

- `Tauri-App-Extension`
- `Dashboard-Backend`
- `Dashboard-Web`
- `Notify-backend`
- PostgreSQL `members` schema

## Goal

For every signed-in member who opens the desktop tracker:

1. record which tracker version they opened and when;
2. group members by the tracker version they last used;
3. show those groups inside the existing Team onboarding modal;
4. let an authorized manager notify one outdated member or every member on an outdated version by in-app notification or email;
5. give the tracker a title-bar notification inbox containing tracker-only notifications.

Updates must never interrupt an active or paused tracking session.

## What already exists

- Tracker version is available from Tauri through `get_version`.
- The current release version is maintained in `package.json`, `Cargo.toml`, and `tauri.conf.json`.
- Tauri updater checks the signed update feed when the app mounts.
- Available updates are downloaded and staged.
- Installation waits until no active or paused session exists.
- Dashboard Backend already has authenticated member context and a general dashboard notification store.
- Notify Backend already delivers transactional email and onboarding reminders.
- `members` already contains `last_seen_at`, `desktop_agent_linked_at`, and `agent_source`, but no tracker version.

This plan extends those paths. It does not replace the updater and does not mix tracker-only notifications into the dashboard notification bell.

## Recommended design

### 1. Store last reported tracker version on the member

Add three nullable columns to `members`:

```sql
ALTER TABLE members ADD COLUMN IF NOT EXISTS agent_version VARCHAR(32);
ALTER TABLE members ADD COLUMN IF NOT EXISTS agent_platform VARCHAR(32);
ALTER TABLE members ADD COLUMN IF NOT EXISTS agent_last_opened_at TIMESTAMPTZ;
```

Meaning:

- `agent_version`: last version reported by this member, such as `1.0.23`.
- `agent_platform`: coarse platform only: `windows`, `macos`, or `linux`.
- `agent_last_opened_at`: server timestamp of the last accepted report.

These columns intentionally describe the member's most recently used tracker installation. Do not collect a machine fingerprint, hostname, IP address, or device serial number.

Known ceiling: if one member regularly uses multiple computers, the latest computer overwrites the earlier value. Add an `agent_installations` table only when per-device history becomes a real requirement.

### 2. Add authenticated agent-open endpoint

Add:

```text
POST /api/agent/open
Authorization: Bearer <existing token>

{
  "version": "1.0.23",
  "platform": "windows"
}
```

Backend behavior:

1. derive `member_id` from existing authenticated request context;
2. reject unknown fields;
3. validate version as a bounded semantic-version string;
4. allow only known platform values;
5. update the three member columns using database time;
6. return update-message state, if any.

Example response:

```json
{
  "success": true
}
```

The endpoint must never accept a member ID from the client. Reported version is telemetry, not proof that the binary is genuine, and must never grant permissions or bypass compatibility checks.

### 3. Report once per meaningful open

The tracker reports after both conditions are true:

- user is signed in;
- Tauri version has been resolved.

Report timing:

- once after authenticated startup;
- once after a successful sign-in during the current process;
- once when the app returns to the foreground after a long sleep, with a minimum interval such as 30 minutes.

Do not attach a database write to the existing five-second UI refresh. Version reporting is presence metadata, not a heartbeat.

Failure behavior:

- best effort;
- no startup blocking;
- no sign-out;
- no tracking interruption;
- retry at the next eligible open/focus event.

### 4. Add an App versions tab to Team onboarding

Extend the existing Team onboarding modal instead of adding another page. Add two top-level tabs:

```text
[Onboarding] [App versions]
```

Keep the current onboarding table unchanged under `Onboarding`.

The `App versions` tab has two areas:

1. a version selector containing every last-reported version and member count;
2. a member table for the selected version.

Example selector:

```text
1.0.24  Latest       18 members
1.0.23  Outdated      7 members
1.0.21  Outdated      2 members
Unknown / never used  4 members
```

Sort valid versions newest first using semantic-version comparison. Keep `Unknown / never used` last. Show the latest published version even when no member has reported it yet.

Selecting a version shows:

```text
Member              Platform   Last opened       In app   Email
Mona Hassan         Windows    12 minutes ago    [Send]   [Send]
Omar Ali            macOS      3 days ago        [Send]   [Send]
```

Per-person behavior:

- latest version: both update-reminder actions disabled;
- older version: in-app action enabled; email enabled when member has a deliverable email address;
- invalid version: update-reminder actions disabled because age cannot be established safely;
- never reported: both update-reminder actions disabled; a separate `Send latest-app install email` action may be offered instead;
- action shows sending, success, skipped, and failure state without refreshing the whole modal.

Unknown-version rule:

- never create an update notification or update-reminder email for a member whose version is null, empty, malformed, or unrecognized;
- never send the word `unknown` to the member as if it were their installed version;
- individual reminder API returns `409 AGENT_VERSION_UNKNOWN` with a manager-facing explanation;
- bulk update routes reject an unknown-version group before creating any delivery;
- `Send latest-app install email` uses a separate template that asks the member to install/open the latest app without calling their installed version unknown;
- after that member opens a reporting-capable tracker, the next `/api/agent/open` moves them automatically into a real version group;
- malformed stored values appear to managers as `Unrecognized report`, are logged for repair, and receive no update action.

The normal People table may also expose an optional compact `Tracker` column, but the onboarding modal is the main version-management surface.

### 5. Add bulk actions for each version

The selected version header contains two bulk buttons:

```text
[Notify all in app] [Email all]
```

Rules:

- disable both buttons for the latest version;
- enable both for an older valid version;
- disable both update-reminder bulk actions for `Unknown / never used` and `Unrecognized report`;
- optionally expose a separate `Email latest-app install instructions` bulk action for `Unknown / never used`;
- show confirmation with exact version and eligible member count before bulk send;
- backend recomputes eligible recipients at send time instead of trusting IDs from the browser;
- skip members who updated after the modal loaded;
- suppress the same channel/member/target-version reminder for 24 hours;
- return counts for sent, skipped-current, duplicate, missing-email, and failed;
- display partial-success results instead of reporting the entire batch as failed.

Suggested endpoints:

```text
POST /api/agent-versions/:version/reminders
{
  "channel": "app" | "email"
}

POST /api/members/:memberId/agent-update-reminders
{
  "channel": "app" | "email",
  "targetVersion": "1.0.24"
}
```

Both routes require existing member-management permission and hierarchy visibility. The server obtains the latest release itself and rejects attempts to send an update reminder to a member already using that version or newer.

Explicit rejection examples:

```json
{
  "success": false,
  "code": "AGENT_VERSION_UNKNOWN",
  "error": "This member has not reported a tracker version. Send latest-app install instructions instead."
}
```

```json
{
  "success": false,
  "code": "AGENT_ALREADY_CURRENT",
  "error": "This member is already using the latest tracker version."
}
```

### 6. Define one latest-version source

Version comparison needs one authoritative latest version. Use the signed release manifest already served by Landing Backend.

Add a small cached metadata endpoint:

```text
GET /api/agent/update/latest

{
  "version": "1.0.24",
  "notes": "Bug fixes and tracking reliability improvements."
}
```

Requirements:

- derive response from the same cached `latest.json` used by the Tauri update feed;
- do not maintain a second manually edited version value;
- return public release metadata only;
- cache briefly, matching current release-manifest caching.

Dashboard Backend should cache this value and return it with version-group data. Dashboard Web must not fetch release metadata once per member row.

Add a grouped management endpoint:

```text
GET /api/agent-versions
```

Example response:

```json
{
  "success": true,
  "latestVersion": "1.0.24",
  "groups": [
    { "version": "1.0.24", "status": "latest", "memberCount": 18 },
    { "version": "1.0.23", "status": "outdated", "memberCount": 7 },
    { "version": null, "status": "unknown", "memberCount": 4 }
  ]
}
```

Member rows for one selected version may be included when small or loaded through a version-filtered endpoint when pagination is needed. Do not send every member profile for every version before one is selected.

### 7. Use a dedicated tracker-notification store

Do not reuse the general `notifications` table. Web-dashboard read state and tracker-inbox read state must remain independent.

Add `agent_notifications`:

```sql
CREATE TABLE IF NOT EXISTS agent_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type            VARCHAR(40) NOT NULL,
  title           VARCHAR(160) NOT NULL,
  message         TEXT NOT NULL,
  target_version  VARCHAR(32),
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_notifications_recipient_created
  ON agent_notifications (recipient_id, created_at DESC);
```

Initial notification types:

- `update_available`;
- `update_reminder`.

No task, project, billing, dashboard, marketing, or unrelated notification enters this table.

Agent endpoints:

```text
GET  /api/agent-notifications?limit=20
POST /api/agent-notifications/:id/read
POST /api/agent-notifications/read-all
```

All endpoints derive recipient from the authenticated token. A member can never request another member's notifications.

### 8. Add tracker-only notification dropdown to title bar

Add a bell button to the tracker title bar, before the update/minimize controls:

```text
[theme] [bell 2] [check update] [minimize] [close]
```

Bell behavior:

- unread count badge;
- small anchored dropdown;
- newest first;
- title, short message, time, and read/unread state;
- `Mark all read`;
- empty state: `No tracker notifications`;
- update notification action: `Update now` or `Ready — installs when tracking stops`;
- closes on outside click and Escape;
- keyboard accessible and excluded from the draggable title-bar region.

The tracker fetches notifications:

- after authenticated startup;
- on window focus;
- every five minutes while signed in;
- immediately after a successful sign-in.

Do not attach this fetch to the existing five-second application refresh. New unread update reminders may also produce an OS notification, but failure or denied OS permission must not affect the title-bar inbox.

Email reminders never appear in this dropdown. They are a separate delivery attempt.

### 9. Keep the signed updater as the only installation path

The updater currently checks automatically but mostly operates silently. When `check()` returns an update, show a persistent in-app banner:

```text
Tracker v1.0.24 is available.
[Update now]
```

Behavior:

- no active session: `Update now` installs and relaunches;
- active or paused session: download may finish, but banner says `Ready — installs when you stop tracking`;
- install failure: keep tracker usable and show a retry action;
- dismissed banner may reappear on next app launch while version remains outdated.

Use the updater's signed result as the authority for download/install. Never install a URL supplied by a notification or email.

When an update notification action is clicked:

1. run the existing Tauri `check()` flow;
2. confirm a signed update exists;
3. download through the existing update feed;
4. install immediately only when no active or paused session exists;
5. otherwise keep it staged until tracking stops.

### 10. Add update-reminder email template

Add `agent-update-reminder` to Notify Backend's existing transactional email system.

Email content:

- member display name;
- their last reported version;
- latest available version;
- short release note/message controlled by the product, not arbitrary manager HTML;
- safe link to open/download the tracker;
- plain-text and escaped HTML versions.

Use work email first, then personal email only if current member-email rules permit it. No address means the per-person email action is disabled and bulk email reports `missing-email`.

### 11. Rollout constraint

An old tracker cannot display the new title-bar inbox until it installs the release that contains it.

First rollout therefore works as follows:

1. publish the release containing version reporting and tracker notifications;
2. existing automatic Tauri update checks continue reaching older builds;
3. email remains the reliable manual reminder channel for builds without the inbox;
4. after adoption, in-app reminders work for subsequent releases.

The dashboard should label members whose reported version predates inbox support. For those members, disable `Notify in app` with tooltip `This tracker version does not support in-app notifications`; keep email available.

## API and data shape changes

Member list/detail responses gain:

```json
{
  "agentVersion": "1.0.23",
  "agentPlatform": "windows",
  "agentLastOpenedAt": "2026-09-18T18:30:00.000Z"
}
```

Null values must remain valid for existing members and old tracker builds.

Version-management responses also expose only fields needed by the modal:

```json
{
  "memberId": "uuid",
  "displayName": "Mona Hassan",
  "email": "mona@example.com",
  "agentVersion": "1.0.23",
  "agentPlatform": "windows",
  "agentLastOpenedAt": "2026-09-18T18:30:00.000Z",
  "supportsAgentInbox": true,
  "canReceiveEmail": true
}
```

Do not expose auth tokens, machine details, or unrelated member fields through the grouped endpoint.

## Security and privacy rules

- Authenticate every write that associates a version with a member.
- Resolve member from token, never client-supplied ID.
- Limit string length and accepted characters before reaching PostgreSQL.
- Treat all version reports as untrusted display/diagnostic data.
- Compare semantic versions with a real parser or a small tested numeric comparator, never lexicographically.
- Do not collect machine identity for this requirement.
- Rate-limit reminder creation and suppress duplicates.
- Recompute bulk recipients and version eligibility on the server.
- Cap bulk batch size and process email with bounded concurrency.
- Return per-category counts without exposing one member's private data to another.
- Escape every value placed into update email HTML.
- Never let a manager-provided message control an installer URL or executable.
- Continue verifying update signatures through Tauri.
- Never force restart while tracking or paused.

## Delivery phases

### Phase 1 — Version reporting

- add member columns;
- add PostgreSQL update helper;
- add authenticated `/api/agent/open` route;
- add Tauri command/client call;
- report on authenticated startup and sign-in;
- add backend validation and route tests.

Result: backend knows last tracker version used by each signed-in member.

### Phase 2 — Version management tab

- expose fields in member list/detail queries;
- update Dashboard Web member model;
- fetch/cache latest release metadata once;
- add `App versions` tab to existing Team onboarding modal;
- add version groups, counts, selector, and selected-version member table;
- add disabled states for latest, invalid, unknown, and unsupported-inbox versions;
- optionally add compact Tracker column to the main People table.

Result: authorized managers can select a version and see every member last using it.

### Phase 3 — Agent-only notification inbox

- add `agent_notifications` table and service;
- add authenticated list/read/read-all endpoints;
- add title-bar bell, unread badge, and dropdown;
- fetch on startup, sign-in, focus, and five-minute interval;
- keep tracker notifications separate from dashboard notifications;
- add accessibility and dropdown interaction tests.

Result: tracker has a small app-only notification center.

### Phase 4 — Reminder delivery

- add per-member reminder endpoint;
- add per-version bulk endpoint;
- add in-app and email actions to selected-version member rows;
- add version-level `Notify all in app` and `Email all` actions;
- add `agent-update-reminder` Notify Backend template;
- enforce permission, version recheck, deduplication, and partial-result reporting.

Result: managers can remind one outdated member or everyone on one outdated version through either channel.

### Phase 5 — Update action and safe install

- surface updater result in persistent UI;
- connect notification `Update now` actions to existing signed updater;
- preserve safe staged-install behavior during active/paused sessions;
- add focused frontend tests.

Result: reminders lead into the existing safe, signed update flow.

## Minimum tests

Backend:

- authenticated report updates only caller's member;
- unauthenticated report returns `401`;
- invalid/oversized version and unknown platform return `400`;
- old tracker clients remain compatible with nullable columns;
- reminder requires management permission;
- reminder cannot target a member outside caller visibility;
- latest-version member cannot receive an update reminder;
- bulk route selects only members still on the requested old version;
- members who updated after modal load are skipped;
- unsupported old builds are excluded from in-app delivery;
- missing email is reported without failing the batch;
- duplicate reminder is suppressed;
- semantic comparison handles `1.0.9` versus `1.0.10` correctly;
- agent notification reads are scoped to authenticated recipient;
- app reminder creates only an `agent_notifications` row;
- email reminder does not create an agent-inbox item.

Tracker:

- report occurs after signed-in startup;
- report failure does not block tracker;
- available update shows banner;
- unread badge and dropdown contain agent notifications only;
- outside click and Escape close dropdown;
- mark-one and mark-all update unread count;
- five-minute poll does not overlap or use the five-second main refresh;
- active or paused session prevents installation/relaunch;
- stopped session may install staged update;
- reminder never supplies the download URL.

Dashboard:

- missing agent data renders `Never reported`;
- versions are grouped and sorted newest first;
- selecting a version shows only members in that group;
- outdated/current states use semantic comparison;
- reminder action is hidden without permission;
- per-member and bulk actions are disabled for latest version;
- in-app action is disabled for builds without inbox support;
- email action is disabled when no deliverable address exists;
- bulk confirmation shows version, channel, and eligible count;
- partial batch result shows sent, skipped, duplicate, missing-email, and failed counts.

Notify Backend:

- update email renders escaped member/version values;
- plain-text and HTML bodies contain latest version and safe download link;
- invalid template payload is rejected;
- delivery failure is returned to Dashboard Backend for batch accounting.

## Acceptance criteria

- Opening a signed-in tracker records member, version, platform, and server timestamp.
- Team onboarding modal has `Onboarding` and `App versions` tabs.
- App versions tab lists every reported version, latest status, and member count.
- Selecting a version shows its members and their platform/last-opened data.
- Existing members with no report remain valid.
- Latest-version groups cannot send update reminders.
- An authorized manager can notify one outdated member by app or email.
- An authorized manager can notify all eligible members on one outdated version by app or email.
- Tracker title bar shows an app-only bell and notification dropdown.
- General dashboard notifications never appear in tracker dropdown.
- Publishing a newer signed release still uses the existing signed updater.
- Active and paused tracking sessions are never restarted for an update.
- No machine fingerprint or new third-party dependency is introduced.

## Explicitly deferred

- per-device installation history;
- forced minimum-version lockout;
- remote forced installation or restart;
- update adoption analytics beyond last reported member version;
- realtime WebSocket reminder delivery;
- arbitrary manager-written executable URLs or release metadata;
- unrelated task/project/dashboard notifications in the tracker inbox;
- custom free-form reminder text in the first version.

## Locked product decisions

- Version management lives in the existing Team onboarding modal.
- Managers can send per-person and per-version bulk reminders.
- Delivery channels are selected separately: in app or email.
- Latest-version reminder controls are disabled.
- Tracker title-bar inbox contains tracker-only notifications.
- In-app notifications and emails have separate delivery/read state.

## Verification completed

- Dashboard Backend: `789` tests passed, including focused semantic-version and unknown/unrecognized cases.
- Dashboard Web: TypeScript type-check and `5` tests passed.
- Tracker WebView UI: production build passed and `210` tests passed.
- Tracker Rust library: `cargo check` passed and `196` tests passed (`1` desktop-only test ignored).
- Tracker release sources are aligned at `1.0.24`, matching the first inbox-capable version threshold.
- Landing Backend and Notify Backend: modified JavaScript modules passed syntax checks.
- Repository diff check passed. The repository-wide Rust format check still reports pre-existing formatting drift outside this feature; the changed Rust code compiles and its library tests pass.
