# LandingWebBackend-Prod Branch — Landing Backend Service

> **Branch**: `LandingWebBackend-Prod`  
> **Latest Commit**: `7e0633a` — chore: remove .env.example from production branch  
> **Tracks**: `origin/LandingWebBackend-Prod`  
> **Role**: Production-isolated deployment branch for the Landing-Backend service

---

## 1. Branch Purpose

The `LandingWebBackend-Prod` branch contains **only the Landing-Backend service** — a lightweight API scaffold for the Landing-Web marketing site. This is the **smallest and simplest** service in the Virtual Tracker ecosystem.

### What's Included
- `Landing-Backend/` — Lightweight API service
- `.gitignore` — Repository-level ignore rules

### What's Excluded
- All other services and documentation
- `.env.example` files

---

## 2. Branch Status

This branch has **only 2 commits**, indicating it was recently created and is in an early stage:

| SHA | Message |
|-----|---------|
| `7e0633a` | chore: remove .env.example from production branch |
| `20d3dee` | LandingWebBackend-Prod: isolated Landing-Backend with Coolify production config |

The service currently acts as a **placeholder API** with security middleware already in place but no business logic routes implemented yet.

---

## 3. Service Architecture

```
Landing-Backend/
├── .dockerignore              # Docker build exclusions
├── Dockerfile                 # Multi-stage Docker build
├── index.js                   # Entry point
├── package.json               # Dependencies & scripts
├── src/
│   ├── app.js                 # Central request handler
│   ├── config/
│   │   └── env/
│   │       ├── index.js       # Environment configuration
│   │       ├── public.js      # Public env vars
│   │       └── schema.js      # Zod validation schema
│   ├── core/
│   │   ├── database/
│   │   │   └── firebase.js    # Firebase Admin initialization
│   │   ├── middleware/
│   │   │   ├── http/
│   │   │   │   ├── api-error.js        # Error formatting
│   │   │   │   ├── quota-error.js      # Rate limit errors
│   │   │   │   ├── read-json-body.js   # Body parsing
│   │   │   │   ├── request-ip.js       # IP extraction
│   │   │   │   ├── response.js         # Response helpers
│   │   │   │   ├── sanitize-error.js   # Error sanitization
│   │   │   │   ├── sanitize-log.js     # Log sanitization
│   │   │   │   └── validate-body.js    # Input validation
│   │   │   └── security/
│   │   │       ├── cors.js                    # CORS handler
│   │   │       ├── password-request-guard.js  # Password in query prevention
│   │   │       ├── rate-limit.js              # Rate limiting
│   │   │       ├── security-headers.js        # CSP, HSTS, etc.
│   │   │       ├── sensitive-fields.js        # Sensitive data detection
│   │   │       └── tls-enforcement.js         # HTTPS enforcement
│   │   └── utils/
│   │       ├── create-server.js  # Server factory
│   │       ├── logger.js         # Structured logging
│   │       └── metrics.js        # Metrics collection
│   └── server.js                 # HTTP server bootstrap
```

---

## 4. Current Functionality

### Request Pipeline (`app.js`)
The request handler implements the full security pipeline:

1. **CORS Preflight** — Handles `OPTIONS` requests
2. **TLS Enforcement** — Rejects HTTP in production
3. **URL Parsing** — Safe URL parsing with error handling
4. **Sensitive Query Guard** — Blocks passwords/tokens in query params
5. **Health Check** — `GET /health` returns `{ ok: true }`
6. **404 Fallback** — All other routes return "Not found"

### API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check endpoint |
| `*` | `*` | Returns 404 for all other routes |

### Security Middleware
The full security stack from the other backends is present and active:
- CORS with configurable origins
- TLS enforcement in production
- Security headers (CSP, HSTS, X-Frame-Options, etc.)
- Rate limiting
- Sensitive field protection
- Error sanitization

---

## 5. Architecture Intent

This service is architecturally prepared for future expansion. The middleware stack and configuration system are identical to the Auth-Backend and Dashboard-Backend, making it trivial to add:

- Contact form submission API
- Newsletter subscription endpoints
- Demo request handling
- Blog content API
- Analytics event ingestion

The service follows the same patterns as other backends:
- Bare `node:http` (no Express/Fastify)
- Zod-validated environment variables
- Firebase Admin for database access
- Structured JSON logging
- Prometheus-compatible metrics

---

## 6. Dependencies

The `package.json` dependencies mirror the core security stack:
- Firebase Admin for database/auth
- Zod for validation

---

## 7. Deployment

### Docker Build
- Multi-stage Dockerfile identical to other services
- Standalone Node.js application

### Health Check
- `GET /health` returns `{ ok: true }`
- Container health check via Node.js fetch script
