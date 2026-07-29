# Virtual Tracker — Software & DevOps Cost Assessment

**Prepared:** 29 July 2026
**Subject:** Full repository at commit `b3ba413`
**Perspective:** **Written for the client.** Figures are the ones a buyer should rely on when
deciding what to pay, what to hold back, and what the system will cost to run.

> **Basis of this assessment.** No prior invoice, quote, or agreed figure was used as an input.
> Every number below is derived from the code as it actually exists in this repository, plus
> published 2026 market rates. Where the code is incomplete, the assessment says so and
> deducts for it.
>
> **Client-favourable convention.** Where an estimate could reasonably fall in a range, the
> effort figures use the *lean* end — what a competent team needs, not what a generous
> timesheet would show. Where risk could reasonably be discounted, it is **not** discounted:
> unfinished work is counted in full against the delivery.

---

## Executive summary

| Question | Answer |
|---|---:|
| How much engineering is in this repo? | **~1,700 hours** (~10.5 person-months) |
| How complete is it? | **~70%** of a shippable product |
| What is the delivered work fairly worth? | **$36,000 – $58,000** |
| What will it cost to finish? | **$21,000 – $38,000** (655–960 hrs) |
| Can it be deployed today, as-is? | **No.** Three required services are missing from the deploy config |
| Deployment / DevOps bring-up cost | **81–127 hrs → $3,000 – $4,500 fixed fee** |
| Hosting & third-party, year one | **$1,900 – $5,200** |
| Ongoing maintenance | **$480 – $720 / month** |

**The single most important finding:** the software is substantial and largely well-built, but
**it cannot be deployed from the configuration in this repository**. `docker-compose.yml` is
missing PostgreSQL, Redis, and the entire Notify service — all three of which the backend
requires at runtime. Budget the remediation before budgeting the server.

---

## Part 1 — What is actually in the repository

### 1.1 Measured inventory

Counted directly from source. Excludes `node_modules`, lockfiles, build output, and `target/`.

| Component | Source LOC | Files | Role |
|---|---:|---:|---|
| Dashboard-Web | 85,113 | 649 | Next.js dashboard — 14 feature modules, 364 components |
| Dashboard-Backend | 39,778 | 214 | Main API — ~138 endpoints, 30 Postgres tables, 24 Firestore collections |
| Tauri-App-Extension | 6,663 | 35 | Desktop agent — 3,805 lines Rust + React UI |
| Landing-Web | 6,543 | 111 | Marketing site — 18 routes, blog, SEO |
| Auth-Backend | 2,501 | 33 | Firebase auth service |
| Notify-backend | 2,210 | 20 | Email, push, phone validation |
| Landing-Backend | 1,252 | 25 | Contact form, session proxy |
| deploy/ | 195 | 9 | Compose, Caddy, nginx |
| **Total** | **144,255** | **1,096** | |
| Documentation | 11,909 lines | 40 files | Specs, migration proposals, schema docs |

### 1.2 Genuinely difficult work that is present and working

These are the parts that justify a professional price rather than a template price:

- **Recursive organisational hierarchy with permission scoping.** `member_tree_cache` plus
  ancestor/descendant closure queries, re-evaluated on every list endpoint
  (`member-relationships/service.js`, 1,012 lines). This is the kind of thing that looks
  simple and takes weeks to get right.
- **A cross-platform desktop agent in Rust.** Screen capture via `xcap`, foreground-window and
  URL capture, idle detection, an offline queue that replays on reconnect, Windows DPAPI
  credential encryption, a local `tiny_http` server implementing the device-link handshake,
  tray icon, autostart, single-instance guard, and a signed auto-updater.
- **Server-side time-tracking integrity.** Daily, weekly, and per-task caps enforced in the
  backend rather than the client, overtime surfacing, manual-entry tagging. Specified in
  `Task-Time-process-and-calculations.md` (712 lines).
- **A declarative schema-catalog engine.** Generic entity CRUD driven by field definitions
  with type coercion and unknown-field rejection — one system serving many entities instead
  of hand-written validation per endpoint.
- **Correct Firestore lockdown.** `firestore.rules` denies all direct client access; every
  read and write goes through the backend Admin SDK. This is the right posture and is
  frequently got wrong.
- **Production hardening that only appears after real traffic:** concurrency caps, adaptive
  backoff, 429 handling, rate limiting across 57 files, page-level error boundaries,
  sanitised error responses, screenshots offloaded to Google Cloud Storage rather than the
  app tier.

### 1.3 Completion assessment — module by module

This is the part that matters most to a buyer. "Built" and "working" are not the same thing.

| Area | Weight | Complete | Evidence |
|---|---:|---:|---|
| Auth & identity | 10% | **90%** | Firebase integration, password policy, session cookies, invites all wired |
| Members / teams / hierarchy | 15% | **90%** | 13,778 LOC, 10 files wired to API, tree + bans + onboarding working |
| Projects & clients | 12% | **85%** | 8 API-wired files, budgets, member limits, team links |
| Tasks & time tracking | 15% | **80%** | Working, but **mid-migration** — dual-write flags still active |
| Activity capture & agent | 15% | **75%** | Agent functional; screenshots, apps, URLs wired. Not signed for distribution |
| Landing site | 5% | **90%** | 18 routes, blog, SEO, account area |
| Timesheets | 6% | **60%** | 1,698 LOC, 3 API-wired files. Approvals flagged not implemented |
| Settings | 5% | **30%** | 8,893 LOC of UI, **1** API-wired file. Gated as coming-soon |
| Reports | 8% | **25%** | 7,162 LOC of UI, **no `api/` directory at all**. Gated |
| Financials | 6% | **15%** | 2,965 LOC of UI, no API layer, code comments confirm mock data |
| DevOps / deployment | 3% | **55%** | Deploy config is missing three required services (see Part 3) |
| **Weighted total** | 100% | **~70%** | |

**What this means in plain terms.** Roughly **17,200 lines of the frontend — Reports,
Financials, Settings, Time-off — are user interface with no backend behind them.** They are
correctly hidden from users via `shared/constants/coming-soon-pages.ts`, so nothing is
misrepresented in the running app. But they are not features yet. A buyer should treat them
as *high-fidelity design work*, worth roughly a third of a wired feature, not as delivered
functionality.

### 1.4 Quality and risk findings

| # | Finding | Severity | Client impact |
|---|---|---|---|
| 1 | **1 test file for 144,255 LOC.** Zero Rust tests, no frontend tests, no `test` script in Dashboard-Web | **High** | Every change is a regression risk. This is the single largest hidden cost in the codebase |
| 2 | **No CI for build, lint, or test.** The only workflow (`release.yml`) builds the desktop agent on tag | **High** | Broken code can reach `main` unnoticed |
| 3 | **Firestore→Postgres migration is unfinished.** `modules/compat/routes.js` is 1,632 lines of dual-read bridging; `TASK_MEMBER_PROGRESS_PG_DUAL_WRITE` still a live flag | **High** | Two databases to run, back up, and reason about. Data-consistency risk until cutover completes |
| 4 | **`.env.example` documents 15 variables; the backend reads ~50** | **High** | Deployment will fail on undocumented config. Missing: `POSTGRES_URL`, `REDIS_URL`, `GCS_BUCKET_NAME`, `INTERNAL_SERVICE_SECRET`, `RESEND_*`, `SMTP_*`, `FIREBASE_CLIENT_EMAIL`/`PRIVATE_KEY`, all `ACTIVITY_*` flags |
| 5 | **`/monitor` admin dashboard is publicly routed** through Caddy, protected only by env-set username/password | **Medium** | Admin surface exposed to the internet. Needs IP allowlist or gateway-level auth |
| 6 | **Backend Dockerfiles are single-stage** and `COPY . .` after `npm ci` | **Low** | Larger images, source and any stray local files shipped into production. Cosmetic vs. the above |
| 7 | Frontend build args are baked at image-build time | **Low** | Any domain change requires a full rebuild, not a restart. Worth knowing before go-live |
| 8 | Only 10 TODO/FIXME markers across the whole codebase | **Positive** | The code is not littered with abandoned work |
| 9 | Firestore rules deny-all, backend-only access | **Positive** | Correct security posture |
| 10 | Consistent feature-sliced architecture across 14 modules | **Positive** | A new developer can find things. Lowers future maintenance cost materially |

---

## Part 2 — What the software is worth

### 2.1 Effort, estimated leanly

Hours below are what a competent senior developer *needs*, not what the work might have taken.
Gated UI-only modules are costed at a reduced rate because they carry no integration,
error-handling, or edge-case burden.

| Work package | Hours | Note |
|---|---:|---|
| Dashboard-Web — 9 API-wired feature modules | 430 | The real product surface |
| Dashboard-Web — shared infrastructure (layout, providers, tables, auth context, theming, routing) | 130 | 1,260-line auth context, table framework, dark mode |
| Dashboard-Web — 4 gated UI-only modules (Reports, Financials, Settings, Time-off) | 120 | ~17,200 LOC at reduced rate — design work, not integration |
| Dashboard-Backend — API, RBAC, hierarchy, presence, schema engine | 340 | ~138 endpoints |
| Data architecture — dual-database design, migrations, backfills | 80 | 30 tables + 24 collections + compat layer |
| Tauri desktop agent (Rust + React) | 170 | Highest difficulty-per-line in the repo |
| Landing-Web | 70 | |
| Notify-backend | 55 | |
| Auth-Backend | 45 | |
| DevOps as it currently stands | 45 | Dockerfiles, Compose, Caddy, release workflow |
| Landing-Backend | 20 | |
| Documentation & technical planning | 45 | 11,909 lines |
| **Subtotal** | **1,550** | |
| Project management & client communication (+10%) | 155 | Lean overhead for solo delivery |
| **Total** | **~1,705** | **≈ 10.5 person-months** |

*Sanity check: 144,255 LOC ÷ 1,705 hrs = 85 LOC/hour. That is a fast, efficient rate —
appropriate for a heavily feature-sliced codebase with a great deal of structural repetition,
and it keeps the estimate on the client's side of the line. A conventional estimate at
30–50 LOC/hour would produce 2,900–4,800 hours.*

> **A note on the git history.** This repository shows 50 commits across 5 days. It is a
> **split mirror** of an earlier monolithic repo — the README documents the `copy-*.mjs`
> re-sync scripts that produced it. The commit dates here reflect the split, not the build.
> Neither party should use them as evidence of effort in either direction.

### 2.2 Fair value of the delivered work

Applying 2026 market rates to 1,705 hours, **then deducting for the 30% that is not finished.**

| Rate basis | Rate/hr | Gross | × 70% complete | **Fair value** |
|---|---:|---:|---:|---:|
| Offshore / MENA senior freelance | $22 | $37,510 | | **$26,257** |
| Offshore / MENA senior freelance (upper) | $30 | $51,150 | | **$35,805** |
| Global remote mid-senior | $38 | $64,790 | | **$45,353** |
| Global remote senior | $48 | $81,840 | | **$57,288** |

**Recommended fair valuation of the delivered work: $36,000 – $58,000.**

For context on why this is the client-favourable band: the same scope quoted fresh by an
agency would come back at **$180,000 – $400,000** (US/Western Europe) or **$70,000 – $140,000**
(nearshore). The range above sits below every one of those, and already has the incomplete
30% deducted.

### 2.3 What it costs to finish — the client's forward liability

This is money the client will spend *after* accepting delivery. It should be known before
agreeing a final figure on the work to date.

| Remediation item | Hours | Priority |
|---|---:|---|
| Build a real test suite (backend contract tests, frontend critical paths, Rust unit tests) | 160 – 240 | **Critical** |
| Wire Reports to the backend (aggregation endpoints, export, scheduling) | 100 – 140 | High |
| Wire Financials (invoicing, payments, payroll data) | 80 – 120 | High |
| Complete Firestore→Postgres cutover, delete the 1,632-line compat layer | 80 – 120 | **Critical** |
| Timesheets — approvals workflow, completion | 60 – 80 | High |
| Wire Settings to the backend | 50 – 70 | Medium |
| Security review & hardening (`/monitor` exposure, secret rotation, dependency audit) | 40 – 60 | **Critical** |
| CI pipeline — lint, type-check, build, test across 7 packages | 30 – 45 | High |
| Observability — structured logging, error tracking, metrics | 30 – 45 | Medium |
| Fix deployment gaps (see Part 3) | 25 – 40 | **Blocking** |
| **Total** | **655 – 960** | |

**Cost to finish: $21,000 – $38,000** at $30–40/hr. Higher if taken to an agency.

### 2.4 Recommended commercial position

| | Amount |
|---|---:|
| Fair value of delivered work (70% complete) | $36,000 – $58,000 |
| Recommended retention until blocking deploy gaps are closed (Part 3, Phase 0) | **hold 8–12%** |
| Known forward cost to reach 100% | $21,000 – $38,000 |
| **All-in cost of a finished product** | **$57,000 – $96,000** |

That all-in figure is still **well under half** the cheapest nearshore agency quote for the
same scope. The build represents good value — provided the remaining 30% is priced honestly
and the deployment gaps are closed before final payment.

---

## Part 3 — Deployment & DevOps

### 3.1 Blocking gaps — the system cannot be deployed as-is

The README says deployment is `docker compose up -d --build`. **It is not.** Verified against
`deploy/docker-compose.yml` and `Dashboard-Backend/src/config/env-schema.js`:

| # | Gap | Evidence | Consequence |
|---|---|---|---|
| 1 | **No PostgreSQL service** in Compose | 30 `CREATE TABLE` statements in `src/lib/postgres/schema.sql`; `POSTGRES_URL` in env schema | Backend cannot start. Projects, tasks, time entries, and activity all live in Postgres |
| 2 | **No Redis service** in Compose | `src/lib/redis/` exists; `REDIS_URL` in env schema | Caching and presence degrade or fail |
| 3 | **Notify-backend has no Dockerfile and is absent from Compose** | `ls Notify-backend/Dockerfile` → not found; `grep notify docker-compose.yml` → 0 matches; but `NOTIFY_BACKEND_URL` is in the env schema | **All transactional email is dead on arrival** — invites, password resets, verification |
| 4 | **`.env.example` covers 15 of ~50 variables** | Counted from `deploy/.env.example` vs `env-schema.js` | Deployment fails on undocumented config, discovered one crash at a time |
| 5 | `/monitor` admin dashboard routed publicly | `deploy/Caddyfile` line: `handle /monitor*` | Admin surface on the public internet behind env-var credentials only |

**Phase 0 — closing these is a prerequisite to any deployment:**

| Task | Hours |
|---|---:|
| Write `Notify-backend/Dockerfile`, add service to Compose, wire internal URL | 3 – 5 |
| Add `postgres` service, named volume, schema init from `schema.sql`, healthcheck | 4 – 6 |
| Add `redis` service with persistence and healthcheck | 1 – 2 |
| Complete `.env.example` — all ~50 variables, documented, with safe defaults | 4 – 6 |
| Restrict `/monitor` (IP allowlist or gateway basic-auth) | 2 – 3 |
| **Phase 0 total** | **14 – 22** |

### 3.2 Full deployment plan and effort

| Phase | Tasks | Hours |
|---|---|---:|
| **0. Blocking remediation** | Per 3.1 above | 14 – 22 |
| **1. Server provisioning & hardening** | VPS order and OS install; SSH keys, disable password auth; `ufw`, `fail2ban`, unattended-upgrades, swap file; Docker Engine + Compose plugin, daemon config, log rotation | 7 – 10 |
| **2. External service setup** | Firebase — auth providers, authorised domains, deploy Firestore rules + indexes, Storage rules, RTDB for presence; GCS — bucket, service account, least-privilege IAM, CORS, lifecycle rules for screenshot retention; Resend — domain verification, SPF/DKIM/DMARC | 10 – 15 |
| **3. DNS & TLS** | 4 A records (`api.`, `app.`, `landingapi.`, apex); Cloudflare proxy decisions; Caddy certificate issuance verified on all four hosts | 3 – 5 |
| **4. Build & bring-up** | `.env` assembly and secret handling; first `--build` (two Next.js builds on the box); debugging OOM, healthcheck, CORS and build-arg issues; Postgres schema init, verify all 30 tables | 12 – 21 |
| **5. Data protection** | `pg_dump` cron + offsite copy + retention policy; **tested** restore drill; scheduled Firestore export | 8 – 11 |
| **6. Observability** | Uptime checks on 4 public endpoints; container log aggregation and rotation; disk and memory alerting | 6 – 9 |
| **7. Desktop-agent release channel** | Code-signing certificate procurement + HSM token setup; wire certificate into the `tauri-action` workflow; verify updater endpoint and `updater.json`; test install **and auto-update** on a clean Windows VM | 11 – 19 |
| **8. Verification & handover** | End-to-end smoke test (signup → invite → agent link → track → screenshot → timesheet); runbook covering deploy, rollback, restore, secret rotation; client walkthrough | 10 – 15 |
| | **Total** | **81 – 127** |

**Priced:**

| Rate | Cost |
|---|---:|
| $25/hr | $2,025 – $3,175 |
| $35/hr | $2,835 – $4,445 |
| $60/hr | $4,860 – $7,620 |

**Recommended fixed fee for the complete bring-up: $3,000 – $4,500.** A fixed fee is the
right structure here — it puts the risk of the unknowns in Phase 4 on the developer, not the
client. A US agency would bill $10,000–15,000 for the same scope of work.

### 3.3 Hostinger VPS sizing

The documented flow builds both Next.js applications **on the server**. The build is the
memory spike, not the running system. With Postgres and Redis now added to Compose per
Phase 0, the requirement rises further.

**Steady state:** 2 × Next.js standalone (~300 MB each) + 4 × Node backends (~200 MB each,
including Notify) + Caddy (~50 MB) + Postgres (~1–2 GB tuned) + Redis (~256 MB) ≈ **4–5 GB**.
**Plus 2–4 GB transient during each Next.js build.**

| Plan | Specs | Promo /mo | Renewal /mo | Verdict |
|---|---|---:|---:|---|
| KVM 1 | 1 vCPU / 4 GB / 50 GB | ~$4.99 | $11.99 | ❌ Cannot complete the build |
| KVM 2 | 2 vCPU / 8 GB / 100 GB / 8 TB | $8.99 | ~$23 (est.) | ⚠️ Workable only with swap and patience |
| **KVM 4** | **4 vCPU / 16 GB / 200 GB** | **$14.99** | **~$35–40 (est.)** | ✅ **Recommended** |
| KVM 8 | 8 vCPU / 32 GB / 400 GB / 32 TB | $29.99 | $73.99 | For 200+ tracked users |

*Promotional prices require a long-term prepaid commitment, typically 24–48 months.
Renewals for KVM 1 ($11.99) and KVM 8 ($73.99) are confirmed from published sources; KVM 2 and
KVM 4 renewals are interpolated and should be confirmed at checkout — this is exactly the
kind of figure that changes between quote and purchase.*

**Recommendation: KVM 4.** The $6/month premium over KVM 2 is less than the cost of fifteen
minutes of developer time spent debugging an out-of-memory build. Consider building images
elsewhere (CI, or a local machine) and pulling them to the VPS — that removes the build spike
entirely and would let KVM 2 suffice, saving ~$180/year. Worth doing if the budget is tight.

### 3.4 Recurring costs

| Item | Small (10–20 users) | Growing (50–100 users) | Notes |
|---|---:|---:|---|
| Hostinger VPS | $15/mo promo · ~$38 renewal (KVM 4) | $30/mo promo · ~$74 renewal (KVM 8) | |
| Domain | $1 – 2/mo | $1 – 2/mo | $10–20/yr |
| Backups add-on | $1 – 4/mo | $1 – 4/mo | Weekly included on most plans; daily is the add-on |
| Resend (email) | **$0** | $20/mo | Free = 3,000/mo, capped 100/day. Pro = 50,000/mo |
| Firebase Blaze (Auth, Firestore, RTDB presence) | $0 – 25/mo | $60 – 250/mo | Usage-based. Presence heartbeats and activity writes are the cost driver |
| GCS (screenshot storage + egress) | $2 – 10/mo | $15 – 60/mo | ~100 MB/user/month at one capture per 10 min. **Egress on viewing dominates storage** |
| Cloudflare | $0 | $0 | Free tier is sufficient |
| Uptime monitoring | $0 – 7/mo | $7 – 20/mo | |
| **Monthly total** | **$20 – 60** | **$135 – 430** | |

**Two levers worth knowing about.** Screenshot capture interval and retention drive the GCS
line almost entirely — the `archive:screenshots` script already exists, and a bucket lifecycle
rule deleting objects after 30–90 days will keep this cost flat instead of compounding. Second,
Firestore cost falls as the Postgres migration completes; finishing that cutover has a direct
monthly saving attached to it.

### 3.5 One-time costs

| Item | Cost | Required for |
|---|---:|---|
| Windows code-signing certificate (OV) | $219 – 386/yr | Desktop agent distribution |
| Windows code-signing certificate (EV) | $297 – 507/yr | Immediate SmartScreen reputation — **recommended** |
| HSM / hardware token | $90 – 250 one-time | Now mandatory for code signing |
| Apple Developer Program | $99/yr | Only if a macOS agent build ships |

Certificate validity dropped to a **460-day maximum** on 1 March 2026, so this now renews
roughly every 15 months rather than every three years.

> **Important for the client, not the developer:** the certificate must be issued to the
> **client's** business entity, because the client is the publisher of the software. It cannot
> be bought by the developer on the client's behalf and transferred. Start the procurement
> early — organisational validation typically takes 3–10 business days.
>
> Without it, every single installation of the agent shows a Windows SmartScreen warning. For
> a workforce-monitoring tool being pushed to employees, that is the most likely cause of a
> failed rollout, and it is the cheapest problem on this entire list to prevent.

### 3.6 Ongoing maintenance

| Level | Scope | Hours/mo | Cost/mo @ $60/hr |
|---|---|---:|---:|
| Break-fix only | Security patches, backup verification, incident response | 4 – 6 | $240 – $360 |
| **Standard** *(recommended)* | Above + dependency updates across 7 packages, agent releases, minor fixes | **8 – 12** | **$480 – $720** |
| Active development | Above + ongoing feature work | 20 – 40 | $1,200 – $2,400 |

Standard is the realistic floor for a production system with a distributed desktop agent, a
half-finished database migration, and effectively no automated test coverage. That last point
is why the retainer cannot safely go lower — without tests, every dependency update requires
manual regression checking.

---

## Part 4 — Year-one total cost of ownership

Assumes 50 tracked users, KVM 4 on promotional pricing, EV code signing, standard maintenance.

| Line | One-time | Year-1 recurring |
|---|---:|---:|
| Delivered software (70% complete), fair value | $36,000 – $58,000 | — |
| Deployment & DevOps bring-up (incl. blocking remediation) | $3,000 – $4,500 | — |
| Completing the remaining 30% | $21,000 – $38,000 | — |
| Hostinger VPS (KVM 4, promotional) | — | $180 |
| Domain, backups, monitoring | — | $170 – $400 |
| Resend | — | $240 |
| Firebase Blaze + GCS | — | $900 – $3,700 |
| EV code-signing certificate + HSM token | $90 – $250 | $297 – $507 |
| Maintenance retainer (standard) | — | $5,760 – $8,640 |
| **Totals** | **$60,090 – $100,750** | **$7,547 – $13,667** |

**Infrastructure and third-party services alone — no labour of any kind — run
$1,900 – $5,200 in year one.** Budget for it separately; it is not a rounding error, and it
recurs every year regardless of whether any further development happens.

---

## Part 5 — Recommendations for the client

**Before paying the balance on delivered work**

1. **Require Phase 0 (14–22 hrs) as a delivery condition.** The system cannot be deployed
   without PostgreSQL, Redis, and Notify in the Compose file. This is not a change request —
   it is a defect in the deliverable. Retain 8–12% until it is closed and a deployment is
   demonstrated end-to-end.
2. **Get the deployment demonstrated, not described.** Acceptance should be a working stack on
   a real VPS with a completed user journey: signup → invite email received → agent installed
   and linked → time tracked → screenshot visible → timesheet generated. Anything less leaves
   the integration risk with you.
3. **Ask for the `.env.example` to be completed** to all ~50 variables before handover. This is
   4–6 hours of work that will otherwise cost you far more in failed deployments.

**Before commissioning further work**

4. **Fund the test suite before new features.** 160–240 hours feels like a lot to spend on
   something with no visible output. It is the highest-return spend available: with 144,255
   lines and one test file, every future change carries regression risk that you pay for in
   debugging time. This cost only grows.
5. **Finish the Postgres migration before building on top of it.** The 1,632-line compat layer
   is pure carrying cost — it makes every subsequent change harder and slower, and it keeps you
   paying for two databases. It also has a direct monthly saving attached.
6. **Price Reports and Financials as new work, not as completion.** They are UI shells with no
   backend. Whatever they were previously described as, budget 180–260 hours to make them
   function.

**On infrastructure**

7. **Put every third-party account in your own name** — Hostinger, Firebase, GCS, Resend,
   the domain, and especially the code-signing certificate. Pay for them directly. If the
   working relationship changes, you keep control of your production system and your data.
8. **Start code-signing procurement now.** Organisational validation takes 3–10 business days
   and the agent rollout is blocked without it.
9. **Set a GCS lifecycle rule on screenshots from day one** (30–90 day retention). Left
   unmanaged, this is the one cost line that compounds indefinitely.
10. **Size at KVM 4**, or build images off-server and stay on KVM 2 to save ~$180/year.

---

## Sources

Pricing verified July 2026.

- [Hostinger VPS pricing — plans and real renewal costs](https://hostadvice.com/hosting-company/hostinger-reviews/vps-pricing/)
- [Hostinger VPS 2026 — KVM plans, specs and value](https://desking.app/review/hostinger-vps)
- [Hostinger VPS pricing 2026 — all plans and costs](https://smarthostfinder.com/hostinger-vps-pricing/)
- [Resend pricing 2026 — Free / Pro / Scale](https://automationatlas.io/answers/resend-pricing-explained-2026/)
- [Firestore pricing](https://firebase.google.com/docs/firestore/enterprise/pricing)
- [Code-signing certificates — OV & EV pricing](https://www.ssldragon.com/ssl-certificates/code-signing/)
- [Code-signing cost breakdown and HSM requirements](https://codesigncert.com/blog/code-signing-certificate-cost)
- [Freelance software developer rates by country, 2026](https://www.index.dev/blog/freelance-developer-rates)
- [Full-stack developer hourly rates 2026 — Arc.dev](https://arc.dev/freelance-developer-rates/full-stack)
- [Web developer hourly rates 2026 — global benchmarks](https://developex.com/blog/web-developer-hourly-rates-2026/)
