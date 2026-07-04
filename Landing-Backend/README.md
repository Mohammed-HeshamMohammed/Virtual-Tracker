# Landing-Backend

Backend for the marketing/landing site (`Landing-Web`). Owns:

| Route | Method | Purpose |
| :--- | :--- | :--- |
| `/health` | `GET` | Liveness check |
| `/api/contact` | `POST` | Validates a contact-form inquiry and delegates it to Notify-Backend, which persists it (delivery-log metadata) and emails support |
| `/api/session-status` | `GET` | Proxies Dashboard-Backend's session-cookie check, forwarding the shared cross-subdomain session cookie |
| `/api/session-logout` | `POST` | Proxies Dashboard-Backend's session-logout (revokes the session everywhere), forwarding/relaying the cookie |

## Why a proxy for session status?

Landing-Web should only ever call its own backend. The actual session cookie
(minted via Firebase Admin's `createSessionCookie`/`verifySessionCookie`) is
owned by Dashboard-Backend, since that's where Firebase Auth lives. This
service forwards the request server-to-server rather than duplicating
Firebase Admin auth logic here.

## CORS

Every route is wildcard CORS (no cookies involved) **except**
`/api/session-status` and `/api/session-logout`, which need
`Access-Control-Allow-Credentials` with an explicit origin so the browser
will send/accept the shared session cookie. That origin is restricted to the
same registrable domain as `FRONTEND_ORIGIN`/`APP_PUBLIC_URL` — see
`src/http/cors.js`.

## Environment

See `.env.example`. Landing-Backend holds no database of its own —
`NOTIFY_BACKEND_URL`, `INTERNAL_SERVICE_SECRET`, and `SUPPORT_EMAIL` are all
required for `/api/contact` to work at all (it responds `503` without them).
Notify-Backend is the system of record: every inquiry lands in its
`notification_deliveries` table (metadata column) whether or not the email
itself sends successfully.

## Local dev

```bash
npm install
cp .env.example .env   # fill in values
npm run dev
```
