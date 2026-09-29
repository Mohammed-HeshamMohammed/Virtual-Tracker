# Authentication Email Codes and Authenticator-App MFA Plan

**Repository:** Virtual Tracker  
**Created:** 2026-09-27  
**Updated:** 2026-09-28  
**Status:** **NOT STARTED — implementation plan only.** The repository has reusable authentication, REST, PostgreSQL, Redis, notification, and browser-link foundations, but no self-hosted TOTP/assurance implementation has been completed by this document. Sections 26–27 and the final completion table are authoritative for current status.  
**Primary systems:** `Dashboard-Web`, `Landing-Web`, `Virtual-Tracker-Web-Backend` gateway, `Dashboard-Backend`, `Auth-Backend`, `Notify-backend`, `Tauri-App-Extension`, existing Firebase Authentication, self-hosted RFC 6238 TOTP  
**Product name / TOTP issuer:** `My Virtual Tracker`  
**Hard cost constraint:** Do not require Firebase Authentication with Identity Platform, Google Cloud MFA, or another paid MFA service. TOTP verification and MFA session enforcement run inside Virtual Tracker.
**Confirmed production baseline:** Keep the eight running Coolify resources documented in Section 7; MFA v1 does not require a ninth resource.

## 0. Executive decision

Build two related capabilities, but do not treat them as the same security factor:

1. **Email code challenges** provide email ownership confirmation, account recovery confirmation, and optional low-assurance login/device verification. They use Virtual Tracker's existing notification pipeline. They are useful, but they are **not** described or counted as two-factor authentication.
2. **Authenticator-app MFA** is implemented by Virtual Tracker using the open RFC 6238 TOTP standard. It works with Google Authenticator, Microsoft Authenticator, 1Password, Authy, and other applications that support standard `otpauth://` TOTP entries. Firebase remains the primary identity provider, but it does not store or verify the second factor.

This distinction is intentional. NIST SP 800-63B says email must not be used as an out-of-band authenticator. Email codes can still verify an email address or approve a recovery workflow, but an organization setting named **Require two-factor authentication** must require an enrolled TOTP factor (and later a phishing-resistant factor such as a passkey/security key), never only an email code.

The recommended delivery order is:

1. Harden and generalize the existing email challenge and mail-delivery code.
2. Add encrypted TOTP-factor storage, key rotation, backup/recovery codes, and RFC test-vector coverage to `Dashboard-Backend`.
3. Add a Virtual Tracker assurance session that is issued only after the primary Firebase credential and, when required, the TOTP both succeed.
4. Ship optional self-service TOTP enrollment and TOTP sign-in on the web.
5. Repair the desktop-agent/browser linking path so a Firebase ID token alone cannot bypass MFA.
6. Add server-enforced organization MFA policy with a staged enrollment grace period.
7. Add recovery administration, session visibility, audit, and production rollout controls.

## 1. Terminology

| Term | Meaning in this plan |
|---|---|
| Email code | A short-lived, single-use numeric code delivered to the verified email address. It proves access to that mailbox at that moment. |
| TOTP | A time-based one-time password generated from a shared secret, normally six digits every 30 seconds. |
| MFA / 2FA | A primary Firebase sign-in followed by successful verification of an enrolled Virtual Tracker TOTP factor. Email alone does not qualify. |
| Enrollment | Adding an authenticator app to a signed-in Firebase user after recent reauthentication. |
| Step-up | Requiring fresh authentication before a sensitive action even though the user already has a session. |
| Recovery | Regaining access when the enrolled authenticator is unavailable. Recovery is not an ordinary sign-in path. |
| Issuer | The service name placed in the `otpauth://` URI so authenticator apps can distinguish the entry. Use `My Virtual Tracker`. |
| Authentication context | Server-derived information about a sign-in: provider, web/desktop source, browser family, OS family, IP, time, and optionally coarse location. |

## 2. Current implementation audit

### 2.1 Existing components that should be reused

The repository already has most of the supporting structure:

- `Auth-Backend` owns Firebase web configuration, password policy, token verification, sign-in-method resolution, and the desktop Google OAuth callback.
- The application already uses REST-style JSON APIs extensively: Auth-Backend exposes `/api/auth/*`, Dashboard-Backend dispatches protected `/api/*` and `/api/v1/*` modules, Landing-Backend exposes contact/download/session proxy routes, and Notify-backend exposes internal `/api/notify/*` routes. MFA must extend this API architecture rather than introduce frontend-only logic or direct database access.
- `Dashboard-Web` signs in directly with the Firebase Web SDK and then calls `POST /api/auth/session-bootstrap`.
- `Dashboard-Backend/src/http/auth-middleware.js` is the central API authorization chokepoint for bearer-token requests.
- `Dashboard-Backend/src/modules/auth/session-bootstrap.js` is the first application authorization check after a successful Firebase sign-in.
- `Dashboard-Backend/src/modules/auth/session-cookie-routes.js` creates the shared `vt_session` cookie used by the landing/application surfaces.
- `Notify-backend` is an internal-only mail service protected by `INTERNAL_SERVICE_SECRET`; browser clients do not receive SMTP credentials.
- `Dashboard-Backend/src/lib/notify/email-client.js` is the existing Dashboard-to-Notify adapter.
- `Notify-backend/src/modules/email/routes.js` allowlists templates and logs delivery results.
- `Notify-backend/src/modules/email/email-builders.js` already contains branded HTML/text templates.
- `Dashboard-Backend/src/modules/customer-accounts/verification-code.service.js` already demonstrates a secure six-digit code pattern: `crypto.randomInt`, per-code random salt, `scrypt`, constant-time comparison, expiration, attempt limits, and one-time consumption.
- `Dashboard-Web/features/settings/components/organization/sections/security-login.tsx` and `Dashboard-Web/features/settings/components/enterprise-security/enterprise-security-page.tsx` already show 2FA controls, but they are currently local demo state and do not enforce anything.
- `Dashboard-Backend/src/modules/auth/security-login-alerts.js` already detects a changed IP or user-agent and sends a new-sign-in email.
- `Tauri-App-Extension` already has browser linking and encrypted device/session storage, which can carry an explicit “MFA verified” device authorization after the web flow completes.

### 2.2 Gaps that block a correct MFA release

1. **No self-hosted TOTP factor store exists.** Virtual Tracker needs encrypted, versioned TOTP-secret storage and a reviewed RFC 6238 implementation.
2. **No MFA assurance session exists.** The API currently accepts a valid Firebase bearer token as sufficient proof. Without a second, server-enforced assurance session, a caller could bypass any TOTP screen and call the API directly.
3. **The settings pages are not connected.** Their toggles are local React state and cannot be used as policy evidence.
4. **Organization policy is not server-enforced.** A client-only “Required” setting would be bypassable by calling the API directly.
5. **The desktop Google callback completes on primary authentication alone.** Once self-hosted MFA is required, a Firebase ID token must not be enough to register/link a new agent device.
6. **The desktop device reauthentication path needs an explicit policy.** A Firebase custom token proves the primary identity, not a fresh TOTP. Existing registered agent devices should not silently become a route around a newly required second factor.
7. **The existing email-code service is purpose-specific.** The `verification_codes` table and Customer Accounts service can be generalized, but authentication challenges need better concurrency, idempotency, cleanup, privacy-safe responses, and delivery state.
8. **Notify-backend's current cooldown can suppress codes.** An unrecognized email template uses the five-minute default cooldown. Authentication resend behavior needs an explicit cooldown and idempotency model so the UI does not claim that a fresh code was sent when Notify skipped it.
9. **No recovery process is defined.** The self-hosted design must generate one-time recovery codes and retain an admin-assisted path before mandatory enforcement.
10. **No reliable third-party authenticator icon contract exists.** Standard `otpauth://` data carries an issuer and account label, not a portable icon URL.
11. **The web surfaces do not yet share a complete assurance state machine.** `Dashboard-Web` and `Landing-Web` each perform Firebase sign-in/bootstrap work, and Landing-Web currently synchronizes the shared session cookie after its own success path. Both surfaces must handle the same `MFA_REQUIRED`, enrollment, grace, recovery, and assurance results before any shared cookie, custom-token exchange, account area, or protected API becomes available.

## 3. Problem statement

Virtual Tracker currently relies on a primary Firebase credential and email verification, but users and organizations cannot protect accounts with an authenticator app. The product also has several separate email-verification or unlock flows without a general authentication challenge contract. This leaves privileged accounts with weaker protection, makes organization-level 2FA controls misleading, and creates inconsistent email-code behavior.

The feature must add a secure, understandable authentication layer without creating a second identity store, exposing SMTP or TOTP secrets to backend logs, breaking the desktop agent, or claiming guarantees that Google Authenticator and Microsoft Authenticator do not provide.

## 4. Goals

1. Allow an eligible, email-verified user to enroll at least one standard TOTP authenticator and use it on subsequent sign-ins.
2. Provide a reusable email-code service for email ownership and approved recovery/step-up workflows with one-time use, expiry, throttling, and auditable delivery.
3. Make an organization “Require 2FA” policy real and server-enforced for selected role groups.
4. Preserve email/password, Google, Apple, email-link, web, and desktop-agent sign-in behavior while making MFA-required states explicit.
5. Give users clear authentication context—service identity, source application, browser/OS, time, and IP—without trusting client-supplied branding or leaking unnecessary location data.
6. Provide a recoverable and supportable path before mandatory MFA is enabled.
7. Apply one global authentication-assurance contract across Dashboard-Web, Landing-Web sign-in/account/invite flows, the public Web Backend gateway, protected APIs, cross-domain session exchange, and desktop browser linking. A user must not gain a weaker assurance path by choosing another Virtual Tracker surface.

### 4.1 User stories

- As a user, I want to scan one standard QR code with Google Authenticator or Microsoft Authenticator so that I can protect my account without paying for or connecting a Google/Microsoft business service.
- As a user without camera access, I want a manual setup key so that I can enroll the same factor accessibly.
- As a user, I want one-time recovery codes so that losing my authenticator device does not permanently lock me out.
- As an organization owner, I want MFA requirements enforced by the API for selected roles so that users cannot bypass the setting with direct requests or an older desktop agent.
- As a desktop-agent user, I want browser MFA and re-linking to preserve captured offline work so that stronger security does not lose time-tracking data.
- As a support/security administrator, I want an audited recovery workflow so that I can restore access without learning or recreating a user's TOTP secret.
- As an operator, I want encryption-key health, rotation, backup, and restore procedures so that self-hosting does not turn one lost environment variable into a tenant-wide lockout.

## 5. Non-goals for v1

1. **Email as compliant MFA.** Email codes may be offered as email verification or low-assurance confirmation, but they do not satisfy the “Require 2FA” policy.
2. **Guaranteed logo display inside Google Authenticator or Microsoft Authenticator.** The TOTP standard has no portable icon field. We guarantee the issuer/account label and branding in Virtual Tracker's UI and emails only.
3. **SMS MFA.** It adds cost, abuse, phone-number privacy, and SIM-swap risk. The factor model may leave room for another self-hosted or standards-based factor later.
4. **Passkeys/WebAuthn in this release.** The policy model should support `totp` and future `webauthn`, but passkeys are a separate implementation.
5. **Exact IP geolocation.** v1 shows IP and device/browser context. Country/region is optional later, requires a privacy review, and must never be presented as exact physical location.
6. **Writing the TOTP cryptographic algorithm from scratch.** Use a maintained RFC 6238 library and verify it against the RFC test vectors. Virtual Tracker still owns encryption, factor lifecycle, replay prevention, rate limits, and session enforcement.
7. **Replacing Firebase Authentication.** Firebase remains the primary identity provider and token issuer; the self-hosted layer adds the second factor and final application authorization.

## 6. Security and product decisions

### 6.1 Assurance matrix

| Method | Allowed purpose | Satisfies required 2FA? | Notes |
|---|---|---:|---|
| Verified email link | Primary/passwordless sign-in, email ownership | No | Existing Firebase-supported flow. |
| Six-digit email code | Email ownership, recovery approval, optional new-device confirmation | No | Never label as MFA/2FA. |
| Password only | Primary sign-in where policy permits | No | Existing Firebase provider. |
| Google/Apple only | Primary federated sign-in where policy permits | No | The IdP may use its own MFA, but Virtual Tracker must not assume or assert it unless reliable claims are available and policy explicitly supports federation assurance. |
| Password/Google/Apple + Virtual Tracker TOTP | Full MFA sign-in | Yes | v1 supported second factor, verified on `Dashboard-Backend`. |
| Existing registered desktop device credential | Silent agent session recovery only | No new interactive assurance | Must not enroll/remove MFA or satisfy a fresh step-up. |
| Admin-assisted TOTP reset | Recovery administration | No | Removes factors only after a controlled support process; revokes sessions and sends alerts. |

### 6.2 TOTP configuration

- Use the maintained MIT-licensed `otplib` package in `Dashboard-Backend`, pinned to an exact reviewed version. At the time of this plan, the current package is 13.5.0; re-run dependency/license/security review before installation.
- Use the library's RFC 6238-compatible defaults for the widest authenticator compatibility: Base32 unpadded secret, HMAC-SHA-1, six digits, 30-second period.
- Accept the current time step and at most one adjacent step after real-device testing. Never widen the window merely for convenience.
- Store the matched time-step counter and reject a second successful use of the same or an older counter. RFC 6238 requires a verifier not to accept the same OTP twice after successful validation.
- Generate a separate cryptographically random secret for every factor. A user with two authenticators has two independently revocable factors rather than one secret copied twice.
- Generate and validate TOTP only in `Dashboard-Backend`. `Auth-Backend`, `Dashboard-Web`, Notify, and Tauri never receive the stored secret after enrollment finishes.
- Never log the secret, QR payload, full `otpauth://` URI, submitted TOTP, recovery material, or assurance token.
- Require a verified Firebase email before enrollment.
- Require recent reauthentication before enrollment, rename, or removal.

### 6.3 TOTP secret encryption and key ownership

Unlike an email code, a TOTP secret cannot be one-way hashed because the server must reproduce the expected code. Protect it with envelope-style authenticated encryption:

- Encrypt every Base32 secret with Node's `crypto` AES-256-GCM using a fresh 96-bit nonce.
- Bind ciphertext to `firebase_uid`, factor ID, algorithm, digits, and period as authenticated additional data so rows cannot be swapped between accounts.
- Store `ciphertext`, `nonce`, authentication tag, and `key_version` in Postgres. Never store the plaintext secret after the request completes.
- Keep the 32-byte master key ring outside the database and repository, supplied to the backend as production secrets such as `TOTP_MASTER_KEYS` plus `TOTP_ACTIVE_KEY_ID`.
- Maintain at least the active and previous key during rotation. New writes use the active key; successful reads can be re-encrypted lazily or by a controlled rotation job.
- Back up the key ring offline and test restoration. Losing all key copies permanently locks out every enrolled user; leaking the key together with the database exposes all TOTP factors.
- Restrict environment-secret access to the Dashboard backend process and production operators. Never expose it to frontend builds, Notify, Auth-Backend, CI logs, or diagnostic bundles.
- Fail startup/readiness when MFA enforcement is enabled but the active encryption key is missing or malformed.

This is zero-license-cost infrastructure, not zero responsibility: the application operator now owns encryption-key backup, rotation, incident response, clock accuracy, and factor recovery.

### 6.4 Email-code configuration

Initial defaults, configurable only server-side:

| Control | Default |
|---|---:|
| Code length | 6 numeric digits |
| Lifetime | 10 minutes |
| Resend cooldown | 60 seconds |
| Requests per UID/email | 3 per 15 minutes |
| Requests per IP | 10 per 15 minutes, with proxy trust configured correctly |
| Wrong attempts | 5 per issued code |
| Active codes | One per UID + purpose; a resend invalidates the earlier code |
| Successful use | Atomic, one time |
| Stored secret | Salted slow hash only; plaintext is never stored |
| Retention | Delete challenge secret material after 24 hours; retain a metadata-only audit event per policy |

### 6.5 Account enumeration

- Public “request code,” email-link, reset, and recovery initiation endpoints return the same user-facing response whether the account exists or not.
- Authenticated flows may explain a delivery configuration problem because the account identity is already known.
- Logs and metrics use Firebase UID or an HMAC/pseudonymous email key, not a raw email label.
- Do not add email addresses, codes, tokens, QR data, or TOTP secrets to analytics events.

### 6.6 Cost model

The selected MFA design has no required paid Google service:

- Firebase continues only in its existing primary-auth role; this plan does not enable Identity Platform or Google's paid MFA feature.
- RFC 6238 is an open standard.
- Google Authenticator and Microsoft Authenticator generate the six-digit codes locally from the shared standard secret. Virtual Tracker does not call a Google or Microsoft MFA API and does not need their enterprise authentication subscriptions.
- `otplib` and `qrcode` are open-source packages; pin versions and confirm their licenses during dependency review.
- Encryption uses Node's built-in `crypto`.
- Factor, challenge, recovery, and assurance data use the existing `virtual-tracker-SQL-db` PostgreSQL deployment. Apply additive migrations to that resource; do not create an MFA-specific database container.
- The existing `Virtual-Tracker-RealTime-db` Redis resource remains available for cross-instance throttling, cache invalidation, and the application's existing real-time workload. PostgreSQL remains authoritative for MFA factors, challenge consumption, replay prevention, assurance sessions, policy, recovery, and audit.
- Email uses the existing `Notify-backend` SMTP interface and can use the organization's current or self-hosted relay.

Expected incremental infrastructure cost can therefore be zero on the current VPS if capacity is sufficient. The real cost is operational: engineering review, secure secret backup, key rotation, server/clock monitoring, SMTP deliverability, incident response, and support for locked-out users. Do not describe self-hosting as “free security”; describe it as “no additional paid authentication vendor.”

## 7. Proposed architecture

### 7.1 Confirmed eight-resource Coolify baseline

The production screenshot and current repository deployment documentation identify eight running Coolify resources. These are the deployment baseline for this plan. Do not add a ninth container merely to support email codes or authenticator-app TOTP.

| Coolify resource | Type / public domain | Repository responsibility | MFA/email-code responsibility | Required change |
|---|---|---|---|---|
| `virtual-tracker-auth` | Application — `auth.myvirtualtracker.com` | `Auth-Backend`; Firebase configuration, primary-token utilities, password policy, desktop OAuth/link entry | Continue primary authentication and existing link routing only. It must not receive stored TOTP secrets, submitted TOTP codes, the TOTP master key ring, SMTP credentials, or organization-MFA policy ownership. | Update the desktop/link hand-off so primary authentication cannot finalize a protected link before Dashboard-Backend grants the required assurance. |
| `Virtual-Tracker-Dashboard-Backend` | Application — `appapi.myvirtualtracker.com` | `Dashboard-Backend`; authoritative application API and policy enforcement | Own email-challenge state, encrypted TOTP factors, recovery-code hashes, assurance sessions, policy evaluation, audit, and TOTP verification. This is the only application that receives the TOTP key ring. | Deploy the new modules/migrations, add validated secret variables and feature flags, connect to existing PostgreSQL/Redis/Notify internal endpoints, and add readiness checks. |
| `Virtual-Tracker-Dashboard-Web` | Application — `app.myvirtualtracker.com` | `Dashboard-Web`; authenticated web UI | Render enrollment, local QR, manual-key, challenge, recovery, factor-management, policy, and safe sign-in-context screens. It never stores production secrets or makes security decisions. | Deploy UI/routes and public API-origin build variables only. Do not add server secrets to `NEXT_PUBLIC_*` variables. |
| `Virtual-Tracker-Landing-Web` | Application — `myvirtualtracker.com` | `Landing-Web`; public/marketing plus sign-in/account/invite entry surfaces | Participate in the same global bootstrap and render the same required TOTP/recovery states for protected flows. Public content remains public. It must not verify TOTP server-side or hold authoritative MFA state. | Update its existing sign-in/bootstrap/session-cookie flow, add the shared assurance state contract and challenge UI, and delay protected access/shared-session sync until `ready`. |
| `virtual-tracker-notification` | Application — `notify.myvirtualtracker.com` | `Notify-backend`; SMTP/push/SMS dispatch | Render and send allowlisted verification, recovery, sign-in-alert, factor-change, and policy emails. It receives plaintext email codes only for the single internal delivery call and never verifies them. | Add templates, delivery idempotency, explicit auth-code cooldowns, safe delivery status, and SMTP readiness. Keep access internal even if a diagnostic domain exists. |
| `Virtual-Tracker-RealTime-db` | Database — Redis, no public domain | Existing presence/pub-sub and real-time store | Optional accelerator for distributed rate limits, short-lived counters, and policy-cache invalidation. It is not the source of truth and an eviction/restart must not reset consumed challenges or permit TOTP replay. | Reuse the existing `REDIS_URL`; add no second Redis-compatible resource. Define fail-safe behavior for each MFA-related Redis use. |
| `virtual-tracker-SQL-db` | Database — PostgreSQL, no public domain | Existing relational production store | Authoritative durable store for challenges, encrypted factors, recovery-code hashes, assurance-session hashes, organization policy, and security audit metadata. | Apply additive migrations in the existing database. Prefer a dedicated schema and least-privilege role/grants where practical; do not expose a public database port. |
| `Virtual-Tracker-Web-Backend` | Application — `api.myvirtualtracker.com` | Existing public Web/API gateway | Route the public MFA/email-challenge endpoints to Dashboard-Backend without becoming a second verifier. Preserve cookies and trusted proxy context. It must not hold the TOTP key ring or SMTP credentials. | Add/verify route forwarding, request-size/time limits, `Set-Cookie`/`Cookie`, CORS/origin behavior, `X-Forwarded-Proto`, and trusted client-IP handling for the new endpoints. |

The Tauri desktop agent is shipped software, not a ninth always-running Coolify resource. It participates through the browser-link and Dashboard-Backend flows described later in this plan.

### 7.2 Coolify database and service catalogue decision

An item appearing in Coolify's deployable catalogue does not make it a dependency. The approved v1 target is the eight-resource baseline above.

#### Database catalogue

| Catalogue option | Decision for this plan | Reason |
|---|---|---|
| PostgreSQL | **Reuse the existing `virtual-tracker-SQL-db`; required** | The codebase already uses PostgreSQL, and MFA requires transactional, durable, auditable state. |
| Redis | **Reuse the existing `Virtual-Tracker-RealTime-db`; optional for MFA, already required elsewhere** | Useful for distributed counters/cache invalidation, but it must not become authoritative MFA storage. |
| KeyDB or Dragonfly | **Do not deploy alongside Redis** | They are alternative cache/data-store choices, not additional MFA components. Any future Redis replacement requires its own compatibility, persistence, failure, and load testing. |
| MySQL or MariaDB | **Do not deploy** | Adding a second relational engine creates migrations, backups, credentials, and operational complexity with no MFA benefit. |
| MongoDB | **Do not deploy** | The MFA data is relational and transactional and already belongs in PostgreSQL. |
| ClickHouse | **Do not deploy for MFA** | Security events may later be exported to analytics, but authentication enforcement and audit truth must remain in PostgreSQL. |

#### Potentially related service catalogue entries

| Category / catalogue entries | Decision | Boundary |
|---|---|---|
| Identity replacements: Authentik, Keycloak / Keycloak With Postgres, Logto, Pocket ID / Pocket ID With PostgreSQL, SuperTokens with MySQL/PostgreSQL, Appwrite, Supabase | **Do not deploy for this plan** | These represent an identity-platform replacement or major re-platforming decision. They are not needed to add self-hosted TOTP around the existing Firebase primary identity. Reconsider only through a separate architecture decision and migration plan. |
| Secret managers: Infisical or Vault | **Optional later; choose at most one** | Coolify secret environment variables plus an offline encrypted recovery copy are sufficient for v1. A secret manager becomes valuable only after its authentication, availability, unseal/recovery, backup, least-privilege, and key-rotation procedures are designed. Do not add it casually to the sign-in critical path. Vaultwarden and Passbolt are user password managers, not automatic substitutes for application-runtime secret injection. |
| SMTP testing: Mailpit | **Allowed in local/staging only** | It captures/intercepts test mail. Production MFA and recovery messages must never be routed to Mailpit. Do not place real customer addresses or production secrets in the test instance. |
| Production mail: the existing SMTP provider; optionally Stalwart after a separate mail-operations review | **Keep the current relay for v1** | `virtual-tracker-notification` is the application boundary regardless of SMTP provider. Self-hosting Stalwart is possible, but requires separate DNS, reverse-DNS, SPF, DKIM, DMARC, TLS, queue, bounce, reputation, abuse, backup, and monitoring work. Plunk or Usesend may be evaluated separately but are not assumed to be drop-in production dependencies. Listmonk is not the MFA transaction engine. |
| Availability checks: Uptime Kuma, Healthchecks, Checkmate, or Statusnook | **The capability is required; a new service is optional if equivalent monitoring already exists** | Monitor public health and synthetic sign-in bootstrap plus private readiness without submitting real credentials or TOTP codes. Choose one approach, configure an owned alert destination and escalation path, and keep it outside the authentication trust decision. |
| Host/container monitoring: Beszel/Beszel Agent or the existing Coolify host telemetry | **Required capability; use the lightest existing option** | Alert on CPU, memory, disk/inode pressure, restart loops, unhealthy containers, PostgreSQL/Redis capacity, certificate expiry, and clock drift. Monitoring failure must not bypass authentication. |
| Logs/traces/errors: SigNoz or OpenObserve for a broader telemetry stack; GlitchTip or Bugsink for exception tracking; Dozzle for short-lived inspection; Grafana only with a defined data source | **Optional self-hosted tooling; choose the smallest non-duplicative stack** | Structured metrics/logs/traces must be emitted by the eight resources whether or not an extra UI is deployed. Authentication telemetry must be redacted before export; never use email, IP, UID, challenge ID, TOTP, recovery material, cookies, or encryption-key data as metric labels. |
| Object/file storage: existing S3-compatible storage or, after a separate review, Garage/SeaweedFS | **Not required for MFA v1** | TOTP QR images and issuer icons are generated/served from memory or bundled static assets and are never uploaded to object storage. If the wider product later accepts files, use a separate private bucket/service and the controls in Section 26.7.8; do not store uploads in application-container filesystems or PostgreSQL blobs by default. |
| Database operations: PgBackWeb, Databasus, PgAdmin, CloudBeaver, Redis Insight, or Drizzle Gateway | **Optional administration/backup tooling** | These do not implement MFA. Any admin UI must be private and strongly protected. A PostgreSQL backup is incomplete for MFA unless the matching offline TOTP key-ring version is also recoverable. Redis backup is not authoritative for MFA. |
| Workflow/queue platforms: Activepieces, N8N variants, Windmill, Inngest, Hatchet, Trigger, or RabbitMQ | **Not required for v1** | Keep authentication challenge issuance/consumption and security mail hand-off in reviewed application code. A future outbox/worker design may use a queue, but workflow automation must never decide MFA assurance. |
| Network/tunnel tools: Cloudflared, Cloudflare DDNS, Tailscale Client, Netbird Client, Newt Pangolin, or WireGuard Easy | **Not required by MFA** | They may solve separate administration/connectivity needs. They do not replace application authorization, TLS, trusted-proxy configuration, or Coolify internal networking. |
| Captcha/abuse tools such as Cap Captcha | **Optional P1 defense-in-depth** | A captcha may be added to genuinely public recovery/code-request surfaces after an abuse and accessibility review. It never replaces generic responses, server-side throttling, expiry, attempt limits, or audit. |
| Every other catalogue service supplied with this request | **Unrelated; do not deploy for this feature** | Collaboration, CMS, media, AI, finance, monitoring, storage, and line-of-business templates do not participate in the MFA trust boundary. Adding them would increase attack surface and VPS resource pressure without meeting an acceptance criterion. |

Before adding any optional service, record an architecture decision with owner, purpose, resource budget, data classification, network exposure, authentication method, backup/restore, update cadence, monitoring, failure behavior, and removal plan. Optional services must not delay the eight-resource MFA implementation.

### 7.3 Coolify networking and secret placement

The eight entries are separate Coolify resources. A shared project/environment name is not itself network connectivity. Put only the required callers and dependencies on the same Coolify destination/predefined network, use each resource's generated **internal URL/hostname and internal port**, and verify DNS plus an application-level health request from the calling container. Inside a container, `localhost` means that same container; it must not be used to reach PostgreSQL, Redis, Notify, Auth, or Dashboard-Backend in another resource.

Do not publish PostgreSQL or Redis ports and do not assign them public domains. Public domains remain on the application/gateway resources that actually need browser or agent ingress. Prefer private URLs for server-to-server calls even when a public domain exists.

| Resource | Required production configuration for this feature |
|---|---|
| `Virtual-Tracker-Dashboard-Backend` | Existing internal `POSTGRES_URL`, existing internal `REDIS_URL`, internal `NOTIFY_BACKEND_URL`, the shared `INTERNAL_SERVICE_SECRET`, Firebase Admin configuration, and the new validated MFA secrets/flags below. |
| `virtual-tracker-notification` | The same `INTERNAL_SERVICE_SECRET`, a restricted PostgreSQL connection if delivery logging is enabled, and production `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`. |
| `Virtual-Tracker-Web-Backend` | Internal upstreams for Auth-Backend and Dashboard-Backend; forwarding rules for MFA/challenge/session routes; correct proxy headers and credentialed-cookie behavior. |
| `virtual-tracker-auth` | Existing Firebase/OAuth configuration and Dashboard-Web/Dashboard-Backend callback targets only; no TOTP or SMTP secrets. |
| `Virtual-Tracker-Dashboard-Web` and `Virtual-Tracker-Landing-Web` | Public build-time origins only. No master keys, internal service secret, SMTP credentials, database URLs, or Redis URLs. |
| PostgreSQL and Redis resources | Persistent volume/backup/resource limits and internal connectivity only. MFA continues safely only when PostgreSQL is healthy; Redis degradation follows explicitly tested fail-safe behavior. |

Proposed Dashboard-Backend variables must be added to `src/config/env-schema.js`, `src/config/env.js`, `.env.example`, readiness checks, deployment documentation, and tests before production configuration is entered:

```env
# Key-ring serialization must be specified and validated in implementation.
TOTP_MASTER_KEYS=<secret key ring containing versioned 32-byte AES keys>
TOTP_ACTIVE_KEY_ID=v1

# Separate keyed hashing secret; do not reuse a TOTP encryption key.
AUTH_CHALLENGE_HMAC_KEY=<independent random secret>

# Separate key ring for short-lived encrypted email-outbox payloads.
AUTH_OUTBOX_MASTER_KEYS=<secret key ring containing versioned 32-byte AES keys>
AUTH_OUTBOX_ACTIVE_KEY_ID=v1

# Start false and enable in the rollout order below.
AUTH_EMAIL_CHALLENGES_ENABLED=false
TOTP_ENROLLMENT_ENABLED=false
TOTP_SIGNIN_ENABLED=false
TENANT_MFA_POLICY_ENABLED=false
AGENT_MFA_RELINK_ENABLED=false
```

Requirements for these values:

- Enter them as runtime secrets on `Virtual-Tracker-Dashboard-Backend`, never as frontend build arguments or committed files.
- Generate independent cryptographically random values; do not derive them from the database password, Firebase key, or `INTERNAL_SERVICE_SECRET`.
- Keep an encrypted offline copy of every still-needed TOTP key version and document its custodians. Database restore without the matching key ring is not an MFA restore.
- Rotate by adding a new key version, switching `TOTP_ACTIVE_KEY_ID`, re-encrypting/observing reads, verifying the post-rotation backup, and only then retiring an old version.
- Manage outbox keys independently. Keep an old outbox key only until all jobs encrypted with it are delivered/erased/expired and the protected backup replay window has passed; restored expired jobs are purged, never delivered.
- Fail readiness when a feature flag requires a missing/malformed secret, unknown active TOTP/outbox key ID, unavailable authoritative schema, or unacceptable clock drift.

### 7.4 Application and data flow

```text
Allowed interactive entry surfaces
  Dashboard-Web | Landing-Web sign-in/account/invite | Tauri browser link
        |
        v
Canonical browser auth/API origin: Virtual-Tracker-Web-Backend
  https://api.myvirtualtracker.com
        |
        +--> Auth-Backend + Firebase Authentication
        |      primary password / Google / Apple / email-link identity
        |      returns Firebase ID token; does not decide Virtual Tracker MFA
        |
        v
Dashboard-Backend global session bootstrap / assurance resolver
        |                        |
        |                        +--> decrypt factor briefly + verify TOTP
        |                        +--> PostgreSQL factors, challenges, policy, sessions, audit
        |                        +--> Redis optional counters/cache invalidation only
        |                        +--> Notify-backend --SMTP--> verified user email
        |                        +--> issue opaque HttpOnly host-only assurance cookie
        |
        v
Dashboard-Backend central auth middleware
  requires Firebase bearer + assurance level required for user/tenant/action
        |
        +--> Dashboard protected UI/API
        +--> Landing account/protected UI/API
        +--> cross-domain shared session/custom-token exchange
        +--> one-time desktop agent link completion

Desktop agent
Tauri agent --> browser-based link --> Firebase primary sign-in
                                      --> Virtual Tracker TOTP verification
                                      --> AAL2 assurance session
                                      --> one-time agent link exchange
                                      --> encrypted local agent credentials bound to verified policy
```

Responsibility boundaries:

| Component | Owns | Must not own |
|---|---|---|
| Existing Firebase Authentication | Primary credentials and identity tokens | TOTP secrets, TOTP decisions, organization policy |
| Auth-Backend | Firebase public config and existing desktop OAuth/link routing | SMTP credentials, TOTP secrets, organization policy |
| Dashboard-Backend | Encrypted TOTP factors, TOTP verification adapter, assurance sessions, organization policy, challenge lifecycle, recovery, authentication audit | SMTP credentials, browser storage of secrets |
| Notify-backend | Template allowlist, SMTP delivery, delivery idempotency/status | Identity decisions, code verification, organization policy |
| Dashboard-Web | Enrollment/challenge UI and factor management UI | TOTP verification, security-policy truth, long-term storage of enrollment secrets |
| Landing-Web | The same global primary-sign-in/bootstrap/MFA resolution contract for landing sign-in, account, invite, and other protected flows | A weaker landing-only sign-in, independent MFA policy, factor administration, or durable secret storage |
| Web Backend gateway | One canonical browser origin and route forwarding to Auth-Backend/Dashboard-Backend | MFA verification, session-policy decisions, TOTP keys, SMTP credentials |
| Tauri agent | Initiate browser linking, securely store resulting agent tokens/device credential and authorization expiry | Direct TOTP enrollment or bypassing browser MFA |

### 7.5 Global coverage and no-weaker-surface rule

“Global” means one identity-level authenticator enrollment follows the Firebase UID across every allowed Virtual Tracker entry surface and organization membership. Organization policy, authorization, recovery administration, and assurance sessions remain tenant/action-aware. It does **not** mean asking for a TOTP on public marketing pages or allowing an email code for every action.

Use `https://api.myvirtualtracker.com` as the canonical browser-facing auth/API origin for both Dashboard-Web and Landing-Web once the gateway routes are verified. Both web applications send credentials to that origin. The host-only assurance cookie is therefore scoped to one API origin and is not duplicated across `app`, apex, `auth`, `notify`, and `appapi` subdomains. Direct internal container calls continue to use private Coolify URLs. If production intentionally keeps direct `appapi.myvirtualtracker.com` browser calls instead, it must be the single canonical assurance origin for both web surfaces; mixing the two origins in one rollout is prohibited because it creates parallel cookie/session states.

The effective MFA requirement is calculated server-side from the authenticated UID, selected tenant, role, policy version, enrolled factors, primary `auth_time`, requested action, and current assurance session. The UI surface, hostname, client-provided flags, and route used to begin sign-in cannot reduce that requirement.

| Case / surface | Email code allowed? | TOTP / recovery factor behavior | Result |
|---|---:|---|---|
| Public Landing-Web marketing, pricing, resources, or contact content | No authentication code unless a specific form requires verified ownership | No TOTP | Remains public; do not add authentication friction to unrelated pages. |
| Registration or email-address ownership from Landing-Web or Dashboard-Web | Yes, fixed `email_ownership` purpose | TOTP only after a primary identity exists and enrollment is allowed/required | The same challenge service and generic anti-enumeration response are used on either surface. |
| Password, Google, Apple, or email-link sign-in from Dashboard-Web | Only for an independently allowed low-assurance purpose; never as MFA replacement | Require TOTP/recovery when factor/policy says AAL2 | Normal Dashboard access starts only after global bootstrap succeeds. |
| Password, Google, Apple, or email-link sign-in from Landing-Web | Same rule as Dashboard-Web | Same TOTP/recovery challenge and policy as Dashboard-Web | Landing account access and shared-session sync wait for the same assurance result. |
| Invite acceptance or protected account action opened from either web surface | Only when the endpoint maps to a fixed allowlisted purpose | Require the action's assurance level; sensitive tenant actions use recent AAL2 | Switching hostnames or opening the invite on Landing-Web cannot weaken enforcement. |
| New-device confirmation where tenant policy does not require MFA | Optional `new_device_confirmation` | Use TOTP instead when strict MFA applies or the action requires AAL2 | Email confirmation produces only its purpose-bound low-assurance result. |
| Sensitive settings, policy, billing/security administration, factor add/remove | Security alert email is sent; an email code is not sufficient unless a narrowly defined low-risk action explicitly permits it | Recent AAL2 is required; adding/removing factors follows factor-management rules | Central middleware checks the action, not only the page UI. |
| Recovery initiation | Yes, `mfa_recovery_request` acknowledgment/ownership evidence | An unused recovery code may complete the bound challenge; otherwise controlled support approval is required | Mailbox access alone never silently removes required MFA. |
| Desktop agent initial link or re-link | Email notifications may report the event; email code does not satisfy required MFA | Browser flow must complete required TOTP/recovery before one-time link exchange | No Firebase-token-only or landing-route bypass. |
| Internal service-to-service calls | No interactive code | No human TOTP | Use narrowly scoped internal authentication; services cannot mint a user AAL2 session. |

Global factor management remains centralized in the Dashboard security settings. Landing-Web may show status and route the user to the canonical management screen, but it must not implement a second factor store or a different policy editor.

## 8. Email code system

### 8.1 Supported purposes

Implement one global challenge service in Dashboard-Backend with an explicit allowlist. Dashboard-Web, Landing-Web, desktop browser-link pages, and approved account/recovery flows call the same API contract through the canonical browser origin. The server derives and validates the purpose; a frontend hostname does not create a separate challenge namespace. Initial purposes:

| Purpose key | Trigger | Result |
|---|---|---|
| `email_ownership` | Registration/profile email workflow | Marks only the intended email ownership workflow complete. |
| `new_device_confirmation` | Risk/policy engine identifies a new web device and no strict MFA policy applies | Issues a low-assurance application confirmation. Does not satisfy 2FA. |
| `mfa_recovery_request` | User starts assisted recovery | Creates a support-reviewable recovery request; does not remove factors by itself. |
| `sensitive_action_email` | A low-risk action explicitly configured for email step-up | Issues a short-lived purpose-bound capability. Not accepted for 2FA-required actions. |
| `customer_accounts_tab` | Existing Customer Accounts unlock | Retained and migrated to the common service without changing its existing authorization semantics. |

Do not implement an unrestricted `purpose` supplied by the browser. The route maps a fixed endpoint/action to a fixed server-side purpose definition. A challenge is bound to UID/recipient, purpose, tenant when applicable, initiating transaction, and intended completion surface/action so a code requested for one flow cannot be replayed in another.

For `email_ownership`, successful verification may set Firebase `emailVerified` through the Admin SDK only when the authenticated UID, challenged normalized email, and Firebase user's current email all match. If any of those values changed after issuance, consume nothing and require a new challenge. Existing Firebase email-action links remain supported; this code flow is an alternative confirmation mechanism, not a second independent identity record.

### 8.2 Data model

Create `auth_challenges` in Postgres and migrate or adapt the current `verification_codes` use:

```sql
auth_challenges
  id                  uuid primary key
  tenant_id           uuid null
  firebase_uid        varchar(128) null
  member_id           uuid null
  recipient_key       char(64) not null      -- HMAC of normalized recipient
  recipient_email_enc text null              -- optional app-level encryption; omit if UID lookup is enough
  purpose             varchar(64) not null
  code_hash           text not null
  status              varchar(24) not null   -- pending_delivery, active, consumed, superseded, expired, locked, delivery_failed
  attempts            int not null default 0
  max_attempts        int not null
  expires_at          timestamptz not null
  consumed_at         timestamptz null
  superseded_at       timestamptz null
  delivery_id         uuid null
  request_ip_hash     char(64) null
  user_agent_hash     char(64) null
  created_at          timestamptz not null
  updated_at          timestamptz not null
```

Indexes/constraints:

- `(firebase_uid, purpose, created_at desc)` for the latest challenge.
- `(recipient_key, purpose, created_at desc)` for per-recipient throttling without raw email lookup.
- Partial index on `status = 'active'` and `expires_at` for validation/cleanup.
- A transaction or advisory lock around issue/replace so concurrent resend requests cannot create two usable codes.
- A check constraint for allowed statuses and bounded attempt counts.
- `tenant_id` follows the current tenancy/RLS design; system-level pre-login lookups must use an explicitly scoped service path, never a tenant-bypass connection available to ordinary handlers.

Do not store a recipient address in `auth_challenges` merely for delivery convenience. Prefer resolving it from Firebase UID/member data at dispatch time. When a flow must deliver to a not-yet-committed address, keep that address only inside the short-lived encrypted outbox payload below.

Use a PostgreSQL transactional outbox in the existing `virtual-tracker-SQL-db`; do not add RabbitMQ or another Coolify resource for v1:

```sql
auth_email_outbox
  delivery_id          uuid primary key
  challenge_id         uuid not null unique
  template_key         varchar(64) not null
  payload_ciphertext   text not null      -- recipient/code/template fields, AES-256-GCM encrypted
  payload_nonce        text not null
  payload_auth_tag     text not null
  key_version          varchar(32) not null
  status               varchar(24) not null -- queued, delivering, delivered, retryable, permanent_failure, expired
  attempts             int not null default 0
  available_at         timestamptz not null
  lease_expires_at     timestamptz null
  payload_expires_at   timestamptz not null
  delivered_at         timestamptz null
  last_error_code      varchar(64) null
  created_at           timestamptz not null
  updated_at           timestamptz not null
```

The outbox uses a separate versioned `AUTH_OUTBOX_MASTER_KEYS` key ring; it never reuses a TOTP encryption key, database password, HMAC key, or internal-service secret. The recipient and code may exist only inside the short-lived authenticated ciphertext. Delete ciphertext/tag/nonce immediately after confirmed delivery, permanent failure, supersession, or expiry; retain only minimum delivery metadata. A restored worker re-checks challenge status and expiry and never replays expired/superseded mail.

### 8.3 Code generation and verification

Extract the sound parts of `customer-accounts/verification-code.service.js` into a shared service:

- Generate with `crypto.randomInt(0, 1_000_000)` and zero-pad to six digits.
- Salt and hash with `scrypt` or Argon2id. The existing `scrypt` approach is acceptable and avoids a new native dependency.
- Compare fixed-length derived values with `timingSafeEqual`.
- Validate and consume inside one database transaction using `SELECT ... FOR UPDATE` or one conditional `UPDATE ... WHERE status='active' AND attempts < max_attempts AND expires_at > now()`.
- Increment the attempt count atomically.
- Mark a correct code consumed in the same transaction that issues the purpose-bound result.
- A resend supersedes every previous active challenge for the same identity and purpose.
- Never return a code from an API response outside test-only dependency injection.
- Tests use an injected deterministic generator/sender, not production flags that can expose codes.

### 8.4 Request flow

1. Normalize the route input and resolve the account without revealing whether it exists.
2. Apply global IP, recipient, UID, and purpose-specific throttles.
3. Acquire the issue lock and supersede an earlier active challenge.
4. In one PostgreSQL transaction, generate/store a `pending_delivery` challenge and insert one encrypted `auth_email_outbox` job with a unique `deliveryId`/idempotency key.
5. Return a generic `202 Accepted` once the job is durably queued; do not hold the browser request open for SMTP. Public responses do not reveal account/delivery state. An authenticated UI may poll a safe status projection only when the product flow genuinely needs it.
6. A coordinated Dashboard-Backend worker claims jobs with a bounded lease and `FOR UPDATE SKIP LOCKED`, decrypts recipient/code only in memory, and calls Notify-backend once with the delivery ID.
7. If Notify confirms delivery before code expiry, atomically mark the challenge `active`, mark the job `delivered`, and erase encrypted payload material.
8. Retry only classified transient failures with bounded exponential backoff and jitter that cannot extend past code expiry. Permanent failure, supersession, expiry, or exhausted retries makes the challenge unusable and erases the payload.
9. Verification locks the latest active row, checks format, expiry, attempts, and hash, then consumes it atomically.
10. Issue a short-lived signed capability containing `sub`, `purpose`, `challenge_id`, `iat`, `exp`, and a random `jti`, or complete the exact server-side state transition in the same transaction.
11. A capability is accepted only by the one intended action. It is never a general bearer session.

### 8.5 Notify-backend changes

- Add fixed templates such as `auth-email-code`, `mfa-enrolled`, `mfa-removed`, `mfa-recovery-started`, `mfa-recovery-completed`, and `security-session-revoked`.
- Add each template to `ALLOWED_TEMPLATES`; never allow arbitrary subject/body HTML from an authentication route.
- Extend `sendEmailViaNotify` and `/api/notify/email` with `deliveryId` and make it idempotent by a unique database constraint.
- Separate **idempotency** from **cooldown**. Repeating the same delivery ID returns the existing result; a legitimate resend after 60 seconds gets a new ID and new code.
- Never put the code, reset token, TOTP secret, or full security link in `notification_deliveries.metadata`, application logs, or error-monitoring breadcrumbs.
- Record provider message ID, template, status, latency, and normalized failure class.
- Keep both plain-text and HTML variants.
- Make the email state the purpose, request time, expiration, and “If this was not you” instructions.
- Authentication emails must not contain analytics pixels or third-party tracking assets.

### 8.6 Mail reliability and domain setup

Before production enforcement:

- Send from a dedicated transactional address such as `security@myvirtualtracker.com`.
- Configure SPF and DKIM for the selected SMTP provider.
- Publish DMARC first in monitoring mode, review reports, then move toward quarantine/reject.
- Require TLS to the SMTP relay and fail closed if the production relay cannot negotiate the configured security level.
- Use the existing SMTP interface with either the organization's current domain-mail relay or a self-hosted SMTP relay. A paid Google mail/identity product is not required.
- A self-hosted relay still needs a stable sending IP, reverse DNS, queue monitoring, abuse controls, and reputation management. If outbound port 25 is blocked by the VPS host, use an available authenticated relay; do not weaken TLS or credentials to work around it.
- Add queue/retry behavior for transient SMTP failures. Do not retry permanent address failures.
- Add bounce/complaint handling before relying on email for recovery.
- Monitor delivery latency because a ten-minute code delivered after expiration is a product failure even if SMTP eventually reports success.

## 9. Authenticator-app TOTP

### 9.1 Self-hosted prerequisite and dependencies

No Identity Platform upgrade is required. Add only locally installed open-source dependencies:

- `otplib` in `Dashboard-Backend` for secret generation, `otpauth://` URI construction, RFC 6238 code generation, and verification. Pin the exact reviewed version in `package-lock.json`; do not load it from a CDN.
- `qrcode` in `Dashboard-Web`, or a similarly reviewed local QR renderer, to render the URI without sending the secret to an external QR service.
- Node's built-in `crypto` for AES-256-GCM encryption, random session/recovery material, HMAC recipient keys, and constant-time comparisons.

Before enabling the feature:

1. Generate the production TOTP encryption key ring from a cryptographically secure source and store it only in the backend's secret manager/environment configuration.
2. Put the VPS and containers on reliable NTP/time synchronization and alert on meaningful clock drift.
3. Add readiness checks for the active key ID, decrypt/encrypt self-test, Postgres schema, and server clock; return only safe booleans to clients.
4. Run the library against every RFC 6238 test vector and fixed Virtual Tracker interoperability fixtures.
5. Confirm the dependency license and transitive dependency lockfile in CI.
6. Test database restore together with encryption-key restore. A database backup without the key ring is not a usable MFA backup.

### 9.2 Factor and assurance-session data model

Create two identity-global tables and one tenant-bound assurance-session table. The exact DDL follows repository migration conventions. A user enrolls an authenticator once per Firebase identity, not once per tenant or frontend; tenant policies decide when that global factor must be used.

```sql
auth_mfa_factors
  id                  uuid primary key
  firebase_uid        varchar(128) not null
  factor_type         varchar(24) not null default 'totp'
  display_name        varchar(80) not null
  secret_ciphertext   text not null
  secret_nonce        text not null
  secret_auth_tag     text not null
  key_version         varchar(32) not null
  algorithm           varchar(12) not null default 'sha1'
  digits              smallint not null default 6
  period_seconds      smallint not null default 30
  last_used_step      bigint null
  status              varchar(20) not null -- pending, active, revoked
  pending_expires_at  timestamptz null
  enrolled_at         timestamptz null
  revoked_at          timestamptz null
  created_at          timestamptz not null
  updated_at          timestamptz not null
```

```sql
auth_recovery_codes
  id                  uuid primary key
  firebase_uid        varchar(128) not null
  factor_set_version  int not null
  code_hash           text not null
  used_at             timestamptz null
  created_at          timestamptz not null
```

```sql
auth_assurance_sessions
  id                    uuid primary key
  tenant_id             uuid not null
  member_id             uuid not null
  firebase_uid          varchar(128) not null
  token_hash            char(64) not null unique
  assurance_level       smallint not null -- 1 primary only, 2 primary + TOTP/recovery
  factor_id              uuid null
  primary_auth_time      timestamptz not null
  mfa_verified_at        timestamptz null
  policy_version         bigint not null
  user_agent_hash        char(64) null
  request_ip_hash        char(64) null
  expires_at             timestamptz not null
  idle_expires_at        timestamptz not null
  revoked_at             timestamptz null
  created_at             timestamptz not null
  last_seen_at           timestamptz not null
```

Rules:

- `auth_mfa_factors` and `auth_recovery_codes` are identity-security tables, not tenant business tables. Ordinary tenant queries and tenant administrators cannot read them. Access goes through a narrow Dashboard-Backend repository that requires the verified Firebase UID and returns only safe projections outside verification/enrollment operations.
- `auth_assurance_sessions` remains tenant/member/policy-bound so assurance cannot authorize a different organization accidentally. Switching tenant never requires re-enrolling the authenticator, but the target tenant's policy is re-evaluated and a target-bound assurance session is created only from valid proof allowed by that policy.
- Add database constraints/indexes for factor ownership/status and factor-set versioning by `firebase_uid`. Factor IDs remain opaque and globally unique.
- Removing/resetting an identity-global factor revokes assurance sessions and agent authorizations for that Firebase UID across every tenant, then emits appropriately scoped audit/security notifications without revealing other tenant memberships.
- Tenant policy/reporting may ask only whether affected members have an active usable factor and when enrollment occurred. It never receives ciphertext, recovery-code records, factor names belonging to private user context, or a general UID lookup API.
- Only active factors participate in sign-in. Pending enrollment rows expire and are deleted.
- Recovery codes are generated with `crypto.randomBytes` as ten independent 12-character Crockford Base32 values (about 60 bits each), shown once, and stored only as salted slow hashes. Generate a new set whenever the factor set changes; invalidate the old set.
- Store only a SHA-256/HMAC hash of the opaque assurance token. The browser receives the raw token only as an HttpOnly cookie.
- Default AAL2 assurance to a 12-hour absolute lifetime and 30-minute idle refresh window; “remember me” may extend the absolute lifetime only after product/security review. Sensitive actions still use their shorter `step_up_max_age_minutes`.
- Rotate the opaque token after successful step-up and privilege/policy changes to prevent session fixation.
- Revoke all assurance sessions on password reset, factor removal/recovery, account disable, security-stamp change, or explicit sign-out-everywhere. Tenant removal revokes sessions/agent authorization for that tenant without deleting an identity-global factor still used by another membership.

### 9.3 Enrollment flow

Place personal factor management under the user's own **Security** settings, separate from organization enforcement:

1. User selects **Set up authenticator app**.
2. Require recent reauthentication with the user's primary provider.
3. Confirm the Firebase user has a verified email.
4. Call `POST /api/auth/mfa/enrollment/start` with the Firebase bearer token and the current assurance cookie when adding another factor.
5. Dashboard-Backend generates a unique Base32 secret, encrypts it as a short-lived `pending` factor, and creates `otpauth://totp/My%20Virtual%20Tracker:user@example.com?...&issuer=My%20Virtual%20Tracker&algorithm=SHA1&digits=6&period=30` through the reviewed URI library.
6. Return the URI and manual secret exactly once over HTTPS with `Cache-Control: no-store`. Never persist them in browser storage.
7. Render the URI as a QR code locally in the browser. Do not send it to a remote QR-generation service.
8. Show the manual secret behind an explicit reveal/copy control for accessibility and apps that cannot scan.
9. Tell the user that both Google Authenticator and Microsoft Authenticator can scan the standard QR code; the app choice does not need to be detected.
10. Ask for a six-digit code and send it to `POST /api/auth/mfa/enrollment/confirm` with the pending factor ID.
11. Dashboard-Backend locks the factor row, decrypts the secret only in memory, verifies the code and time step, then atomically marks the factor active and records `last_used_step`.
12. Generate ten high-entropy recovery codes, show them once, and require the user to confirm that they saved them. Store only slow salted hashes.
13. Clear the secret, URI, QR canvas, code, and recovery-code plaintext from client/server working memory immediately after success or cancellation.
14. Revoke older assurance sessions as policy requires, create a new AAL2 assurance session, write an audit event, and send an “Authenticator added” email containing no secret.
15. Encourage enrollment of a second authenticator before strict enforcement.

Enrollment state machine:

```text
idle -> reauth_required -> generating -> qr_visible -> verifying
     -> enrolled
     -> cancelled
     -> retryable_error
     -> fatal_error
```

The state machine prevents double-submit, stale secret reuse, and navigation that accidentally leaves a secret displayed.

### 9.4 Sign-in and assurance flow

Centralize post-Firebase authorization so every primary provider and every allowed entry surface behaves consistently:

1. Complete email/password, Google popup/redirect, Apple, or email-link sign-in through Firebase as today and obtain an ID token.
2. Call `POST /api/auth/session-bootstrap` with the Firebase bearer token and credentialed cookies enabled.
3. Dashboard-Backend verifies the Firebase token, resolves the member/tenant/policy, and checks for a matching unexpired assurance session.
4. If MFA is not required and no factor is enrolled, issue an AAL1 assurance session and continue.
5. If enrollment is required, return `MFA_ENROLLMENT_REQUIRED` or `MFA_ENROLLMENT_GRACE` with safe policy metadata.
6. If an active factor exists and no valid AAL2 session exists, create a short-lived sign-in challenge ID bound to UID, Firebase `auth_time`, tenant, intended destination, IP/user-agent hashes, and allowed factor IDs; return `MFA_REQUIRED`.
7. Render the same factor selector plus six-digit input contract in the initiating Dashboard-Web, Landing-Web, or browser-link surface. It supports paste, uses `autocomplete="one-time-code"`, and is keyboard/screen-reader usable.
8. Send `{challengeId, factorId, code}` to `POST /api/auth/mfa/verify` with the Firebase bearer token.
9. Dashboard-Backend rate-limits and locks the challenge/factor row, decrypts the secret only for the verification call, checks the current and permitted adjacent step through `otplib`, rejects `matched_step <= last_used_step`, and atomically advances `last_used_step`.
10. On success, issue a random 256-bit token as the production `__Host-vt_auth_assurance` cookie with `Secure; HttpOnly; SameSite=Lax; Path=/` and no `Domain`, store only its hash, mark it AAL2, and complete bootstrap. A separately named non-Secure development cookie is allowed only on loopback/localhost and must be impossible in production.
11. On invalid/expired code, clear the input, preserve the factor selection, and return a stable bounded error. Attempt limits are enforced server-side by challenge, UID, IP, and factor.
12. On cancellation or provider change, invalidate the challenge and clear partial state.
13. Never persist the TOTP code, challenge secret, or raw assurance token in localStorage, sessionStorage, URL parameters, logs, analytics, or Redux-like stores.

Every protected application API request, regardless of whether it began on Dashboard-Web, Landing-Web, the gateway, shared-session exchange, or a desktop browser-link flow, then requires both:

- a valid Firebase bearer token proving the primary identity; and
- a valid `__Host-vt_auth_assurance` cookie whose UID, tenant, policy version, expiry, and required assurance level match the request.

`Dashboard-Web/infrastructure/api/http.ts` and `Landing-Web/src/lib/api/http.ts` must use `credentials: "include"` for calls to the canonical assurance origin. CORS must allow credentials only for exact trusted application origins. Because the Firebase bearer is still required, a third-party website cannot authenticate with the cookie alone; nevertheless, cookie-mutating endpoints also validate `Origin` and use CSRF defenses.

### 9.5 Factor management

Users can:

- List active factors from `GET /api/auth/mfa/factors`; never return encrypted secret fields.
- See sanitized display name, factor type, and enrollment time.
- Rename the display label after recent AAL2 verification.
- Add a second authenticator.
- Remove a factor only after recent reauthentication.
- Never remove the last factor when organization policy requires MFA unless an authorized recovery/admin override is active.

After enrollment or removal:

- Revoke affected assurance sessions and agent authorizations; keep the underlying Firebase account intact.
- Send a security email.
- Add an audit event.
- Issue a replacement assurance session only after the required fresh proof.

### 9.6 Recovery

Safe v1 recovery:

1. Encourage at least two enrolled TOTP authenticators.
2. Let a user who has already completed the Firebase primary sign-in submit one unused recovery code against the bound MFA challenge.
3. Compare the submitted recovery code to slow salted hashes, consume it atomically, issue AAL2 for that session, and immediately prompt the user to replace/re-enroll the missing factor and regenerate the code set.
4. Notify the primary email and organization security contacts that a recovery code was used.
5. If no recovery code is available, provide **Start account recovery** from the MFA screen.
6. Send a generic email acknowledgement and create a recovery case; the email code proves mailbox access but does not immediately remove MFA.
7. Require a documented support/admin identity check. Do not use knowledge-based questions such as mother's maiden name.
8. A tightly permissioned recovery endpoint revokes the user's self-hosted factor rows after approval; it does not alter the Firebase primary providers.
9. Revoke all Firebase refresh tokens, assurance sessions, shared session cookies, and agent link/device reauth credentials as policy requires, then close active presence sessions.
10. Send “MFA removed through recovery” notifications to the primary email and any organization security contacts.
11. Add an immutable audit entry containing actor, reason code, case ID, target UID/member, time, and request context—never the email/recovery code.
12. On next sign-in, if organization policy requires MFA, force re-enrollment before dashboard access.

## 10. Organization MFA policy

### 10.1 Data model

Create a tenant-scoped table rather than storing policy in component state:

```sql
tenant_auth_policies
  tenant_id                 uuid primary key
  mode                      varchar(24) not null -- optional, required_roles, required_all
  allowed_factors           text[] not null      -- initially ['totp']
  required_role_keys        text[] not null
  enrollment_grace_hours    int not null default 168
  step_up_max_age_minutes   int not null default 10
  recovery_requires_admin   boolean not null default true
  enforcement_started_at    timestamptz null
  updated_by                uuid not null
  updated_at                timestamptz not null
```

Add a member-level projection only if needed for efficient UI:

```sql
member_auth_security
  member_id                 uuid primary key
  tenant_id                 uuid not null
  enrollment_required_at    timestamptz null
  grace_expires_at          timestamptz null
  last_mfa_sign_in_at       timestamptz null
  recovery_state            varchar(24) null
  updated_at                timestamptz not null
```

`auth_mfa_factors` is the source of truth for second-factor enrollment. Secret ciphertext columns are readable only by the narrow MFA service, excluded from ordinary `SELECT *` models, admin APIs, exports, audit JSON, and support tools. Policy/reporting queries use factor IDs, status, and enrollment timestamps only.

### 10.2 Enforcement points

Policy must be checked globally in both places for every protected surface:

1. **`session-bootstrap`:** resolve member/tenant/role, read the policy and self-hosted factor records, validate the assurance cookie, and return one of:
   - `MFA_ENROLLMENT_REQUIRED`
   - `MFA_ENROLLMENT_GRACE`
   - `MFA_RECOVERY_REQUIRED`
   - normal authorized response
2. **`auth-middleware`:** require the Firebase bearer plus a matching assurance session and repeat the policy gate on every protected API request, using only a short tenant-keyed cache with immediate invalidation. This prevents direct API bypass and handles role/policy changes during an existing session.

The transport contract may expose the lowercase `state` values defined in Section 12 together with stable uppercase error/action codes for compatibility. Both web clients must map the same pair consistently; neither may convert an unknown state into authorized access.

Keep the pre-assurance allowlist narrow and test it as data. It may include only primary session bootstrap, MFA challenge creation/verification, enrollment required by policy, recovery initiation/use, logout, health/readiness, and the minimum public invite/email-action routes that already have their own controls. Adding a route to this list requires a security review because it becomes reachable with primary authentication but without TOTP.

The server must distinguish:

- **Enrolled:** the user has at least one active, decryptable factor under the current key ring.
- **Used for this sign-in:** the assurance session has `assurance_level = 2`, a valid factor/recovery reference, and an `mfa_verified_at` later than the Firebase primary `auth_time` bound to the challenge.
- **Fresh enough for a sensitive action:** compare the assurance session's `mfa_verified_at` to the action's configured maximum age and require a new TOTP challenge when stale.

The middleware must never infer MFA from a Firebase token, custom claim, UI flag, or presence of an enrolled factor. Only a live, server-issued assurance session proves that the second factor was used for this sign-in.

### 10.3 Rollout behavior

- Default policy is `optional` for all existing tenants.
- Owners/Super Admins can require TOTP for Owners first, then Managers, then Members.
- Changing from optional to required creates a grace window; it does not instantly lock out every unenrolled member.
- During grace, the user sees a persistent security banner and enrollment CTA.
- After grace, allow only sign-out, factor enrollment, recovery initiation, support access, and minimum account information needed to complete the gate.
- Owners cannot create an impossible policy: before enforcement, require at least two active recovery administrators who are enrolled, or a documented provider-level break-glass account.
- A policy downgrade/removal is a sensitive, audited action requiring recent MFA.

## 11. “Detect the icon/place authenticated” behavior

The phrase can refer to two different product experiences; support both safely.

### 11.1 Icon inside Google/Microsoft Authenticator

The standard Key URI format supports `issuer`, account label, secret, algorithm, digits, and period. It does **not** define a portable icon URL. Therefore:

- Set the issuer and label consistently: `My Virtual Tracker:user@example.com` with `issuer=My Virtual Tracker`.
- Show the My Virtual Tracker logo next to the QR code in our enrollment screen.
- Test the QR with current Google Authenticator and Microsoft Authenticator releases.
- Accept that either app may show a generic key icon or infer branding through its own private catalog.
- Do not put a website URL in `issuer`; that harms readability and does not guarantee favicon retrieval.
- Do not tell users that Virtual Tracker can detect which authenticator application they chose. Standard TOTP enrollment does not reliably report that.

Acceptance wording: **“The authenticator entry is clearly labeled My Virtual Tracker and the account email. Third-party icon rendering is best-effort and outside Virtual Tracker's control.”**

### 11.2 Icon/context for the place a sign-in occurred

For Virtual Tracker's own security screen and login-alert email, derive a safe context record server-side:

```text
source: web | tauri_agent | landing_session
provider: password | google | apple | email_link | custom_token
browser_family: Chrome | Edge | Firefox | Safari | Other
os_family: Windows | macOS | Linux | Android | iOS | Other
device_class: desktop | mobile | tablet | unknown
ip: normalized address (or privacy-masked display where required)
occurred_at: UTC timestamp
country_code: optional P1, coarse and explicitly approximate
```

Icon rules:

- Use a fixed server/UI allowlist mapping to bundled SVG/PNG icons for Virtual Tracker Web, the Tauri agent, browser families, OS families, and a generic fallback.
- Never fetch or render an icon URL supplied by the client, user-agent string, email, issuer, or remote site. That prevents tracking, mixed content, and script/image injection.
- A country flag, if later enabled, is derived from a reviewed IP-to-country service and labeled **Approximate location**. It must not influence authentication by itself.
- Security emails use the My Virtual Tracker brand icon and text device context. Email clients often block remote images, so the security meaning cannot depend on an icon being visible.
- The current hand-written `summarizeUserAgent` should be replaced by a small tested parser or an explicit conservative mapping; unknown values remain “Unknown device.”

## 12. REST API architecture and surface

REST APIs are the required integration boundary for this feature. Dashboard-Web, Landing-Web, the public Web Backend gateway, the Tauri browser-link flow, Dashboard-Backend, Auth-Backend, and Notify-backend must not implement separate copies of challenge or factor decisions. They communicate through one documented, versioned HTTP/JSON contract, while PostgreSQL and Redis remain private to the owning backend.

### 12.1 Existing REST API inventory and ownership

| Service/component | Existing REST-style responsibility | MFA extension |
|---|---|---|
| `Virtual-Tracker-Web-Backend` | Public `https://api.myvirtualtracker.com` gateway for browser/client API traffic | Canonical public origin; route versioned auth/MFA/email-challenge/session requests to the owning backend without making security decisions. |
| `virtual-tracker-auth` | Firebase configuration, password policy, primary token verification, sign-in-method resolution, and Google OAuth routes under `/api/auth/*` and `/api/v1/auth/*` | Keep primary-authentication endpoints here. Do not add TOTP secret storage/verification or organization assurance policy here. |
| `Virtual-Tracker-Dashboard-Backend` | Protected application REST APIs for auth bootstrap, members, activity, projects, tasks, timesheets, compliance, reports, settings, and other domain modules | Own every self-hosted MFA, assurance-session, email-challenge verification, factor, recovery, and tenant-policy endpoint. Central middleware enforces assurance on the existing protected API surface. |
| `Landing-Backend` repository component (deployment behind the Web Backend must be verified) | Public contact/download/update and session proxy behavior | Proxy only the narrowly required session endpoints where needed; do not create a second MFA implementation or expose a second browser assurance origin. |
| `virtual-tracker-notification` | Internal `/api/notify/email`, `/api/notify/push`, `/api/notify/phone/*`, and readiness routes | Add allowlisted auth/security email templates and idempotent delivery. It sends codes but never verifies them or grants assurance. |

The browser applications call the public gateway. Server-to-server calls use Coolify internal URLs. No browser, gateway, Auth-Backend, Landing backend, or Notify route reads MFA tables directly.

### 12.2 Versioning and compatibility decision

- Canonical new endpoints are under `/api/v1/auth/*` and `/api/v1/settings/security/*`.
- The existing router normalization may temporarily accept matching unversioned `/api/auth/*` paths during migration. New clients use `/api/v1`; unversioned aliases are compatibility shims with removal metrics and a documented sunset, not a second contract.
- Responses include an API contract version where state-machine compatibility matters. An unknown version or state fails closed and prompts an application update; it never defaults to `ready`.
- Breaking request/response or security-semantic changes require `/api/v2`. Adding an optional response field is non-breaking.
- Publish and review `docs/openapi/auth-mfa-v1.yaml` before frontend integration. Generate or validate shared TypeScript types from that specification where practical.

### 12.3 Auth-Backend

Names below show their current logical paths; implementation exposes the canonical `/api/v1` form and only the compatibility aliases described above.

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/auth/google/start` | link token | Existing desktop link start; move completion into the Dashboard-Web flow so self-hosted TOTP runs before agent linking. |
| `GET` | `/api/auth/google/callback` | OAuth state | Legacy callback during migration; it may establish only the primary identity and must not complete a protected agent link by itself. |

### 12.4 Dashboard-Backend: user security

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/session-bootstrap` | Firebase bearer; optional existing assurance cookie | Global post-primary resolver used by Dashboard-Web, Landing-Web, and browser-link flows. Returns one explicit assurance state and never grants protected access before the effective requirement is met. |
| `GET` | `/api/auth/mfa/capabilities` | bearer | Returns safe booleans such as `totpEnabled`, recovery availability, and policy mode. |
| `GET` | `/api/auth/security` | bearer + assurance | Factor projection, policy/grace state, recent sessions; no encrypted fields. |
| `GET` | `/api/auth/mfa/factors` | bearer + assurance | List factor metadata only. |
| `POST` | `/api/auth/mfa/enrollment/start` | recent primary; AAL2 when adding | Create encrypted pending factor and return one-time URI/manual secret. |
| `POST` | `/api/auth/mfa/enrollment/confirm` | bearer + pending factor | Verify first code, activate factor, return one-time recovery-code set, issue AAL2. |
| `POST` | `/api/auth/mfa/challenges` | bearer | Create a challenge bound to the primary sign-in and current policy. |
| `POST` | `/api/auth/mfa/verify` | bearer + challenge | Verify TOTP with replay/attempt protection and issue assurance cookie. |
| `POST` | `/api/auth/mfa/recovery-code/verify` | bearer + challenge | Atomically consume a backup code and issue recovery AAL2. |
| `DELETE` | `/api/auth/mfa/factors/:id` | recent AAL2 | Revoke a factor and all affected sessions. |
| `POST` | `/api/auth/email-challenges/request` | varies by fixed purpose | Issue an allowlisted email challenge with generic public response. |
| `POST` | `/api/auth/email-challenges/verify` | challenge transaction + purpose | Consume a code and complete only its bound action. |
| `POST` | `/api/auth/mfa/recovery` | primary/recovery context | Start assisted recovery; never directly disables MFA. |
| `POST` | `/api/auth/session-cookie` | Firebase bearer + satisfied effective assurance | Create/synchronize the shared `vt_session` only after global bootstrap reaches `ready`. |
| `GET` | `/api/auth/session-status` | shared cookie + assurance lookup | Return safe sign-in/assurance state for both web surfaces; never return tokens, factors, or policy internals. |
| `POST` | `/api/auth/session-exchange` | valid shared cookie + satisfied current policy | Support cross-domain Firebase sign-in without turning the custom token into an MFA bypass; the receiving surface must still call global bootstrap. |
| `POST` | `/api/auth/session-logout` | shared cookie | Revoke/clear shared and assurance state consistently across surfaces. |
| `POST` | `/api/auth/sessions/revoke` | recent AAL2 | Revoke selected/all assurance, Firebase, shared-cookie, and agent sessions as requested. |

All TOTP operations terminate on Dashboard-Backend over TLS. Auth-Backend and Notify-backend never receive the TOTP secret or submitted authenticator code.

`session-bootstrap` returns a versioned, shared state contract such as `ready`, `mfa_required`, `mfa_enrollment_required`, `policy_grace`, or `recovery_required`, plus only the safe fields needed to render the next step. Dashboard-Web and Landing-Web must use the same parser/state machine. Do not make one surface infer MFA from HTTP status text while the other reads structured fields.

The existing cross-subdomain `vt_session` is an application SSO convenience, not independent evidence of AAL2. Do not create it until the current effective policy is satisfied. A host-only assurance cookie remains on the single canonical API origin and is checked in PostgreSQL on protected requests. `/session-exchange` must re-evaluate policy/version/revocation and the receiving client must run `session-bootstrap`; a Firebase custom token by itself proves only primary identity.

### 12.5 Dashboard-Backend: organization policy and recovery administration

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/settings/security/auth-policy` | tenant management | Read effective tenant MFA policy and rollout counts. |
| `PATCH` | `/api/settings/security/auth-policy` | Owner/Super Admin + recent MFA | Validate and update policy, grace period, and required roles. |
| `GET` | `/api/settings/security/mfa-enrollment-summary` | tenant management | Counts only; avoid exposing factor details unnecessarily. |
| `GET` | `/api/settings/security/recovery-requests` | restricted recovery role | List pending recovery cases. |
| `POST` | `/api/settings/security/recovery-requests/:id/approve` | two-person/restricted approval | Remove factors, revoke tokens/devices, audit, notify. |
| `POST` | `/api/settings/security/recovery-requests/:id/deny` | restricted recovery role | Close case and notify. |

Every mutation uses body allowlists, length limits, centralized authentication context, tenancy/RLS, recent-auth checks, and audit events.

### 12.6 REST contract rules

All new authentication endpoints follow these rules:

- HTTPS only in production. JSON requests use `Content-Type: application/json`; successful JSON responses use a consistent envelope with `success`, `state`/`data`, and a request correlation ID supplied as a response header.
- Authentication uses `Authorization: Bearer <Firebase ID token>` for primary identity plus the HttpOnly assurance cookie when required. Internal Notify calls use the scoped internal-service credential; they cannot mint user assurance.
- `GET` is safe/read-only, `POST` creates challenges or performs explicit security actions, `PATCH` changes policy/metadata, and `DELETE` revokes a factor/session. Never place a password, email code, TOTP, recovery code, secret, ID token, assurance token, or SMTP credential in a URL/path/query string.
- Expected bootstrap progression returns `200` with a structured state such as `mfa_required`; it is not treated as an exceptional server failure. A normal protected endpoint lacking required assurance returns `403` with a stable code and safe next action.
- Use `400` for malformed JSON, `401` for missing/invalid primary authentication, `403` for authenticated-but-insufficient assurance/authorization, `404` for absent resources without enumeration leakage, `409` for consumed/replayed/stale state, `422` for valid JSON that fails field validation, `429` for throttling with a bounded `Retry-After`, and `503` for an unavailable required dependency/readiness failure.
- Public account lookup, code request, and recovery initiation responses remain enumeration-safe even when internal results differ.
- Challenge/factor/session/recovery identifiers are opaque random UUIDs or random tokens. Sequential database IDs are never exposed as authorization evidence.
- Request bodies are strictly allowlisted and size-limited. Unknown security-sensitive fields are rejected rather than silently trusted.
- CORS allows credentialed requests only from the exact Dashboard-Web and Landing-Web production origins. Cookie-mutating routes validate `Origin`/CSRF expectations as well as bearer authentication.
- Do not automatically retry non-idempotent verify, consume, factor-change, recovery-approval, or policy-change requests. Challenge issuance and Notify delivery accept a server-defined idempotency key; repeated requests return the original safe outcome without issuing multiple active codes.
- Rate limits apply consistently at the canonical gateway and authoritative backend, using trusted proxy configuration so clients cannot spoof the address used for abuse controls.
- Responses and logs never echo submitted codes or secrets. Error messages use stable machine codes plus safe user-facing messages and correlation IDs, not raw database/crypto/provider errors.
- Cache headers are `no-store` for bootstrap, challenge, enrollment, factor, recovery, session, and policy responses. Read-only non-sensitive capability metadata may use a short private cache only when policy invalidation is proven.

### 12.7 Core REST flow examples

Primary sign-in completion from Dashboard-Web or Landing-Web:

```http
POST /api/v1/auth/session-bootstrap HTTP/1.1
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
```

```json
{
  "success": true,
  "contractVersion": 1,
  "state": "mfa_required",
  "challenge": {
    "id": "opaque-challenge-id",
    "expiresAt": "2026-09-28T12:10:00Z",
    "factors": [
      { "id": "opaque-factor-id", "type": "totp", "label": "Authenticator" }
    ]
  }
}
```

TOTP verification:

```http
POST /api/v1/auth/mfa/verify HTTP/1.1
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
```

```json
{
  "challengeId": "opaque-challenge-id",
  "factorId": "opaque-factor-id",
  "code": "123456"
}
```

Successful verification returns `200`, sets the host-only HttpOnly assurance cookie, and returns only safe session metadata:

```json
{
  "success": true,
  "contractVersion": 1,
  "state": "ready",
  "assurance": {
    "level": 2,
    "expiresAt": "2026-09-28T20:00:00Z"
  }
}
```

The literal example code above is documentation-only and is never accepted through a production test bypass. The response never includes the assurance token, stored TOTP secret, expected code, recovery-code hashes, or policy internals.

## 13. Global web-surface work

### 13.1 Dashboard-Web MFA modules

Suggested feature layout:

```text
Dashboard-Web/features/auth/mfa/
  api/security-api.ts
  services/mfa-error.ts
  services/mfa-sign-in.ts
  services/totp-enrollment.ts
  components/mfa-challenge-pane.tsx
  components/totp-enrollment-dialog.tsx
  components/factor-list.tsx
  components/recovery-start-dialog.tsx
  components/security-event-context.tsx
  models.ts
```

### 13.2 Shared login contract

- Extend Dashboard-Web's `AuthContextType` and Landing-Web's `CurrentUserState` with the same explicit MFA/assurance state, not collections of unrelated booleans.
- Route every Firebase provider result on both sites through an equivalent `completePrimarySignIn` flow that immediately enters Virtual Tracker's global bootstrap/assurance resolver.
- Add an `mfa` pane to the existing login-card state machine rather than opening a detached modal that can be lost during redirects.
- Preserve the user's intended destination without placing a challenge ID, TOTP secret, assurance token, or recovery material in the URL.
- Treat browser refresh during a challenge as cancellation; restart primary sign-in.
- Do not sync `vt_session` or start normal application bootstrap until the required Virtual Tracker assurance level is established.
- Send cookies on all calls to the canonical assurance origin with an explicit credentialed CORS contract; do not rely on one frontend's fetch defaults differing from the other.
- Map Firebase primary-auth errors and Virtual Tracker MFA errors separately to stable user messages; keep raw provider/library messages out of the UI/logs.

### 13.3 Settings changes

- Personal Security section: enrolled authenticators, add/remove, last security events, recovery link.
- Organization Security section: connect the existing mock toggles to the real policy API.
- Show rollout impact before saving: enrolled/required/not-enrolled counts by role.
- Require a typed confirmation and recent MFA when enabling required-all or when removing the last recovery admin.
- Replace “authenticator app or security key” copy until security keys are actually implemented.
- Add accessible QR alternative, manual secret, copy feedback, code input labels, error announcements, focus management, and keyboard navigation.

### 13.4 State hygiene

- Enrollment URI/manual secret, submitted codes, challenge IDs, and one-time recovery-code plaintext stay in component memory only.
- Clear sensitive state on success, cancel, provider change, sign-out, visibility timeout, and unmount.
- Mark pages containing QR/secret data `Cache-Control: no-store` where server rendering is involved.
- Do not capture enrollment dialogs in product analytics/session replay. Add masking rules before release.

### 13.5 Landing-Web changes

- Update `Landing-Web/src/lib/auth/verify-session.ts` to parse the same versioned bootstrap/assurance states as Dashboard-Web instead of treating every non-success as a generic sign-in failure.
- Update `Landing-Web/src/lib/auth/use-current-user.ts` so it does not call `syncSharedSessionCookie()` until bootstrap returns `ready` at the required assurance level.
- Add credentialed requests for global assurance/session endpoints in `Landing-Web/src/lib/api/http.ts`; retain bearer-token refresh behavior without dropping the assurance cookie.
- Add the same accessible TOTP/recovery challenge states to the Landing-Web sign-in/account flow, using a thin UI adapter over the shared backend contract. Landing-Web does not implement TOTP calculation, secret persistence, policy decisions, or a separate recovery service.
- Make silent cross-domain SSO stop at primary identity when assurance is missing, stale, revoked, bound to another UID/tenant, or below current policy. It must enter the same challenge flow instead of immediately treating the user as fully signed in.
- Support the global allowlisted email-code flows where Landing-Web legitimately owns the entry experience, including registration/email ownership and recovery initiation. Do not expose arbitrary challenge purposes.
- Keep ordinary public marketing/content pages independent of Firebase/TOTP availability. An MFA outage must not take down public pages that require no account.
- After success, return to the validated intended Landing-Web or Dashboard-Web destination. Allow only an explicit same-site route allowlist; never redirect to a client-supplied external URL.

### 13.6 Shared frontend contract maintenance

- Define one versioned TypeScript response model and error-code list for both web applications. Prefer a small repository-local shared package or generated types; if build boundaries prevent that initially, add a parity test that fails when the two definitions diverge.
- Use the same copy for factor meaning, recovery limitations, expiry, retries, and the fact that email does not satisfy required 2FA.
- Keep factor enrollment/rename/removal and organization policy management in Dashboard-Web. Landing-Web may display assurance status and deep-link to that canonical screen.
- Test the same UID moving between apex, `app`, and canonical API origins without being asked to satisfy MFA twice while the bound assurance session remains valid—and without retaining assurance after logout, policy change, recovery, or revocation.

## 14. Backend work by component

### 14.1 Auth-Backend

- Keep the existing free Firebase configuration, password policy, token verification, and primary-provider behavior. No Identity Platform upgrade is part of this plan.
- Redesign desktop Google linking so the agent opens a Dashboard-Web link-completion page carrying only the signed, expiring agent-link state. That page completes normal Firebase primary sign-in, then Virtual Tracker's own TOTP/assurance flow, before it calls `/api/activity/agent/link/complete`.
- Deprecate the separate server callback completing an agent link from a primary Firebase ID token alone after compatibility rollout.
- Do not pass Firebase refresh tokens through browser query parameters.
- Continue signing/expiring OAuth state and bind it to the one-time link session.
- Return stable `agentLinkError` codes for cancelled, expired, MFA unsupported, and backend unavailable conditions.

### 14.2 Dashboard-Backend

- Add the generalized challenge service and schema migration.
- Add the encrypted PostgreSQL email outbox plus a coordinated, leased delivery worker that calls Notify without blocking browser requests on SMTP.
- Add the self-hosted TOTP adapter, encrypted factor store, key-ring loader/rotation command, assurance sessions, recovery-code service, cleanup, and readiness checks.
- Add tenant policy and recovery case services.
- Extend `session-bootstrap`, shared session-cookie routes, session exchange, and `auth-middleware` with the same global policy and assurance evaluator used for Dashboard-Web, Landing-Web, gateway requests, and browser-link completion.
- Add a recent-auth helper based on `mfa_verified_at`, bound Firebase `auth_time`, and policy version.
- Add security audit events and safe login context parsing.
- Extend session revocation to Firebase tokens, shared session cookies, presence connections, and desktop agent device credentials according to the selected action.
- Reconcile factor/session integrity from Postgres on bootstrap and through a scheduled cleanup/repair job; never send secret ciphertext to repair logs.
- Ensure all caches key by tenant and are invalidated immediately when a policy changes.

### 14.3 Notify-backend

- Add the authentication templates and explicit cooldowns.
- Add delivery ID idempotency and a unique index.
- Add validation/size limits for every template field.
- Add retryable/permanent failure classification and metrics.
- Add tests proving codes/tokens are absent from delivery metadata and logs.
- Document SMTP DNS and production readiness in `docs/notify-backend/README.md`.

### 14.4 Web Backend gateway and Landing-Web integration

- Route all global browser authentication, bootstrap, MFA, email-challenge, shared-session, and recovery endpoints through the selected canonical API origin.
- Keep the Auth-Backend exact-path allowlist narrow and route self-hosted assurance endpoints to Dashboard-Backend. Add routing tests so a new `/api/auth/*` path cannot silently land on the wrong service.
- Preserve multiple `Set-Cookie` headers, `Cookie`, `Authorization`, request origin, HTTPS scheme, and the reviewed proxy/IP chain. Reject unsupported origins while allowing credentialed CORS only for the production Dashboard-Web and Landing-Web origins.
- Apply conservative request-body and upstream time limits without retrying non-idempotent challenge verification or factor mutations at the gateway.
- Implement the Landing-Web changes in Section 13.5 and ensure public marketing routes remain available independently of assurance-service health.

### 14.5 Tauri-App-Extension

- Keep password-form MFA behavior as **Continue in browser** for v1.
- Browser link completion must pass through Firebase primary sign-in plus a valid Virtual Tracker AAL2 assurance session before agent credentials are issued.
- When the agent receives `MFA_REQUIRED`, do not retry it as a generic network error; open the bound browser challenge.
- Existing device custom-token reauthentication is for continuation of an already authorized device, not initial MFA or factor management.
- Decide policy for an organization newly requiring MFA:
  - recommended: existing device sessions get a bounded grace period;
  - after grace, pause uploads/timer start and request browser re-link;
  - never discard already captured offline work while waiting for reauthentication.
- Store no TOTP secret/code in Rust state, logs, DPAPI store, frontend state, or diagnostic bundles.
- Add explicit user-facing states: `mfa_required`, `mfa_enrollment_required`, `recovery_required`, and `policy_grace`.

## 15. Security notifications and audit

Record events such as:

- `auth.email_challenge.requested`
- `auth.email_challenge.delivery_failed`
- `auth.email_challenge.verified`
- `auth.email_challenge.locked`
- `auth.mfa.enrolled`
- `auth.mfa.factor_removed`
- `auth.mfa.challenge_succeeded`
- `auth.mfa.challenge_failed` (aggregate/rate-limited, no code)
- `auth.mfa.policy_changed`
- `auth.mfa.recovery_requested`
- `auth.mfa.recovery_approved`
- `auth.session.revoked`
- `auth.agent.relink_required`

Audit payloads contain identifiers, actor, tenant, factor type, policy version, reason code, server-derived source/device context, and timestamp. They never contain code values, password data, TOTP plaintext/ciphertext, encryption keys/nonces/tags, full QR URIs, SMTP credentials, assurance tokens, ID tokens, refresh tokens, or agent secrets.

Security emails are sent for factor enrollment/removal, recovery start/completion, policy-triggered lockout, password changes, and suspicious/new sign-in. They must include a clear action if the user did not initiate the event: revoke sessions, contact support, or secure the account.

## 16. Threat model and required controls

| Threat | Required control |
|---|---|
| Brute-force six-digit email code | Per-code attempt cap, UID/email/IP throttles, short TTL, slow salted hash, atomic lockout. |
| Offline cracking after DB leak | `scrypt`/Argon2id with per-code salt; short retention; never store plaintext. |
| Two usable codes after resend | Transactional supersede; verify only latest active row. |
| Duplicate/raced email sends | Delivery idempotency key and one active challenge lock. |
| Account enumeration | Uniform public responses and timing; pseudonymous metrics. |
| MFA bypass via direct API | Policy check in central backend middleware, not just UI. |
| Firebase token bypasses TOTP | Require both Firebase bearer and server-issued assurance session for every protected API; audit the pre-assurance allowlist. |
| MFA bypass via desktop OAuth | Complete a new link only after browser AAL2 assurance and bind it to the exact one-time agent state. |
| MFA bypass via custom token/device recovery | Treat device credential as continuation only; re-link after policy/grace changes. |
| QR/TOTP secret leak | Local QR generation, memory-only state, no logs/analytics/replay, explicit cleanup. |
| Database leak exposes TOTP factors | AES-256-GCM per factor, master key outside DB, associated data binding, narrow decrypt service, rotation and incident plan. |
| Backend host compromise exposes key and DB | Least-privilege process/secrets, host/container hardening, patching, monitoring, short decrypt lifetime, and documented acceptance that self-hosting cannot protect against a fully compromised verifier. |
| Reuse within the 30-second TOTP window | Store `last_used_step` and atomically reject the same/older matched counter after success. |
| Server clock manipulation/drift | NTP monitoring, narrow verification window, readiness alert, and fail safely when drift exceeds the supported bound. |
| TOTP phishing | Clear limitation in security copy; future passkeys/WebAuthn. TOTP is not phishing-resistant. |
| Session theft before MFA enrollment policy check | Block at bootstrap and middleware; revoke on policy/recovery changes. |
| CSRF on cookie/session routes | Existing bearer proof plus explicit CSRF design for credentialed cookie mutations; validate Origin/Referer where appropriate. |
| XSS stealing auth material | CSP, no untrusted HTML, dependency review, no remote QR service, avoid JS-readable custom assurance tokens. |
| Malicious remote icon | Fixed local icon allowlist; never render client-supplied URLs. |
| Email supply-chain failure | SPF/DKIM/DMARC, maintained SMTP relay, TLS, delivery metrics, bounce handling. |
| Support abuse during recovery | Restricted role, case ID, identity procedure, two-person approval for privileged users, immutable audit, notifications. |
| Tenant policy/cache confusion | Tenant-keyed cache, RLS, policy version, immediate invalidation. |

## 17. Testing plan

### 17.1 Unit tests

REST contract:

- The OpenAPI document parses and every implemented MFA/email-challenge/session/policy operation matches its declared method, path, authentication, request schema, response schema, and status codes.
- Dashboard-Web and Landing-Web generated/shared client types compile against the same contract version and reject unknown assurance states.
- No sensitive request field is permitted in route parameters or query strings; body allowlists reject unknown security-sensitive keys.
- Expected bootstrap states use the documented successful envelope; protected routes without adequate assurance return the stable `403` code rather than an inconsistent redirect or generic `500`.
- Idempotency tests prove repeated challenge issuance/delivery requests cannot create multiple active challenges or send multiple messages for one accepted idempotency key.
- REST error serialization redacts codes, secrets, tokens, ciphertext, database errors, SMTP responses, and crypto/library details.

Email challenge service:

- Generates exactly six numeric digits, including leading zeroes.
- Stores no plaintext.
- Challenge plus encrypted outbox job commit atomically; either both exist or neither exists.
- Outbox ciphertext decrypts only with its declared independent key version/AAD, and recipient/code markers never appear in database plaintext, logs, metrics, traces, errors, or Notify metadata.
- Two worker replicas cannot deliver the same job concurrently; lease expiry/recovery is safe and the delivery ID remains idempotent.
- Successful/permanent/expired/superseded delivery erases encrypted payload material; a restored expired job cannot send mail.
- Correct code succeeds once.
- Reuse fails.
- Expired code fails.
- Earlier code fails after resend.
- Five wrong attempts lock the challenge.
- Concurrent correct submissions produce one success.
- Concurrent issue requests produce one active challenge.
- Request limits apply independently by UID/recipient/IP/purpose.
- Constant-time comparison path handles malformed hashes without throwing.
- Delivery failure leaves no active code.

Policy service:

- Optional/role/all policies resolve correctly.
- Tenant and role changes invalidate cached decisions.
- Grace-period boundaries use server time.
- Last required recovery admin cannot be removed.
- Email challenges never satisfy an MFA-required policy.

UI/services:

- Every primary provider on Dashboard-Web and Landing-Web routes a successful Firebase primary sign-in through the same versioned bootstrap contract and, when required, the same MFA/recovery state machine.
- Dashboard-Web and Landing-Web response types/error codes remain in parity; a contract-version mismatch fails safely instead of granting access.
- Invalid TOTP clears only the code and preserves the factor selection.
- Cancel invalidates the server challenge and clears local state.
- Enrollment secret clears on unmount/success/cancel.
- QR/manual-secret controls are accessible.
- Organization toggles render server state, not hardcoded local defaults.

TOTP and assurance service:

- `otplib` passes all RFC 6238 vectors for supported settings.
- One Firebase UID with memberships in two tenants sees one identity-global factor set; tenant A cannot inspect tenant B membership/security context, and each tenant receives only its own policy-bound assurance session.
- Removing a membership revokes only that tenant's sessions/agent grants and preserves the identity-global factor; deleting/disabling the Firebase identity revokes globally and follows factor/recovery retention rules.
- Generated secrets meet the configured entropy/length and are unique in the test corpus.
- AES-GCM round-trip succeeds only with the correct key version and associated UID/factor data.
- Ciphertext, nonce, tag, or associated-data tampering fails closed.
- Missing/unknown encryption key version fails safely and readiness reports unhealthy.
- Current/allowed-adjacent step succeeds; outside-window code fails.
- A previously successful time step cannot be replayed, including under concurrent submissions.
- Attempt/rate limits apply by challenge, UID, IP, and factor.
- Expired pending factors and assurance sessions are rejected and cleaned up.
- Recovery code works exactly once and regeneration invalidates the old set.
- Only a token hash is stored for assurance sessions; cookie flags are exact.
- AAL1 cannot satisfy an AAL2 policy or recent-AAL2 action.

### 17.2 Integration tests

- Gateway routing tests cover every canonical `/api/v1/auth/*` and `/api/v1/settings/security/*` operation and prove it reaches the intended Auth-Backend or Dashboard-Backend owner.
- Contract tests execute the OpenAPI examples against staging and validate response content types, cache headers, cookies, `Retry-After`, CORS, and correlation IDs.
- The temporary unversioned aliases behave identically to `/api/v1` during migration and emit usage metrics; new web builds call only `/api/v1`.
- Dashboard-Web, Landing-Web, and the Tauri browser-link flow consume the REST APIs only; none accesses PostgreSQL/Redis/Notify directly or calculates expected TOTP values client-side.
- Dashboard-Backend to Notify-backend with internal auth and delivery idempotency.
- Dashboard-Web and Landing-Web both enter `mfa_required`, `mfa_enrollment_required`, `policy_grace`, `recovery_required`, and `ready` correctly for identical server responses.
- A user who starts on Landing-Web, satisfies MFA there, and opens Dashboard-Web receives the same still-valid assurance; the reverse direction behaves identically.
- Landing-Web cannot synchronize `vt_session`, enter its account area, or complete silent SSO while global bootstrap requires unresolved MFA.
- The canonical API origin accepts credentialed requests only from the allowlisted production web origins and preserves assurance/shared-session cookies through the Web Backend gateway.
- Switching between the gateway and direct Dashboard-Backend public origin cannot create two accepted assurance-cookie namespaces; the non-canonical browser origin is rejected or redirected during rollout.
- `session-bootstrap` blocks required-but-unenrolled users after grace.
- Direct protected API request cannot bypass the same policy.
- Enrolled user signs in through Firebase password + self-hosted TOTP.
- Google/Apple primary provider enters the same TOTP resolution path.
- Protected APIs reject a valid Firebase token with no assurance cookie, an AAL1 cookie under AAL2 policy, a mismatched UID/tenant, a revoked session, and an old policy version.
- Shared `vt_session` is created/synchronized only after the required assurance level is complete.
- `/session-status` and `/session-exchange` re-evaluate assurance/policy and cannot turn a primary-only shared cookie or Firebase custom token into AAL2.
- Policy change revokes/blocks the expected sessions.
- Recovery approval removes factors, revokes tokens, invalidates agent access as configured, and writes audit.
- Two different tenants receive only their own policy/recovery data.

### 17.3 Desktop tests

- Password sign-in with an enrolled account returns “Continue in browser,” not a raw Firebase error.
- Browser Google link with TOTP resolves and links the exact initiating agent session.
- Expired/cancelled link cannot be reused.
- A link cannot be completed with an ID token for a different link state.
- A newly required policy moves the agent through grace to re-link without losing queued activity.
- Diagnostic logs contain no password, code, secret, ciphertext/key material, assurance token, ID token, refresh token, or agent secret.

### 17.4 Manual compatibility matrix

Test current versions on real devices:

| Authenticator | Android | iOS | QR | Manual key | Issuer/account readable | Icon observed (informational only) |
|---|---:|---:|---:|---:|---:|---:|
| Google Authenticator | required | required | required | required | required | record, do not gate |
| Microsoft Authenticator | required | required | required | required | required | record, do not gate |
| 1Password or another standard app | one platform | one platform | required | required | required | record, do not gate |

Also test clock drift, offline phone code generation, multiple enrolled factors, factor removal, browser refresh mid-challenge, popup/redirect providers, dark/light themes, keyboard-only use, screen reader announcements, slow SMTP, bounced email, and production-like reverse-proxy IP headers.

### 17.5 Security validation

- Threat-model review before mandatory policy ships.
- Dependency and static analysis for new QR/parser packages.
- Verify CSP permits only the required local QR rendering path.
- Pen-test challenge enumeration, brute force, replay, concurrent consume, cross-tenant policy access, recovery abuse, and desktop link substitution.
- Capture sanitized Firebase token fixtures to prove primary `uid`/`auth_time` binding, and separate assurance-session fixtures to prove AAL2 handling.
- Exercise encryption-key rotation and restore from production-shaped backups in an isolated environment.
- Run a log scan after the end-to-end suite for six-digit test markers and token/secret patterns.

## 18. Observability and success metrics

### 18.1 Operational metrics

- Email challenge request, delivery success/failure, p50/p95 delivery latency, verify success, expiry, lockout, and resend rate by template/purpose.
- TOTP enrollment start/success/cancel/failure.
- MFA-required sign-in start/success/failure/recovery-start.
- Policy enrollment coverage by tenant/role.
- Recovery request volume and time to resolution.
- Agent re-link required/success/failure.
- SMTP bounce/complaint rate.

Metrics must not label raw email, IP, UID, challenge ID, or tenant name. Use bounded reason codes and privacy-safe tenant identifiers only where operationally necessary.

### 18.2 Initial product targets

Targets are hypotheses to confirm after baseline measurement:

- At least 90% of users who start TOTP enrollment complete it in the same session.
- At least 98% of valid TOTP challenges succeed within three attempts.
- At least 99% of accepted email-code sends reach the SMTP provider within 30 seconds.
- Fewer than 1% of required-MFA sign-ins start recovery.
- Zero successful direct-API or desktop-link policy bypasses in release testing.
- Zero authentication secrets found in automated log scans.
- 100% of privileged recovery approvals create a complete audit event and security notification.

### 18.3 Monitoring, alerting, and ownership

- Define service-level indicators for public availability, request success/error rate, p50/p95/p99 latency, saturation, email outbox age, SMTP delivery latency, database/Redis health, worker lag, clock drift, certificate expiry, and audit-write failures.
- Assign warning and critical thresholds, an alert recipient, acknowledgement target, escalation path, and linked runbook for every production alert. An unowned dashboard is not monitoring.
- Use multi-window alerts or equivalent persistence rules so one transient failure does not page, while sustained failure, burn-rate, queue-age, and capacity exhaustion alert before users are broadly affected.
- Provide liveness for process restart only and readiness for traffic admission. Readiness verifies required schema/key/config/dependency state without exposing secrets or creating expensive dependency storms.
- Run synthetic checks from outside the VPS for public DNS/TLS/gateway/bootstrap behavior and separate internal checks for private PostgreSQL, Redis, Notify, worker, and clock health. Synthetic checks use dedicated non-privileged test identities only when authentication is necessary.
- Correlate metrics, logs, traces, audit events, jobs, and dependency calls with safe request/trace IDs. Sampling may reduce ordinary traces but never required security audit events.
- Test alert delivery, runbook accuracy, silence/maintenance behavior, and monitoring-system failure in staging and through scheduled production drills.

## 19. Rollout phases

### Phase 0 — Decisions and infrastructure readiness

- Record the current eight-resource Coolify inventory and confirm that MFA v1 adds no required resource. Capture resource limits and available VPS CPU, memory, and disk before considering any optional catalogue service.
- Verify `virtual-tracker-auth`, `Virtual-Tracker-Dashboard-Backend`, `Virtual-Tracker-Web-Backend`, `virtual-tracker-notification`, `virtual-tracker-SQL-db`, and `Virtual-Tracker-RealTime-db` share only the Coolify internal network paths they require. Prove each connection from the calling container using the generated internal hostname; do not use cross-container `localhost` or public-domain round trips.
- Confirm PostgreSQL and Redis have no public port/domain exposure. Confirm the public Web Backend gateway routes the proposed MFA, email-challenge, and session paths to Dashboard-Backend with credentialed-cookie and trusted-proxy behavior intact.
- Confirm current PostgreSQL backup/restore status and create a combined restore procedure for PostgreSQL plus the matching offline TOTP key ring. Treat Redis as reconstructible/non-authoritative for MFA.
- Confirm the existing Firebase primary-auth setup remains unchanged and no Identity Platform upgrade is needed.
- Select and pin the self-hosted TOTP and QR dependencies; complete license/security review.
- Generate staging/production TOTP encryption key rings, define offline backup owners, and rehearse key restore/rotation.
- Confirm VPS/container clock synchronization and drift alerting.
- Inventory Firebase, Notify, SMTP, and any optional enrichment integrations; record credentials, data flow, deadlines, quotas, retry/idempotency, degraded behavior, test doubles, and owners. Confirm authenticator apps require no vendor API.
- Confirm MFA QR/manual/recovery material remains memory/text only and no object-storage resource is needed. If wider-product uploads are brought into scope, require the separate Section 26.7.8 review before deployment.
- Record current route/dependency latency, error rate, peak traffic, PostgreSQL/Redis pool use, container saturation, and queue baselines. Define initial API budgets and production-shaped load model.
- Select current or minimal optional self-hosted monitoring that can deliver owned alerts; create the alert catalogue, external synthetic checks, internal readiness checks, and staging incident/alert drills.
- Decide the SMTP relay approach—existing domain relay or self-hosted—and configure SPF/DKIM/DMARC.
- If production SMTP is not ready, use Mailpit only in an isolated local/staging environment. A decision to self-host Stalwart or another relay is a separate mail-operations project and does not block application development against a test relay.
- Define support recovery owners and approval policy.
- Decide whether existing desktop devices receive a grace period and its length.
- Establish a staging Firebase project and production-like domains.
- Create feature flags: `AUTH_EMAIL_CHALLENGES_ENABLED`, `TOTP_ENROLLMENT_ENABLED`, `TOTP_SIGNIN_ENABLED`, `TENANT_MFA_POLICY_ENABLED`, `AGENT_MFA_RELINK_ENABLED`.

**Exit:** documented owners; confirmed eight-resource topology; verified private connectivity and gateway forwarding; staging environment; reviewed dependencies/integrations; restorable PostgreSQL plus encryption keys; clock and service monitoring with tested alerts; no MFA file-storage dependency; recorded performance baselines/budgets; mail-domain readiness; and rollback plan.

### Phase 1 — Shared email challenge foundation

- Add schema/service, atomic verification, cleanup, and tests.
- Add the encrypted PostgreSQL outbox/worker plus Notify delivery idempotency, templates, explicit cooldowns, and metrics.
- Migrate Customer Accounts unlock onto the common service without behavior regression.
- Connect each allowlisted Dashboard-Web and Landing-Web entry flow to the same purpose-bound challenge API; do not create frontend-specific challenge tables or verification rules.
- Add security notifications and audit events.

**Exit:** email challenge suite passes, delivery failure cannot leave a usable challenge, existing Customer Accounts behavior is preserved.

### Phase 2 — Optional TOTP for web users

- Add encrypted factor/recovery/session schemas and `otplib` adapter in staging.
- Add personal enrollment and factor list/removal in Dashboard-Web, plus the shared post-Firebase sign-in challenge/assurance states in both Dashboard-Web and Landing-Web.
- Standardize both sites on the canonical browser auth/API origin, credentialed-cookie behavior, structured bootstrap response, and delayed shared-session synchronization.
- Keep policy optional.
- Test Google Authenticator and Microsoft Authenticator on real devices.

**Exit:** optional enrollment/sign-in/removal works after password, Google, Apple, and email-link primary authentication; Dashboard-Web and Landing-Web enforce the same assurance; cross-domain SSO cannot bypass it; replay and direct-API bypass tests pass.

### Phase 3 — Desktop compatibility

- Move agent browser linking through Firebase primary authentication plus the self-hosted AAL2 assurance session.
- Add Tauri MFA-required states and browser continuation.
- Define/rehearse agent grace and re-link behavior.

**Exit:** an enrolled user can link/re-link the agent; no link can complete before MFA; offline work is preserved.

### Phase 4 — Organization policy in report-only mode

- Persist policy and connect the existing settings UI.
- Compute affected/enrolled counts.
- Run middleware evaluation in report-only mode and compare expected blocks to actual usage.
- Add policy/grace UI and notifications.

**Exit:** seven-day report-only period has no unexplained policy decisions and recovery administrators are ready.

### Phase 5 — Enforce privileged roles

- Enable required MFA for internal test tenant Owners/Super Admins.
- Expand to selected pilot tenants.
- Monitor recovery, sign-in completion, email delivery, and agent re-link.
- Add kill switches that disable policy enforcement without deleting self-hosted factors.

**Exit:** two weeks without a critical bypass or unrecoverable lockout.

### Phase 6 — General availability

- Allow tenant owners to select role groups and grace period within safe bounds.
- Publish user/admin documentation and support runbook.
- Review metrics at 1 week, 1 month, and 1 quarter.

## 20. Rollback plan

- Feature flags can hide enrollment and stop new organization enforcement.
- Turning off tenant enforcement must not delete enrolled self-hosted factors.
- If the self-hosted TOTP service is unhealthy because of key, database, or clock failure, use the documented incident/recovery-admin procedure; do not silently accept email codes as equivalent MFA.
- Key rollback keeps the previous key version available until every factor has been re-encrypted and a post-rotation backup has been verified.
- If Notify fails, do not create usable email challenges; TOTP sign-in continues independently.
- If Dashboard policy evaluation fails, fail closed only for sensitive management routes and use a deliberate incident mode for general access; do not improvise behavior during an outage.
- Database migrations are additive. Do not drop the legacy `verification_codes` table until migrated data is expired and the new service has completed a production soak.
- Desktop release rollback must keep older agents from bypassing policy: backend enforcement remains authoritative and may require browser re-link.

## 21. Implementation sequence and file map

| Order | Area | Likely files |
|---:|---|---|
| 1 | Challenge schema/service | `Dashboard-Backend/src/lib/postgres/*`, new `src/modules/auth/challenges/*` |
| 2 | Notify idempotency/templates | `Notify-backend/src/modules/email/routes.js`, `email-builders.js`, `notify-log.service.js`, schema/tests |
| 3 | Audit/context parsing | `Dashboard-Backend/src/modules/auth/security-login-alerts.js`, new audit service |
| 4 | Encrypted TOTP/factor/session foundation | `Dashboard-Backend/src/modules/auth/mfa/*`, Postgres schema, env validation, key rotation script/tests |
| 5 | Central assurance enforcement | `session-bootstrap.js`, `auth-middleware.js`, `session-cookie-routes.js`, API credential/CORS tests |
| 6 | REST contract and canonical gateway/auth-origin routing | `docs/openapi/auth-mfa-v1.yaml`, shared/generated TypeScript models, `Virtual-Tracker-Web-Backend` routing/config, credentialed CORS, proxy/cookie/contract tests |
| 7 | Dashboard web MFA services/UI | `Dashboard-Web/features/auth/*`, `shared/providers/auth/auth-context.tsx`, `infrastructure/api/http.ts` |
| 8 | Landing web global assurance | `Landing-Web/src/lib/auth/*`, `src/lib/api/*`, sign-in/account challenge UI, shared-contract parity tests |
| 9 | Personal security settings | new Dashboard-Web auth security components plus settings routing |
| 10 | Policy persistence/API | `Dashboard-Backend/src/modules/auth/*`, settings routes, tenancy schema |
| 11 | Organization settings | replace demo state in both current security settings surfaces |
| 12 | Desktop/browser link | `Auth-Backend/src/modules/auth/google-oauth.js`, Dashboard-Web agent-link flow, Tauri auth state |
| 13 | Recovery admin | backend routes/service, restricted UI, session/device revocation |
| 14 | Documentation/operations | deploy docs, Notify docs, support runbook, user help |

Avoid maintaining two independent organization 2FA settings pages. Choose one canonical settings surface and make the other link to it or reuse the same component/data source.

## 22. P0 acceptance criteria

### Coolify deployment and operations

- [ ] MFA v1 runs on the confirmed eight production resources without requiring another database, identity provider, queue, secret manager, or mail-testing container.
- [ ] Dashboard-Backend reaches the existing PostgreSQL, Redis, Auth, and Notify resources through verified Coolify internal hostnames; no cross-container dependency uses `localhost` or an unnecessary public-domain round trip.
- [ ] PostgreSQL and Redis have no public domain or published external port.
- [ ] The public Web Backend forwards every documented MFA/email-challenge/session route to Dashboard-Backend and preserves the required cookies, origin/CORS behavior, HTTPS scheme, and trusted client-IP chain.
- [ ] Only Dashboard-Backend has `TOTP_MASTER_KEYS`, `TOTP_ACTIVE_KEY_ID`, and `AUTH_CHALLENGE_HMAC_KEY`; no browser build, Auth-Backend, gateway, Notify container, database, Redis instance, log, or diagnostic export contains them.
- [ ] Notify alone holds production SMTP credentials, while Dashboard-Backend calls it using the shared internal-service credential and an idempotent delivery contract.
- [ ] A PostgreSQL restore plus the matching offline TOTP key ring has been rehearsed in isolation; a Redis restart/eviction cannot resurrect, replay, or consume authoritative MFA state.
- [ ] Feature flags default off and startup/readiness fails safely when an enabled MFA capability lacks its required schema, encryption key version, service dependency, or clock health.
- [ ] Any optional catalogue service is supported by an approved architecture decision and cannot become an undocumented MFA bypass or single point of failure.

### Global surface enforcement

- [ ] Dashboard-Web, Landing-Web sign-in/account/invite flows, the public Web Backend gateway, direct protected APIs, shared-session exchange, and desktop browser linking all use the same Dashboard-Backend assurance and policy evaluator.
- [ ] An authenticator enrolled for a Firebase UID works across Dashboard-Web, Landing-Web, desktop browser linking, and every tenant membership that permits/requires TOTP without duplicate enrollment; authorization and assurance remain bound to the selected tenant/policy/action.
- [ ] The selected canonical browser auth/API origin is used by both web applications; production does not accept parallel assurance-cookie namespaces on both gateway and direct Dashboard-Backend origins.
- [ ] A user subject to required MFA cannot obtain protected Landing-Web or Dashboard-Web access, a synchronized `vt_session`, a custom-token SSO completion, or an agent link with only a Firebase ID token.
- [ ] A valid non-revoked AAL2 session can be reused across allowed Dashboard/Landing navigation without a duplicate prompt, while logout, policy change, factor removal, recovery, or revocation invalidates it globally.
- [ ] The same allowlisted email-code purpose behaves identically regardless of whether it was initiated on Dashboard-Web or Landing-Web, and its result cannot be consumed for another purpose/surface/action.
- [ ] Public Landing-Web pages that require no account remain available without Firebase, TOTP, an assurance cookie, or Notify health.
- [ ] Email codes are never presented as or accepted as the TOTP factor for a policy that requires 2FA.

### REST API contract

- [ ] A reviewed `docs/openapi/auth-mfa-v1.yaml` documents every new public/internal MFA, email-challenge, assurance-session, factor, recovery, and policy endpoint with authentication, schemas, status codes, rate limits, cache behavior, and safe examples.
- [ ] Dashboard-Web, Landing-Web, and desktop browser-link integrations use the same versioned REST contract and shared/generated models; no client directly reads PostgreSQL/Redis or calls Notify to grant authentication state.
- [ ] New production clients call canonical `/api/v1` routes. Any unversioned compatibility alias is measured, documented, behaviorally identical, and removable after its sunset.
- [ ] Bootstrap uses structured expected states; protected API calls with insufficient assurance fail with stable machine-readable `403` responses and never rely on UI redirects for enforcement.
- [ ] Challenge issuance and Notify delivery are idempotent, while verification/consumption/mutation endpoints are never blindly retried.
- [ ] CORS, CSRF/origin validation, bearer authentication, HttpOnly assurance cookies, rate limits, request-size limits, `no-store`, trusted proxy handling, correlation IDs, and secret redaction are covered by automated contract/integration tests.
- [ ] REST documentation and implementation contain no production bypass, endpoint that returns a code/secret, arbitrary challenge purpose, or route that treats email verification as required MFA.

### Backend engineering controls

- [ ] Every new request, environment value, background-job payload, and external response is schema-validated, allowlisted, bounded, and tested; SQL is parameterized and untrusted values are correctly output-encoded.
- [ ] Central error handling produces the documented safe status/code/retry behavior, rolls back partial mutations, preserves enumeration resistance, and never exposes raw internal/provider/crypto/database errors.
- [ ] HTTPS, exact credentialed CORS, CSRF/origin checks, security headers, API authentication, central authorization, rate/brute-force controls, lockout safety, encryption, secret management, dependency scanning, and least-privilege database roles pass automated tests.
- [ ] Redis, memory, PostgreSQL projections, HTTP caches, service workers, and CDN/reverse-proxy caching follow the allow/deny/invalidation matrix in Section 26.7.4; no cache is an authorization/replay source of truth.
- [ ] Slow/retryable email delivery and maintenance work uses the coordinated PostgreSQL outbox/jobs without a ninth Coolify resource; user requests return after durable acceptance rather than SMTP completion.
- [ ] Queue jobs are encrypted/schema-versioned where necessary, idempotent, leased, bounded, observable, expiry-aware, safe under restore/restart/multiple replicas, and administratively replayable without exposing payload secrets.
- [ ] Structured operational logs contain correlation, route, latency, safe actor/tenant/action/result, dependency, job, and readiness context while all credentials/codes/tokens/secrets/ciphertext/raw bodies are absent.
- [ ] Append-only audit events cover every factor, challenge, session, recovery, policy, key, and privileged administration lifecycle; audit access/export is restricted and audited.
- [ ] Metrics, traces, health/readiness, synthetic checks, actionable alerts, named owners, and exercised runbooks detect availability, latency, saturation, clock, queue, database, Redis, SMTP, and audit-write failures before broad user impact.
- [ ] MFA stores no uploaded QR/file objects. Any wider-product upload integration is private-by-default and proves authorization, size/type/content validation, malware handling, signed-URL restrictions, lifecycle cleanup, and deletion behavior.
- [ ] Every Firebase, SMTP, Notify, enrichment, or future third-party call has an inventory owner, strict schema, authentication, timeout, bounded retry/circuit behavior, quota/backpressure handling, data-minimization rule, metrics, test double, and documented outage behavior.
- [ ] Every inbound webhook verifies the raw body, signature, timestamp/replay window, event allowlist, payload bounds, and delivery idempotency before durable asynchronous processing; outbound callbacks prevent SSRF and sign versioned payloads.
- [ ] Audit records are transactionally coupled to sensitive state changes, immutable to application/support roles, independently retained/exportable, tamper-evident, secret-free, and covered by completeness and failure-mode tests.
- [ ] Versioned APIs meet recorded latency, error-rate, throughput, concurrency, database-pool, queue-age, and payload-size budgets under normal, burst, dependency-degraded, and abuse load without weakening security checks.

### Email challenges

- [ ] The server generates and sends a six-digit code without persisting or logging plaintext.
- [ ] A code expires after the configured TTL and works at most once.
- [ ] Resending invalidates every older active code for that identity and purpose.
- [ ] Five failed attempts lock the code; request/verify routes are rate-limited by appropriate keys.
- [ ] Concurrent requests cannot create two usable active codes or consume one code twice.
- [ ] Public requests do not reveal whether an account exists.
- [ ] Notify delivery idempotency cannot suppress a new code while reporting it as sent.
- [ ] Email challenges never satisfy a required-MFA policy.

### Authenticator app

- [ ] An email-verified user can enroll through a locally rendered QR code or manual secret.
- [ ] The entry label contains `My Virtual Tracker` and the correct account identifier.
- [ ] Google Authenticator and Microsoft Authenticator both generate a code accepted by Dashboard-Backend's reviewed RFC 6238 adapter.
- [ ] Password, Google, Apple, and email-link primary sign-ins all enter the same Virtual Tracker MFA challenge when policy/factor state requires it.
- [ ] TOTP secrets are stored only as AES-256-GCM ciphertext with key version outside the database; plaintext URI/secret/code never reaches logs, analytics, or durable browser storage.
- [ ] A TOTP from an already accepted time step cannot be replayed.
- [ ] Recovery codes are high entropy, displayed once, stored only as slow hashes, and accepted once.
- [ ] Removing a factor requires recent authentication and creates both audit and email notification.
- [ ] The UI never promises that a third-party authenticator will show the My Virtual Tracker icon.

### Policy and desktop

- [ ] Required MFA is checked in `session-bootstrap` and central API middleware.
- [ ] Direct API calls cannot bypass organization policy.
- [ ] Enabling policy provides a grace window and shows affected enrollment counts.
- [ ] A recovery process is operational before mandatory enforcement.
- [ ] Desktop Google/password linking cannot finish before a valid AAL2 assurance session exists.
- [ ] Existing desktop device recovery cannot be used to enroll/remove MFA or satisfy a fresh step-up.
- [ ] Agent re-link does not delete queued offline activity.

### Authentication context/icons

- [ ] Virtual Tracker's UI shows a safe bundled icon plus source/browser/OS/time for known sessions.
- [ ] Unknown clients receive a generic icon and text, not a broken or remote icon.
- [ ] No client-supplied icon URL is rendered.
- [ ] Optional location is clearly approximate and has passed privacy review.

## 23. Open questions

### Blocking before implementation

1. **Product:** Does “email code login” mean a passwordless primary sign-in, a code after password, or only verification/recovery? This plan supports email ownership/recovery first; a numeric-code primary sign-in would require a separate assurance/session design because Firebase natively offers email links rather than six-digit email OTP as a second factor.
2. **Security/operations:** Who owns the offline TOTP master-key backup and rotation ceremony, and where are the recovery copies kept?
3. **Security/support:** Who may approve MFA recovery, and do privileged accounts require two-person approval?
4. **Desktop product:** How long may an already linked agent continue after its tenant starts requiring MFA?
5. **Settings/product:** Which existing security settings page is canonical? Two writable surfaces would create drift.

### Non-blocking during development

1. **Design:** Exact names for factor labels, grace banners, and recovery states.
2. **Security:** Whether to display full or masked IP addresses to end users.
3. **Privacy/legal:** Whether country-level IP enrichment is worth the data-processing dependency.
4. **Product:** Whether optional MFA is available to every plan or only organization/enterprise plans.
5. **Engineering:** Whether challenge cleanup runs in the existing backend scheduler or a dedicated maintenance job.
6. **Operations:** Select the outbox worker polling/notification mechanism and latency target while preserving the transactional PostgreSQL-outbox decision in Section 8.4.

## 24. Definition of done

The work is complete only when:

- The feature has been deployed and verified on the existing eight-resource Coolify topology, with no unapproved ninth dependency and no publicly exposed PostgreSQL or Redis endpoint.
- Dashboard-Web, Landing-Web protected flows, the gateway, shared-session exchange, protected APIs, and desktop linking demonstrably enforce one global assurance contract with no weaker alternate surface.
- The versioned REST/OpenAPI contract is the tested integration boundary for all web, gateway, backend, notification, and desktop-link participants; no security decision depends on duplicated frontend logic.
- The self-hosted TOTP dependencies, encrypted factor storage, key backup/rotation, assurance sessions, and clock requirements are documented and reproduced in staging.
- Optional TOTP enrollment and sign-in work end to end on the web with at least Google and Microsoft Authenticator.
- Desktop linking works for MFA users without bypassing the factor.
- Email challenge generation, delivery, verification, throttling, cleanup, and redaction are verified.
- Organization policy is persisted, tenant-scoped, centrally enforced, and recoverable.
- Security notifications, audit records, observability, support runbook, and rollback controls exist.
- Alert delivery and incident drills prove operators learn of availability, latency, saturation, queue, dependency, clock, certificate, and audit failures without waiting for user reports.
- External integrations and any delivery webhooks pass timeout, schema, TLS/authentication, retry/idempotency, quota, duplicate/replay, outage, rotation, and reconciliation tests; no provider response grants assurance directly.
- MFA creates no durable QR/file objects. Any separately approved upload feature passes private-storage, signed-URL, authorization, validation/quarantine/scanning, quota, cleanup, deletion, and tenant-isolation tests.
- Audit completeness, immutability/tamper evidence, access/export, retention, failure rollback, backup, and restore are verified independently of ordinary application logs.
- API latency/error/throughput and resource headroom meet the approved budgets under production-shaped normal, burst, abuse, soak, queue-backlog, and dependency-degraded tests.
- Automated backend/web/notify/Tauri tests pass.
- Manual cross-device/authenticator tests pass.
- A security review finds no known P0/P1 bypass or secret leakage.
- Production rollout begins optional/report-only and reaches required enforcement only after the exit criteria above.

## 25. Authoritative references

- [RFC 6238: TOTP standard and security requirements](https://www.rfc-editor.org/rfc/rfc6238)
- [otplib: maintained RFC 6238 implementation and interoperability guidance](https://otplib.yeojz.dev/guide/getting-started.html)
- [node-qrcode: local QR generation](https://github.com/soldair/node-qrcode)
- [Firebase: Manage session cookies](https://firebase.google.com/docs/auth/admin/manage-cookies)
- [Firebase: Authenticate using email links](https://firebase.google.com/docs/auth/web/email-link-auth)
- [Google Authenticator Key URI format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format)
- [NIST SP 800-63B: Authentication and authenticator management](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [Coolify: Database resources and internal connection URLs](https://coolify.io/docs/databases/)
- [Coolify: Service networking and predefined network boundaries](https://next.coolify.io/docs/services/configuration/networking)
- [Mailpit: SMTP/email testing features](https://mailpit.axllent.org/docs/)
- [Stalwart: Docker deployment and mail-server operations](https://stalw.art/docs/install/platform/docker/)
- [HashiCorp Vault: centralized secrets management](https://developer.hashicorp.com/vault/docs)
- [Infisical: secrets-management documentation](https://infisical.com/docs/documentation/getting-started/introduction)

## 26. Follow-up completeness audit

This section is the follow-up audit requested after REST APIs were initially under-emphasized. It is authoritative where it clarifies or tightens an earlier section. Its purpose is to prevent implementation from completing the visible QR/code screens while omitting a supporting layer required for a secure global system.

### 26.1 Cross-layer coverage register

| Layer that could otherwise be missed | Decision now captured | Required implementation evidence |
|---|---|---|
| Existing REST APIs and ownership | REST/OpenAPI is the integration boundary; Auth-Backend keeps primary identity, Dashboard-Backend owns assurance, the gateway routes, and Notify only delivers | Reviewed OpenAPI document, route-owner tests, generated/shared types, status/error/idempotency tests, and no direct frontend/database coupling |
| Global identity versus tenant scope | TOTP factors and recovery codes belong to the Firebase UID globally; policy and authorization sessions remain tenant/action-bound | Identity-global factor schema/repository tests, two-tenant membership tests, cross-tenant revocation tests, and proof that tenant admins see only safe enrollment projections |
| PostgreSQL schema migration | MFA uses additive, reversible-in-behavior migrations on the existing PostgreSQL resource | Expand/contract migration scripts, lock/runtime estimates, production-shaped rehearsal, schema-version readiness, backward-compatible deploy window, and rollback that disables code without destroying factors |
| Database roles and grants | Identity-security tables are not ordinary tenant business tables and are inaccessible to browser, gateway, Notify, reporting, support exports, and routine tenant queries | Explicit least-privilege grants, catalog tests, live role tests, and separate safe projections for enrollment reporting |
| Redis role | Redis accelerates limits/cache invalidation but never owns factors, replay state, assurance truth, recovery, or audit | Redis outage/eviction/restart tests showing no replay, bypass, or resurrection; documented fail-open/fail-closed decision for each cached item |
| Background cleanup/jobs | Expired challenges, pending factors, sessions, idempotency records, and retained audit metadata require bounded cleanup | Idempotent jobs, PostgreSQL advisory lock or other single-runner coordination, batch limits, timeouts, metrics, retry policy, multi-replica tests, and no deletion of live rows |
| Email delivery state | Challenge issuance and delivery must not diverge; SMTP retries cannot send a superseded code as current | Pending/active/delivery-failed transaction model, delivery idempotency, resend supersession, bounce/complaint handling, delayed-delivery expiry behavior, and user-safe status |
| Gateway and proxy trust | One canonical browser API origin owns the assurance cookie and routes to the correct backend | Route table tests, exact CORS origins, CSRF/origin checks, trusted proxy/IP chain, header/cookie preservation, request limits, no parallel cookie namespaces, and private upstreams |
| Shared browser session | Dashboard-Web and Landing-Web cannot independently decide when a user is fully authenticated | One bootstrap state contract, delayed `vt_session` creation, guarded session exchange, logout/revocation propagation, and same-UID/tenant binding tests |
| Multi-tab and race behavior | Two tabs can resend, verify, enroll, remove a factor, or log out concurrently | Atomic server transitions, one active challenge per bound purpose, stale-state responses, cross-tab logout/revocation notification, no recovery-code double use, and deterministic UI recovery |
| Account/email lifecycle | Email change, Firebase disable/delete, provider linking/unlinking, UID migration/merge, tenant join/leave, role change, and tenant switch affect security state | Explicit lifecycle handlers/tests; notification to old/new verified email where safe; factor preservation only for the same verified UID; global factor/session cleanup on account deletion; tenant-only revocation on membership removal |
| Organization changes | A user may belong to multiple tenants with different MFA policies | Target-tenant selection cannot be client-forged; policy is recalculated on switch; no re-enrollment is required; tenant-bound assurance is issued only after acceptable identity-global proof |
| Recovery operations | Recovery is a privileged workflow, not an alternate weak login | Recovery role/approval model, case state machine, two-person rule for privileged users if selected, evidence checklist, timeouts, notifications, global revocation, immutable audit, and support runbook |
| Factor/recovery-code UX | Secrets are displayed once and must be saved without entering logs, analytics, clipboard history assumptions, or screenshots | No-store/masking rules, explicit print/download decision, confirmation that codes were saved, regeneration/revocation behavior, accessible manual-key path, and user warnings |
| Server time | TOTP depends on accurate time across containers/hosts | NTP configuration, drift metric/alert, readiness threshold, deterministic injected-clock tests, and incident behavior that never widens the acceptance window automatically |
| Encryption-key lifecycle | Database backup alone cannot restore factors | Versioned key-ring parser/schema, startup self-test, rotation/re-encryption procedure, offline custody, access audit, loss/compromise runbooks, and isolated combined restore rehearsal |
| Backup/disaster recovery | PostgreSQL, encryption keys, configuration, and mail/DNS recovery have different failure modes | Defined RPO/RTO, encrypted backups, restore automation/checklist, isolated restore test, integrity sampling, operator ownership, and proof restored sessions are revoked when appropriate |
| Capacity and availability | MFA adds DB/crypto/SMTP load to an existing constrained VPS | Load tests for bootstrap/verify/resend bursts, PostgreSQL pool budget, CPU/latency targets, Redis/SMTP/database failure injection, queue/backpressure limits, resource alerts, and denial-of-service safeguards |
| Observability | Operators need failures without collecting authentication secrets | Bounded metrics/reason codes, redacted structured logs, correlation IDs, delivery/verification funnels, drift/key/schema readiness, alerts/runbooks, and automated secret-pattern log scans |
| Privacy and retention | Authentication context contains personal/security data | Purpose-specific retention periods, IP/user-agent hashing or masking, data-subject export/deletion rules, audit retention/legal basis, no raw identifiers in metrics, and coarse-location review before enablement |
| Accessibility and localization | Code/QR/recovery screens are critical-path interfaces | Keyboard and screen-reader flows, focus/error announcements, non-visual QR alternative, paste/autofill, contrast/zoom/mobile testing, externalized strings, locale-safe time display, and no RTL-breaking code inputs |
| Dependency and supply chain | QR/TOTP/parser packages enter an authentication boundary | Exact pins/lockfile, license review, provenance/maintainer review, SBOM, vulnerability scanning, update cadence, minimal dependency selection, and no remote QR/icon service |
| CI/CD and deployment order | Old/new gateway, backend, database, web, and agent versions coexist during rollout | Compatibility matrix; deploy additive schema then backend/gateway then web then agent; smoke/contract tests; feature flags off by default; automatic readiness gate; rollback rehearsal |
| Desktop/offline behavior | Agent link, custom tokens, queued activity, and old clients can bypass or break stronger policy if unspecified | Minimum supported version, structured MFA errors, browser continuation, one-time bound link exchange, grace/re-link policy, preservation of offline work, and forced-upgrade/unsupported-client behavior |
| Incident response | Key compromise, factor bypass, SMTP abuse, or database exposure needs a prepared response | Severity definitions, kill switches, global session/factor revocation tools, customer notification decision tree, evidence preservation, rotation steps, owners/escalation, and post-incident review template |
| Product/support documentation | A technically correct feature can still cause lockouts and support mistakes | User setup/recovery help, tenant-admin rollout guide, operator deployment/runbook, support verification script, troubleshooting codes, icon limitation wording, and escalation contacts |

### 26.2 Migration and release compatibility requirements

Use an expand/contract deployment sequence:

1. Add tables, indexes, constraints, grants, environment schema, readiness probes, OpenAPI contract, and disabled feature flags. Old application versions must continue working.
2. Deploy Dashboard-Backend and gateway support while enrollment/sign-in/policy enforcement remain disabled. Verify schema, clock, keys, internal network, Notify, CORS, and cookies in staging.
3. Deploy both web clients with support for every new bootstrap state; unknown states fail closed. Keep the backend capable of serving the immediately previous web build during the rollout window.
4. Enable email-challenge foundations, then optional enrollment, then optional sign-in, then desktop compatibility, then report-only tenant policy, then privileged-role enforcement.
5. Do not enable a backend state that the deployed Dashboard-Web, Landing-Web, gateway, or supported agent cannot understand.
6. Rollback disables flags and restores the previous application image while retaining additive schema and encrypted factors. Do not roll back by deleting factors, challenges, recovery cases, audit records, or key versions.

Every release candidate records the minimum compatible versions of Dashboard-Web, Landing-Web, Web Backend gateway, Dashboard-Backend, Auth-Backend, Notify, and Tauri agent. Deployment must stop if the compatibility matrix or schema/key readiness check fails.

### 26.3 Account and membership lifecycle rules

- **Verified email changes:** require recent primary authentication and, when enrolled/required, recent AAL2. Update future TOTP display labels only through explicit re-enrollment/rename; an existing authenticator's label is an enrollment snapshot. Send security notifications to the old and new verified addresses where delivery/privacy rules permit.
- **Provider link/unlink:** linking Google/Apple/password methods does not create or remove a TOTP factor. Removing the last usable primary provider is refused. High-risk provider changes revoke assurance and require fresh proof.
- **Firebase UID change/merge:** never copy encrypted factors to another UID automatically. A controlled migration must prove both identities, decrypt/re-encrypt with new associated data, rotate recovery codes, revoke sessions, and audit the operation; otherwise require re-enrollment.
- **Account disable/delete:** disable immediately revokes Firebase tokens, all tenant assurance sessions, shared cookies, recovery flows, and agent credentials. Permanent deletion follows retention/legal rules and removes identity-global factor/recovery material through an audited job.
- **Tenant join/leave/switch:** joining a tenant reuses the identity-global factor but applies the new tenant's policy. Leaving removes only that tenant's memberships/sessions/agent grants. Switching tenant re-runs policy and cannot trust a client-supplied role/tenant claim.
- **Role/policy change:** cache invalidation and policy-version mismatch take effect on the next protected request; privileged escalation requires recent AAL2 before the mutation and again under the new context if policy requires it.

### 26.4 Background work and failure ownership

For every scheduler/outbox/cleanup task, document: owner process, cadence, leader/lock mechanism, maximum batch, retry/backoff, poison-item handling, timeout, metrics, alert, manual replay, and behavior during deploy/rollback. No task may run independently in every replica without coordination.

Minimum jobs/workers:

- expire/supersede email challenges and delete secret hash material after retention;
- expire pending factor enrollments and revoke expired assurance sessions;
- purge used/expired idempotency keys after the replay window;
- retry only safe Notify deliveries through an outbox if asynchronous delivery is selected;
- re-encrypt factors during key rotation in resumable bounded batches;
- reconcile orphaned sessions/factors/membership references without logging secrets;
- produce safe coverage/health aggregates for report-only rollout.

### 26.5 Required documentation and runbooks

Implementation is not complete until these repository artifacts exist and match production behavior:

| Artifact | Minimum content |
|---|---|
| `docs/openapi/auth-mfa-v1.yaml` | Versioned REST operations, schemas, auth/cookies, states/errors, status codes, idempotency, rate limits, cache/CORS behavior, safe examples |
| Coolify deployment guide | Exact eight-resource mapping, internal hostnames, variables/secrets by container, gateway routes, health checks, deploy order, smoke tests, rollback |
| Observability and alert catalogue | SLIs/SLOs, metric/log/trace schema, dashboards, warning/critical thresholds, owners, destinations, runbook links, retention/redaction, synthetic checks, and alert-test evidence |
| External integration and webhook register | Provider/data owner, purpose, endpoints/events, credentials, data classification, timeout/retry/idempotency/quota policy, signature/replay rules, outage behavior, test double, and removal plan |
| API performance report | Per-route latency/error/throughput/payload budgets, representative dataset and traffic model, database/cache/worker budgets, load/soak/failure results, bottlenecks, and accepted exceptions |
| Key-management runbook | Generation, custody, backup, access, rotation, re-encryption, restore, loss, compromise, and retirement |
| SMTP/deliverability runbook | Relay ownership, SPF/DKIM/DMARC, TLS, bounce/complaint handling, queue inspection, abuse response, test-versus-production isolation |
| MFA recovery/support runbook | Eligibility, identity evidence, roles/approvals, case states, privileged-account escalation, revocation, notification, audit, refusal conditions |
| Incident runbook | Key/database/session/factor/SMTP incidents, kill switches, session revocation, communication, evidence, recovery, postmortem |
| User and tenant-admin help | Enrollment, manual key, recovery codes, lost device, multiple authenticators, policy rollout/grace, desktop re-link, third-party icon limitation |
| Compatibility/release record | Minimum versions, migration/schema version, key versions, flags, rollout cohort, verification evidence, rollback result |

### 26.6 Follow-up backlog

| ID | Priority | Follow-up | Completion gate |
|---|---|---|---|
| `AUTH-F01` | P0 | Resolve the five blocking product/operations questions in Section 23 | Named decision owner, selected answer, date, and updated acceptance tests |
| `AUTH-F02` | P0 | Write and validate the OpenAPI contract and shared client models | Spec lint passes; both web clients compile; gateway ownership tests pass |
| `AUTH-F03` | P0 | Implement/rehearse identity-global factor/recovery schema and tenant-bound assurance migrations/grants | Production-shaped migration and live role/isolation tests pass |
| `AUTH-F04` | P0 | Implement coordinated cleanup/outbox/key-rotation jobs | Multi-replica, retry, interruption, and manual replay tests pass |
| `AUTH-F05` | P0 | Implement account/email/provider/tenant lifecycle handling | Lifecycle matrix has automated integration tests and audited revocation behavior |
| `AUTH-F06` | P0 | Prove canonical gateway, cookie, CORS, CSRF, proxy-IP, session exchange, and multi-tab behavior | Cross-origin/browser integration suite passes with no alternate assurance namespace |
| `AUTH-F07` | P0 | Rehearse PostgreSQL plus TOTP-key backup/restore and key compromise response | Isolated restore produces usable factors; compromise drill revokes/rotates safely |
| `AUTH-F08` | P0 | Load/failure test bootstrap, verification, resend, policy, PostgreSQL, Redis, Notify, and clock drift | Capacity targets and alert thresholds are recorded; no failure creates a bypass |
| `AUTH-F09` | P0 | Publish operator, support, recovery, incident, and user documentation | Runbooks are exercised by someone other than the author and corrections are merged |
| `AUTH-F10` | P0 | Add CI gates for OpenAPI drift, migration compatibility, dependencies, secret scanning, and end-to-end auth | Required checks block merge/release on a security contract regression |
| `AUTH-F11` | P0 | Implement and verify the backend engineering checklist in Section 26.7 | Validation, error, security, cache, worker/queue, logging, and audit tests pass in all owning services |
| `AUTH-F12` | P0 | Implement and verify observability, external-integration, webhook, audit-integrity, and API-performance controls in Sections 18.3 and 26.7.7-26.7.12 | Alert drills, provider/webhook failure tests, audit completeness/tamper tests, and production-shaped load/soak budgets pass; file storage is proven unnecessary or separately secured |
| `AUTH-F13` | P1 | Add optional captcha only if measured abuse justifies it | Accessibility/privacy review and server-side controls remain authoritative |
| `AUTH-F14` | P1 | Evaluate passkeys/WebAuthn as a phishing-resistant factor | Separate architecture/threat model; does not delay TOTP v1 |
| `AUTH-F15` | P1 | Evaluate one secret manager, monitoring stack, and backup UI only if operations need them | Separate ADR and capacity/security review; no duplicated optional services |
| `AUTH-F16` | P2 | Evaluate coarse sign-in location and richer device/icon context | Privacy review, accuracy wording, local icon allowlist, and no auth decision based on location/icon |

### 26.7 Backend engineering checklist

This P0 checklist applies to Dashboard-Backend, Auth-Backend, the Web Backend gateway/Landing route layer, and Notify-backend. Existing helpers may be reused, but every new MFA/email endpoint and job must prove the behavior below through tests.

#### 26.7.1 Input validation and sanitization

- Define one server-side schema for every body, path parameter, query parameter, header, webhook payload, environment variable, and background-job payload. Frontend validation is usability only and never trusted.
- Require the expected `Content-Type`, reject malformed/oversized JSON before business logic, cap nesting/array/string sizes, and reject unknown security-sensitive fields instead of silently accepting them.
- Allowlist enums and action/purpose/template keys. Validate UUID/token shapes, integer bounds, timestamps, redirect destinations, tenant/member/factor relationships, and state transitions.
- TOTP and email codes accept exactly the configured ASCII digits after safe whitespace removal; do not coerce floats, signs, Unicode lookalikes, or longer strings. Factor labels are length-limited, control-character-free text.
- Normalize email addresses consistently for lookup/rate-limit keys without inventing provider-specific transformations. Preserve the verified canonical address for delivery and display.
- Redirect/continue URLs use a fixed same-site origin/path allowlist. Never accept a scheme, hostname, callback, template name, icon URL, or internal upstream from an untrusted request.
- Use parameterized PostgreSQL queries only. Dynamic identifiers, sort keys, and SQL fragments come from fixed server allowlists; user input is never concatenated into SQL.
- Escape untrusted values for their output context: JSON serializer for API output, HTML/text escaping in email templates, CR/LF rejection in headers, and structured logger fields instead of interpolated log lines.
- Reject prototype-pollution keys such as `__proto__`, `prototype`, and `constructor` in generic metadata objects. Avoid recursive merges of client objects into configuration or persisted security records.
- Never “sanitize and continue” when that could turn an invalid security value into a different valid identity/action. Reject with a stable validation error and correlation ID.

#### 26.7.2 Error handling

- Use a centralized typed application-error model with stable machine code, safe message, HTTP status, retryability, and correlation ID. Each service maps internal/library/provider failures at its boundary.
- Return the status behavior in Section 12.6 consistently. Expected MFA progression is structured state, not an exception; inadequate assurance is `403`; throttling is `429` with bounded `Retry-After`; required dependency/readiness failure is `503`.
- Public sign-in, code request, email lookup, invite, and recovery errors are enumeration-safe. Timing and response shape must not disclose whether a UID/email/factor/recovery case exists.
- Never return stack traces, SQL text, constraint names, file paths, environment values, Firebase/SMTP responses, crypto details, internal hostnames, raw exception messages, tokens, codes, ciphertext, or key identifiers beyond an approved safe active-key health boolean.
- Roll back the entire database transaction when an issue/verify/consume/policy/recovery operation fails. Do not catch and continue after partial security-state mutation.
- Classify dependency errors as retryable, permanent, degraded, or fatal. Apply explicit connection/request timeouts; retry only idempotent operations with bounded backoff/jitter; never blindly retry code consumption or factor/policy mutations.
- The top-level request/job boundary records a redacted failure and returns or persists a safe outcome. Unhandled fatal errors make readiness fail and let the process supervisor restart; they never leave the service claiming healthy.
- User-facing copy explains the safe next step without revealing internals. Operators correlate the incident through the request/job ID and protected logs.

#### 26.7.3 Security control checklist

| Control | Required implementation |
|---|---|
| HTTPS | TLS is mandatory for every public production origin. Redirect/reject HTTP as appropriate, set HSTS after domain validation, and verify secure upstream/server-to-server TLS or private Coolify networking. Production never enables certificate-verification bypass. |
| CORS configuration | Exact allowlist for `https://app.myvirtualtracker.com` and `https://myvirtualtracker.com`; credentialed responses never use `*`; allow only needed methods/headers; preflight and failure behavior are tested. |
| CSRF protection | Cookie-mutating endpoints require a valid bearer identity plus exact `Origin`/`Referer` policy and CSRF token/design where bearer proof is not sufficient. SameSite is defense-in-depth, not the only control. |
| Rate limiting | Layer limits by public IP, trusted client IP, UID, pseudonymous recipient, tenant, route/purpose, challenge, and factor as appropriate. Gateway and backend limits are coordinated and return safe `429` responses. |
| Brute-force protection | Short expiries, attempt caps, atomic lockout, resend supersession, replay prevention, exponential/capped delays, distributed counters, alert thresholds, and recovery/admin monitoring cover email codes, TOTP, recovery codes, password-related routes, and support approval. |
| Security headers | CSP, HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, frame protection (`frame-ancestors`), permissions policy, and `Cache-Control: no-store` are set/tested on sensitive responses. |
| Secret management | TOTP/outbox key rings, HMAC key, Firebase credentials, SMTP password, internal-service secret, and database credentials remain runtime secrets with scoped access, rotation, offline recovery, and no browser/CI/log exposure. |
| Environment variables | Central schema validates type/format/length/relationships at startup. Missing/malformed required values fail readiness. Public build variables are explicitly separated from server secrets. `.env.example` contains placeholders only. |
| Dependency vulnerability scanning | Exact versions/lockfile, license/provenance review, SBOM, automated OSV/npm/container scanning, high/critical release gate, documented exceptions with owner/expiry, and scheduled update review. |
| Encryption at rest | TOTP and queued email payloads use AES-256-GCM with independent versioned keys/nonces/AAD. Recovery/email codes use salted slow hashes when verification does not need plaintext. Backups inherit equivalent protection. |
| Encryption in transit | Browser traffic uses HTTPS; internal calls use private networking and authenticated service requests, with TLS when crossing trust/network boundaries. SMTP requires the configured TLS posture. |
| Database least privilege | Separate explicit roles/grants for ordinary app, identity-security repository, migration/admin, Notify delivery logging, backup, and read-only operations as needed. No browser/gateway access and no routine superuser connection. |
| API authentication | Firebase bearer proves primary identity; opaque HttpOnly assurance session proves Virtual Tracker AAL; internal calls use rotated scoped credentials; gateway routing alone is never authentication. |
| Authorization | Central server middleware enforces tenant, role, ownership, purpose, resource, policy version, assurance level, and recent step-up on every protected route. UI hiding is never authorization. |
| Account lockout/throttling | Lock the challenge/factor path rather than permanently locking the Firebase account after a small number of TOTP mistakes. Use bounded cooldowns, safe recovery, alerts for attack patterns, and protection against lockout abuse. |
| Audit logs | Append-only security events record actor/target/tenant/action/result/reason/time/context and policy/factor/session identifiers only as safe IDs. Privileged recovery/policy/factor/session/key actions are always audited; audit readers are restricted. |

#### 26.7.4 Caching

| Cache layer | Allowed uses | Forbidden data/behavior | Invalidation and failure rule |
|---|---|---|---|
| Redis | Distributed rate counters, short policy/capability projections, revocation/cache-invalidations, non-authoritative delivery coordination where proven | TOTP secrets, email/recovery codes, assurance-token plaintext, sole replay/consume state, sole factor/policy/audit truth | Keys include tenant/UID/purpose/version as applicable; TTL is bounded; policy/factor/revocation events invalidate immediately; outage follows tested conservative behavior and never grants access |
| In-memory process cache | Parsed immutable config/public keys, safe library objects, very short non-authoritative lookups keyed by every security scope | Cross-tenant rows, codes/secrets/tokens, mutable policy without version checking, rate limits assumed global across replicas | Bounded size/TTL; keyed by tenant/UID; cleared on config/policy/factor events and deploy; correctness cannot depend on cache survival |
| PostgreSQL/buffer/query caching | Normal database buffer cache, indexes, prepared statements, and safe projections/materialized aggregates for reporting | A second stale authorization truth, unversioned factor/policy snapshots, or denormalized secret copies | Writes and policy versions remain authoritative; explain/analyze indexes under load; reporting refresh never blocks or weakens sign-in decisions |
| HTTP/browser caching | Short private cache only for explicitly non-sensitive immutable capability/config metadata | Bootstrap, challenges, enrollment URI/QR/manual secret, factor lists, recovery, session, policy mutations, codes, tokens, or user security context | Sensitive endpoints send `Cache-Control: no-store`; service workers/browser storage must not capture responses; logout clears app state |
| CDN/reverse-proxy caching | Public static JS/CSS/images and public marketing assets with content hashes | Any `/api/v1/auth/*`, session/cookie, email-challenge, recovery, account, tenant policy, personalized response, or response containing `Set-Cookie`/`Authorization` variance | Bypass cache for APIs and credentialed traffic; honor `Vary: Origin` where relevant; test that authenticated responses never enter shared cache |

Cache keys and invalidation are part of the security contract. A cache miss may cost latency; it must not change authorization. Record hit/miss/eviction metrics without raw UID/email/IP labels.

#### 26.7.5 Background jobs and queues

- Keep primary-token verification, challenge verification/consumption, replay checks, factor changes, policy decisions, and assurance issuance synchronous and transactional because the caller needs the authoritative result.
- Move slow/retryable work off the request path: SMTP delivery through `auth_email_outbox`, cleanup/expiry, key re-encryption, non-critical security notifications, report-only aggregates, and reconciliation.
- Use the PostgreSQL outbox and existing containers for v1. No RabbitMQ, N8N, Activepieces, or new worker resource is required. A future broker requires a separate ADR and must preserve transaction/idempotency semantics.
- The request commits business state plus the outbox job atomically and returns `202` after durable acceptance. Workers use `FOR UPDATE SKIP LOCKED` or an advisory lock, bounded leases, heartbeats, retry/backoff/jitter, maximum attempts, dead/permanent states, expiry, and idempotent consumers.
- Queue payloads are schema-versioned, size-limited, encrypted when they contain temporary recipient/code data, and never contain TOTP secrets, raw assurance tokens, Firebase tokens, SMTP credentials, or unrestricted HTML.
- Jobs re-read current authoritative state before acting. A delayed/restored worker cannot send a superseded/expired code, resurrect a revoked session, or apply an old policy.
- Expose safe queue depth, oldest-job age, delivery latency, failure class, retries, lease expiry, cleanup lag, and dead-job counts. Alert before code lifetime or storage bounds are exceeded.
- Provide administrative inspect/retry/cancel tooling that shows safe metadata only and requires restricted authorization plus audit. Manual replay is idempotent and cannot reveal/decrypt payload in the UI.

#### 26.7.6 Operational logging

Application logs should contain useful operational context without becoming a credential database. Authoritative security audit requirements are separate and defined in Section 26.7.11.

Log these structured fields where applicable:

- UTC timestamp, level, service name/version, environment, instance/container identifier;
- correlation/request ID and trace/span IDs propagated through gateway, Dashboard-Backend, and Notify;
- HTTP method, normalized route template (not raw sensitive URL), status, duration, response size, and safe retryability/error code;
- pseudonymous actor/target identifiers, tenant ID only where operationally required, action/purpose, assurance level requested/result, policy version, and factor type—not factor secret/name;
- trusted source classification, coarse browser/OS/client type, and HMAC/masked IP or user-agent fingerprints where the event requires them;
- database/Redis/Notify dependency name, operation class, latency, pool/timeout state, and safe failure category—not SQL values, connection strings, provider bodies, or credentials;
- background job type, safe job/delivery ID, attempt, lease age, queue latency, result, and next retry time;
- startup/readiness results for schema version, active key IDs as approved non-secret labels, clock drift, dependency health, and enabled feature flags;
- security events such as request/verify/lockout/replay/recovery/factor/session/policy/key/admin actions through the separate audit channel.

Never log:

- passwords, email/TOTP/recovery codes, setup/manual keys, QR or `otpauth://` content;
- raw Firebase ID/refresh/custom tokens, assurance cookies/tokens, link tokens, CSRF values, internal-service secrets, SMTP/database credentials, encryption/HMAC keys;
- factor/outbox ciphertext, nonces, authentication tags, full recipient addresses in routine logs, full request bodies/headers/cookies, or raw authorization headers;
- unredacted SQL parameters, provider responses, stack traces to clients, or user-controlled newline/control characters.

Logging controls:

- Central logging helpers enforce field allowlists/redaction before serialization. Authentication routes never use ad-hoc `console.log` with request bodies or raw errors.
- Separate operational logs from append-only audit events. Operational logs may be sampled/short-lived; required security audits are complete, access-controlled, retained per policy, exportable, and protected from ordinary tenant/admin mutation.
- Define level semantics: `debug` disabled in production unless time-bounded; `info` successful lifecycle milestones without secrets; `warn` bounded suspicious/retryable conditions; `error` failed operations needing attention; `fatal` unsafe process/readiness state.
- Set retention, access roles, deletion/legal-hold rules, encryption, backup, alerting, and tamper-evidence appropriate to each log class. Log access and audit export are themselves audited.
- Run automated canary/secret-pattern scans in tests and staging using unique fake codes/tokens/keys; the build fails if markers appear in logs, metrics, traces, error reports, or delivery metadata.

#### 26.7.7 Monitoring and observability

- Instrument the gateway, Auth-Backend, Dashboard-Backend, Notify, PostgreSQL client, Redis client, and workers with the same correlation/trace context and bounded route/dependency/job names. Do not put user-controlled or high-cardinality identifiers in metric labels.
- Publish RED signals for APIs (request rate, errors, duration), USE signals for containers/dependencies (utilization, saturation, errors), and business/security signals for challenge, TOTP, recovery, policy, assurance, audit, and email-outbox state.
- Required alerts include: public endpoint unavailable; readiness/liveness failure; elevated `5xx` or latency burn; authentication-success collapse; unusual `401`/`403`/`429`/lockout/replay spikes; PostgreSQL connection, replication/backup, storage, or query pressure; Redis errors/evictions; queue age/dead jobs; SMTP failures/bounces; clock drift; certificate/domain expiry; missing key/schema/config; audit insertion/export failure; container restart/memory/disk pressure.
- Every alert names severity, threshold/window, owner, notification destination, acknowledgement/escalation target, user impact, safe diagnostic links, runbook, and recovery verification. Alerts are deduplicated/rate-limited without hiding a continuing incident.
- Dashboards show current state and trends, but release readiness requires alert delivery tests and incident drills. A green dashboard without tested paging is not sufficient.
- Start with the eight resources emitting health and telemetry. If current Coolify monitoring cannot satisfy paging/history needs, add the smallest self-hosted combination from Section 7.2; monitoring remains operational support and never enters an allow/deny authentication decision.

#### 26.7.8 File and object storage

MFA v1 has **no file-upload requirement and needs no new storage resource**. Generate each TOTP QR response from the one-time `otpauth://` value in memory with `no-store`, erase the value promptly, and use a bundled Virtual Tracker issuer icon. Do not persist QR PNG/SVG files, manual secrets, recovery-code documents, or authenticator vendor icons in PostgreSQL, Redis, object storage, logs, or CDN caches.

If the wider application later introduces files, images, or documents, it becomes a separate reviewed boundary with these minimum controls:

- Store objects in a private, versioned, encrypted bucket using an existing S3-compatible provider or a separately approved self-hosted service such as Garage. Do not use application-container disks as durable shared storage or make Firebase/Google paid storage a dependency.
- Authorize upload initiation and every read/delete against current tenant, owner, role, purpose, and quota. Server-generated random object keys replace user filenames; bucket/key names cannot be client-selected outside a scoped prefix.
- Prefer short-lived, single-purpose signed URLs bound to exact method, object key, expiry, and where supported content type/length/checksum. Issuing a signed URL is audited; possession must not provide directory listing, overwrite, cross-tenant access, or permanent public access.
- Enforce request and decompressed-size limits, per-user/tenant quotas, extension allowlists, MIME plus magic-byte detection, safe filenames/metadata, checksum, image dimension/pixel limits, archive/decompression-bomb defenses, and parser timeouts. Re-encode risky images/documents where appropriate.
- Upload into quarantine. Perform malware/content scanning where file risk warrants it before marking the object available; scanning failure or timeout leaves it unavailable. Never execute, render active HTML/SVG, or serve quarantined content from the application origin.
- Use least-privilege storage credentials separated by upload/read/cleanup role, private networking where possible, access logs, lifecycle rules, orphan/multipart cleanup, backup/restore policy, and key rotation. No browser receives master storage credentials.
- Define soft-delete/retention/legal-hold behavior, asynchronous physical deletion, failed-cleanup retries/alerts, tenant/account deletion reconciliation, and proof that database metadata and object state cannot silently diverge.

#### 26.7.9 External API and service integrations

The integration register initially contains Firebase primary identity/key discovery, the internal Notify API, the selected SMTP relay, and any explicitly approved optional IP/location service. Google Authenticator and Microsoft Authenticator are **not external backend integrations**: they scan the standard TOTP URI and calculate codes locally, so no vendor API, account, or paid Google service is required.

For every integration:

- Record owner, purpose, provider/base URL, data sent/received, data residency/classification, credentials/scopes, allowed egress destinations, version/deprecation policy, rate/quota limits, cost if any, support/escalation, outage mode, and removal/replacement plan.
- Authenticate the peer, require TLS with certificate validation, keep credentials server-side, scope and rotate them, and prevent secrets or provider payloads from reaching clients/logs. Apply DNS/URL/redirect allowlists so configurable integrations cannot become SSRF or credential-exfiltration paths.
- Validate status, content type, size, and a strict response schema before use. Treat missing/extra/malformed/stale provider fields as explicit safe errors; never let a provider response directly set tenant, role, policy, assurance, or ownership.
- Set separate connect, headers, body, and total deadlines plus response-size limits. Propagate cancellation, cap concurrency, isolate connection pools, and apply bulkheads/circuit breakers so a slow provider cannot exhaust application workers.
- Retry only classified transient failures and only when the operation is idempotent or carries a provider-supported idempotency key. Use bounded exponential backoff with jitter and honor safe `Retry-After`; never retry past an email-code/job expiry.
- Handle quotas and `429` with backpressure and alerts rather than retry storms. Define conservative degraded behavior: authentication dependencies fail closed for protected access; optional enrichment disappears; queued notification work remains pending/failed without changing assurance truth.
- Provide deterministic test doubles/fixtures for success, timeout, malformed data, TLS/auth failure, `429`, `5xx`, partial response, duplicate response, and provider schema/version changes. Staging never sends production customer data to test providers.
- Measure request count, latency, outcome class, retry/circuit/quota state, and cost-safe usage without provider tokens, raw identities, or payload bodies as labels.

#### 26.7.10 Webhooks

No authenticator-app webhook is required. The likely v1 webhook use is an SMTP provider's delivery/bounce/complaint event if the selected relay supports one; otherwise delivery reconciliation remains an internal Notify concern.

- Expose provider-specific, versioned webhook routes through the gateway with strict body/content-type/size limits and no browser cookie behavior. Maintain an explicit event-type/schema allowlist; unknown versions/events are safely ignored or rejected and measured.
- Capture the exact raw request bytes, verify the provider's signature/MAC before parsing or processing, validate timestamp within a narrow replay window, use constant-time comparison, and support overlapping secret versions during rotation. Network/IP allowlists are defense-in-depth only.
- Deduplicate atomically in PostgreSQL using provider plus immutable event/delivery ID. Do not assume events are ordered, unique, complete, or delivered once; stale delivery events cannot make an expired/superseded challenge valid.
- After authentication and schema validation, durably record/enqueue the event and return the provider-required success promptly. Perform expensive work asynchronously with bounded retries, poison/dead state, reconciliation, metrics, and restricted audited replay.
- Return generic responses with no internal detail. Invalid signatures/replay/schema failures are rate-limited, safely logged, monitored, and never forwarded to business handlers.
- Outbound webhooks, if introduced later, require tenant-admin authorization and recent AAL2, HTTPS destinations, DNS/IP revalidation that blocks loopback/private/link-local/metadata targets, redirect refusal or revalidation, signed versioned payloads, per-subscription secrets, idempotent delivery IDs, timeouts/retries, disable-on-abuse policy, delivery UI, and secret rotation.
- Tests cover raw-body preservation, valid/invalid/old signatures, rotation overlap, replay, duplicate/out-of-order events, oversized payloads, parser abuse, queue failure, endpoint timeout, SSRF/DNS rebinding, and manual replay.

#### 26.7.11 Security audit logging

Security audit is distinct from operational logging. It is an authoritative history for investigation, accountability, support, and compliance; it is never sampled and never used as the only source of live authorization truth.

- Use an append-only PostgreSQL audit table with immutable event ID, schema version, UTC occurred/recorded time, correlation/trace ID, actor type and pseudonymous actor ID, target type/ID, tenant scope when relevant, action, outcome, bounded reason code, assurance/policy/factor/session safe identifiers, source class, privileged case/approval ID, and allowlisted metadata. It contains no codes, secrets, tokens, cookies, raw email, full IP/user agent, request body, ciphertext, provider body, or arbitrary error text.
- Sensitive mutations write their audit event in the same PostgreSQL transaction as the state change. If a required audit insert fails, factor/policy/session/recovery/key/admin mutation rolls back. Successful privileged access and recovery approval cannot complete without the audit event.
- Give the application an insert-only audit path; ordinary app, support, tenant-admin, reporting, and migration roles cannot update/delete historical rows. Retention deletion runs only through a separately authorized, audited lifecycle role after policy/legal-hold checks.
- Add tamper evidence through chained/partition digests or signed periodic manifests stored under separate credentials. Back up audit data, verify digest/restore integrity on schedule, and alert on gaps, sequence anomalies, forbidden mutation attempts, export failure, or expected-event count mismatch.
- Define an event catalogue mapping every factor, challenge, assurance session, recovery case, tenant policy, account/provider lifecycle, key rotation, webhook administration, signed-file authorization, audit access/export, and privileged support action to its required success/failure events and fields.
- Provide restricted, paginated, time-bounded search/export with field-level masking, tenant isolation, reason-coded access, maximum ranges/rows, asynchronous export where large, and audit-of-the-audit. Spreadsheet/JSON exports receive integrity metadata and expire from any temporary delivery location.
- Retention and data-subject handling distinguish security/legal obligations from ordinary application deletion. Document who may access, export, retain, place legal hold, or approve deletion; never promise erasure that conflicts with an applicable security/legal requirement.
- Tests reconcile expected mutations against audit events, prove no unauthorized update/delete, force audit-write failure, validate tenant isolation/redaction/retention, detect canary tampering/gaps, and restore then verify integrity.

#### 26.7.12 API performance and capacity

- Establish a per-route budget before implementation. Initial server-side p95 targets under normal load are: bootstrap/read endpoints at or below 300 ms; TOTP/email-code verification at or below 400 ms; factor/policy/session mutations and durable email-outbox acceptance at or below 500 ms. Initial p99 target is below 1 second excluding explicitly asynchronous SMTP delivery. Revise targets only from measured production-shaped evidence, never to hide regressions.
- Keep ordinary unexpected `5xx` below 1% and define separate availability/error-budget objectives for the public gateway and the assurance service. Expected validation/authentication denials are measured by bounded status/reason code but are not misclassified as service availability success.
- Load-test at the greater of forecast rollout traffic or at least three times measured peak, including sign-in bursts, resend/verify abuse, multi-tab races, tenant-policy reads, worker backlog, and recovery administration. Run soak tests long enough to expose memory, connection, lease, cache, and storage leaks.
- Bound request body, header, response, pagination, batch, and export sizes. Use cursor pagination and selected columns; prevent unbounded lists, wildcard searches, arbitrary sort expressions, synchronous large exports, or user-selected query complexity.
- Set PostgreSQL statement/lock timeouts, pool/concurrency budgets per container, transaction duration limits, and index/query plans. Use production-shaped `EXPLAIN (ANALYZE, BUFFERS)` in staging, detect N+1 calls, and regression-test query count and worst routes without exposing sensitive parameters.
- Cache only under Section 26.7.4. Batch/pipeline safe Redis/dependency operations, reuse bounded connection pools, stream safe large output, and move eligible work to Section 26.7.5 jobs. Never skip hashing, replay checks, authorization, audit, or encryption to reach a latency target.
- Configure gateway/backend timeouts coherently so upstream deadlines are shorter than caller timeouts and retries cannot multiply load. Add per-route concurrency limits, admission control, load shedding for non-critical work, queue bounds, and circuit breakers; protect sign-in/recovery capacity from reporting/export work.
- Compress public static content, but avoid compression of secret-bearing dynamic responses where cross-site compression leakage is plausible. CDN caching remains limited to approved public immutable assets.
- CI runs deterministic micro/contract/query budgets; release candidates run production-shaped load, burst, soak, and dependency-failure tests. Record hardware/container limits, dataset, traffic model, results, regressions, headroom, and approved exception owner/expiry in the API performance report.

## 27. Completion estimate (2026-09-28)

This table compares the current repository and eight running Coolify resources with the requirements in this plan. It is authoritative for implementation status. Percentages describe the named workstream, not how much text has been written. Existing reusable infrastructure is credited only as foundation; it is not evidence that MFA itself is implemented.

| Workstream | Already done / not missing | Still missing | Estimated completion |
|---|---|---|---:|
| Architecture, scope, and threat model | Email-versus-MFA distinction, global surface model, eight-resource topology, factor/policy ownership, REST boundary, threats, rollout, rollback, and acceptance criteria are documented | Resolve Section 23 decisions; review the identity-global schema, canonical API origin, recovery model, and incident ownership with product/security/operations | ~90% planning |
| Existing Coolify/runtime foundation | Eight resources are running: Auth, Dashboard Backend/Web, Landing Web, Notify, Web Backend gateway, PostgreSQL, and Redis | Verify internal networking, private DB/cache exposure, resource limits, backups, canonical routes/cookies, readiness, SMTP, and staging parity for this feature | ~70% prerequisite foundation |
| REST/OpenAPI contract | The application already has REST-style backends and gateway/client helpers; proposed endpoints, states, rules, and examples are documented | Create `docs/openapi/auth-mfa-v1.yaml`, implement endpoints/routing, generate/share types, add contract/idempotency/CORS/error tests, migrate clients to `/api/v1` | ~10% |
| PostgreSQL schema and access boundary | Existing PostgreSQL client/migration conventions and tenant controls can be reused | Implement identity-global factors/recovery, tenant-bound sessions/policy/challenges/audit/recovery cases, indexes, grants, additive migrations, live-role tests, cleanup, and production-shaped rehearsal | 0% feature implementation |
| Email challenge service | Existing customer-account code demonstrates secure six-digit generation/hash/attempts, and Notify already sends allowlisted SMTP templates | Generalize purpose-bound challenges, atomic concurrency, global endpoints, delivery state/idempotency, resend/rate limits, cleanup, templates, bounces, metrics, and both-web integrations | ~20% reusable foundation; 0% generalized service |
| TOTP cryptography and factor lifecycle | Standard/library/key-encryption design, enrollment/sign-in/replay/recovery behavior, and tests are specified | Select/pin dependencies; implement key ring, AES-GCM repository, RFC vectors, QR/manual enrollment, verification/replay protection, factor management, recovery codes, rotation, and lifecycle hooks | 0% |
| Assurance sessions and central enforcement | Firebase bearer middleware, bootstrap, shared cookie routes, and central API dispatcher already exist | Implement opaque assurance sessions, canonical host-only cookie, AAL/policy evaluator, pre-assurance allowlist, recent step-up, session exchange hardening, revocation, and middleware coverage across every protected API | 0% MFA assurance |
| Dashboard-Web and Landing-Web | Both sites already perform Firebase sign-in/bootstrap and the landing/application shared-session flow exists | Add shared contract/types, MFA/enrollment/recovery states, credentialed canonical API calls, delayed `vt_session`, settings/policy UI, multi-tab behavior, accessibility, and global parity tests | ~10% reusable sign-in foundation; 0% MFA UI |
| Gateway and Landing backend integration | Public gateway and repository session proxy routes exist | Implement/verify versioned owner routing, exact credentialed CORS, CSRF/origin checks, trusted proxy/IP, cookie/header preservation, limits, compatibility aliases, canonical-origin enforcement, and smoke tests | ~20% reusable routing foundation |
| Organization policy and administration | Role/tenant infrastructure and two mock security-setting surfaces exist | Persist/version policy, choose canonical settings UI, enrollment summaries, grace/report-only mode, privileged-role enforcement, recovery-admin safeguards, cache invalidation, audit, and notifications | 0% enforceable policy |
| Desktop/Tauri compatibility | Browser link, encrypted local credentials, offline queue, and structured agent states provide a foundation | Require AAL2 before link completion, add structured errors/browser continuation, re-link/grace/minimum-version policy, global revocation, compatibility tests, and preserve queued work | ~10% reusable link foundation; 0% MFA enforcement |
| Recovery, lifecycle, and support | The plan defines recovery codes and an assisted recovery direction | Implement cases/roles/approvals, account/email/provider/tenant lifecycle handlers, all-session/device revocation, user/admin UI, notifications, audit, support tooling, and exercised runbooks | 0% |
| Backend engineering controls | Existing services have HTTP validation, security-header, CORS, rate-limit, error, sanitization, logging, PostgreSQL, and Redis helpers that can be reused | Apply all of Section 26.7 uniformly: strict schemas/output encoding, typed errors, security/cache controls, transactional workers, redacted telemetry, integration/webhook hardening, immutable audit, capacity budgets, and automated verification | ~15% reusable foundation; 0% MFA-specific completion |
| Monitoring and observability | Existing Coolify health mechanisms and application logging can be extended; the catalogue offers self-hosted availability, host, error, log, metric, and trace tools | Implement common telemetry, external synthetic/internal readiness checks, SLI/SLO/error budgets, actionable alerts with owners/destinations/runbooks, secret-safe dashboards, retention, alert delivery tests, and incident drills; select an optional minimal stack only if existing monitoring is insufficient | ~10% reusable foundation; 0% MFA alerting proof |
| File/object storage boundary | MFA v1 has no file requirement; QR generation can remain memory-only and issuer icons can be bundled | Prove QR/manual/recovery secrets never enter durable file/object/CDN storage. If wider-product uploads enter scope, complete a separate storage ADR and implement private buckets, signed URLs, authorization, validation/quarantine/scanning, quotas, permissions, lifecycle cleanup, and deletion reconciliation | 100% scope decision; N/A to MFA implementation unless uploads are added |
| External integrations and webhooks | Firebase primary identity, internal Notify, and SMTP integration paths already exist; authenticator apps need no vendor API or webhook | Create the provider/event register; implement schema/timeout/retry/quota/circuit/egress controls, deterministic failure tests, SMTP delivery webhook signature/replay/idempotency handling if supported, reconciliation, metrics, rotation, and outage runbooks | ~20% integration foundation; 0% MFA hardening proof |
| Security audit integrity | Existing login-alert/context code and PostgreSQL provide reusable foundations; required event categories are defined | Implement append-only schema/grants, transactional event writes, event catalogue, retention/access/export, tamper-evident manifests, gap/completeness alerts, audit-of-audit, restore verification, and forced-failure/tenant-isolation tests | ~10% reusable foundation; 0% MFA audit verification |
| API performance and capacity | Existing gateway, PostgreSQL, Redis, and service health patterns provide a place to measure | Establish baselines and route budgets; optimize bounded queries/pools/timeouts; add pagination/admission/load shedding; run query, burst, abuse, soak, queue-backlog, and dependency-failure tests on production-shaped limits; publish headroom and exceptions | 0% MFA performance validation |
| Operations, reliability, and disaster recovery | Existing health/readiness, SMTP, PostgreSQL, Redis, and deployment mechanisms can be extended | Add clock/key/schema checks, job leadership, metrics/alerts, load/failure testing, SMTP/DNS readiness, combined database/key restore, RPO/RTO, incident drills, capacity budget, and optional-tool ADRs | ~10% reusable operations foundation |
| Automated/manual verification | The repository has established backend/web/Tauri test structures | Add every unit/contract/integration/security/load/migration/restore/browser/device/authenticator/desktop test in Sections 17, 22, and 26; complete staging report-only soak and security review | 0% feature verification |
| Documentation and release | This implementation plan now covers architecture, REST, infrastructure, global behavior, backend controls, follow-ups, and completion tracking | Create and exercise the OpenAPI, deployment, observability/alerts, integration/webhook register, API performance report, key, SMTP, recovery/support, incident, user/admin, compatibility, and release artifacts listed in Section 26.5 | ~25% documentation set |
| **Overall feature-specific implementation** | **Reusable platform components exist, but this document itself changes no production behavior and no self-hosted TOTP/assurance feature has been verified as implemented** | **All feature code, migrations, UI, tests, runbooks, staging proof, and rollout remain** | **0% implemented** |
| **Production readiness** | **The plan defines gates intended to prevent an unsafe launch** | **No MFA-specific implementation, production-shaped validation, restore drill, support operation, security review, or staged rollout has occurred** | **0% ready** |
