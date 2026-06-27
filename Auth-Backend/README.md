# Auth-Backend

Authentication-focused API extracted from `app/Backend` for the Virtual-Tracker monorepo layout.

## Routes

- `/api/auth/*` — Firebase config, verify, profile, password policy, phone verification, deactivation
- `/api/public/invites/*` — Public invite registration
- `/api/invites/*`, `/api/members/preprovision`, `/api/members/validate-add` — Invite management (authenticated)
- `/api/member-onboarding/*` — Post-signup onboarding checklist

## Setup

1. Copy `.env.example` to `.env` and configure Firebase (see `firebase-*.local.json.example`).
2. `npm install`
3. `npm start` (default port from `PORT`, usually 5712)
