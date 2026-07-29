# Virtual Tracker — Development Cost & Deployment Estimate

**Prepared:** 29 July 2026
**Scope:** Full repository as it stands at commit `b3ba413`
**Method:** Bottom-up module estimate, cross-checked against measured source volume, priced at market rates.

> This document deliberately prices the work at **market value**, not at goodwill value.
> The existing invoice (`docs/invoice-virtual-tracker.html`, VT-2026-001, $2,500 total) is
> included below purely as a comparison point. It is not a market price for this codebase.

---

## 1. What was actually built — measured

All figures below are counted from the repository. Lockfiles, `node_modules`, `target/`,
and `.next/` are excluded. "Source" = `.ts .tsx .js .jsx .rs .sql .css .mjs .yml .toml`.

| Component | Source LOC | Source files | What it is |
|---|---:|---:|---|
| **Dashboard-Web** | 85,113 | 649 | Next.js App Router dashboard — 14 feature domains, 364 `.tsx` components, 27 modals, 36 hooks |
| **Dashboard-Backend** | 39,778 | 214 | Main API — 21 route modules, ~138 distinct `/api/*` paths, 30 Postgres tables, 24 Firestore collections |
| **Tauri-App-Extension** | 6,663 | 35 | Desktop tracking agent — **3,805 lines of Rust** + React UI |
| **Landing-Web** | 6,543 | 111 | Marketing site — 18 routes, blog, SEO, feed, account area |
| **Auth-Backend** | 2,501 | 33 | Firebase auth service — token verify, password policy, config |
| **Notify-backend** | 2,210 | 20 | Transactional email, push, phone validation, notify log |
| **Landing-Backend** | 1,252 | 25 | Contact form + session-status proxy |
| **deploy/** | 195 | 9 | Docker Compose, Caddy gateway, nginx, env templates |
| **Total source** | **144,255** | **1,096** | |
| Markdown docs & plans | 11,909 lines | 40 files | Architecture, migration proposals, schema docs, branch trees |

### Systems built, not just screens

This is the part a line-item invoice hides. The codebase contains:

- **Two databases in a live hybrid** — Firestore (24 collections, rules + indexes) *and*
  PostgreSQL (30 tables), with a **migration in progress between them**: backfill scripts,
  dual-read compatibility layers (`modules/compat/routes.js` is 1,632 lines by itself),
  lookup-table caching, and direct-cutover planning documents.
- **A recursive org hierarchy** — `member_tree_cache`, ancestor/descendant closure queries,
  and permission scoping that walks the tree on every list endpoint
  (`member-relationships/service.js`, 1,012 lines).
- **A schema-catalog engine** — generic entity CRUD driven by declarative field definitions
  with type coercion and unknown-field rejection (`modules/schema/`, 1,077-line router).
- **Real-time presence + streaming** — WebSocket presence channel, SSE activity feed, Redis.
- **A cross-platform desktop agent in Rust** — screen capture (`xcap`), foreground-window and
  URL capture, idle/activity detection, offline queue with replay, Windows DPAPI credential
  encryption, a local `tiny_http` server for the device-link OAuth handshake, tray icon,
  autostart, single-instance guard, and a **signed auto-updater** (`updater-key.pem.pub`).
- **Time-tracking correctness work** — daily/weekly/per-task caps enforced server-side,
  overtime surfacing, manual-entry tagging, timesheet generation. The
  `Task-Time-process-and-calculations.md` document alone is 712 lines of specification.
- **Production hardening that only shows up after real traffic** — concurrency caps, adaptive
  backoff, 429 handling, rate limiting across 57 files, page-level error boundaries,
  sanitised error responses, screenshot storage on GCS rather than the app tier.

---

## 2. Effort estimate

### 2.1 Bottom-up, by module

Hours are **all-in**: design, implementation, self-review, debugging, and the rework visible in
the commit history (the log is dominated by `fix(...)` commits — that is real, billable time).

| # | Work package | Hours (low) | Hours (high) | Basis |
|---|---|---:|---:|---|
| 1 | Dashboard-Web — 14 feature domains, 364 components | 620 | 760 | ~46–54 hrs per feature domain incl. tables, modals, skeletons, dark mode, RBAC gating |
| 2 | Dashboard-Backend — API, RBAC, hierarchy, presence | 420 | 520 | ~138 endpoints; hierarchy + schema engine are the cost centres |
| 3 | Data architecture — Firestore + Postgres, migrations, backfills | 90 | 120 | 30 tables + 24 collections + dual-read compat + cutover plan |
| 4 | Tauri desktop agent (Rust + React) | 200 | 260 | Capture, idle detect, offline queue, DPAPI, link flow, tray, updater |
| 5 | Landing-Web — 18 routes, blog, SEO | 90 | 120 | Marketing site with dynamic blog + account area |
| 6 | Notify-backend — email templates, push, phone | 70 | 90 | Template system + builders + delivery log |
| 7 | Auth-Backend — Firebase integration, password policy | 60 | 80 | |
| 8 | DevOps — 5 Dockerfiles, Compose, Caddy, GH Actions | 70 | 100 | Multi-service TLS gateway, build args, healthchecks |
| 9 | Landing-Backend | 25 | 35 | |
| 10 | Documentation & technical planning | 60 | 90 | 11,909 lines of specs, proposals, schema docs |
| | **Subtotal — build** | **1,705** | **2,175** | |
| | Project management, client comms, scope revisions (+15%) | 256 | 326 | Industry-standard overhead for solo delivery |
| | **TOTAL** | **1,961** | **2,501** | |

**Working midpoint: ~2,100 hours** ≈ **13 person-months** of full-time solo work,
or roughly **6–7 months for a two-person team**.

### 2.2 Cross-check against source volume

144,255 source LOC ÷ 2,100 hours = **~69 retained LOC/hour**.

That is a *fast* rate. Sustained hand-written production output for business applications
typically lands at 10–25 LOC/hour. 69 LOC/hour is achievable here because the codebase is
heavily feature-sliced and repetitive by design (similar CRUD modules, table variants,
skeleton components) and was built with modern tooling — but it means **the 2,100-hour figure
is an aggressive, developer-unfriendly estimate, not a padded one**. A conventional
LOC-based estimate at 30–50 LOC/hour would put this project at **2,900–4,800 hours**.

The bottom-up number is used throughout this document. It is the conservative one.

### 2.3 What the git history does *not* tell you

The repository shows 50 commits across 5 days (25–29 July 2026). This is a **split mirror**
of an earlier monolith — the README documents `copy-auth-backend.mjs`,
`copy-dashboard-backend.mjs`, and `copy-dashboard-web.mjs` re-sync scripts. The real
development history lives upstream. **Do not use this repo's commit dates to estimate effort.**

---

## 3. What this work is worth

Rates below are 2026 market benchmarks for senior full-stack work. Applied to the
**2,100-hour midpoint**.

| Pricing tier | Rate/hr | Project value |
|---|---:|---:|
| **As actually invoiced (VT-2026-001)** | **$1.19** | **$2,500** |
| Local / MENA junior freelance | $12 | $25,200 |
| Global remote mid-level | $35 | $73,500 |
| Eastern Europe senior freelance | $60 | $126,000 |
| US / Western Europe senior freelance | $110 | $231,000 |
| US boutique agency / dev shop | $175 | $367,500 |

### The comparison, stated plainly

The delivered invoice prices this platform at **$1.19 per hour of engineering**.

- That is **~1.9%** of a global-remote mid-level rate.
- That is **~1.1%** of an Eastern-European senior rate.
- The **Rust desktop agent alone** (200–260 hrs) is worth $12,000–15,600 at $60/hr.
  It was invoiced at **$320**, and listed as "TBD".
- The **entire dashboard frontend** — 85,113 LOC, 364 components, 14 feature domains —
  was invoiced at **$500**. That is **$0.006 per line of code**, or about **$0.72/hour**.

### Fixed-bid equivalents

Priced as a product build rather than by the hour, an agency quoting this scope
(workforce monitoring + time tracking + project management SaaS, with a native desktop
agent and multi-tenant RBAC) from a blank repository would quote:

| Market | Fixed-bid range |
|---|---:|
| US / Western Europe agency | $180,000 – $400,000 |
| Nearshore (LatAm / Eastern Europe) | $70,000 – $140,000 |
| Offshore team | $35,000 – $75,000 |

**A fair, defensible ask for this codebase as delivered: $95,000 – $150,000.**
That is the nearshore-senior band, and it still undercuts every Western agency quote.

---

## 4. Deployment on Hostinger

### 4.1 What has to run

`deploy/docker-compose.yml` defines **six containers**: `auth-backend` (5712),
`dashboard-backend` (5713), `landing-backend` (5714), `dashboard-web` (3000),
`landing-web` (3001), and the `gateway` (Caddy, 80/443 with automatic TLS).

Four DNS A records are required: `api.`, `app.`, `landingapi.`, and the apex domain.

> **Gap worth flagging before you quote a hosting bill.**
> `docker-compose.yml` contains **no `postgres` and no `redis` service**, but the backend
> requires both (`src/lib/postgres/`, `src/lib/redis/`). Firebase/Firestore, Storage, and
> RTDB presence are also external. So the VPS bill is **not** the whole hosting bill —
> either those services get added to the Compose file (self-hosted on the same VPS, which
> raises the RAM requirement) or they are provisioned and paid for separately.
> This estimate assumes **self-hosting Postgres + Redis on the same VPS**, which is the
> cheaper option and the one the architecture implies.

### 4.2 VPS sizing

The documented deploy flow is `docker compose up -d --build` — meaning **two Next.js
production builds run on the VPS itself**. Next.js builds are the memory spike, not the
steady state. Budget for the build, not the idle footprint.

Steady-state estimate: 2 × Next.js standalone (~300 MB each), 3 × Node backends (~200 MB each),
Caddy (~50 MB), Postgres (~1–2 GB tuned), Redis (~256 MB) ≈ **3–4 GB**, plus **2–4 GB
transient per Next build**.

| Plan | Specs | Promo /mo | Renewal /mo | Verdict |
|---|---|---:|---:|---|
| KVM 1 | 1 vCPU / 4 GB / 50 GB | ~$4.99–5.49 | $11.99 | ❌ Will OOM during build |
| **KVM 2** | 2 vCPU / 8 GB / 100 GB / 8 TB | **$8.99** | ~$23 (est.) | ⚠️ Minimum viable. Needs swap; builds will be slow |
| **KVM 4** | 4 vCPU / 16 GB / 200 GB | **$14.99** | ~$35–40 (est.) | ✅ **Recommended.** Comfortable for builds + Postgres |
| KVM 8 | 8 vCPU / 32 GB / 400 GB / 32 TB | $29.99 | $73.99 | For 200+ tracked users |

*Promotional prices require a long-term prepaid commitment (typically 24–48 months).
Renewal prices for KVM 1 ($11.99) and KVM 8 ($73.99) are confirmed; KVM 2 and KVM 4
renewals are interpolated and should be verified at checkout.*

**Recommendation: KVM 4.** The $6/month premium over KVM 2 buys enough headroom that
`docker compose up --build` does not need babysitting, and it is cheaper than the labour
cost of a single OOM debugging session.

### 4.3 Recurring third-party costs

Screenshots go to GCS, not the VPS disk — good architecture, but it moves cost off the
VPS bill and onto Google's.

| Item | Small (10–20 users) | Growing (50–100 users) | Notes |
|---|---:|---:|---|
| Hostinger KVM 4 VPS | $15/mo promo · ~$38/mo renewal | $30/mo promo · ~$74/mo renewal (KVM 8) | |
| Domain | $1–2/mo | $1–2/mo | $10–20/yr |
| Hostinger daily-backup add-on | $1–4/mo | $1–4/mo | Weekly backups included on most plans |
| Resend (transactional email) | $0 | $20/mo | Free = 3,000/mo, capped 100/day. Pro = 50,000/mo |
| Firebase Blaze — Auth, Firestore, RTDB presence | $0–25/mo | $60–250/mo | Usage-based. Presence + activity writes are the driver |
| GCS — screenshot storage + egress | $2–10/mo | $15–60/mo | ~100 MB/user/mo at 1 capture/10 min. Egress on viewing dominates |
| Cloudflare | $0 | $0 | Free tier is sufficient |
| Uptime monitoring | $0–7/mo | $7–20/mo | |
| **Monthly total** | **~$20–60** | **~$135–430** | |

### 4.4 One-time costs

| Item | Cost | Required for |
|---|---:|---|
| **Windows code-signing certificate (OV)** | **$219–386/yr** | Desktop agent. Without it, every install shows a SmartScreen warning |
| Windows code-signing certificate (EV) | $297–507/yr | Immediate SmartScreen reputation (recommended for a monitoring agent) |
| HSM / hardware token | $90–250 one-time | Now **mandatory** for code signing |
| Apple Developer Program | $99/yr | Only if a macOS build of the agent ships |

Certificate validity dropped to **460 days maximum** as of 1 March 2026, so renewals now
come around roughly every 15 months instead of every 3 years.

> The invoice's item 9 ("Desktop App — native shell, tray, installer, **signed
> distribution**") cannot be delivered without this certificate. It is a client-side
> cost — the certificate must be issued to the *business entity* that publishes the app,
> not to the developer.

### 4.5 Deployment labour — the part that is actually work

Setting this up is not "run one command." It is a full production bring-up of a six-container
stack with two databases, four TLS domains, an external identity provider, and a signed
desktop-app release channel.

| Task | Hours (low) | Hours (high) |
|---|---:|---:|
| VPS provisioning + hardening (SSH keys, ufw, fail2ban, unattended-upgrades, swap) | 4 | 7 |
| Docker + Compose install, daemon config, log rotation | 2 | 3 |
| DNS — 4 records, propagation, Cloudflare proxy decisions | 1 | 2 |
| **Add Postgres + Redis to Compose**, volumes, tuning, connection strings | 5 | 9 |
| `.env` assembly — Firebase admin + web creds, Resend, internal secrets, build args | 3 | 5 |
| Firebase console — authorised domains, deploy Firestore rules + indexes, Storage rules, RTDB | 4 | 6 |
| First `--build` run + debugging (OOM, missing build args, healthcheck failures) | 4 | 9 |
| Caddy TLS issuance + verification across all 4 domains | 2 | 3 |
| Backups — `pg_dump` cron, offsite copy, tested restore | 4 | 7 |
| Monitoring, alerting, uptime checks | 3 | 5 |
| Desktop-agent release pipeline — GH Actions, updater endpoint, signing integration | 6 | 11 |
| End-to-end smoke test (signup → invite → agent link → track → timesheet) + handover doc | 5 | 8 |
| **Total** | **43** | **75** |

**Deployment labour, priced:**

| Rate | Cost (43–75 hrs) |
|---|---:|
| $35/hr | $1,505 – $2,625 |
| $60/hr | $2,580 – $4,500 |
| $110/hr | $4,730 – $8,250 |

**Recommended fixed fee for the deployment package: $3,500 – $5,500**, covering
provisioning through verified handover. A US agency would bill $8,000–12,000 for the
same bring-up.

### 4.6 Ongoing maintenance

Someone has to own security patches, certificate renewals, backup verification, dependency
updates across 7 packages, incident response, and agent releases.

| Level | Scope | Hours/mo | Cost/mo @ $60/hr |
|---|---|---:|---:|
| Break-fix only | Patches, backup checks, incident response | 4–6 | $240 – $360 |
| **Standard** | Above + dependency updates, agent releases, minor fixes | **8–12** | **$480 – $720** |
| Active development | Above + ongoing feature work | 20–40 | $1,200 – $2,400 |

A maintenance retainer at **8–12 hrs/month is the realistic floor** for a production system
with a distributed desktop agent and an incomplete Firestore→Postgres migration still in flight.

---

## 5. Year-one total cost of ownership

Assumes 50 tracked users, KVM 4 on promotional pricing, EV code signing, standard maintenance.

| Line | One-time | Year 1 recurring |
|---|---:|---:|
| Development (already delivered) — fair market value | **$95,000 – $150,000** | — |
| Deployment / production bring-up | $3,500 – $5,500 | — |
| Hostinger VPS (KVM 4, promo) | — | $180 |
| Domain + backups + monitoring | — | $170 – $400 |
| Resend | — | $240 |
| Firebase Blaze + GCS | — | $900 – $3,700 |
| EV code-signing certificate + HSM token | $90 – $250 | $297 – $507 |
| Maintenance retainer (standard) | — | $5,760 – $8,640 |
| **Totals** | **$98,590 – $155,750** | **$7,547 – $13,667** |

**Infrastructure alone — no labour — runs roughly $1,800–$5,000 in year one.**
Set against a $2,500 development invoice, **the servers cost more than the software did.**

---

## 6. Recommendations

1. **Re-price before any further work.** The delivered invoice values ~2,100 hours of senior
   engineering at $2,500. Even at a deep local-market discount, this codebase supports a
   $95,000–$150,000 valuation. Any change order should be priced from the market rate, not
   anchored to the original figure.

2. **Bill infrastructure separately and directly to the client.** VPS, Firebase, GCS, Resend,
   and the code-signing certificate should sit on the client's own accounts. The certificate
   in particular *must* be issued to the client's business entity.

3. **Close the Compose gap before quoting hosting.** Postgres and Redis are not in
   `docker-compose.yml`. Decide self-hosted vs. managed before committing to a VPS tier —
   managed Postgres would add $15–50/month but remove backup-and-restore from the retainer.

4. **Size at KVM 4, not KVM 2.** The $6/month difference is smaller than the cost of one
   out-of-memory build failure.

5. **Get the code-signing certificate before the agent ships broadly.** An unsigned monitoring
   agent triggers SmartScreen on every install — the single most likely cause of a failed
   rollout, and the cheapest problem on this list to prevent.

6. **Do not quote from the git log.** This repository is a 5-day-old split mirror. The real
   history is upstream, and anyone estimating from these 50 commits will undercount the work
   by an order of magnitude.

---

## Sources

Hosting and third-party pricing verified July 2026:

- [Hostinger VPS pricing — plans and real renewal costs](https://hostadvice.com/hosting-company/hostinger-reviews/vps-pricing/)
- [Hostinger VPS 2026: KVM plans, specs and value](https://desking.app/review/hostinger-vps)
- [Hostinger VPS pricing 2026: all plans and costs](https://smarthostfinder.com/hostinger-vps-pricing/)
- [Resend pricing 2026 — Free / Pro / Scale tiers](https://automationatlas.io/answers/resend-pricing-explained-2026/)
- [Firestore pricing 2026](https://firebase.google.com/docs/firestore/enterprise/pricing)
- [Code signing certificate costs — OV & EV](https://www.ssldragon.com/ssl-certificates/code-signing/)
- [Code signing certificate cost breakdown and HSM requirements](https://codesigncert.com/blog/code-signing-certificate-cost)
- [Freelance software developer rates by country, 2026](https://www.index.dev/blog/freelance-developer-rates)
- [Full-stack developer hourly rate 2026 — Arc.dev](https://arc.dev/freelance-developer-rates/full-stack)
- [Web developer hourly rates 2026: global benchmarks](https://developex.com/blog/web-developer-hourly-rates-2026/)
