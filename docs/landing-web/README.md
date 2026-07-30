# Landing-Web

Marketing site (Next.js 15, App Router). Same commands work **locally** and in **production** (Docker / Coolify).

## Requirements

- Node.js **20.6+**
- npm 10+

## Environment

Copy `.env.example` to `.env.local` (never commit secrets):

| Variable | Local | Production |
| --- | --- | --- |
| `NEXT_PUBLIC_DASHBOARD_URL` | Optional — `http://localhost:3000` to link CTAs to Dashboard Web | `https://app.myvirtualtracker.com` (baked at **build** time) |
| `PORT` | `3001` (default) | `3001` in Docker / Coolify |

When `NEXT_PUBLIC_DASHBOARD_URL` is unset, sign-in and trial buttons stay on the landing site (`/sign-in`, `/demo`).

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

## Local production test

```bash
npm run build
npm start
```

`npm run build` uses `scripts/build.mjs` so a stray `NODE_ENV=production` in your shell does not break the build.

Optional faster rebuild (skips TS during build): `SKIP_TYPECHECK=1 npm run build`  
Full check before deploy: `npm run type-check && npm run build`

## Docker (production)

```bash
docker build -t vt-landing-web --build-arg NEXT_PUBLIC_DASHBOARD_URL=https://app.myvirtualtracker.com .
docker run -p 3001:3001 vt-landing-web
```

Image runs `node server.js` from Next **standalone** output (`output: "standalone"` in `next.config.mjs`).

## Coolify

| Setting | Value |
| --- | --- |
| Branch | `LandingWeb-Prod` |
| Base directory | `Landing-Web` |
| Port | `3001` |
| Build | Dockerfile (recommended) or `nixpacks.toml` |
| Start (Docker) | `node server.js` |
| Health check | `GET /` |

Set `NEXT_PUBLIC_DASHBOARD_URL` as a **build** argument / env var in Coolify so CTAs point at the dashboard app.
