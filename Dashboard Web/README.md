# Dashboard Web (`vt-dashboard-web`)

Next.js App Router Single-Page Application (SPA) providing the visual workspace dashboard for the Virtual Tracker platform. It provides interfaces for operational command centers, screenshots telemetry review, timesheet submissions, project planning, task boards, hierarchy tree graphs, and payroll financials.

It is designed to run in a containerized environment and communicates directly with both the **Auth-Backend** and **Dashboard-Backend** services using split routing.

---

## Role in the Stack

```
                               ┌───────────────┐
                               │  Browser Web  │
                               └───────┬───────┘
                                       │
                       ┌───────────────┴───────────────┐
                       │ apiFetch() Dynamic Routing    │
                       └───────┬───────────────┬───────┘
                               │ (Auth paths)  │ (App paths)
                               ▼               ▼
                       ┌───────────────┐┌───────────────┐
                       │ Auth-Backend  ││  Dashboard-   │
                       │   (:5712)     ││ Backend (:5713│
                       └───────────────┘└───────────────┘
```

| Service | Dev Port | Protocol / Client Calls? | Purpose |
| :--- | :--- | :--- | :--- |
| **Dashboard Web** (this) | `:3000` | Frontend Browser | Serves the React/Next.js single-page application. |
| **Auth-Backend** | `:5712` | Yes (Client Direct) | Authentication logic only (`/firebase-config`, `/verify`, `/password-policy`). |
| **Dashboard-Backend** | `:5713` | Yes (Client Direct) | Business CRUD endpoints, session bootstrap, and telemetry ingestion. |
| **Notify-Backend** | `:5715` | **No** (Internal Only) | SMTP emails and push notifications. Never accessed from the browser. |

### Client-Side Split Routing
To maintain clean decoupling, the frontend automatically routes API calls to their respective backends in the browser:
- **Unified Gateway Mode (Production)**: If `NEXT_PUBLIC_API_URL` is set, all API calls target this single gateway. A reverse proxy (e.g. Caddy/Nginx) forwards the 6 exact Auth paths to `vt-auth-api` and redirects the rest to `vt-dashboard-api`.
- **Split Port Mode (Local Development)**: If no gateway is specified, the http client dynamically forwards paths matching `isAuthBackendApiPath(pathname)` to `http://localhost:5712` and other business calls to `http://localhost:5713`.

---

## Core Technology Stack

- **Framework**: Next.js (App Router)
- **Library**: React 19
- **Authentication**: Firebase Client Web SDK + Custom auth context provider (`useAuth`)
- **Styling**: Tailwind CSS v4 + PostCSS
- **Animations**: Framer Motion + GSAP (GreenSock) + Tw-Animate-CSS
- **Visualizations**: 
  - **Recharts**: Timesheet reports, timeline charts, and metric widgets
  - **Visx (by Airbnb)**: Custom node hierarchies and interactive organizational tree graphs
- **Drag-and-Drop**: `@dnd-kit/core` and `@dnd-kit/sortable` (used on kanban task boards and order sorting)
- **UI Primitives**: Radix UI headless components styled with Tailwind CSS

---

## Environment Variables Configuration

These variables must be set at **Build Time** (baked into the client bundle prefixing `NEXT_PUBLIC_`):

| Variable | Scope | Target Port | Description |
| :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_API_URL` | Production | Gateway `:443` | **Recommended.** The single entry point endpoint of the unified API gateway. |
| `NEXT_PUBLIC_AUTH_API_URL` | Dev / Split | Auth API `:5712` | Direct public URL for the Auth-Backend subdomain. |
| `NEXT_PUBLIC_DASHBOARD_API_URL` | Dev / Split | Dashboard API `:5713` | Direct public URL for the Dashboard-Backend subdomain. |

*If no variables are defined, the application defaults to local development ports (`:5712` for Auth-Backend, `:5713` for Dashboard-Backend).*

---

## Directory Project Structure

The project uses a structured, modular design separating domain business features from infrastructure clients:

```text
Dashboard Web/
├── .dockerignore
├── .env.example
├── .gitignore
├── Dockerfile
├── README.md                   # This documentation file
├── components.json             # Component styling constraints configuration
├── tsconfig.json               # TypeScript compiler rules
├── postcss.config.mjs          # PostCSS processor configuration
├── next.config.mjs             # Next.js bundler and rewrite settings
├── package.json
│
├── app/                        # App Router routing entrypoints and shells
│   ├── layout.tsx              # Root HTML wrapper
│   ├── page.tsx                # Entrypoint rendering HomeClient
│   ├── globals.css             # Main stylesheet seeding Tailwind v4 variables
│   ├── home-client.tsx         # Decides between login forms, invite accepts, and DashboardShell
│   ├── dashboard-shell.tsx     # The visual shell frame (Sidebar, Topbar, page content context)
│   ├── page-content.tsx        # Dynamic page resolver utilizing lazy chunk imports
│   │
│   ├── auth/                   # Redirect routing logic for Auth actions
│   ├── error/                  # Error bounds templates
│   └── routes/                 # Lazy loaders, transitions, and nav orders
│       ├── chunk-loaders.ts    # React lazy maps grouping pages into domain bundles
│       ├── nav-page-order.ts   # Sequence definition of sidebar elements
│       └── people-member-pages.ts # Transition routes config
│
├── features/                   # Domain features (encapsulates UI, hooks, components)
│   ├── activity/               # Telemetry review (Screenshots feed, App logs, URL feeds, active timers)
│   ├── auth/                   # Credentials forms, password validation, session bootstrap gates
│   ├── clients/                # Clients overview, billing budget modals, invoice configurations
│   ├── dashboard/              # Command Center, widgets, operational metrics grids
│   ├── financials/             # Payroll management, payment records, invoices tables
│   ├── members/                # User profile modals, invitations register forms, transfer requests
│   ├── projects/               # Projects list CRUD, member mapping modals
│   ├── reports/                # Time sheets summaries, manual edit logs, attendance charts
│   ├── settings/               # Organization parameters, scheduling, and integrations panel
│   ├── tasks/                  # Taskboards (Kanban), subtask lists, assignments, comment streams
│   ├── teams/                  # Teams creation, leader toggles, project permissions
│   ├── time-off/               # Leave request calendar grids
│   └── timesheets/             # Pay period timesheet submissions and logs approvals
│
├── infrastructure/             # Global system configurations and clients
│   ├── api/                    # Core http transport logic
│   │   ├── http.ts             # Fetch client wrapping headers, tokens, retries, and errors
│   │   ├── api-backend-routes.ts # Registry listing paths sent to Auth-Backend
│   │   ├── url.ts              # Resolves split ports vs gateway URLs dynamically
│   │   └── retry.ts            # Network failure retry policy handler
│   ├── firebase/               # Initializer for Firebase Client Web SDK
│   └── logging/                # Console logs formatters
│
├── shared/                     # Reusable utilities and design elements
│   ├── constants/              # System constants and limits
│   ├── providers/              # React Context Providers (Auth context, theme contexts)
│   ├── ui/                     # Shadcn / custom visual primitives (Buttons, Dialogs, Tables)
│   └── utils/                  # Helper utilities (dates parser, formatting, classnames merger)
│
└── public/                     # Static assets (images, logos, fonts)
```

---

## Client Infrastructure Deep-Dive

### 1. Unified HTTP Client (`http.ts`)
The custom fetch wrapper (`apiFetch` / `apiPath`) automates system concerns:
- **Authentication Header**: Injected automatically via `bearerAuthHeaders()` querying the active Firebase client user token (`user.getIdToken()`).
- **Token Refresh Loop**: If a request fails with a `401 Unauthorized` status (e.g. expired token), the client intercepts, requests a fresh Firebase ID token, and retries the connection.
- **Failover Retry Policy**: General network errors trigger a retry sequence (up to 3 times by default) with exponential backoff before failing.
- **Payload Unwrapping**: Automatically extracts enveloped standard responses (`data`, `member`, `invite`, etc.).

### 2. Offline / Disconnect Handlers
- **Heartbeat Monitor**: Monitors backend connectivity using active polling.
- **Reconnect Overlay**: If the API gateway is unreachable, the UI shows a visual blur overlay alerting the user, blocking writes, and retrying connection in the background until restored.

---

## Local Development & Installation

### 1. Verify Prerequisites
Make sure **Auth-Backend** and **Dashboard-Backend** are running on ports `:5712` and `:5713`.

### 2. Install and Start
```bash
# Navigate to directory
cd "Dashboard Web"

# Install dependencies
npm install

# Run the dev server
npm run dev
```

### 3. Verification
Open your browser and navigate to `http://localhost:3000`. 
*Note: Ensure you access the app via `localhost` (not `127.0.0.1`) to prevent cookie session mismatches.*

---

## Production Build & Deployment

### 1. Build Client Bundle
During the build stage, you must supply the unified API gateway URL, which is hard-coded into client-side files:
```bash
# Create optimization build
NEXT_PUBLIC_API_URL=https://api.yourdomain.com npm run build
```

### 2. Execution
```bash
# Run production Next.js instance
npm start
```
*Note: Next.js runs on port `:3000` by default. Reverse proxy configurations in production forward domains like `https://app.yourdomain.com` to this port.*
