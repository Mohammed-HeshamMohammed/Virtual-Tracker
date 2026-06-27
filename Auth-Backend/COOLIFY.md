# Auth Backend — Coolify deployment

| Setting | Value |
| --- | --- |
| **Branch** | `Auth-Production` |
| **Base directory** | `Auth-Backend` |
| **Container name** | `vt-auth-api` |
| **Public domain** | `auth.myvirtualtracker.com` |
| **Port** | `3000` |
| **Health check** | `GET /health` |

## Platform URLs (defaults in `src/config/deployment-profiles.js`)

| Service | Domain |
| --- | --- |
| Auth Backend | `auth.myvirtualtracker.com` |
| Dashboard Backend | `dashapi.myvirtualtracker.com` |
| Landing Web Backend | `api.myvirtualtracker.com` |
| Landing Web | `myvirtualtracker.com` |
| Dashboard Web | `app.myvirtualtracker.com` |

Set environment variables in Coolify — see `.env.example`. With `NODE_ENV=production`, unset vars fall back to the production profile above.

## AuthN routes (this container)

Only these paths are served by Auth-Backend:

- `GET /api/auth/firebase-config`
- `GET /api/auth/readiness`
- `GET /api/auth/password-policy`
- `POST /api/auth/validate-password`
- `POST /api/auth/verify`
- `POST /api/auth/resolve-sign-in-methods`

Identity, email, and session bootstrap → **Dashboard-Backend** (`dashapi.myvirtualtracker.com`).
