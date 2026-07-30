# General Dashboard — Content & Functional Specification

This document details the functional content, data structure, metrics, widgets, and business logic of the **General Dashboard**.

---

## 1. Overview & Scope Model

The General Dashboard provides a consolidated view of workspace activity, productivity metrics, presence, and project progress.

### View Modes
- **Me Scope (`me`)**: Displays activity, tasks, and metrics scoped strictly to the current authenticated user.
- **Team / Organization Scope (`all`)**: Displays aggregated team metrics across all accessible team members and projects.
- **Permission Control (`canAccessAllView`)**: View toggle (`Me` vs `All`) is enabled based on user role permissions (Admins, Managers, Owners).

---

## 2. Stat Widgets (Core Metrics)

The top section of the General Dashboard displays 8 primary productivity and tracking indicators:

| Widget ID | Stat Label | Data Source Metric | Format | Icon & Theme |
| :--- | :--- | :--- | :--- | :--- |
| `worked_week` | Worked this week | `workedWeekHours` | `Hh Mm` (Clock format) | TrendingUp (Indigo) |
| `worked_today` | Worked today | `workedTodayHours` | `Hh Mm` (Clock format) | Clock (Cyan) |
| `activity_today` | Activity today | `activityTodayPercent` | Percentage (`0–100%`) | Activity (Purple) |
| `activity_week` | Activity this week | `activityWeekPercent` | Percentage (`0–100%`) | Activity (Violet) |
| `spent_week` | Billable this week | `spentWeekHours` | `Hh Mm` (Clock format) | Wallet (Emerald) |
| `spent_today` | Billable today | `spentTodayHours` | `Hh Mm` (Clock format) | Wallet (Teal) |
| `members` | Members worked | `membersWorkedToday` | Integer Count | Users (Blue) |
| `projects` | Projects worked | `projectsWorkedToday` | Integer Count | FolderKanban (Orange) |

---

## 3. Dashboard Panels & Content

### A. Tasks (`panel-todos`)
- **Header**: Title (`Tasks`), Subtitle (`X open`), Link action (`View tasks` → navigates to Project Management Tasks).
- **Task List Content**:
  - Completion status checkbox (`✓` for completed, empty ring for open).
  - Task Title (with line-through styling if completed).
  - Associated Project Name tag.
- **Empty State**: Displays *"No open tasks in this view."* when no tasks are found.

---

### B. Team Presence (`panel-online`)
- **Header**: Title (`Team presence`), Subtitle (`X working · Y idle`), Legend badges (`Working` [Emerald], `Idle` [Amber], `Offline` [Slate]).
- **Member Row Content**:
  - Member Initials Avatar (up to 2 letters).
  - Full Name.
  - Presence Status indicator dot (Working / Idle / Offline).
  - Currently tracked Project Name.
  - Session Duration / Last active relative time (`m ago` / `h ago`).
- **Interactive Detail Modal (`MemberDetailDialog`)**: Clicking a member opens a popover showing full presence status, active task/project details, and session timestamps.
- **Empty State**: Displays *"No team members in scope."*.

---

### C. Screenshots (`panel-screenshots`)
- **Header**: Title (`Screenshots`), Subtitle (`Latest team captures`), Link action (`View all` → navigates to `activity-screenshots`).
- **Grid Content**: Displays up to 6 preview thumbnails (one per active member).
  - Captured screen image thumbnail (or placeholder monitor icon if image loading).
  - Member Name overlay.
  - Relative capture timestamp (`Xm ago`).
  - Activity Level badge (color-coded based on activity score percentage).
- **Interactive Lightbox Modal**: Clicking any thumbnail opens a high-resolution preview with member info, activity score bar, capture timestamp, and full-screen view.
- **Empty State**: Displays *"No captures yet. Start the agent and timer to collect screenshots."*.

---

### D. Apps & URLs (`panel-apps`)
- **Header**: Title (`Apps & URLs`), Subtitle (`Top applications this week`), Link action (`View all` → navigates to `activity-apps`).
- **Application List Content**:
  - Application Letter Icon.
  - Application Name.
  - Total Duration spent (`Hh Mm`).
  - Usage percentage bar (relative proportion of total tracked app time).
- **Empty State**: Displays *"No app activity recorded yet."*.

---

### E. Project Budgets (`panel-budgets`)
- **Header**: Title (`Project budgets`), Subtitle (`Utilization across projects`), Link action (`Manage` → navigates to budget settings).
- **Budget Row Content**:
  - Project Name.
  - Financial/Hours status text (`$X left · $Y total`).
  - Utilization Progress Bar with threshold color alerts:
    - `< 75%`: Emerald (Normal)
    - `75% – 89%`: Amber (Warning)
    - `≥ 90%`: Red (Critical)
- **Empty State**: Displays *"No project budgets configured."*.

---

### F. Weekly Trends (`panel-weekly`)
- **Header**: Title (`Weekly trends`), Subtitle (`Active hours by day`), Active vs Idle status indicators.
- **Chart Content**:
  - 7-day rolling SVG trend line and gradient area chart representing active work hours.
  - Mon–Sun Day Labels axis with bold underline highlight on the current day of the week.
- **Empty State**: Displays *"No activity recorded this week."*.

---

### G. Recent Projects (`panel-projects`)
- **Header**: Title (`Recent projects`), Subtitle (`Progress across active work`), Link action (`All projects` → navigates to `pm-projects`).
- **Project Item Content**:
  - Color identifier stripe.
  - Project Name.
  - Project Completion / Progress percentage bar (`0–100%`).
  - Assigned member count tag (`X members`).
- **Empty State**: Displays *"No projects in your scope yet."*.

---

## 4. Grid System & Registry Structure

The dashboard operates on a 12-column responsive layout engine (`layout-engine.ts`):

- **Panel Height**: Standardized at `420px`.
- **Stat Slot Height**: Stacked stat blocks occupy half panel height minus grid gap (`200px`).
- **Widget Sizes**:
  - `stat`: Half-height card block.
  - `panel`: Full-height interactive container widget.

---

## 5. API Data Schema & Aggregations

Data is delivered in a single payload from `GET /api/dashboard/general` (`general-dashboard-service.js`):

```json
{
  "roleName": "string",
  "canAccessAllView": boolean,
  "me": {
    "stats": {
      "workedTodayHours": number,
      "workedWeekHours": number,
      "workedSparkline": number[],
      "spentTodayHours": number,
      "spentWeekHours": number,
      "spentSparkline": number[],
      "activityTodayPercent": number,
      "activityWeekPercent": number,
      "activitySparkline": number[],
      "membersWorkedToday": number,
      "membersSparkline": number[],
      "projectsWorkedToday": number,
      "projectsSparkline": number[]
    },
    "todos": [
      { "id": "string", "title": "string", "projectName": "string", "status": "string", "priority": "string", "done": boolean }
    ],
    "onlineMembers": [
      { "id": "string", "name": "string", "initials": "string", "status": "Working|Idle|Offline", "lastActive": "string", "project": "string", "time": "string" }
    ],
    "recentProjects": [
      { "id": "string", "name": "string", "progress": number, "memberCount": number, "colorIndex": number }
    ],
    "budgets": [
      { "id": "string", "name": "string", "spentPercent": number, "total": number, "remaining": number, "spent": number }
    ],
    "weeklyActivity": [
      { "key": "string", "label": "string", "activeHours": number, "idleHours": number }
    ],
    "topApps": [
      { "name": "string", "totalSeconds": number, "percent": number }
    ]
  },
  "all": { ... }
}
```
