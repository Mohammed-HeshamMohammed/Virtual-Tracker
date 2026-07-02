# dashboard-web-production Branch — Dashboard Frontend

> **Branch**: `dashboard-web-production`  
> **Latest Commit**: `480993a` — fix(auth): coalesce overlapping verify/bootstrap calls per uid  
> **Tracks**: `origin/dashboard-web-production`  
> **Role**: Production-isolated deployment branch for the Dashboard-Web + supporting backends + infrastructure

---

## 1. Branch Purpose

The `dashboard-web-production` branch is the **full-stack production branch** that contains the Dashboard-Web frontend along with the **complete supporting ecosystem**: Dashboard-Backend, Landing-Web, Notify-backend, and the deploy infrastructure. Unlike other production branches that isolate a single service, this branch carries the full suite needed to run the entire platform.

### What's Included
- `Dashboard-Web/` — Complete Next.js dashboard application
- `Dashboard-Backend/` — Core business API
- `Landing-Web/` — Marketing site
- `Notify-backend/` — Notification service
- `deploy/` — Docker Compose + Caddy gateway (without docs/env.example)

### What's Excluded
- Auth-Backend (deployed separately via `Auth-Production`)
- `.env.example` files
- Markdown documentation files (removed from root)

---

## 2. Dashboard-Web — Complete Feature Breakdown

### 2.1 Application Structure (Next.js 16)

```
Dashboard-Web/
├── app/                      # Next.js App Router
│   ├── layout.tsx            # Root layout (ThemeProvider + AuthProvider)
│   ├── page.tsx              # Home page entry
│   ├── auth/action/page.tsx  # Email verification handler
│   ├── error/[code]/page.tsx # HTTP error pages
│   ├── dashboard-shell.tsx   # Authenticated layout shell
│   ├── launcher-shell.tsx    # Auth-aware launcher
│   └── routes/               # Client-side routing system
│       ├── chunks/           # Lazy-loaded route chunks
│       └── nav-page-order.ts # Navigation ordering
├── features/                 # Feature modules (~15 domains)
├── infrastructure/           # API, Firebase, logging
├── shared/                   # UI components, tables, utils
├── public/                   # Static assets
├── scripts/
│   └── build.mjs            # Custom build script
└── types/                    # TypeScript declarations
```

### 2.2 Route Chunks (Lazy-Loaded)
The dashboard uses client-side routing with code-split chunks:

| Chunk | Features Loaded |
|-------|-----------------|
| `dashboard-chunk` | Overview, command center, analytics |
| `people-chunk` | Members, hierarchy, teams |
| `activity-chunk` | Activity tracking, screenshots |
| `projects-chunk` | Projects, client management |
| `timesheets-chunk` | Timesheets, approvals |
| `reports-chunk` | Time & activity reports |
| `financials-chunk` | Billing, invoicing |
| `settings-chunk` | Organization settings, policies |
| `profile-chunk` | User profile management |

### 2.3 Feature Modules (Detailed)

#### Authentication (`features/auth/`)
- **Firebase Auth Integration**: Email/password, Google OAuth
- **Sign-In Flow**: Email verification detection, unverified account handling
- **Session Bootstrap**: Automatic member provisioning on first login
- **Verify/Bootstrap Coalescing**: Prevents duplicate API calls per UID
- **Auth Action Handler**: Processes email verification links from Firebase

#### Dashboard (`features/dashboard/`)
- **Command Center**: Centralized overview with widgets
- **Real-time Stats**: Live member count, active timers, project status
- **Charts**: Recharts-based data visualization

#### Members & People (`features/members/`, `features/hierarchy/`, `features/teams/`)
- **Member Management**: CRUD, roles, bulk actions, search
- **Hierarchy Visualization**: Visx-based organizational tree with drag-and-drop
- **Team Management**: Team creation, roster editing, weekly reports
- **Invite System**: Email invitations with role assignment
- **Member Deduplication**: Detect and merge duplicate profiles

#### Activity Monitoring (`features/activity/`)
- **Activity Tracking**: Web and desktop app monitoring
- **Screenshot Capture**: Periodic screenshot recording
- **Agent Sessions**: Desktop agent link management
- **Activity Reports**: Productivity metrics and charts

#### Projects & Clients (`features/projects/`, `features/clients/`)
- **Project CRUD**: Create, edit, archive projects
- **Budget Tracking**: Client-linked project budgets
- **Task Assignment**: Assign members to project tasks
- **Client Management**: Client profiles, contact info
- **Invoicing**: Invoice generation from timesheets

#### Tasks (`features/tasks/`)
- **Kanban Board**: Drag-and-drop task board (dnd-kit)
- **List View**: Traditional task list
- **Timeline Calendar**: Visual timeline of task schedules
- **Task Timer**: Start/stop timer per task with concurrent limits
- **Task Assignments**: Multi-member assignment
- **Workload Validation**: Prevent overallocation

#### Timesheets (`features/timesheets/`)
- **Timesheet Submission**: Weekly/daily timesheet entry
- **Approval Workflow**: Manager review queue
- **Setup Modal**: Configure timesheet periods and rules
- **Manual Time Entry**: Add time retroactively
- **Preview Cards**: Visual timesheet summaries

#### Reports (`features/reports/`)
- **Time & Activity Reports**: Filterable, exportable reports
- **Excel Export**: ExcelJS-powered spreadsheet generation
- **Chart Visualizations**: Recharts graphs for trends
- **Work Session Analysis**: Break down productive time

#### Settings (`features/settings/`)
- **Organization**: Company info, permissions, security
- **Members**: Custom fields, payment settings, work limits
- **Policies**: Overtime, time-off, work breaks
- **Billing**: Plans, invoices, payment settings
- **Integrations**: Third-party service connections
- **Activity Tracking**: Capture mode configuration
- **Enterprise Security**: Advanced security settings

#### Onboarding (`features/onboarding/`)
- **Welcome Wizard**: Step-by-step first-time setup
- **Role Selection**: Initial role assignment
- **Profile Completion**: Guide to complete profile

### 2.4 Shared Infrastructure

#### API Layer (`infrastructure/api/`)
| File | Purpose |
|------|---------|
| `http.ts` | HTTP client with auth headers |
| `auth-retry.ts` | Automatic token refresh and retry |
| `request-coalesce.ts` | Deduplicates concurrent identical requests |
| `backend-connection-events.ts` | Connection status tracking |
| `secure-transport.ts` | TLS enforcement |
| `retry.ts` | Exponential backoff retry logic |
| `api-backend-routes.ts` | Backend URL routing (auth vs dashboard) |
| `path.ts` / `url.ts` | URL construction utilities |

#### UI Component Library (`shared/ui/`)
Extensive Radix UI-based component library:
- **Primitives**: Button, Input, Textarea, Select, Checkbox, Switch, Toggle
- **Overlays**: Dialog, Popover, Dropdown Menu, Tooltip, Command Palette
- **Data Display**: Avatar, Badge, Status Dot, Skeleton, Calendar
- **Layout**: Sidebar, Topbar, Breadcrumbs, Notifications Bell
- **Forms**: Form Field, Date Picker, Multi-Select, Searchable Select, Toggle
- **Specialized**: Tree Chart (org hierarchy), Phone Verify Control, Avatar Stack

#### Table System (`shared/tables/`)
- **Paginated Tables**: Configurable page sizes with URL-based pagination
- **Cached Lists**: Automatic cache invalidation and refresh
- **Responsive Row Cap**: Dynamic row height based on viewport
- **Table Toolbar**: Search, filter, refresh, export buttons
- **Scroll Management**: Infinite scroll and virtual lists

#### Providers (`shared/providers/`)
- **ThemeProvider**: Dark/light mode with system detection
- **AuthProvider**: Firebase Auth state management

---

## 3. Full-Stack Ecosystem on This Branch

### Dashboard-Backend
Same comprehensive backend as documented in `DashboardBackend-Prod`, including:
- All 17 domain modules (auth, members, hierarchy, tasks, projects, clients, etc.)
- PostgreSQL lookup tables with auto-migration
- Real-time WebSocket presence
- Admin monitoring dashboard

### Landing-Web
Complete marketing site (same as `LandingWeb-Prod`):
- All 12+ pages (home, about, features, pricing, blog, etc.)
- Full SEO implementation

### Notify-Backend
Complete notification service:
- 9 email templates, phone validation, push notifications
- PostgreSQL delivery logging with deduplication

### Deploy Infrastructure
- Docker Compose configuration (without `.env.example`)
- Caddy reverse proxy configuration
- Nginx fallback configuration
- Secrets directory structure

---

## 4. Dependencies (Dashboard-Web)

### Runtime Dependencies
| Package | Purpose |
|---------|---------|
| `next` ^16.2.9 | Framework |
| `react` 19.2.4 | UI library |
| `firebase` ^12.12.1 | Client-side auth & Firestore |
| `framer-motion` ^11.15.0 | Animations |
| `gsap` ^3.15.0 | Advanced animations |
| `recharts` 2.15.0 | Charts |
| `@visx/*` | Hierarchy visualization |
| `@dnd-kit/*` | Drag and drop |
| `react-hook-form` ^7.54.1 | Form management |
| `@radix-ui/*` (20+ packages) | UI primitives |
| `lucide-react` ^0.564.0 | Icons |
| `sonner` ^1.7.1 | Toast notifications |
| `date-fns` 4.1.0 | Date manipulation |
| `exceljs` ^4.4.0 | Excel export |
| `embla-carousel-react` 8.6.0 | Carousel component |
| `canvas-confetti` ^1.9.4 | Celebration effects |
| `cmdk` 1.1.1 | Command palette |

### Dev Dependencies
| Package | Purpose |
|---------|---------|
| `tailwindcss` ^4.2.0 | Styling |
| `typescript` 5.7.3 | Type checking |
| `tw-animate-css` 1.3.3 | Tailwind animations |

---

## 5. Branch Evolution (Commit History)

| SHA | Message |
|-----|---------|
| `480993a` | fix(auth): coalesce overlapping verify/bootstrap calls per uid |
| `dbfce70` | fix(auth): retry transient session-bootstrap 503 errors during sign-in |
| `3eb2961` | fix(dashboard-web): preserve email verification params on /auth/action |
| `4e9b882` | fix(dashboard-web): prevent signup race from triggering session-bootstrap |
| `6585ea5` | fix(dashboard-web): improve sign-in for unverified email and Google OAuth |
| `a989198` | chore(dashboard-web): clean up development scripts and package.json |
| `1fe45a7` | chore(dashboard-web): use stopwatch brand icons for layout metadata |
| `90165d2` | fix(dashboard-web): align build scripts and HOSTNAME binding with landing-web |
| `5cc01a9` | fix(dashboard-web): resolve TypeScript typecheck and syntax errors |
| `806a42e` | refactor: rename Dashboard Web directory to Dashboard-Web |
| `97e9c16` | chore: isolate Dashboard Web for production deployment |
| `3fe55af` | docs: document database layout, dashboard web and dashboard backend |
| `d40af99` | refactor: delegate auth/notify concerns across services and add delivery logging |
| `3253a18` | chore(landing): configure stopwatch brand icons for metadata and social previews |
| `1573813` | chore: simplify firebase configuration to use service account only |
