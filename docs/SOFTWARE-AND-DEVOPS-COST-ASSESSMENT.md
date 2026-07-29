# Virtual Tracker — Software & DevOps Cost Assessment

**Prepared:** 29 July 2026
**Subject:** Full repository at commit `b3ba413`, plus the live production deployment
**Perspective:** **Written for the client.** Figures are the ones a buyer should rely on when
deciding what to pay, what to hold back, and what the system will cost to run.

> **Basis of this assessment.** No prior invoice, quote, or agreed figure was used as an input.
> Every number is derived from the code as it exists in this repository, from **measured
> production resource usage on the live server**, and from published 2026 market rates.
> Where the code is incomplete, the assessment says so and deducts for it.
>
> **Client-favourable convention.** Where an estimate could reasonably fall in a range, effort
> figures use the *lean* end. Where risk could reasonably be discounted, it is **not**
> discounted.

---

## Executive summary

| Question | International market | **Egyptian market (§6)** |
|---|---:|---:|
| How much engineering is in this repo? | **~1,738 hours** (~10.7 person-months) | same |
| How complete is the software? | **~71%** of a shippable product | same |
| What is the delivered work fairly worth? | $36,000 – $58,000 | **EGP 700,000 – 1,200,000** |
| What will it cost to finish? | $21,000 – $38,000 (655–960 hrs) | **EGP 330,000 – 670,000** |
| Is it deployed and running? | **Yes** — full stack live on a Hostinger KVM 2, measured at 15% CPU / 20% RAM | same |
| Remaining DevOps work | 34–54 hrs → $1,300 – $2,200 | **EGP 20,000 – 38,000** |
| Hosting & third-party, year one | $1,700 – $4,900 | **EGP 86,000 – 247,000** |
| Ongoing maintenance | $480 – $720 / month | **EGP 4,800 – 8,400 / month** |

*Rate: 50.5 EGP/USD (July 2026). Labour reprices to the local market; **infrastructure does
not** — every server and service line is USD-denominated. See §6.4.*

**Two findings dominate everything else.**

1. **The server is not the problem, and never will be.** The entire stack — including
   PostgreSQL, Redis, and Notify — runs at **20% RAM and 15% CPU on an 8 GB / 2 vCPU box**.
   Activity tracking adds only 1–2% CPU under constant load. There is no case for upgrading
   hardware. The real ceiling is **disk growth**, addressed in §3.5.

2. **The production configuration exists only on the server, not in version control.** The
   deployment works, but `docker-compose.yml` in this repository does not describe it — it is
   missing PostgreSQL, Redis, and Notify entirely, and `.env.example` documents 15 of ~50
   variables. Combined with auto-deploy on every commit and **one test file across 144,255
   lines**, this is now the highest-value thing to fix. It is cheap to fix. See §1.4 and §3.2.

---

## Part 1 — What is actually in the repository

### 1.1 Measured inventory

Counted directly from source. Excludes `node_modules`, lockfiles, build output, `target/`.

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

These justify a professional price rather than a template price:

- **Recursive organisational hierarchy with permission scoping.** `member_tree_cache` plus
  ancestor/descendant closure queries re-evaluated on every list endpoint
  (`member-relationships/service.js`, 1,012 lines). Looks simple; takes weeks to get right.
- **A cross-platform desktop agent in Rust.** Screen capture via `xcap`, foreground-window and
  URL capture, idle detection, an offline queue that replays on reconnect, Windows DPAPI
  credential encryption, a local `tiny_http` server implementing the device-link handshake,
  tray icon, autostart, single-instance guard, signed auto-updater.
- **Server-side time-tracking integrity.** Daily, weekly and per-task caps enforced in the
  backend rather than the client, overtime surfacing, manual-entry tagging. Specified in
  `Task-Time-process-and-calculations.md` (712 lines).
- **A declarative schema-catalog engine.** Generic entity CRUD driven by field definitions with
  type coercion and unknown-field rejection — one system serving many entities.
- **Correct Firestore lockdown.** `firestore.rules` denies all direct client access; every read
  and write goes through the backend Admin SDK. This is the right posture and is frequently
  got wrong.
- **Efficient activity ingest.** Confirmed by production measurement, not just by reading the
  code: constant tracking load costs **1–2% of two vCPUs**. The batching and tick-coalescing
  work in `app-log` ingest is doing its job. This is a real engineering result and it is the
  reason the hosting bill is as low as it is.
- **Production hardening:** concurrency caps, adaptive backoff, 429 handling, rate limiting
  across 57 files, page-level error boundaries, sanitised error responses, screenshots
  offloaded to Google Cloud Storage rather than the app tier.

### 1.3 Completion assessment — module by module

"Built" and "working" are not the same thing. Percentages are weighted by share of product value.

| Area | Weight | Complete | Evidence |
|---|---:|---:|---|
| Auth & identity | 10% | **90%** | Firebase integration, password policy, session cookies, invites wired |
| Members / teams / hierarchy | 15% | **90%** | 13,778 LOC, 10 API-wired files, tree + bans + onboarding working |
| Projects & clients | 12% | **85%** | 8 API-wired files, budgets, member limits, team links |
| Tasks & time tracking | 15% | **80%** | Working, but **mid-migration** — dual-write flags still live |
| Activity capture & agent | 15% | **75%** | Agent functional; screenshots, apps, URLs wired. Not code-signed |
| Landing site | 5% | **90%** | 18 routes, blog, SEO, account area |
| DevOps / deployment | 3% | **75%** | **Live and stable**, with auto-deploy. Not reproducible from the repo |
| Timesheets | 6% | **60%** | 1,698 LOC, 3 API-wired files. Approvals flagged not implemented |
| Settings | 5% | **30%** | 8,893 LOC of UI, **1** API-wired file. Gated as coming-soon |
| Reports | 8% | **25%** | 7,162 LOC of UI, **no `api/` directory at all**. Gated |
| Financials | 6% | **15%** | 2,965 LOC of UI, no API layer; code comments confirm mock data |
| **Weighted total** | 100% | **~71%** | |

**In plain terms.** Roughly **17,200 lines of the frontend — Reports, Financials, Settings,
Time-off — are user interface with no backend behind them.** They are correctly hidden from
users via `shared/constants/coming-soon-pages.ts`, so nothing is misrepresented in the running
app. But they are not features yet. Treat them as *high-fidelity design work* worth roughly a
third of a wired feature, not as delivered functionality.

### 1.4 Quality and risk findings

Re-ranked now that the deployment is confirmed working. The top three are all the same
underlying problem: **the production system is real, but the repository cannot rebuild it.**

| # | Finding | Severity | Client impact |
|---|---|---|---|
| 1 | **Auto-deploy on every commit, with 1 test file across 144,255 LOC and no CI for build/lint/test.** Zero Rust tests, no frontend tests, no `test` script in Dashboard-Web | **Critical** | Every commit reaches production untested. There is no gate between a typo and a customer-facing outage. The CD half is built; the CI half does not exist |
| 2 | **Production config is not in version control.** Repo `docker-compose.yml` has no `postgres`, no `redis`, and no `notify-backend` (that service has no Dockerfile at all), yet all three run in production | **Critical** | If the VPS is lost, the deployment **cannot be reconstructed from this repository**. The working knowledge lives on one server and in one person's head |
| 3 | **Database was created directly on the server**, not provisioned from `schema.sql` | **High** | Live schema may have drifted from the committed schema. No verified path to rebuild the database from code |
| 4 | **`.env.example` documents 15 of ~50 variables** the backend reads. Missing: `POSTGRES_URL`, `REDIS_URL`, `GCS_BUCKET_NAME`, `INTERNAL_SERVICE_SECRET`, `RESEND_*`, `SMTP_*`, `FIREBASE_CLIENT_EMAIL`/`PRIVATE_KEY`, all `ACTIVITY_*` flags | **High** | Any rebuild or second environment fails one crash at a time |
| 5 | **No retention or purge on `activity_app_logs` and `activity_url_logs`.** Rows land every ~30s per tracked user; an `archive:screenshots` script exists but has no equivalent for these tables | **High** | The only genuine scaling limit on the current server. Quantified in §3.5 |
| 6 | **Firestore→Postgres migration unfinished.** `modules/compat/routes.js` is 1,632 lines of dual-read bridging; `TASK_MEMBER_PROGRESS_PG_DUAL_WRITE` still a live flag | **High** | Two databases to run, back up and reason about. Consistency risk until cutover completes |
| 7 | **`/monitor` admin dashboard publicly routed** through Caddy, protected only by env-set credentials | **Medium** | Admin surface on the public internet. Needs an IP allowlist or gateway auth |
| 8 | Backend Dockerfiles are single-stage with `COPY . .` after `npm ci` | **Low** | Larger images; source and stray local files shipped to production |
| 9 | Frontend build args baked at image-build time | **Low** | A domain change needs a rebuild, not a restart |
| 10 | Only 10 TODO/FIXME markers across the codebase | **Positive** | Not littered with abandoned work |
| 11 | Firestore rules deny-all, backend-only access | **Positive** | Correct security posture |
| 12 | Consistent feature-sliced architecture across 14 modules | **Positive** | A new developer can find things — materially lowers future maintenance cost |
| 13 | **Measured production efficiency: 20% RAM / 15% CPU on 2 vCPU / 8 GB** | **Positive** | Genuinely good engineering. Hosting costs stay minimal for years |

---

## Part 2 — What the software is worth

### 2.1 Effort, estimated leanly

Hours are what a competent senior developer *needs*, not what a generous timesheet would show.
Gated UI-only modules are costed at a reduced rate — they carry no integration, error-handling
or edge-case burden.

| Work package | Hours | Note |
|---|---:|---|
| Dashboard-Web — 9 API-wired feature modules | 430 | The real product surface |
| Dashboard-Web — shared infrastructure (layout, providers, tables, auth context, theming, routing) | 130 | 1,260-line auth context, table framework, dark mode |
| Dashboard-Web — 4 gated UI-only modules (Reports, Financials, Settings, Time-off) | 120 | ~17,200 LOC at reduced rate — design work, not integration |
| Dashboard-Backend — API, RBAC, hierarchy, presence, schema engine | 340 | ~138 endpoints |
| Data architecture — dual-database design, migrations, backfills | 80 | 30 tables + 24 collections + compat layer |
| Tauri desktop agent (Rust + React) | 170 | Highest difficulty-per-line in the repo |
| Landing-Web | 70 | |
| **DevOps — including the live deployment** | **75** | Revised up from 45. Compose, Caddy, Dockerfiles, release workflow, **plus provisioning, Postgres/Redis/Notify setup, auto-deploy pipeline and tuning that are not visible in the repo** |
| Notify-backend | 55 | |
| Auth-Backend | 45 | |
| Landing-Backend | 20 | |
| Documentation & technical planning | 45 | 11,909 lines |
| **Subtotal** | **1,580** | |
| Project management & client communication (+10%) | 158 | Lean overhead for solo delivery |
| **Total** | **~1,738** | **≈ 10.7 person-months** |

*Sanity check: 144,255 LOC ÷ 1,738 hrs = 83 LOC/hour. A fast, efficient rate — appropriate for
a heavily feature-sliced codebase with substantial structural repetition, and it keeps the
estimate on the client's side of the line. A conventional estimate at 30–50 LOC/hour would
produce 2,900–4,800 hours.*

> **On the git history.** This repository shows 50 commits across 5 days. It is a **split
> mirror** of an earlier monolithic repo — the README documents the `copy-*.mjs` re-sync
> scripts that produced it. These commit dates reflect the split, not the build. Neither party
> should cite them as evidence of effort in either direction.

### 2.2 Fair value of the delivered work

Applying 2026 market rates to 1,738 hours, **then deducting for the 29% that is not finished.**

| Rate basis | Rate/hr | Gross | × 71% complete | **Fair value** |
|---|---:|---:|---:|---:|
| Offshore / MENA senior freelance | $22 | $38,236 | | **$27,148** |
| Offshore / MENA senior freelance (upper) | $30 | $52,140 | | **$37,019** |
| Global remote mid-senior | $38 | $66,044 | | **$46,891** |
| Global remote senior | $48 | $83,424 | | **$59,231** |

**Recommended fair valuation of the delivered work: $36,000 – $58,000.**

For context on why that is the client-favourable band: the same scope quoted fresh by an agency
returns **$180,000 – $400,000** (US / Western Europe) or **$70,000 – $140,000** (nearshore). The
range above sits below every one of those and already has the incomplete 29% deducted.

### 2.3 What it costs to finish — the client's forward liability

Money the client spends *after* accepting delivery. Know it before agreeing a final figure.

| Remediation item | Hours | Priority |
|---|---:|---|
| Build a real test suite (backend contract tests, frontend critical paths, Rust unit tests) | 160 – 240 | **Critical** |
| Wire Reports to the backend (aggregation endpoints, export, scheduling) | 100 – 140 | High |
| Wire Financials (invoicing, payments, payroll data) | 80 – 120 | High |
| Complete Firestore→Postgres cutover, delete the 1,632-line compat layer | 80 – 120 | **Critical** |
| Timesheets — approvals workflow, completion | 60 – 80 | High |
| Wire Settings to the backend | 50 – 70 | Medium |
| Security review & hardening (`/monitor` exposure, secret rotation, dependency audit) | 40 – 60 | **Critical** |
| CI pipeline — lint, type-check, build, test across 7 packages, gating the auto-deploy | 30 – 45 | **Critical** |
| Observability — structured logging, error tracking, metrics | 30 – 45 | Medium |
| Reproducibility & DR — get production config into version control (§3.2) | 25 – 40 | **Critical** |
| **Total** | **655 – 960** | |

**Cost to finish: $21,000 – $38,000** at $30–40/hr. Higher through an agency.

### 2.4 Recommended commercial position

| | Amount |
|---|---:|
| Fair value of delivered work (71% complete) | $36,000 – $58,000 |
| Recommended retention until §3.2 reproducibility work is delivered | **hold 5–8%** |
| Known forward cost to reach 100% | $21,000 – $38,000 |
| **All-in cost of a finished product** | **$57,000 – $96,000** |

Still **well under half** the cheapest nearshore agency quote for the same scope. The build
represents good value — provided the remaining 29% is priced honestly as new work, and the
reproducibility gap is closed before final payment.

The retention is deliberately lower than it would be for a broken deployment. The system is
live and stable; what is missing is the ability to rebuild it. That is a real risk, but it is a
**25–40 hour** risk, not a rebuild.

---

## Part 3 — Deployment & DevOps

### 3.1 What is already done — and it is more than the repo shows

Confirmed running on a single Hostinger **KVM 2 (2 vCPU / 8 GB / 100 GB NVMe)**:

- All application containers, the Caddy gateway with automatic TLS across four domains
- **PostgreSQL and Redis on the same box**
- **Notify-backend running in production** despite having no Dockerfile in this repo
- **Continuous deployment** — containers build from their production branches and auto-redeploy
  on every commit, with Next.js builds completing on the VPS itself
- PostgreSQL provisioned directly on the server

**Measured production load:**

| Metric | Measured | Of KVM 2 capacity | Headroom |
|---|---:|---:|---:|
| RAM | **20%** | ~1.6 GB of 8 GB | **6.4 GB free** |
| CPU | **15%** | ~0.3 of 2 vCPU | **1.7 vCPU free** |
| Constant activity-tracking load | **+1–2% CPU** | ~0.02–0.04 vCPU | — |

This retires my earlier sizing concerns outright. I had estimated 4–5 GB steady state plus a
2–4 GB build spike and recommended KVM 4. **The measurement says otherwise, and the measurement
wins.** The stack is roughly three times leaner than a conventional estimate for eight
containers including a database — that is a real engineering result, not luck.

The corollary matters more than the correction: **activity tracking costing 1–2% of two vCPUs
means CPU will not be the constraint at any realistic headcount.** Even reserving 30% for build
spikes, the tracking workload could grow by an order of magnitude before CPU matters.

### 3.2 What remains — reproducibility, not deployment

The system is deployed. The problem is that **this repository cannot rebuild it.** Verified:

| Gap | Evidence | Consequence |
|---|---|---|
| No `postgres` service in Compose | `grep -E "^  [a-z-]+:" deploy/docker-compose.yml` → 6 services, none of them Postgres | Live DB has no declaration in code |
| No `redis` service in Compose | Same; yet `REDIS_URL` is in the env schema | Same |
| **Notify-backend has no Dockerfile and no Compose entry** | `ls Notify-backend/Dockerfile` → not found; `grep notify docker-compose.yml` → 0 matches | The service running your invites and password resets is undeclared |
| `.env.example` covers 15 of ~50 vars | `deploy/.env.example` vs `src/config/env-schema.js` | No documented path to configure a fresh environment |
| Database created by hand, not from `schema.sql` | Confirmed by the client | Possible drift between live schema and committed schema |
| `/monitor` publicly routed | `deploy/Caddyfile`: `handle /monitor*` | Admin surface exposed |

**This is a bus-factor and disaster-recovery problem.** Today everything works. If the VPS is
lost, corrupted, or has to move, the recovery path runs through one person's memory rather than
through `git clone`. That is the single cheapest serious risk on this list to eliminate.

| Task | Hours |
|---|---:|
| Write `Notify-backend/Dockerfile`; add `notify-backend` service to Compose | 3 – 5 |
| Add `postgres` and `redis` services with named volumes, healthchecks, schema init | 5 – 8 |
| **Reconcile live DB schema against `schema.sql`**; commit a migration for any drift | 4 – 7 |
| Complete `.env.example` — all ~50 variables, documented, safe defaults | 4 – 6 |
| Verify the committed Compose file reproduces production on a throwaway VPS | 4 – 6 |
| Restrict `/monitor` (IP allowlist or gateway basic-auth) | 2 – 3 |
| **Add CI gating the auto-deploy** — lint, type-check, build, test before it reaches production | 8 – 14 |
| Backups: `pg_dump` cron, offsite copy, retention, **tested restore** | 4 – 5 |
| **Total** | **34 – 54** |

**Priced: $1,300 – $2,200** at $35–40/hr. The CI line is the one that pays for itself fastest —
auto-deploy without a test gate means every commit is a production change with nothing standing
between a mistake and your users.

### 3.3 VPS sizing — KVM 2 confirmed

| Plan | Specs | Promo /mo | Renewal /mo | Verdict |
|---|---|---:|---:|---|
| KVM 1 | 1 vCPU / 4 GB / 50 GB | ~$4.99 | $11.99 | Would fit at 40% RAM, but no build headroom |
| **KVM 2** | **2 vCPU / 8 GB / 100 GB / 8 TB** | **$8.99** | **~$23 (est.)** | ✅ **Correct choice. Proven in production at 20/15%** |
| KVM 4 | 4 vCPU / 16 GB / 200 GB | $14.99 | ~$35–40 (est.) | Unnecessary. Only worth it for disk, not CPU or RAM |
| KVM 8 | 8 vCPU / 32 GB / 400 GB | $29.99 | $73.99 | No case for this |

*Promotional pricing requires a long-term prepaid commitment, typically 24–48 months. Renewals
for KVM 1 ($11.99) and KVM 8 ($73.99) are confirmed from published sources; KVM 2 and KVM 4
renewals are interpolated and should be confirmed at checkout.*

**Stay on KVM 2. Do not upgrade for CPU or RAM.** When an upgrade eventually becomes necessary
it will be for **disk**, and §3.5 explains how to postpone that indefinitely for far less than
the cost of a bigger plan.

### 3.4 Recurring costs

Revised down — KVM 2 confirmed, and Postgres/Redis self-hosted means no managed-database line.

| Item | Current (10–20 users) | Growing (50–100 users) | Notes |
|---|---:|---:|---|
| Hostinger KVM 2 | $9/mo promo · ~$23 renewal | $9/mo promo · ~$23 renewal | **Same plan at both scales** — the headroom is already there |
| Domain | $1 – 2/mo | $1 – 2/mo | $10–20/yr |
| Backups add-on | $1 – 4/mo | $1 – 4/mo | Weekly included on most plans; daily is the add-on |
| Resend (email) | **$0** | $20/mo | Free = 3,000/mo capped 100/day. Pro = 50,000/mo |
| Firebase Blaze (Auth, Firestore, RTDB presence) | $0 – 25/mo | $60 – 250/mo | Usage-based. Falls as the Postgres migration completes |
| GCS (screenshots — storage + egress) | $2 – 10/mo | $15 – 60/mo | ~100 MB/user/month at one capture per 10 min. **Egress on viewing dominates** |
| Cloudflare | $0 | $0 | Free tier sufficient |
| Uptime monitoring | $0 – 7/mo | $7 – 20/mo | |
| **Monthly total** | **$13 – 48** | **$112 – 379** | |

Note what this table says: **the VPS line does not change between 20 users and 100 users.** At
scale, your hosting bill is Firebase and GCS — both usage-based, both controllable. The server
is a rounding error.

### 3.5 The one real constraint: disk growth

CPU and RAM are solved. Disk is not, and nothing in the codebase currently manages it.

`activity_app_logs` and `activity_url_logs` insert rows with a **30-second default duration**,
per tracked user, continuously during tracked time. There is an `archive:screenshots` script,
but **no equivalent retention or purge for these two tables.**

Rough projection (row plus index overhead ≈ 1 KB, ~2,000 rows/user/working day across both
tables):

| Tracked users | Growth /month | Growth /year | Time to fill KVM 2's usable ~70 GB |
|---:|---:|---:|---:|
| 20 | ~0.9 GB | ~11 GB | ~6 years |
| 50 | ~2.2 GB | ~26 GB | **~2.5 years** |
| 100 | ~4.4 GB | ~53 GB | **~16 months** |

**The fix is a retention policy, not a bigger server.** A scheduled purge or partition-drop on
activity logs older than 90–180 days — mirroring what `archive:screenshots` already does for
images — holds disk flat forever. That is **4–8 hours of work** against a KVM 2→KVM 4 upgrade at
$72–204/year, every year, that would only postpone the same problem.

Add a matching GCS lifecycle rule on the screenshot bucket at the same time. Between them,
these two changes are the difference between a hosting bill that stays at $13–48/month and one
that compounds.

### 3.6 Desktop-agent release channel — the remaining one-time cost

| Item | Cost | Required for |
|---|---:|---|
| Windows code-signing certificate (OV) | $219 – 386/yr | Agent distribution |
| Windows code-signing certificate (EV) | $297 – 507/yr | Immediate SmartScreen reputation — **recommended** |
| HSM / hardware token | $90 – 250 one-time | Now mandatory for code signing |
| Apple Developer Program | $99/yr | Only if a macOS build ships |
| Wiring the certificate into the existing `tauri-action` workflow + clean-VM install test | 6 – 10 hrs | |

Certificate validity dropped to a **460-day maximum** on 1 March 2026 — this now renews roughly
every 15 months rather than every three years.

> **For the client, not the developer:** the certificate must be issued to the **client's**
> business entity, because the client publishes the software. It cannot be bought by the
> developer and transferred. Organisational validation takes 3–10 business days, so start early.
>
> Without it, every installation shows a Windows SmartScreen warning. For a workforce-monitoring
> tool being pushed to employees, that is the most likely cause of a failed rollout and the
> cheapest problem here to prevent.

### 3.7 Ongoing maintenance

| Level | Scope | Hours/mo | Cost/mo @ $60/hr |
|---|---|---:|---:|
| Break-fix only | Security patches, backup verification, incident response | 4 – 6 | $240 – $360 |
| **Standard** *(recommended)* | Above + dependency updates across 7 packages, agent releases, minor fixes | **8 – 12** | **$480 – $720** |
| Active development | Above + ongoing feature work | 20 – 40 | $1,200 – $2,400 |

Standard remains the floor, and the reason is now sharper than before: **auto-deploy on every
commit with no test suite** means every dependency update requires manual regression checking.
Once CI and tests exist (§2.3, §3.2), the break-fix tier becomes genuinely viable and this line
drops by ~$240/month — roughly **$2,900/year**, which pays back the CI work in under a year.

---

## Part 4 — Year-one total cost of ownership

Assumes 50 tracked users, KVM 2, EV code signing, standard maintenance.

| Line | One-time | Year-1 recurring |
|---|---:|---:|
| Delivered software (71% complete), fair value | $36,000 – $58,000 | — |
| Reproducibility, CI and backup work (§3.2) | $1,300 – $2,200 | — |
| Completing the remaining 29% | $21,000 – $38,000 | — |
| Hostinger KVM 2 (promotional) | — | $108 |
| Domain, backups, monitoring | — | $170 – $400 |
| Resend | — | $240 |
| Firebase Blaze + GCS | — | $900 – $3,700 |
| EV code-signing certificate + HSM token | $90 – $250 | $297 – $507 |
| Maintenance retainer (standard) | — | $5,760 – $8,640 |
| **Totals** | **$58,390 – $98,450** | **$7,475 – $13,595** |

**Infrastructure and third-party services alone — no labour — run $1,700 – $4,900 in year one**,
down from my earlier estimate now that KVM 2 is confirmed and no managed database is needed.

---

## Part 5 — Recommendations for the client

**Before paying the balance**

1. **Require the reproducibility work (34–54 hrs, §3.2) as a delivery condition.** The system
   works; the repository cannot rebuild it. Retain 5–8% until a `git clone` plus a documented
   `.env` reproduces production on a throwaway VPS. This is the highest-value, lowest-cost item
   in this entire document.
2. **Get a tested database restore demonstrated, not described.** The database was created by
   hand on the server. Until a `pg_dump` has been restored somewhere and shown to work, you do
   not have a backup — you have a file.

**Before commissioning further work**

3. **Add CI before anything else (8–14 hrs).** Auto-deploy on every commit with one test file
   means there is nothing between a mistake and your users. You already have the hard half —
   continuous deployment — running. Adding the gate is comparatively trivial.
4. **Fund the test suite (160–240 hrs).** It feels like a lot for no visible output. With
   144,255 lines and one test file, it is the highest-return spend available, and it drops your
   maintenance retainer by roughly $2,900/year on its own.
5. **Set the activity-log retention policy (4–8 hrs, §3.5).** Cheapest item here with the
   longest-running payoff. Do it before the disk projection matters, not after.
6. **Finish the Postgres migration before building on top of it.** The 1,632-line compat layer
   is pure carrying cost, and it keeps you paying for two databases.
7. **Price Reports and Financials as new work, not completion.** They are UI shells with no
   backend. Budget 180–260 hours to make them function, whatever they were previously called.

**On infrastructure**

8. **Stay on KVM 2.** Your own measurements prove it. Revisit only when the §3.5 disk projection
   bites — and fix that with retention, not hardware.
9. **Put every third-party account in your own name** — Hostinger, Firebase, GCS, Resend, the
   domain, and especially the code-signing certificate. Pay directly. If the working
   relationship changes, you keep control of your production system and your data.
10. **Start code-signing procurement now.** Validation takes 3–10 business days and the agent
    rollout is blocked without it.

---

## Part 6 — Egyptian market pricing (EGP)

Everything above is restated here at Egyptian market rates. This is the section to use if both
parties are in Egypt and settling in pounds.

### 6.1 Basis

**Exchange rate.** July 2026 traded between **48.71 and 51.50 EGP/USD**, averaging **50.07**,
with the latest quote around **50.70**. This document uses **50.5 EGP/USD** throughout. The
pound moved 5.7% within a single month — §6.5 explains why that matters more than it looks.

**Egyptian rate benchmarks, 2026:**

| Benchmark | Rate |
|---|---|
| Local freelance, all levels | EGP 150 – 800/hr |
| Junior local freelance | EGP 150 – 250/hr |
| Mid-level local freelance | EGP 250 – 450/hr |
| **Senior local freelance** | **EGP 450 – 800/hr** |
| Egyptian senior on international platforms | $22 – 48/hr → **EGP 1,110 – 2,425/hr** |
| Egyptian agency, blended team rate (PM + design + dev + QA) | $20 – 35/hr → **EGP 1,010 – 1,770/hr** |
| Specialist agency, senior talent | $35 – 70/hr → **EGP 1,770 – 3,535/hr** |
| Senior developer salary, local company | EGP 35,000 – 70,000/month |
| Senior developer salary, multinational | EGP 60,000 – 105,000/month |

A salaried senior at EGP 50,000/month costs roughly **EGP 310/hr**. A freelancer needs 2–3× that
to cover no benefits, no job security, gaps between contracts, own equipment and tax — which is
exactly how the EGP 450–800 senior freelance band is derived. It is not a markup; it is the
same person's cost with the employer's subsidy removed.

### 6.2 Value of the delivered work, in EGP

1,738 hours × 71% complete = **1,234 effective delivered hours.**

| Rate basis | EGP/hr | Gross | × 71% complete | **Fair value** |
|---|---:|---:|---:|---:|
| Senior local freelance (low) | 450 | 782,100 | | **EGP 555,000** |
| Senior local freelance (mid) | 550 | 955,900 | | **EGP 679,000** |
| Senior local freelance (upper) | 700 | 1,216,600 | | **EGP 864,000** |
| Senior local freelance (top of band) | 800 | 1,390,400 | | **EGP 987,000** |
| Egyptian agency blended (low) | 1,010 | 1,755,400 | | **EGP 1,246,000** |

**Recommended fair valuation, Egyptian market: EGP 700,000 – 1,200,000.**

The band sits at the **upper end of senior local freelance, edging into agency territory**, and
that is deliberate. This is not typical local freelance work: 3,805 lines of Rust in a
cross-platform desktop agent, a dual-database architecture mid-migration, recursive hierarchy
permissions, and a declarative schema engine sit well above the CRUD-app work that the EGP
450–550 band usually describes.

**Three anchors for sanity:**

| Comparison | EGP |
|---|---:|
| Typical Egyptian **MVP app** build, agency | 150,000 – 400,000 |
| **This system** (144,255 LOC, 7 services, desktop agent) | **700,000 – 1,200,000** |
| Same scope commissioned fresh from a Cairo software house | ~2,000,000 – 4,000,000 |
| Same work bought internationally (the USD band in §2.2) | 1,818,000 – 2,929,000 |

This is roughly **three to five times an MVP-tier project** — which is correct, because it is
not an MVP. And note the last row: **the identical work sold to an international client is worth
about 2.5× the Egyptian domestic price.** That gap is a market fact, not a negotiating position,
and both parties should price with their eyes open about it. For the client it means the local
figure is genuinely good value. It also means retention is a real consideration — a developer
who can bill EGP 1,110–2,425/hr abroad has an obvious alternative to EGP 700/hr at home.

### 6.3 Remaining work, in EGP

At EGP 500–700/hr for senior local freelance:

| Item | Hours | EGP |
|---|---:|---:|
| Reproducibility, CI and backups (§3.2) | 34 – 54 | **20,000 – 38,000** |
| Test suite | 160 – 240 | 80,000 – 168,000 |
| Wire Reports to backend | 100 – 140 | 50,000 – 98,000 |
| Wire Financials | 80 – 120 | 40,000 – 84,000 |
| Complete Postgres cutover | 80 – 120 | 40,000 – 84,000 |
| Timesheets + approvals | 60 – 80 | 30,000 – 56,000 |
| Wire Settings | 50 – 70 | 25,000 – 49,000 |
| Security review & hardening | 40 – 60 | 20,000 – 42,000 |
| Observability | 30 – 45 | 15,000 – 31,500 |
| Activity-log retention policy (§3.5) | 4 – 8 | **2,000 – 5,600** |
| **Total to reach 100%** | **655 – 960** | **EGP 330,000 – 670,000** |

**Maintenance retainer:** 8–12 hrs/month at EGP 600–700 = **EGP 4,800 – 8,400/month**
(EGP 57,600 – 100,800/year).

### 6.4 Hosting in EGP — and why it does not behave like the rest

| Item | USD | **EGP** |
|---|---:|---:|
| Hostinger KVM 2, promotional | $8.99/mo | **454/mo** |
| Hostinger KVM 2, renewal | ~$23/mo | **~1,162/mo** |
| Total infrastructure, current scale | $13 – 48/mo | **656 – 2,424/mo** |
| Total infrastructure, at 50–100 users | $112 – 379/mo | **5,656 – 19,140/mo** |
| **Year-one infrastructure, all-in** | **$1,700 – 4,900** | **EGP 86,000 – 247,000** |
| EV code-signing certificate | $297 – 507/yr | **15,000 – 25,600/yr** |
| HSM token (one-time) | $90 – 250 | **4,500 – 12,600** |

**Every line in this table is USD-denominated and paid by international card.** Hostinger,
Firebase, Google Cloud Storage, Resend, the domain registrar, and the code-signing CA all bill
in dollars. None of them reprice when the pound moves. That makes infrastructure structurally
different from labour: **the developer's rate is an EGP cost, the servers are a USD cost.**

**FX sensitivity on year-one infrastructure** (mid-case $3,300):

| Scenario | Rate | Year-1 infra |
|---|---:|---:|
| Today | 50.5 | EGP 166,650 |
| Pound weakens 10% | 55.6 | EGP 183,300 |
| Pound weakens 20% | 60.6 | EGP 200,000 |
| Pound weakens 30% | 65.7 | EGP 216,600 |

Usage identical in every row. The bill rises purely on currency. Given that the pound moved 5.7%
in July 2026 alone, budgeting these lines at today's rate and not revisiting them is a mistake.

**The hedge is available and it is also the cheapest option.** Hostinger's promotional pricing
requires a 24–48 month prepayment in USD — which is normally a drawback, but here it does two
useful things at once:

| Approach | 48-month cost |
|---|---:|
| Prepay 48 months at $8.99/mo | $432 → **EGP 21,800 locked today** |
| Pay monthly at renewal rate $23/mo | $1,104 → **EGP 55,800 at today's rate, more if the pound slides** |

Prepaying saves about **60% in dollar terms and fixes the EGP cost at today's rate for four
years.** For an Egyptian buyer this is close to a free hedge on the single largest fixed
infrastructure line. Do the same on the domain (multi-year registration) where possible.

The costs that *cannot* be hedged this way — Firebase and GCS — are usage-based, and §3.5 is
therefore doing double duty: the activity-log retention policy and the screenshot lifecycle rule
control your only FX-exposed variable spend. **EGP 2,000–5,600 of work to cap a bill that would
otherwise compound in a depreciating currency** is the best-value item in this entire document.

### 6.5 Tax and settlement

Two items to confirm with an accountant rather than take from this document:

- **VAT.** Egypt's standard VAT rate is 14%. If the developer is VAT-registered, professional
  services are typically within scope — on a EGP 1,000,000 engagement that is EGP 140,000 the
  client should have budgeted, not discovered at invoice. Establish the developer's registration
  status and whether quoted figures are VAT-inclusive **before** agreeing a number.
- **E-invoicing.** Egypt operates a mandatory electronic invoicing system for registered
  businesses. If the client needs a compliant tax invoice to expense this, the developer's
  registration status determines whether that is possible at all.

Also practical: Egyptian cards frequently carry international transaction limits that can block
or throttle USD subscription payments. Confirm the payment card can sustain the recurring
charges — and especially a one-off 48-month prepayment — before relying on the hedge in §6.4.

### 6.6 Year-one total, in EGP

50 tracked users, KVM 2 on prepaid promotional pricing, EV code signing, standard maintenance.

| Line | One-time (EGP) | Year-1 recurring (EGP) |
|---|---:|---:|
| Delivered software (71% complete), fair value | **700,000 – 1,200,000** | — |
| Reproducibility, CI and backup work (§3.2) | 20,000 – 38,000 | — |
| Completing the remaining 29% | 330,000 – 670,000 | — |
| Hostinger KVM 2 (prepaid promotional) | — | 5,450 |
| Domain, backups, monitoring | — | 8,600 – 20,200 |
| Resend | — | 12,100 |
| Firebase Blaze + GCS | — | 45,450 – 186,850 |
| EV code-signing certificate | — | 15,000 – 25,600 |
| HSM token | 4,500 – 12,600 | — |
| Maintenance retainer (standard) | — | 57,600 – 100,800 |
| **Totals** | **EGP 1,054,500 – 1,920,600** | **EGP 144,200 – 351,000** |

**Infrastructure and third-party services alone — no labour of any kind — run
EGP 86,000 – 247,000 in year one, and every pound of it is exposed to the dollar.**

### 6.7 What changes when you price in EGP

1. **The software gets cheaper; the servers do not.** Labour reprices to the local market —
   roughly 40% of the international figure. Infrastructure does not reprice at all. In USD terms
   hosting was a rounding error against development cost; in EGP terms, year-one infrastructure
   at EGP 86,000–247,000 is **12–20% of the entire delivered software value.** It deserves
   proportionally more of your attention than it would in a dollar budget.

2. **Prepay the VPS and the domain.** ~60% dollar saving and a four-year FX lock, in one
   decision. Confirm the card limit first.

3. **Do the retention work early (EGP 2,000–5,600).** Firebase and GCS are the only
   infrastructure lines that both grow with usage *and* float with the dollar. Capping them is
   the highest-leverage small spend available.

4. **Settle the VAT question before agreeing a number**, not after. On this size of engagement
   it is a EGP 100,000+ swing.

5. **Understand the retention risk without over-reacting to it.** EGP 700,000–1,200,000 is a
   fair domestic price and the client should not pay more than the local market. But the same
   work sells internationally for ~2.5×, so if this system needs years of ongoing development,
   a maintenance retainer at a competitive local rate is cheaper than the disruption of finding
   someone new to learn 144,255 lines. The EGP 4,800–8,400/month retainer is the cheap
   insurance line in this document, not the expensive one.

---

## Sources

Pricing verified July 2026. Production resource figures supplied by the client from the live
Hostinger deployment. Exchange rate 50.5 EGP/USD.

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
