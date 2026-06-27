# Virtual-Tracker

Split layout for containerized VPS deployment.

| Folder | Role | Container |
|--------|------|-----------|
| [Auth-Backend](./Auth-Backend) | Auth, invites, onboarding | `vt-auth-backend` |
| [Dashboard-Backend](./Dashboard-Backend) | Projects, members, activity, API | `vt-dashboard-backend` |
| [Dashboard Web](./Dashboard%20Web) | Next.js dashboard app | `vt-dashboard-web` |
| [Landing-Web](./Landing-Web) | Marketing site | `vt-landing-web` |
| [deploy](./deploy) | Docker Compose + Caddy gateway | `vt-gateway` |

## Production (Hostinger / any VPS)

```bash
cd deploy
cp .env.example .env
# Edit .env — domains, Firebase, email
docker compose up -d --build
```

See **[deploy/README.md](./deploy/README.md)** for DNS, Firebase, and verification steps.

| Public URL | Service |
|------------|---------|
| `https://api.yourdomain.com` | API gateway → both backends |
| `https://app.yourdomain.com` | Dashboard Web |
| `https://yourdomain.com` | Landing-Web |

## Local development (without Docker)

```bash
# Terminals 1–2: backends
cd Auth-Backend && npm install && npm start       # :5712
cd Dashboard-Backend && npm install && npm start # :5713

# Terminal 3: dashboard
cd "Dashboard Web" && npm install && npm run dev  # :3000

# Terminal 4: landing (optional)
cd Landing-Web && npm install && npm run dev -- -p 3001
```

For local split dev, Dashboard Web uses ports `5712` / `5713` automatically. For production-like testing, set `NEXT_PUBLIC_API_URL` to a local gateway or use `docker compose`.

## Re-sync from monolith

```bash
node app/Backend/scripts/copy-auth-backend.mjs
node app/Backend/scripts/copy-dashboard-backend.mjs
node app/Frontend/scripts/copy-dashboard-web.mjs
# Re-apply Dashboard Web/infrastructure/api/* if the copy overwrote split routing
```
