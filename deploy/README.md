# VPS deployment — full Virtual-Tracker stack

Deploy **all four services** with one command:

| Container | Source folder | Public URL |
|-----------|---------------|------------|
| `auth-backend` | `../Auth-Backend` | via `api.*` (path routing) |
| `dashboard-backend` | `../Dashboard-Backend` | via `api.*` (path routing) |
| `dashboard-web` | `../Dashboard Web` | `app.yourdomain.com` |
| `landing-web` | `../Landing-Web` | `yourdomain.com` |
| `gateway` (Caddy) | `deploy/Caddyfile` | TLS on 80/443 |

## Architecture

```
                    Internet
                        │
                        ▼
              ┌─────────────────┐
              │  Caddy gateway  │  :443
              └────────┬────────┘
       ┌───────────────┼───────────────┐
       │               │               │
       ▼               ▼               ▼
 api.domain      app.domain     landing.domain
       │               │               │
       ├─► auth-backend:5712       dashboard-web:3000
       └─► dashboard-backend:5713  landing-web:3001
                    │
                    ▼
              Firebase / Firestore
```

## Prerequisites

- VPS with Docker + Docker Compose (Hostinger KVM VPS works well)
- Domain with DNS A records:
  - `api.yourdomain.com` → VPS IP
  - `app.yourdomain.com` → VPS IP
  - `yourdomain.com` (and optional `www`) → VPS IP
- Firebase project (Auth, Firestore, Storage, RTDB for presence)
- Resend or SMTP for auth emails

## 1. Configure environment

```bash
cd Virtual-Tracker/deploy
cp .env.example .env
nano .env   # fill every value
```

**Required:**

| Variable | Example |
|----------|---------|
| `API_DOMAIN` | `api.yourdomain.com` |
| `APP_DOMAIN` | `app.yourdomain.com` |
| `LANDING_DOMAIN` | `yourdomain.com` |
| `NEXT_PUBLIC_API_URL` | `https://api.yourdomain.com` |
| `APP_PUBLIC_URL` | `https://app.yourdomain.com` |
| `CORS_ORIGINS` | `https://app.yourdomain.com,https://yourdomain.com` |
| `FIREBASE_*` | Web + Admin credentials |
| `RESEND_*` or `SMTP_*` | Transactional email |

**Firebase Admin** (pick one):

- Env: `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`, or `FIREBASE_SERVICE_ACCOUNT` JSON string
- File: uncomment `volumes` in `docker-compose.yml` and place `secrets/firebase-admin.local.json`

## 2. Deploy Firebase rules (one-time)

```bash
cd ../Dashboard-Backend
npm install
npm run deploy:firestore   # if script exists, else: firebase deploy --only firestore
```

Add authorized domains in Firebase Console → Authentication → Settings:

- `app.yourdomain.com`
- `api.yourdomain.com` (if using Firebase Hosting auth actions)

## 3. Start the stack

```bash
cd Virtual-Tracker/deploy
docker compose up -d --build
docker compose ps
```

Wait until all services are healthy:

```bash
docker compose logs -f gateway
```

## 4. Verify

```bash
curl -s https://api.yourdomain.com/health
curl -s https://api.yourdomain.com/api/auth/readiness
curl -sI https://app.yourdomain.com | head -1
curl -sI https://yourdomain.com | head -1
```

Open in browser:

- `https://yourdomain.com` — marketing site (Sign in → app)
- `https://app.yourdomain.com` — dashboard (sign in, load members)

## Build args (baked into frontend images)

| Service | Build arg | Source in `.env` |
|---------|-----------|------------------|
| Dashboard Web | `NEXT_PUBLIC_API_URL` | `NEXT_PUBLIC_API_URL` |
| Landing-Web | `NEXT_PUBLIC_DASHBOARD_URL` | `APP_PUBLIC_URL` |

Changing API or app URLs requires rebuild:

```bash
docker compose up -d --build dashboard-web landing-web
```

## Operations

```bash
docker compose logs -f auth-backend
docker compose logs -f dashboard-backend
docker compose logs -f dashboard-web
docker compose logs -f landing-web
docker compose restart dashboard-web
docker compose up -d --build   # after code changes
```

## Security

- Only ports **80** and **443** are published to the host.
- Backends (`5712`, `5713`) and frontends (`3000`, `3001`) stay on the internal Docker network.
- Set `MONITOR_PASSWORD` if you use `/monitor` on the dashboard backend.
- Never use `CORS_ORIGINS=*` in production.

## API path routing

| Path | Backend |
|------|---------|
| `/api/auth/*` | Auth-Backend |
| `/api/presence/ws` | Dashboard-Backend |
| `/api/*` (else — invites, members, onboarding, projects, …) | Dashboard-Backend |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| CORS errors in browser | Add exact frontend origin to `CORS_ORIGINS` |
| Firebase config fails | Check `FIREBASE_*` in `.env`, restart backends |
| Caddy TLS fails | DNS must point to VPS; ports 80/443 open |
| Dashboard blank after login | Verify `NEXT_PUBLIC_API_URL` was set at **build** time |
| Landing sign-in goes nowhere | Set `APP_PUBLIC_URL` before building `landing-web` |

## Alternative: Nginx on host

See `deploy/nginx/` if you prefer host Nginx instead of the Caddy container.
