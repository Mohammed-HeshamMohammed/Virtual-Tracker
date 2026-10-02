# Plan: dashboard behind corporate proxies, VPNs and security gateways

Status: **draft, nothing implemented yet.**

## 1. What the console output actually says

Users on managed networks (office PCs behind a web-filter / proxy / VPN) load
`https://app.myvirtualtracker.com` fine, then every API call fails:

| Symptom | What it means |
|---|---|
| `Redirect is not allowed for a preflight request` on `appapi.../api/bootstrap`, `/api/auth/session-cookie` | The browser's CORS `OPTIONS` preflight to `appapi.` got an **HTTP 3xx**. Our backend never answers a preflight with a redirect, so something between the browser and our server did. |
| `No 'Access-Control-Allow-Origin' header` on `auth.../readiness`, `appapi.../readiness` | The response did not come from our backend (ours always carries CORS headers) - it is a block/interstitial page from the middlebox. |
| `Unsafe attempt to load URL http://114.114.114.114:9421/proxycontrolwarn/httpwarning_3318.html?ori_url=<base64 of https://app...>` | **The smoking gun.** A "proxy control" appliance injected its own warning page. `ori_url` decodes to `https://app.myvirtualtracker.com`. The gateway is intercepting traffic and redirecting to its policy-warning page. |
| `WebSocket ... wss://appapi.../api/presence/ws failed` | Same interception; many gateways drop or rewrite the WebSocket `Upgrade`. |

So this is **not a CORS misconfiguration in our servers** - adding more CORS
headers cannot help, because our servers are never reached. The gateway
classifies `appapi.` and `auth.` (young, uncategorised subdomains) as
"blocked / needs review" and answers on their behalf, while the main
`app.` host happens to pass.

Why it hurts us specifically: the dashboard is a **cross-origin SPA**. It
makes credentialed `fetch` calls from `app.` to two other hostnames
(`appapi.`, `auth.`) plus a cross-origin WebSocket. Every one of those is a
separate gateway decision, and every one needs a successful CORS preflight -
and a preflight cannot follow redirects by spec.

We cannot control customer middleboxes. We **can** stop giving them extra
hostnames to judge, and stop depending on preflights.

## 2. Goal

A user whose network only lets `app.myvirtualtracker.com` through can sign in
and use the dashboard, with no customer-side allowlisting required. Where a
gateway still blocks us, the user (and admin) get a clear, actionable message
instead of a blank "connection lost".

## 3. Approach: make the dashboard single-origin

Serve the API **from the dashboard's own origin** (`https://app.../api/*`,
`wss://app.../api/presence/ws`) and reverse-proxy to the backends behind it.
Same-origin means: no CORS, no preflight, no redirect-on-preflight failure,
one hostname for the gateway to approve, and cookies become first-party.

The repo already supports most of this: `NEXT_PUBLIC_API_URL` "unified
gateway" mode (`Dashboard-Web/infrastructure/api/url.ts`) and a Caddy/nginx
path router (`deploy/Caddyfile`, `deploy/nginx/`) that splits
`/api/(auth-paths)` to Auth-Backend and everything else to Dashboard-Backend.
Production today runs the per-subdomain mode (`appapi.`, `auth.`).

### Phase 0 - confirm the diagnosis (1 hour, no code)
- Reproduce from an affected network (or have the user run
  `curl -i -X OPTIONS https://appapi.myvirtualtracker.com/api/bootstrap -H "Origin: https://app.myvirtualtracker.com" -H "Access-Control-Request-Method: POST"`
  from it). Expect a 302 / HTML body from the appliance, not our headers.
- Run the same from an unaffected network to capture the healthy baseline.
- Check which hostnames the gateway lets through: `app.` yes; `appapi.`,
  `auth.` no. Note the vendor/category if the warning page names one.

### Phase 1 - same-origin API (the real fix)
1. **Edge routing for the app host.** In the app server block
   (`deploy/Caddyfile` `{$APP_DOMAIN}`, and the production equivalent -
   confirm where `app.myvirtualtracker.com` is actually terminated), add the
   same `handle` rules the API gateway has: auth paths -> Auth-Backend,
   `/api/presence/ws` (with WebSocket upgrade) and `/api/*` -> Dashboard-Backend,
   everything else -> `dashboard-web`. Keep `appapi.` and `auth.` working
   unchanged so the agent, old browser tabs and the landing site keep working.
2. **Build the dashboard in unified mode with a relative base.** Today
   `NEXT_PUBLIC_API_URL` must be an absolute https URL (it is run through
   `getSecureApiBaseUrl`). Add support for an empty/relative base meaning
   "same origin" (e.g. `NEXT_PUBLIC_API_URL=/` or a new
   `NEXT_PUBLIC_API_SAME_ORIGIN=true`) so `url.ts`, `presence-ws.ts`
   (`wsBaseUrl()`) and `apiFetch` build `/api/...` and
   `wss://${location.host}/api/presence/ws`. Rebuild is required
   (build-time variable).
3. **Cookies.** `Dashboard-Backend/src/modules/auth/session-cookie.js` sets the
   shared session cookie with an optional `Domain=`. Verify the cookie still
   reaches the backend when requests arrive via `app.`, and that the
   cross-domain SSO flow from the landing site
   (`features/auth/services/cross-domain-sso.ts`, `session-status` /
   `session-exchange`) still works - those calls originate on the landing
   origin and must keep using the cross-origin API host, so **the landing
   site is deliberately left on `appapi.` for now** (it is the marketing
   site, not the failing surface).
4. **Origin / tenant resolution.** Dashboard-Backend's CORS allow-list and
   any host-based logic (`lib/postgres/tenant-resolution.js` mentions the
   presence/session-cookie routes resolving tenant before a tenant is known)
   must accept requests that arrive with `Host: app.myvirtualtracker.com`
   and a same-origin `Origin`. Check `X-Forwarded-*` handling and trusted-proxy
   config so rate limiting and IP-based checks still see the client IP.
5. **WebSocket proxying.** Confirm the app-host proxy passes `Upgrade` /
   `Connection` headers and long idle timeouts (heartbeat is already in
   `presence-ws.ts`).
6. **Roll out behind a switch.** Ship the new build with same-origin
   enabled, keep the old env on a rollback path, test on one affected network
   first, then everyone.

### Phase 2 - resilience when a gateway still interferes
Even single-origin traffic can be blocked (SSL inspection, WebSocket
stripping, whole-domain block). Make that survivable and diagnosable:
1. **WebSocket fallback.** If `wss` fails repeatedly while HTTPS works, fall
   back to polling for presence (the backend already deprecated HTTP presence
   signals - decide whether to re-enable a read-only poll or accept degraded
   "online" indicators and say so in the UI).
2. **Detect interception instead of showing "connection lost".** On a failed
   bootstrap, probe a tiny same-origin endpoint (`/api/readiness`). If it
   returns HTML / a redirect instead of our JSON, show: "Your network's
   security gateway is blocking Virtual Tracker. Ask IT to allow
   `*.myvirtualtracker.com`" with the hostnames to allow. This reuses the
   2-failure debounce already built for the connection overlay (see memory:
   dashboard unclickable-until-refresh bug) so it does not flicker.
3. **Admin-facing doc.** A short "Network requirements" page (and link from
   the error above): hostnames, ports (443 only), WebSockets required, no
   SSL-inspection exemption needed if single-origin works.

### Phase 3 - consider the Tauri agent (separate decision)
The desktop agent talks to `appapi.myvirtualtracker.com`
(`Tauri-App-Extension/src-tauri/src/constants.rs`, `PROD_API_URL`). On the
same filtered networks it will hit the same interception, which looks like
silent tracking failure. Options: (a) document the allowlist requirement
(b) also expose the API under the `app.` host and let the agent fall back to
it. Decide after Phase 1; do not change the agent in the same release as the
dashboard.

## 4. Out of scope / not recommended
- **Adding CORS headers or `Access-Control-Allow-Origin: *`** - never reached,
  and weakens security for no gain.
- **Following the redirect or loading the `114.114.114.114` page** - it is the
  customer's policy page; the browser (correctly) refuses it.
- **Trying to evade the gateway** (tunnelling, domain fronting, obfuscating
  the API host). Customers deploy these on purpose; the supportable answer is
  fewer hostnames plus a clear allowlist request.

## 5. Risks / open questions
- Where is `app.myvirtualtracker.com` terminated in production (Caddy,
  nginx, a PaaS)? That decides how step 1 of Phase 1 is done. The repo only
  shows the sample `deploy/` configs.
- Cookie `Domain=` and the landing -> app SSO hand-off are the part most
  likely to break; test sign-in from the landing site specifically.
- Same-origin means `app.` now carries API traffic: capacity, request-size
  limits and any CDN/WAF in front of `app.` must allow it.
- Gateways that block the whole domain, or that break WebSockets, are only
  helped by Phase 2 (clear messaging), not by Phase 1.

## 6. Verification checklist
- [ ] From a filtered network: dashboard loads, sign-in works, data shows,
      no `Redirect is not allowed for a preflight request` in console.
- [ ] Network tab shows **no** requests to `appapi.` / `auth.` from the
      dashboard origin.
- [ ] Presence/live status works (or degrades with an explicit notice).
- [ ] Sign-in via the landing site still reaches the dashboard signed in.
- [ ] Desktop agent still connects (unchanged path).
- [ ] Dashboard-Web `npm run type-check`, Dashboard-Backend `npm test` pass.
- [ ] Rollback: previous env/build restores per-subdomain mode.
