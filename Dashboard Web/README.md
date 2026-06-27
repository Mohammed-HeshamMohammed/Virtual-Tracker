# Dashboard Web

Next.js frontend for Virtual-Tracker, configured for the split backend layout.

## Backends

| Service | Dev port | Routes |
|---------|----------|--------|
| [Auth-Backend](../Auth-Backend) | 5712 | AuthN only (`/api/auth/verify`, firebase-config, password policy, …) |
| [Dashboard-Backend](../Dashboard-Backend) | 5713 | projects, members, tasks, activity, … |
| [deploy gateway](../deploy) (production) | 443 | both via `https://api.yourdomain.com` |

The app routes API calls automatically:

- `apiPath()` and `apiFetch()` send auth paths to Auth-Backend and everything else to Dashboard-Backend.
- With `NEXT_PUBLIC_API_URL` set (production), all traffic uses the gateway URL.

## Local development

```bash
# Terminals 1–2: start both backends (see Auth-Backend / Dashboard-Backend README)

cd "Dashboard Web"
npm install
cp .env.example .env.local   # optional — split ports are the default
npm run dev
```

Open http://localhost:3000

## Production build

```bash
NEXT_PUBLIC_API_URL=https://api.yourdomain.com npm run build
npm start
```

Or set `NEXT_PUBLIC_API_URL` in `.env.production` before `npm run build`.

## Re-sync from monolith frontend

```bash
node app/Frontend/scripts/copy-dashboard-web.mjs
```

Then re-apply any custom files under `Dashboard Web/infrastructure/api/` if the copy script overwrote them.
