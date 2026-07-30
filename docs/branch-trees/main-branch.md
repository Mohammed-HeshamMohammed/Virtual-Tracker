# Main Branch — Full Repository Overview

> **Branch**: `main`  
> **Latest Commit**: `a18246e` — docs(dashboard-backend): update entity-diagram for Postgres lookups and current routes  
> **Role**: Development integration branch — contains the complete monorepo with all services

---

## 1. Project Identity

**Virtual Tracker** is a workforce productivity and time-tracking SaaS platform. It allows organizations to manage distributed/remote teams, track working hours, monitor activity, handle timesheets, manage projects, and oversee organizational hierarchies — all through a modern web dashboard backed by a split microservices architecture.

- **Product URL**: `https://virtualtracker.com` (landing), `https://app.virtualtracker.com` (dashboard)
- **API Gateway**: `https://api.virtualtracker.com`

---

## 2. Architecture Overview

The `main` branch houses the entire monorepo in a **split-service layout** designed for containerized VPS deployment (Coolify / Hostinger / any Docker host).

```
┌─────────────────────────────────────────────────────────────┐
│                    Caddy Gateway (:80/:443)                  │
│           (TLS termination, path-based routing)              │
├────────┬──────────────┬───────────────┬─────────────────────┤
│ /api/auth/*           │ /api/*        │ dashboard-web:3000  │
│ Auth-Backend:5712     │ Dashboard-    │ (Next.js SPA)       │
│ (AuthN only)          │ Backend:5713  │                     │
│                       │ (full API)    │ landing-web:3001    │
│                       │               │ (Next.js marketing) │
└────────┴──────────────┴───────────────┴─────────────────────┘
```

### Services

| Folder | Service | Port | Container | Description |
|--------|---------|------|-----------|-------------|
| `Auth-Backend/` | Authentication API | 5712 | `vt-auth-backend` | Firebase token verify, password policy, config, sign-in method resolution |
| `Dashboard-Backend/` | Business Logic API | 5713 | `vt-dashboard-backend` | Members, invites, projects, tasks, activity, timesheets, hierarchy, presence, notifications, schema CRUD, client management, dashboard analytics |
| `Dashboard-Web/` | Dashboard Frontend | 3000 | `vt-dashboard-web` | Next.js 16 SPA with Radix UI, TailwindCSS, Framer Motion, Recharts, Firebase Auth |
| `Landing-Web/` | Marketing Site | 3001 | `vt-landing-web` | Next.js 15 marketing/landing site with SEO, blog, pricing, features pages |
| `Notify-backend/` | Notification Service | — | — | Internal email (SMTP/Resend), phone validation, push notifications (FCM) |
| `deploy/` | Infrastructure | 80/443 | `vt-gateway` | Docker Compose + Caddy reverse proxy gateway |

---

## 3. Technology Stack

### Backend (All Services)
- **Runtime**: Node.js ≥ 20.6 (native ESM, `--env-file-if-exists`)
- **HTTP**: Bare `node:http` — no Express/Fastify framework
- **Database**: Firebase Firestore (primary) + PostgreSQL (lookup tables, notification logs)
- **Auth**: Firebase Admin SDK (token verification, user management)
- **Validation**: Zod schemas for env config and request bodies
- **Email**: Nodemailer (SMTP) + Resend API (transactional emails)
- **Real-time**: WebSocket (ws) for presence events
- **Image Processing**: Sharp for avatar/profile image handling
- **Phone Validation**: libphonenumber-js

### Frontend (Dashboard-Web)
- **Framework**: Next.js 16 (App Router, React 19)
- **UI Library**: Radix UI primitives (dialog, dropdown, select, tooltip, etc.)
- **Styling**: TailwindCSS 4 + `tw-animate-css`
- **Animation**: Framer Motion + GSAP
- **Charts**: Recharts + Visx (hierarchy visualization)
- **Drag & Drop**: dnd-kit
- **Forms**: react-hook-form
- **Auth**: Firebase client SDK
- **Data Export**: ExcelJS

### Frontend (Landing-Web)
- **Framework**: Next.js 15 (App Router, React 19)
- **Styling**: TailwindCSS 4
- **Animations**: react-simple-typewriter
- **SEO**: Full OpenGraph, Twitter Cards, sitemap, robots.txt, RSS feed

### Infrastructure
- **Reverse Proxy**: Caddy 2 (automatic TLS, gzip, path routing)
- **Containerization**: Docker with multi-stage builds
- **Build System**: Nixpacks for Coolify deployments
- **Orchestration**: Docker Compose

---

## 4. Auth-Backend — Authentication Service

### Purpose
Slim authentication-only API that handles Firebase token verification, password policy enforcement, and client-side Firebase configuration delivery.

### API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auth/firebase-config` | Returns Firebase web SDK config (cached 1h) |
| `GET` | `/api/auth/password-policy` | Returns password requirements (stale-while-revalidate) |
| `GET` | `/api/auth/readiness` | Health/readiness check for Firebase Admin |
| `POST` | `/api/auth/validate-password` | Validates password against policy (blocklist, patterns) |
| `POST` | `/api/auth/verify` | Verifies Firebase ID token, returns decoded user |
| `POST` | `/api/auth/resolve-sign-in-methods` | Looks up sign-in providers for an email address |
| `GET` | `/health` | Container health check |

### Key Modules
- **Password Policy** (`src/config/password-policy/`): Blocklist checking, pattern detection, configurable requirements
- **Security Headers** (`src/http/security-headers.js`): CSP, HSTS, XSS protection
- **CORS** (`src/http/cors.js`): Origin-based CORS with configurable allowed origins
- **Rate Limiting** (`src/http/rate-limit.js`): In-memory IP-based rate limiting
- **TLS Enforcement** (`src/http/tls-enforcement.js`): Rejects plaintext in production
- **Env Validation** (`src/config/env-schema.js`): Zod-based environment variable validation

### Dependencies
- `firebase-admin` — Firebase Auth token verification
- `zod` — Schema validation

---

## 5. Dashboard-Backend — Core Business API

### Purpose
The primary API powering the dashboard application. Handles all business logic including member management, project tracking, task management, activity monitoring, timesheets, client billing, organizational hierarchy, and real-time presence.

### API Route Groups
| Route Group | Module | Description |
|-------------|--------|-------------|
| `/api/auth/*` | `auth/` | Session bootstrap, identity routes, profile sync, security alerts |
| `/api/bootstrap/*` | `bootstrap/` | First-login setup, warm service |
| `/api/members/*` | `members/` | Member CRUD, bans, invites, roles, dedupe, presence |
| `/api/member-onboarding/*` | `member-onboarding/` | Onboarding workflow routes |
| `/api/hierarchy/*` | `hierarchy/` | Org tree management, transfer requests, access guards |
| `/api/member-relationships/*` | `member-relationships/` | Supervisor/subordinate relationship management |
| `/api/projects/*` | `projects/` | Project CRUD, overview, budget from clients |
| `/api/tasks/*` | `tasks/` | Task management, assignments, time tracking, workload validation |
| `/api/activity/*` | `activity/` | Activity tracking, agent link sessions |
| `/api/clients/*` | `clients/` | Client management, budget logic, invoicing |
| `/api/dashboard/*` | `dashboard/` | Analytics, command center, general dashboard |
| `/api/timesheets/*` | `timesheets/` | (Via schema CRUD) |
| `/api/notifications/*` | `notifications/` | In-app notifications, first-login notify |
| `/api/presence/*` | `presence/` | Real-time presence via WebSocket + PubSub |
| `/api/schema/*` | `schema/` | Generic Firestore CRUD with catalog-based validation |
| `/api/compat/*` | `compat/` | Backward compatibility routes |
| `/monitor/*` | `monitor/` | Admin monitoring dashboard (HTML-based) |

### Schema Catalog System
The `schema/catalog/` directory defines entity schemas for:
- **Activity** — tracking sessions, screenshots, agent data
- **Clients** — client records with budget and invoicing
- **Employment** — employment records and status
- **Hierarchy** — organizational tree nodes
- **Member Relationships** — supervisor/subordinate links
- **Members** — employee profiles, roles, presence
- **Notifications** — in-app notification records
- **Projects** — project definitions and assignments
- **Tasks** — task records with assignments and time entries
- **Teams** — team definitions and rosters
- **Timesheets** — timesheet submissions and approvals

### PostgreSQL Integration
- **Lookup Tables** (`schema/services/postgres-crud.service.js`): Migrated lookup data from Firestore
- **Migration Scripts**: `migrate-to-postgres.mjs`, `migrate-lookups-to-postgres.mjs`
- **Auto-creation**: Tables auto-created on startup if missing

### Dependencies
- `firebase-admin` — Firestore, Auth, Storage, RTDB
- `pg` — PostgreSQL client
- `sharp` — Image processing for avatars
- `ws` — WebSocket for real-time presence
- `zod` — Schema validation

---

## 6. Dashboard-Web — Dashboard Frontend

### Purpose
Full-featured web dashboard for Virtual Tracker. A Next.js 16 single-page application with client-side routing, real-time updates, and comprehensive workforce management UI.

### Page Structure (App Router)
| Route | Page | Description |
|-------|------|-------------|
| `/` | Home | Dashboard overview with command center |
| `/auth/action` | Auth Action | Email verification, password reset handler |
| `/error/[code]` | Error Page | HTTP error display |

### Feature Modules
The app is organized by feature domain under `features/`:

| Feature | Description |
|---------|-------------|
| **activity** | Activity monitoring, screenshots, web/app tracking, agent management |
| **auth** | Firebase authentication, sign-in/up flows, Google OAuth, email verification |
| **clients** | Client management with budget tracking, invoicing, CRUD |
| **dashboard** | Overview widgets, command center, real-time stats |
| **hierarchy** | Organizational tree visualization (Visx), drag-and-drop reordering |
| **members** | Member profiles, invite system, role management, deduplication |
| **onboarding** | First-time user setup wizard |
| **profile** | User profile settings, avatar upload |
| **projects** | Project management, task assignment, budget tracking |
| **reports** | Time & activity reports, export to Excel, charts |
| **settings** | Organization settings, policies, security, billing, integrations |
| **tasks** | Kanban board, list view, timeline calendar, task assignments, time tracking |
| **teams** | Team management, roster editing, weekly reports |
| **time-off** | Time off requests and management |
| **timesheets** | Timesheet submission, review queue, approvals |

### Shared Infrastructure
- **API Layer** (`infrastructure/api/`): HTTP client with auth retry, request coalescing, connection events
- **Firebase Config** (`infrastructure/firebase/`): Client-side Firebase initialization
- **Logging** (`infrastructure/logging/`): Structured client-side logging
- **UI Components** (`shared/ui/`): Extensive Radix-based component library
- **Table System** (`shared/tables/`): Paginated, cached, responsive table framework
- **Validation** (`shared/validation/`): Client-side form validation (members, projects, clients)

---

## 7. Landing-Web — Marketing Site

### Purpose
Public-facing marketing website for Virtual Tracker. Built with Next.js 15 and optimized for SEO, performance, and conversion.

### Pages
| Route | Description |
|-------|-------------|
| `/` | Hero section, features, stats, testimonials, industries, trust badges, CTA |
| `/about` | About the company |
| `/features` | Detailed feature showcase |
| `/pricing` | Pricing plans |
| `/solutions` | Industry-specific solutions |
| `/demo` | Request a demo |
| `/contact` | Contact form |
| `/blog` | Blog listing |
| `/blog/[slug]` | Individual blog posts |
| `/resources` | Resources and guides |
| `/sign-in` | Sign-in redirect |

### SEO Features
- OpenGraph and Twitter Card metadata
- Dynamic sitemap generation (`sitemap.ts`)
- RSS feed (`feed.xml/route.ts`)
- Robots.txt configuration
- Web manifest for PWA
- Dynamic OG image generation (`opengraph-image.tsx`)

### Landing Page Sections
- **HeroSection**: Animated typewriter effect, tabbed content, email CTA form
- **FeaturesSection**: Feature showcase with icons
- **StatsSection**: Key metrics display
- **TestimonialsSection**: Customer testimonials
- **IndustriesSection**: Industry-specific use cases
- **TrustSection**: Trust badges and certifications
- **CtaDemoSection**: Demo request CTA
- **FinalCtaSection**: Bottom conversion section

---

## 8. Notify-Backend — Notification Service

### Purpose
Internal microservice for sending notifications across email, phone (validation), and push channels. Protected by an internal service secret — not exposed directly to the public.

### API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/notify/readiness` | Service readiness probe |
| `POST` | `/api/notify/email` | Send templated email (9 templates) |
| `POST` | `/api/notify/phone/validate` | Validate phone number format |
| `POST` | `/api/notify/push` | Send push notification via FCM |

### Email Templates
| Template ID | Purpose |
|-------------|---------|
| `verification` | Email address verification link |
| `password-updated` | Password change confirmation |
| `new-sign-in-alert` | Security alert for new sign-in |
| `member-invite` | Organization member invitation |
| `preprovision-welcome` | Pre-provisioned account welcome with temp password |
| `registration-welcome` | New registration welcome |
| `transfer-invite` | Hierarchy transfer request |
| `member-ban` | Member ban notification |
| `team-weekly-report` | Weekly team performance report |

### Deduplication & Logging
- Cooldown-based deduplication to prevent spam
- Delivery logging to PostgreSQL (`notify_log` table)
- Status tracking: `sent`, `failed`, `skipped`

### Dependencies
- `firebase-admin` — FCM push notifications
- `nodemailer` — SMTP email delivery
- `pg` — PostgreSQL for delivery logs
- `libphonenumber-js` — Phone number validation
- `zod` — Schema validation

---

## 9. Deploy Infrastructure

### Docker Compose Services
| Service | Image | Port | Role |
|---------|-------|------|------|
| `auth-backend` | Custom build | 5712 | Auth API |
| `dashboard-backend` | Custom build | 5713 | Business API |
| `dashboard-web` | Custom build | 3000 | Dashboard SPA |
| `landing-web` | Custom build | 3001 | Marketing site |
| `gateway` | `caddy:2-alpine` | 80/443 | Reverse proxy with auto-TLS |

### Caddy Routing Rules
```
api.domain.com/api/auth/*  → auth-backend:5712 (specific AuthN routes only)
api.domain.com/api/*       → dashboard-backend:5713 (everything else)
api.domain.com/monitor*    → dashboard-backend:5713
api.domain.com/health      → "ok" (gateway-level)
app.domain.com/*           → dashboard-web:3000
domain.com/*               → landing-web:3001
```

### Health Checks
All services include Node.js-based health check scripts that call `/health` endpoints with configurable intervals (30s), timeouts (5s), and retries (3).

---

## 10. Design Principles & Security

### LLM Design Principles (`LLM-Design-Prinicples-Backend.md`)
Guidelines for AI-assisted development of the backend.

### Security Guidelines (`LLM-Security-GuideLine.md`)
Security best practices for the platform.

### Security Features (All Backends)
- **CORS**: Configurable origin-based cross-origin policy
- **Rate Limiting**: Per-IP, per-route rate limiting
- **TLS Enforcement**: Rejects HTTP in production
- **Security Headers**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- **Sensitive Field Protection**: Prevents passwords/tokens in query params
- **Input Validation**: Zod schemas on all request bodies
- **Auth Token Verification**: Firebase ID token verification on all protected routes

---

## 11. Recent Commit History (last 20)

| SHA | Message |
|-----|---------|
| `a18246e` | docs(dashboard-backend): update entity-diagram for Postgres lookups and current routes |
| `68fe87f` | fix(dashboard-backend): map Firestore auto-ids to stable Postgres uuids in lookup migration |
| `ca3979f` | fix(dashboard-backend): ignore non-uuid Firestore actor ids in Postgres lookup writes |
| `1433155` | fix(dashboard-backend): replace Postgres lookup seeds before Firestore import |
| `bd939bf` | fix(dashboard-backend): treat empty Firestore UUID fields as null in Postgres |
| `7c35c92` | fix(dashboard-backend): complete first-login bootstrap without client retry |
| `bb83a8c` | fix(auth): avoid duplicate session-bootstrap on Google sign-in |
| `1ad9380` | fix(auth): survive transient session-bootstrap failures on Google sign-in |
| `65818f5` | fix(dashboard-web): preserve email verification params on /auth/action |
| `595298a` | fix(dashboard-web): prevent signup race from triggering session-bootstrap |
| `1f383b1` | fix(dashboard-backend): fall back to Firestore when Postgres lookup schema is missing |
| `82bd916` | fix(dashboard-backend): auto-create Postgres lookup tables on startup |
| `3b4b7ee` | chore(auth-backend): add dev script with NODE_ENV=development |
| `20940bc` | feat(dashboard-backend): add Postgres lookup tables and migration path |
| `c1871d3` | fix(dashboard-web): improve sign-in for unverified email and Google OAuth |
| `f75d64e` | chore(notify-backend): add programmatic env loading and clean start script |
| `2ccab7e` | chore(dashboard-backend): remove redundant env CLI flag from start script |
| `ce59a80` | fix(dashboard-backend): support GET / for default container healthcheck |
| `77d9819` | fix(dashboard-backend): fix relative import of email-client in ban-email.js |
| `d5c5fe0` | fix(dashboard-backend): fix relative import path of task-subcollections in collection-ref.js |
