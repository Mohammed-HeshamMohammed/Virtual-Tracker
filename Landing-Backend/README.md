# Landing-Backend

Backend for the marketing/landing site (`Landing-Web`). Owns:

| Route | Method | Purpose |
| :--- | :--- | :--- |
| `/health` | `GET` | Liveness check |
| `/api/contact` | `POST` | Persists a contact-form inquiry to Firestore (`landing_contact_inquiries`) and notifies support via Notify-Backend |
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

See `.env.example`. Required for the contact form to actually persist
inquiries: Firebase Admin credentials (Firestore). `NOTIFY_BACKEND_URL` +
`SUPPORT_EMAIL` are optional — without them, inquiries are still saved to
Firestore, they just won't trigger a notification email.

## Local dev

```bash
npm install
cp .env.example .env   # fill in values
npm run dev
```
