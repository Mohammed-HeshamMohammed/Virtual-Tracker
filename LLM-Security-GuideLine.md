# Security Guidelines for Backend Engineering

This document outlines 20 core security guidelines and 6 vulnerability priority classifications for backend software systems. It maps their theoretical principles and textbook sources to practical engineering and implementation contexts.

---

## 1. Authentication (AuthN) vs. Authorization (AuthZ)

* **Textbook Source**: *Security Engineering* (Ross Anderson) / *Computer Security: Art and Science* (Matt Bishop)
* **Core Concept**: Access control must be divided into distinct phases: identifying the principal making a request (Authentication) and verifying whether that principal has the explicit right to perform the requested action (Authorization). They must remain structurally decoupled.
* **Backend Engineering Context**: AuthN handles logins, verifying credentials (passwords, MFA), and issuing a session or token (like a JWT). AuthZ runs as a middleware check after AuthN is successful, checking user roles or access control lists (ACLs) before exposing an endpoint (e.g., ensuring a user with `role: "customer"` cannot access an endpoint reserved for `role: "admin"`).

---

## 2. Input Validation and Request Sanitization

* **Textbook Source**: *Writing Secure Code* (Michael Howard & David LeBlanc, Microsoft Press)
* **Core Concept**: The fundamental axiom of application security is that all input is untrusted until proven otherwise. Systems must apply strict type, length, and format filtering at the application boundary before processing data.
* **Backend Engineering Context**: Never pass raw payload strings directly to databases, OS commands, or HTML renderers. API handlers must utilize schema validators (like Joi, Zod, or Pydantic) to strictly enforce data schemas. For example, if an entry expects an integer ID, the handler must reject any request containing string characters or SQL snippets immediately at the application boundary.

---

## 3. Rate Limiting and Throttling

* **Textbook Source**: *Computer Networks* (Andrew S. Tanenbaum) / *Security Engineering* (Ross Anderson)
* **Core Concept**: Systems must manage resource allocation defensively to maintain availability under extreme loads or algorithmic resource-exhaustion attacks (Denial of Service).
* **Backend Engineering Context**: Implementing memory-store caches (like Redis) inside middleware to track request frequencies. If a single IP exceeds 100 requests per minute on a login route, the backend immediately shorts the circuit and returns an HTTP `429 Too Many Requests` status code, preserving server processing power.

---

## 4. Cryptographic Hashing and Salting

* **Textbook Source**: *Cryptography and Network Security: Principles and Practice* (William Stallings)
* **Core Concept**: High-entropy data transformations must be irreversible and non-deterministic for identical inputs. Storing plaintext secrets violates fundamental data safety standards; authentication tokens must be computationally decoupled from user passwords.
* **Backend Engineering Context**: When a user registers, use slow, computationally intensive hashing algorithms designed specifically for passwords—such as Argon2id or bcrypt—rather than fast algorithms like MD5 or SHA-256. The salt ensures that two users with the exact same password will have entirely different hash strings in your database.

---

## 5. DDoS (Distributed Denial of Service) Mitigation

* **Textbook Source**: *Network Security Essentials* (William Stallings)
* **Core Concept**: Network-layer and application-layer availability must be protected by distributed traffic ingestion, rate throttling, and peripheral filtering structures capable of absorbing systemic traffic anomalies.
* **Backend Engineering Context**: True network-layer (Layer 3/4) DDoS protection cannot be handled effectively inside application code; it must be offloaded to peripheral proxy networks (like Cloudflare, AWS Shield, or Akamai). For application-layer (Layer 7) DDoS attacks, backends use reverse proxies (like Nginx) configured for connection limits, drop malformed aggressive headers, and cache static responses aggressively.

---

## 6. SQL / NoSQL Injection Prevention

* **Textbook Source**: *Writing Secure Code* (Michael Howard & David LeBlanc)
* **Core Concept**: The data channel must be strictly separated from the control/command channel. When user data is interpreted as executable code, injection vulnerabilities manifest.
* **Backend Engineering Context**: Completely ban string concatenation in database queries (e.g., `SELECT * FROM users WHERE id = ' + userInput + '`). Instead, enforce the use of parameterized queries or Object-Relational Mappers (ORMs like Prisma, Mongoose, or SQLAlchemy) which handle query parameter binding natively and safely escape inputs.

---

## 7. Secure Token Management (JWT & Session Security)

* **Textbook Source**: *Distributed Systems: Principles and Paradigms* (Andrew S. Tanenbaum & Maarten Van Steen) / *The Web Application Hacker's Handbook* (Dafydd Stuttard & Marcus Pinto)
* **Core Concept**: Stateless capabilities and session state tokens must rely on robust cryptographic signatures to guarantee token integrity and origin authenticity, preventing tampering by client-side or intermediary actors.
* **Backend Engineering Context**: When using JSON Web Tokens (JWTs), they must be digitally signed using robust asymmetric algorithms (like RS256). Refresh tokens must be stored in secure, `HttpOnly`, `SameSite=Strict`, and `Secure` (HTTPS-enforced) cookies so client-side JavaScript cannot read them, completely eliminating the risk of Cross-Site Scripting (XSS) token theft.

---

## 8. Broken Object-Level Authorization (BOLA / IDOR) Protection

* **Textbook Source**: *The Web Application Hacker's Handbook* (Dafydd Stuttard & Marcus Pinto)
* **Core Concept**: Access control must map contextually down to individual records, not just endpoints. The system must never assume that access to an interface grants access to all data structures referenced by that interface.
* **Backend Engineering Context**: If a user hits `/api/orders/5521`, the backend must not just check if the user is logged in; it must execute a database-level validation check: `WHERE order_id = 5521 AND user_id = current_logged_in_user_id`. Using non-sequential, random identifiers like UUIDv4 instead of auto-incrementing integers (1, 2, 3...) further mitigates endpoint guessing.

---

## 9. Secure Cross-Origin Resource Sharing (CORS) & Security Headers

* **Textbook Source**: *The Web Application Hacker's Handbook* (Dafydd Stuttard & Marcus Pinto)
* **Core Concept**: The browser's Same-Origin Policy (SOP) must be backed up by explicit server instructions that define trusted domains and instruct modern runtimes on strict enforcement mechanisms.
* **Backend Engineering Context**: Never use wildcard origins (`Access-Control-Allow-Origin: *`) on endpoints that handle credentials or private user data. Additionally, the backend must inject essential HTTP response headers into every transmission, such as `X-Content-Type-Options: nosniff` (to prevent MIME sniffing) and `Content-Security-Policy` (to restrict resource loading scopes).

---

## 10. Secrets Management and Environment Isolation

* **Textbook Source**: *Designing Secure Software* (Loren Kohnfelder)
* **Core Concept**: Configuration data must be strictly separated from source code. Credentials must be treated as fluid operational variables that are isolated to specific deployment boundaries.
* **Backend Engineering Context**: Utilize zero-exposure configuration structures. In development, use strictly git-ignored `.env` files. In production, ingest secrets at runtime using environment variables provided by dedicated secret managers (such as AWS Secrets Manager, HashiCorp Vault, or Doppler). Additionally, rotate production keys systematically to invalidate leaked credentials automatically.

---

## 11. Data Encryption (In-Transit and At-Rest)

* **Textbook Source**: *Cryptography and Network Security* (William Stallings)
* **Core Concept**: Confidentiality must be maintained through all phases of the data lifecycle. If physical media is compromised or a network stream is intercepted, the underlying cleartext must remain protected by robust cryptographic algorithms.
* **Backend Engineering Context**:
  * **In-Transit**: Force TLS 1.3 (HTTPS) for all incoming API routes and encrypt traffic moving between microservices or background workers.
  * **At-Rest**: Utilize underlying database engine encryption (like AES-256) for data volumes. For highly sensitive properties (such as user credit cards or national IDs), implement column-level application encryption before passing data to the database write stream.

---

## 12. Server-Side Request Forgery (SSRF) Mitigation

* **Textbook Source**: *The Web Application Hacker's Handbook* (Dafydd Stuttard & Marcus Pinto)
* **Core Concept**: An application backend must not act as an un-orchestrated proxy. External resource resolution parameters must be validated to prevent the exploitation of internal networking contexts.
* **Backend Engineering Context**: If your backend must fetch external data based on user input, never blindly execute a request to the provided URL. Implement strict destination parsing: parse the target domain, validate it against a strict whitelist of permitted domains, and explicitly block the backend from requesting local/loopback IP ranges (like `127.0.0.1` or AWS metadata endpoints like `169.254.169.254`).

---

## 13. Mass Assignment Protection

* **Textbook Source**: *Patterns of Enterprise Application Architecture* (Martin Fowler)
* **Core Concept**: Data transfer mechanisms should rely on deterministic mapping models. Untrusted source models must never be automatically mapped to persistent domain entities without explicit filtering boundaries.
* **Backend Engineering Context**: If a user updates their profile using an endpoint, they might pass `{"username": "alex", "is_admin": true}`. If the backend blindly maps the incoming request payload directly to a database update statement (e.g., `User.update(req.body)`), the user can escalate their privileges. Avoid direct mapping; use Data Transfer Objects (DTOs) or explicit field Whitelisting (`{ username: req.body.username }`) to cherry-pick safe parameters.

---

## 14. Secure Deserialization & File Upload Defense

* **Textbook Source**: *Writing Secure Code* (Michael Howard & David LeBlanc)
* **Core Concept**: Reconstituting structured objects from incoming binary streams or storing external files on application media poses severe execution risks. Runtimes must isolate parsing contexts and avoid parsing untrusted format schemas blindly.
* **Backend Engineering Context**: When handling user uploads, never store files directly on the local server storage where they could potentially be executed as code (e.g., an uploaded `.php` or `.js` file). Upload payloads must have their MIME types explicitly verified (do not rely on file extensions), be renamed to random UUIDs, and be shuttled directly to isolated, non-executable storage buckets (like AWS S3) with appropriate cross-origin policies.

---

## 15. Automated Static and Dynamic Analysis (SAST/DAST)

* **Textbook Source**: *Software Engineering* (Ian Sommerville)
* **Core Concept**: Software quality assurance must treat security criteria as a non-functional testing standard that can be validated continuously through both structural code review (Static) and runtime behavioral analysis (Dynamic).
* **Backend Engineering Context**: Embed security linter checks directly within your GitHub Actions or GitLab CI/CD pipelines. This includes running SAST (Static Application Security Testing) tools like SonarQube or Semgrep to flag code-level anti-patterns, and DAST (Dynamic Application Security Testing) tools to fuzz test live staging environments for active flaws before deployment approval.

---

## 16. The Principle of Mutual Distrust (Compartmentalization)

* **Textbook Source**: *Computer Security: Art and Science* (Matt Bishop) / *Designing Secure Software* (Loren Kohnfelder)
* **Academic Definition**: A system must be designed under the assumption that its internal components are potentially compromised or untrustworthy. Components should not grant privileges to other components simply because they exist within the same security perimeter.
* **Software Engineering Context**: This is the foundation of secure microservices. If your Billing Service receives an HTTP request or an event payload from your Inventory Service over an internal network, the Billing Service must still fully validate, sanitize, and verify the signature of that payload. It must never assume internal traffic is safe.

---

## 17. The Principle of Work Factor (Economic Asymmetry)

* **Textbook Source**: *The Protection of Information in Computer Systems* (Saltzer & Schroeder) / *Security Engineering* (Ross Anderson)
* **Academic Definition**: The cost, effort, and computational resources required for an adversary to overcome a protective security mechanism must significantly exceed the actual economic or strategic value of the asset being protected.
* **Software Engineering Context**: This dictates how you configure cryptographic operations. For example, when hashing passwords using bcrypt or Argon2id, you must tune the "work factor" (computational rounds/memory costs) high enough so that brute-forcing a leaked database is mathematically unaffordable for an attacker, balanced against your server's hardware capacity to handle legitimate traffic.

---

## 18. The Principle of Cryptographic Non-Repudiation

* **Textbook Source**: *Cryptography and Network Security: Principles and Practice* (William Stallings)
* **Academic Definition**: The system must provide proof of the integrity and origin of data in such a way that the sending entity cannot deny having performed a specific transaction or action.
* **Software Engineering Context**: Traditional database logs can be altered by a rogue database administrator or an attacker with SQL injection access. To enforce true non-repudiation in highly sensitive backend workflows (like financial transfers or infrastructure configuration changes), actions must be cryptographically signed by the actor's private key or stored in append-only, immutable ledgers that mathematically prove the logs haven't been tampered with.

---

## 19. The Principle of Data Minimization (Privacy by Design)

* **Textbook Source**: *Software Engineering* (Ian Sommerville) / *Engineering Privacy guidelines*
* **Academic Definition**: A system must not collect, process, retain, or expose any personal or sensitive data beyond the absolute minimum required to fulfill a specific, current operational purpose.
* **Software Engineering Context**: When designing database schemas, minimize your attack surface by refusing to store toxic data. If your application only needs to know if a user is over 18 years old, do not save their full Date of Birth in the database. Evaluate the constraint at registration, save a boolean flag like `is_adult: true`, and purge the raw date. If you don't store it, it can't be stolen in a breach.

---

## 20. The Principle of Predictive Threat Modeling (The STRIDE Framework)

* **Textbook Source**: *Writing Secure Code* (Michael Howard & David LeBlanc, Microsoft) / *Threat Modeling* (Adam Shostack)
* **Academic Definition**: Security cannot be an afterthought implemented via post-development patching. It must be a predictive, structured engineering activity executed during the initial architectural design phase by evaluating system boundaries against known threat vectors.
* **Software Engineering Context**: Before a single line of backend code is written for a new feature, engineers must construct a Data Flow Diagram (DFD) and systematically evaluate every data boundary crossing against the STRIDE matrix: Spoofing identity, Tampering with data, Repudiation, Information disclosure, Denial of service, and Elevation of privilege.

---

## 21. Priority 0 (P0): Catastrophic System Compromise (Critical Severity)

* **Textbook Source**: *Site Reliability Engineering: How Google Runs Production Systems* (Beyer, Jones, Petoff, & Murphy) / *Writing Secure Code* (Howard & LeBlanc)
* **Academic Definition**: A catastrophic failure state characterized by the immediate and total loss of a core security attribute (Confidentiality, Integrity, or Availability) across primary production environments. P0 issues demand continuous, un-throttled engineering intervention until a remediation patch or containment circuit-breaker is successfully deployed.
* **Software Engineering Context**: This represents live, unmitigated exploits or complete infrastructure failure. Examples include an active Remote Code Execution (RCE) vulnerability allowing arbitrary shell execution on production application containers, public leakage of root cloud architecture keys, or a live data-exfiltration event stripping unencrypted user databases.

---

## 22. Priority 1 (P1): High-Risk Structural Vulnerability (High Severity)

* **Textbook Source**: *Software Engineering: A Practitioner's Approach* (Roger S. Pressman) / *Threat Modeling: Designing for Security* (Adam Shostack)
* **Academic Definition**: A severe architectural or implementation defect that compromises critical system boundaries and features a clear, repeatable exploit path, but lacks evidence of immediate active exploitation in production environments.
* **Software Engineering Context**: This involves flaws that compromise core customer data or business logic. Examples include unauthenticated SQL Injection (SQLi) vulnerabilities on an API gateway, Broken Object-Level Authorization (BOLA/IDOR) that allows any logged-in user to view or modify another user's financial ledger, or a complete failure of the JWT validation middleware that permits unauthorized requests to bypass backend authentication gates entirely.

---

## 23. Priority 2 (P2): Conditional Security Exposure (Medium Severity)

* **Textbook Source**: *The Web Application Hacker's Handbook* (Dafydd Stuttard & Marcus Pinto)
* **Academic Definition**: A security defect that presents operational risk but relies on complex, conditional prerequisite states, specialized actor permissions, or extensive social engineering orchestration to successfully manifest an exploit.
* **Software Engineering Context**: These flaws are restricted by scope or authorization requirements. Examples include a Stored Cross-Site Scripting (XSS) vulnerability that can only be executed within an isolated administrative dashboard, a Mass Assignment vulnerability on a non-privileged user profile field (e.g., changing a zip code maliciously), or a missing rate limit on an expensive API route that causes localized, temporary resource degradation but cannot take down the core database engine.

---

## 24. Priority 3 (P3): Low-Risk / Architectural Hygiene (Low Severity)

* **Textbook Source**: *Designing Secure Software* (Loren Kohnfelder) / *Software Engineering* (Ian Sommerville)
* **Academic Definition**: Minor technical debt or non-conformance with best-practice secure development standards. These issues present no immediate, direct vector for systemic compromise but weaken peripheral defense-in-depth posture or violate compliance frameworks.
* **Software Engineering Context**: These are technical hardening adjustments. Examples include exposing underlying server engine version numbers in public HTTP response headers (e.g., `Server: nginx/1.18.0`), missing non-critical security flags like `X-Frame-Options` on an informational marketing landing page, or utilizing an outdated but currently un-exploitable third-party utility package inside the application's dev-dependencies.

---

## 25. Priority 4 (P4): Cosmetic Defects & Best-Practice Enhancements (Negligible Severity)

* **Textbook Source**: *Software Engineering: A Practitioner's Approach* (Roger S. Pressman) / *The Security Development Lifecycle* (Michael Howard & Steve Lipner, Microsoft Press)
* **Academic Definition**: A non-conformance artifact or cosmetic irregularity within user-facing interfaces, non-functional code blocks, or auxiliary documentation. It poses absolutely zero demonstrable threat to the system's core security properties (Confidentiality, Integrity, Availability), but represents a minor deviation from optimal code hygiene or operational style guidelines.
* **Software Engineering Context**: These are low-priority backlog items typically handled during routine maintenance cycles. Examples include minor typographical or spelling errors in a backend API error string, outdated technical comments inside a source file, or a request to update a secure linter configuration to ignore a known, safe code layout.

---

## 26. Priority 5 (P5): Inconsequential Observations & Out-of-Scope Items (Zero Risk)

* **Textbook Source**: *Computer Security: Art and Science* (Matt Bishop) / Standardized Vulnerability Rating Taxonomies (e.g., *Bugcrowd VRT* / *FIRST CVSS Framework*)
* **Academic Definition**: An isolated technical finding, automated scanner telemetry artifact, or user submission that—upon human validation and threat context assessment—is mathematically proven to have zero real-world exploitability, is completely neutralized by adjacent environmental controls, or falls entirely outside the defined security boundaries of the system.
* **Software Engineering Context**: These entries are immediately closed, marked as "intended behavior," or retained purely as informational notes. Examples include an automated scanner flagging a theoretical vulnerability in a dead code path that is never compiled or executed, a bug bounty report claiming a vulnerability because a public API returns a standard `404 Not Found` response code, or a user reporting a flaw on a completely decoupled, static marketing website that holds no access to the application data layer.