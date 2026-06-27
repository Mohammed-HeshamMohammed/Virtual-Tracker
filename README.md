# Virtual-Tracker

Multi-app workspace for the Virtual Tracker platform: auth API, dashboard API, dashboard web app, and marketing landing site.

## Projects (main branch)

| Folder | Purpose | Local port |
|--------|---------|------------|
| `Auth-Backend/` | Authentication, profiles, email, phone verification | 5712 |
| `Dashboard-Backend/` | Dashboard REST API (skeleton — routes added over time) | 5713 |
| `Dashboard Web/` | Next.js dashboard (React 19, TypeScript) | 3000 |
| `Landing-Web/` | Next.js marketing / landing site | 3001 |

## Production branches (Coolify / VPS)

Each branch contains **only** the service it deploys. Point Coolify at the folder in the **Base Directory** column.

| Branch | Folder | Base Directory |
|--------|--------|----------------|
| `Auth-Production` | Auth API + Docker | `Auth-Backend` |
| `DashboardBackend-Prod` | Dashboard API + Docker | `Dashboard-Backend` |
| `LandingWeb-Prod` | Landing site + Docker | `Landing-Web` |
| `LandingWebBackend-Prod` | Landing API + Docker | `Landing-Backend` |

## Tech stack

- **Backends:** Node.js 20+, Firebase Admin, Zod, Nodemailer
- **Dashboard Web:** Next.js 16, React 19, TypeScript, Tailwind CSS, Radix UI
- **Landing-Web:** Next.js 15, React 19, TypeScript, Tailwind CSS

## Local development

### 1. Auth-Backend

```bash
cd Auth-Backend
npm install
npm run dev
```

Copy `.env` values from Firebase Console (see `Auth-Backend/.env` — not committed).

### 2. Dashboard-Backend

```bash
cd Dashboard-Backend
npm install
npm run dev
```

### 3. Dashboard Web

```bash
cd "Dashboard Web"
npm install
npm run dev
```

Set `NEXT_PUBLIC_AUTH_API_URL` / `NEXT_PUBLIC_API_URL` only when not using default dev ports (5712 / 5713).

### 4. Landing-Web

```bash
cd Landing-Web
npm install
npm run dev
```

## Project structure (main)

```text
Virtual-Tracker/
├── Auth-Backend/          # Auth API (local dev)
├── Dashboard-Backend/     # Dashboard API (local dev)
├── Dashboard Web/         # Dashboard Next.js app
├── Landing-Web/           # Landing Next.js app
├── landing-page-tree.txt  # Landing-Web file tree
├── LLM-Design-Prinicples-Backend.md
├── LLM-Security-GuideLine.md
└── README.md
```

## Environment

- Each app keeps its own `.env` (gitignored).
- Never commit secrets, Firebase service account JSON, or `node_modules/`.

## Notes

- Dashboard Web dev proxy rewrites `/api/auth/*` → Auth-Backend and other `/api/*` → Dashboard-Backend.
- Production builds use env vars `NEXT_PUBLIC_AUTH_API_URL` and `NEXT_PUBLIC_API_URL` on Dashboard Web.
