# Security Policy

## Supported Versions

Virtual Tracker is a continuously deployed SaaS platform (not versioned releases). Security fixes are applied directly to `main` and deployed to production as soon as they're verified.

| Component        | Status              |
| ----------------- | -------------------- |
| Production (main) | :white_check_mark: Actively maintained |

## Reporting a Vulnerability

If you discover a security vulnerability in Virtual Tracker, please report it privately rather than opening a public issue.

**Contact:** [mohamedhms3102@gmail.com]

Please include:
- A description of the vulnerability and its potential impact
- Steps to reproduce (proof-of-concept if possible)
- Affected component (auth API, dashboard API, notify API, dashboard web, landing site)

**What to expect:**
- Acknowledgement within 48 hours
- An initial assessment and severity rating within 5 business days
- Regular updates until the issue is resolved
- Credit in release notes, if desired, once fixed

Please do not publicly disclose the issue until we've had a chance to address it.

## Scope

This applies to:
- `vt-auth-api`, `vt-dashboard-api`, `vt-notify-api`
- `vt-dashboard-web`, `vt-landing-web`
- Infrastructure at myvirtualtracker.com and subdomains

Out of scope: third-party services we depend on (report those directly to the vendor).
