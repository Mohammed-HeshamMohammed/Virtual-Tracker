# Auth-Backend

Firebase authentication and identity API for the Virtual-Tracker monorepo.

## Routes

- `/api/auth/*` — Firebase config, session verify, profile, password policy, phone verification, deactivation, security notifications
- `/health` — liveness probe

Member invites, preprovision, and onboarding live on **Dashboard-Backend** (`../Dashboard-Backend`).

## Setup

1. Copy the `#Local DEV` or `#Production` block from `.env.example` into `.env`.
2. `npm install`
3. `npm start` (default port from `PORT`, usually `5712`)

Pair with **Dashboard-Backend** on port `5713` and **Dashboard Web** for the full app.
