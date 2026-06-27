# Dashboard-Backend

Dashboard and business-domain API extracted from `app/Backend` for the Virtual-Tracker layout.

Pair with **Auth-Backend** (`../Auth-Backend`) which owns `/api/auth/*`, invites, and member onboarding HTTP routes. Frontend: **Dashboard Web** (`../Dashboard Web`).

## Routes (this service)

- `/api/members`, `/api/roles`, schema CRUD, compat layer
- `/api/projects`, `/api/clients`, `/api/tasks`, `/api/teams`, …
- `/api/dashboard`, `/api/activity`, `/api/presence`, notifications
- `/monitor` — ops dashboard

Auth routes return `404 AUTH_BACKEND_ROUTE` — call Auth-Backend instead.

## Setup

1. Copy `.env.example` → `.env` (default `PORT=5713`)
2. `npm install`
3. `npm start`

Run Auth-Backend on port 5712 in parallel for full platform behavior.
