# Auth-Production Branch — Authentication Backend Service

> **Branch**: `Auth-Production`  
> **Latest Commit**: `cd6f35d` — Sync Auth-Backend from main: add dev script with NODE_ENV=development  
> **Tracks**: `origin/Auth-Production`  
> **Role**: Production-isolated deployment branch for the Auth-Backend service

---

## 1. Branch Purpose

The `Auth-Production` branch contains **only the Auth-Backend service**, stripped of all other services, documentation, and development files. It is designed for direct deployment to a Coolify / Docker-based hosting environment where each service runs in its own container built from its own branch.

### What's Included
- `Auth-Backend/` — The complete authentication microservice
- `.gitignore` — Repository-level ignore rules

### What's Excluded
- All markdown documentation (removed for production)
- `.env.example` files (removed for security)
- Dashboard-Backend, Dashboard-Web, Landing-Web, Notify-backend, deploy/

---

## 2. Service Architecture

```
Auth-Backend/
├── .dockerignore          # Docker build exclusions
├── .firebaserc.example    # Firebase project config template
├── .npmrc                 # npm configuration
├── Dockerfile             # Multi-stage Docker build
├── firebase.json          # Firebase Hosting config (action handler page)
├── firestore.indexes.json # Firestore index definitions
├── firestore.rules        # Firestore security rules
├── hosting-public/        # Static auth action HTML page
├── index.js               # Entry point (loads env, starts server)
├── nixpacks.toml          # Coolify/Nixpacks build config
├── package.json           # Dependencies & scripts
├── scripts/
│   └── dev.mjs            # Dev mode launcher (NODE_ENV=development)
├── server.js              # HTTP server bootstrapper
├── src/
│   ├── app/
│   │   └── handle-request.js   # Central request router
│   ├── config/
│   │   ├── deployment-profiles.js  # Environment-aware defaults
│   │   ├── env-public.js           # Public env vars
│   │   ├── env-schema.js           # Zod env validation schema
│   │   ├── env.js                  # Env loading & parsed config
│   │   ├── firebase.js             # Firebase Admin initialization
│   │   ├── index.js                # Config re-exports
│   │   └── password-policy/        # Password validation system
│   │       ├── blacklists.js       # Blocked password lists
│   │       ├── definition.js       # Policy rules definition
│   │       ├── index.js            # Policy exports
│   │       ├── public-response.js  # Public-facing policy shape
│   │       └── validation.js       # Validation logic
│   ├── core/
│   │   ├── create-server.js   # HTTP server factory
│   │   ├── logger.js          # Structured JSON logging
│   │   └── metrics.js         # Prometheus-compatible metrics
│   ├── http/
│   │   ├── api-error.js           # Standardized API error responses
│   │   ├── auth-token.js          # Bearer token extraction
│   │   ├── cors.js                # CORS handling
│   │   ├── password-request-guard.js  # Password input sanitization
│   │   ├── quota-error.js         # Rate limit error formatting
│   │   ├── rate-limit.js          # In-memory rate limiter
│   │   ├── read-json-body.js      # JSON body parser
│   │   ├── request-ip.js          # Client IP extraction
│   │   ├── response.js            # JSON response helper
│   │   ├── sanitize-error.js      # Error sanitization
│   │   ├── sanitize-log.js        # Log sanitization
│   │   ├── security-headers.js    # CSP, HSTS, etc.
│   │   ├── sensitive-fields.js    # Sensitive field detection
│   │   ├── tls-enforcement.js     # HTTPS enforcement
│   │   └── validate-body.js       # Body validation utilities
│   └── modules/
│       └── auth/
│           ├── authn-paths.js     # Auth route path matching
│           └── routes.js          # HTTP route handlers
└── storage.rules              # Firebase Storage security rules
```

---

## 3. API Endpoints

| Method | Path | Auth Required | Description |
|--------|------|:---:|-------------|
| `GET` | `/health` | ✗ | Container health check — returns `{ ok: true }` |
| `GET` | `/api/auth/readiness` | ✗ | Firebase Admin SDK readiness probe |
| `GET` | `/api/auth/firebase-config` | ✗ | Returns Firebase web SDK configuration (cached 1h) |
| `GET` | `/api/auth/password-policy` | ✗ | Returns password requirements for the UI |
| `POST` | `/api/auth/validate-password` | ✗ | Validates password against security policy |
| `POST` | `/api/auth/verify` | Bearer Token | Verifies Firebase ID token, returns decoded `{ uid, email, emailVerified }` |
| `POST` | `/api/auth/resolve-sign-in-methods` | ✗ | Returns available sign-in providers for an email |

---

## 4. Security Layer

### Password Policy System
The password policy is a multi-layered validation system:
1. **Blocklist Check** — Rejects known-compromised and common passwords
2. **Pattern Detection** — Rejects simple sequential/repetitive patterns
3. **Length & Complexity** — Configurable minimum requirements
4. **Confirmation Matching** — Optional `confirmPassword` field validation

### HTTP Security Stack
| Layer | File | Purpose |
|-------|------|---------|
| CORS | `cors.js` | Origin whitelist from `CORS_ORIGINS` / `FRONTEND_ORIGIN` env vars |
| Rate Limiting | `rate-limit.js` | Per-IP sliding window rate limiter |
| TLS | `tls-enforcement.js` | Rejects HTTP in production (`NODE_ENV=production`) |
| Headers | `security-headers.js` | CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy |
| Input Guard | `password-request-guard.js` | Prevents passwords in query strings |
| Body Validation | `validate-body.js` | Field length limits, unknown field rejection |
| Error Sanitization | `sanitize-error.js` | Strips stack traces from production errors |

---

## 5. Environment Configuration

The service validates all env vars at startup using Zod schemas. Key variables:

| Variable | Required | Description |
|----------|:---:|-------------|
| `PORT` | ✗ | Server port (default: 5712) |
| `NODE_ENV` | ✗ | `development` / `production` / `test` |
| `FIREBASE_API_KEY` | ✓* | Firebase web SDK API key |
| `FIREBASE_AUTH_DOMAIN` | ✓* | Firebase Auth domain |
| `FIREBASE_PROJECT_ID` | ✓* | Firebase project ID |
| `FIREBASE_APP_ID` | ✓* | Firebase app ID |
| `FIREBASE_CLIENT_EMAIL` | ✓** | Service account email (for Admin SDK) |
| `FIREBASE_PRIVATE_KEY` | ✓** | Service account private key |
| `CORS_ORIGINS` | ✗ | Comma-separated allowed origins |
| `APP_PUBLIC_URL` | ✓ (prod) | Production URL (must be HTTPS in production) |

\* Required as a set when any Firebase web variable is present  
\** Required as a pair for Firebase Admin SDK

---

## 6. Deployment Configuration

### Docker
- **Dockerfile**: Multi-stage Node.js build
- **Nixpacks**: `nixpacks.toml` for Coolify auto-detection
- **Health Check**: Node.js script calls `http://127.0.0.1:5712/health` every 30s

### Scripts
| Script | Command | Purpose |
|--------|---------|---------|
| `start` | `node index.js` | Production start |
| `dev` | `node scripts/dev.mjs` | Development mode with `NODE_ENV=development` |

---

## 7. Branch Evolution (Commit History)

| SHA | Message |
|-----|---------|
| `cd6f35d` | Sync Auth-Backend from main: add dev script with NODE_ENV=development |
| `a1ba933` | chore: sync Auth-Backend env/validation updates from main (no docs/env.example) |
| `d78dce7` | chore: remove all markdown files |
| `3a675b8` | chore: remove .env.example from production branch |
| `bea49de` | Sync startup fixes from main and document Coolify start command |
| `cede99b` | Sync env example and Coolify start script from main |
| `90ac407` | Sync Auth-Backend package files: remove unused nodemailer and ws |
| `c50b836` | Merge remote Auth-Production (.dockerignore update) |
| `0373304` | Replace Auth-Backend with slim AuthN service from main; remove legacy scripts and modules |
| `5e21a08` | Slim Auth-Backend .env.example to Firebase and CORS URLs only |
| `cec99e2` | Update Auth-Backend .env.example for AuthN-only production deploy |
| `06c1600` | Slim Auth-Backend to authentication-only API (sync from main) |
| `e4f647d` | Update .dockerignore |
| `d761957` | Sync Auth-Backend from main with full module structure and Docker deploy |
| `4a22d72` | Wire Auth-Backend production defaults to myvirtualtracker.com Coolify deployment |
| `5e13565` | Isolate Auth-Production to Auth-Backend only for Coolify deployment |
| `843775d` | Split auth backend and add Coolify production deployment config for VPS |
