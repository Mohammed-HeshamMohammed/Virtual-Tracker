# Auth Backend ΓÇö Coolify deployment

| Setting | Value |
|---------|--------|
| **Branch** | `Auth-Production` |
| **Base directory** | `Auth-Backend` |
| **Container name** | `vt-auth-api` |
| **Public domain** | `auth.myvirtualtracker.com` |
| **Port** | `3000` |
| **Health check** | `GET /health` |

## Platform URLs (defaults in `src/config/deployment-profiles.js`)

| Service | Domain |
|---------|--------|
| Auth Backend | `auth.myvirtualtracker.com` |
| Dashboard Backend | `dashapi.myvirtualtracker.com` |
| Landing Web Backend | `api.myvirtualtracker.com` |
| Landing Web | `myvirtualtracker.com` |
| Dashboard Web | `app.myvirtualtracker.com` |

Set environment variables in Coolify ΓÇö see `.env.example`. With `NODE_ENV=production`, unset vars fall back to the production profile above.
