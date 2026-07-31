# Desktop Agent — In-App Auth (Auth-Backend) Plan

**Scope:** `Tauri-App-Extension`, using `Auth-Backend` (`https://auth.myvirtualtracker.com`) the same
way `Dashboard-Web` does. `Dashboard-Backend` unchanged — every endpoint this needs already exists.
**Status:** **Implemented 2026-07-31** (items 0, 1, 3 built; item 2 shipped as the browser link it
recommends). `cargo test` 15/15, `tsc` and `vite build` clean. Manual checks below still pending.
**Date:** 2026-07-31

Goal, as asked: sign in with a normal email/password form inside the agent, keep the browser "Link
account" button as one mode among several, and stop losing the session when the app is closed and
reopened.

---

## 0. Prerequisite — the agent is pointed at the wrong host for auth (live bug)

### Evidence

```
GET https://appapi.myvirtualtracker.com/api/auth/firebase-config
  → 404 {"code":"AUTH_BACKEND_ROUTE","error":"This route is handled by Auth-Backend."}
GET https://auth.myvirtualtracker.com/api/auth/firebase-config
  → 200 {"success":true,"config":{"apiKey":"…","authDomain":"…",…}}
```

`Dashboard-Backend` deliberately refuses those paths
([handle-request.js:102](Dashboard-Backend/src/app/handle-request.js:102)), and the list of what
belongs to Auth-Backend is explicit
([authn-paths.js](Dashboard-Backend/src/modules/auth/authn-paths.js)). The agent nevertheless builds
that URL from its Dashboard API base ([firebase.rs:41](Tauri-App-Extension/src-tauri/src/client/firebase.rs:41)),
where `api_url = PROD_API_URL = appapi.myvirtualtracker.com`
([constants.rs](Tauri-App-Extension/src-tauri/src/constants.rs)).

### What that breaks right now

`firebase_api_key()` returns `None`, so:

| Path | Consequence |
|---|---|
| `refresh()` | returns `Unreachable` before it ever calls Google. Once the id token passes its hour, **every** authenticated call fails |
| `sign_in_with_custom_token()` | returns `None`, so `reauth_with_device()` fetches a valid custom token from `/api/activity/agent/reauth` and then cannot spend it — **in-app recovery never works** |
| Restart with an aged token | `refresh_token_if_needed()` is false, `get_connection_state()` reports `signedOut` with a cached profile — precisely the stale-session symptom in `agent-ux-fixes-plan.md` item 5 |

So "keeps losing my tokens" is not a storage problem. Storage is already correct: DPAPI-encrypted
`agent-store.json` holding id token + refresh token + device credential
([tokens.rs](Tauri-App-Extension/src-tauri/src/auth/tokens.rs)), restored on launch by
`restore_session`, re-saved on every rotation via `on_tokens_refreshed`. The tokens are kept — they
just cannot be *renewed*.

### Fix

1. `PROD_AUTH_URL = "https://auth.myvirtualtracker.com"` in `constants.rs`.
2. `Settings.auth_url`, `VT_AUTH_URL` override, same shape as `api_url` / `web_url`
   ([config.rs](Tauri-App-Extension/src-tauri/src/config.rs)).
3. `FirebaseTokenService::new(auth_url, client)` — it is the only consumer of that base URL.
   `ApiClient::new` grows one parameter.

Three lines of real change. Do this first and independently: it restores refresh + device recovery
for **existing** installs with no UI work at all, and every item below depends on it.

### Deliberately not built

- No proxying of `/api/auth/*` through `Dashboard-Backend`. It refuses those paths on purpose;
  duplicating them there would give the agent a second, drifting copy of auth config.

---

## 1. In-app sign-in (email + password)

### How the browser does it

`Dashboard-Web` calls Firebase's client SDK directly
([auth-context.tsx:1025](Dashboard-Web/shared/providers/auth/auth-context.tsx:1025)), using the web
config from Auth-Backend, and asks Auth-Backend only for the things a client must not decide for
itself: password policy, sign-in methods for an email, token verification. The agent should do the
same over REST — there is no Auth-Backend "sign in" endpoint to call, and adding one would put
passwords through a service that currently never sees them.

### Flow

1. **Pre-flight** — `POST {auth_url}/api/auth/resolve-sign-in-methods` `{email}`.
   Returns the providers on file. `[]` → "No account for this email." `["google.com"]` without
   `"password"` → "This account signs in with Google — use Link account." Mirrors the web's
   `assertCanSignInWithEmailAndPassword` instead of letting Firebase return a vague error.
2. **Sign in** — `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<apiKey>`
   with `{email, password, returnSecureToken:true}`. Same host and key the custom-token path already
   uses ([firebase.rs:137](Tauri-App-Extension/src-tauri/src/client/firebase.rs:137)) — one more
   method on `FirebaseTokenService`, no new dependency.
3. **Persist** — hand `(idToken, refreshToken)` to the existing `AgentController::apply_tokens`.
   That already saves to the encrypted store, installs the rotation callback, and calls
   `ensure_device_registered()`, which claims the device credential from
   `POST /api/activity/agent/device/register` ([link.rs:33](Tauri-App-Extension/src-tauri/src/client/api/link.rs:33)).
   Nothing new to write for persistence.
4. **Authorize** — `POST {api_url}/api/auth/session-bootstrap` with the bearer token
   ([session-bootstrap.js:23](Dashboard-Backend/src/modules/auth/session-bootstrap.js:23)). This is
   the same gate the web session passes and it is where the member record is created/aligned. It
   returns the real reasons to refuse: `ACCOUNT_DISABLED`, banned member or device, email not
   verified for password users ([session-authorization.js:41](Dashboard-Backend/src/modules/auth/session-authorization.js:41)),
   must-change-password. Skipping it would let the agent accept a user the dashboard rejects, and
   would leave self-registered users with no member row — every later call 404s "Member not found".
5. **On refusal** — clear tokens, show the reason, and offer the browser link for the cases the
   agent cannot resolve (password change, verification, MFA).

### Error mapping (Identity Toolkit → what the user reads)

| Firebase | Message |
|---|---|
| `EMAIL_NOT_FOUND`, `INVALID_PASSWORD`, `INVALID_LOGIN_CREDENTIALS` | "Email or password is incorrect." |
| `USER_DISABLED` | "This account has been disabled. Contact your administrator." |
| `TOO_MANY_ATTEMPTS_TRY_LATER` | "Too many attempts. Try again later, or use Link account." |
| `MFA_REQUIRED` / `mfaPendingCredential` present | "This account needs a second factor — continue in the browser." → link flow |

### Guardrails

- The password lives in one `String` for the duration of the call and is never stored, logged, or
  echoed into a status line. The agent already writes a diagnostic log the user can open from
  Settings, so this is not theoretical.
- No local attempt counter beyond what Firebase enforces — a second, weaker limiter in the client is
  security theatre.
- HTTPS only, no `VT_AUTH_URL` override honoured in release builds if it is not `https://`.

### UI

Replace the current "Not signed in" empty state with a small form:

| Element | Behaviour |
|---|---|
| Email, Password | Enter submits |
| **Sign in** | Flow above |
| **Link account instead** | Existing browser flow, unchanged — required for Google/Apple/MFA |
| Forgot password? | Opens the web reset page |
| Create account | Opens the web sign-up page (see item 2) |

`WelcomeBackPanel`'s "Not you? Switch account" routes here rather than straight to the browser.

---

## 2. Registration — recommend it stays in the browser

Mechanically it is easy (`accounts:signUp` + `/api/auth/validate-password`). It is the *product*
semantics that make an in-app register form a dead end:

1. Web registration deliberately **signs the user back out** and sends a verification email
   ([auth-context.tsx:1093](Dashboard-Web/shared/providers/auth/auth-context.tsx:1093)) — it never
   yields a usable session.
2. Password users must verify their email before session authorization passes
   ([session-authorization.js:45](Dashboard-Backend/src/modules/auth/session-authorization.js:45)).
3. Even verified, a brand-new user has no project, no task and no
   `desktop_agent_linked_at`, so the timer refuses to start
   ([routes.js:286](Dashboard-Backend/src/modules/activity/routes.js:286)). Someone has to add them
   to a team first.

So the best possible in-app register ends on "check your email, then wait to be added" — a form
whose success state is still a dead app. **Recommendation:** the Create account button opens the web
sign-up page (one line, existing `open_url_in_launcher_or_browser`). Revisit only if self-serve
onboarding becomes a real product flow.

If it is wanted anyway, it is phase 2 and must be: `POST /api/auth/validate-password` → `accounts:signUp`
→ `sendOobCode` → sign the local session straight back out → "Verify your email, then sign in" screen.
No tokens kept.

---

## 3. What "never lose the session" means once item 0 lands

The full chain, all of it already written except the base URL:

1. Launch → `restore_session()` loads the encrypted store (tokens **and** device credential).
2. Id token near expiry → `refresh()` against `securetoken.googleapis.com` with the key from
   Auth-Backend → new pair saved by the rotation callback.
3. Refresh rejected (password change, revoke, 30-day idle) → `reauth_with_device()` mints a custom
   token from `/api/activity/agent/reauth` and trades it for a fresh pair — no user interaction.
4. Device itself revoked → Welcome Back panel → Continue / Switch account / Link again.

Closing the window (or the tray-close from `agent-ux-fixes-plan.md` item 2) touches none of this.
The only remaining case that needs a human is step 4.

**Optional, small:** refresh once on window-show and after a resume-from-sleep, so the first click
after a long idle is not the thing that discovers the token expired. One call, guarded by the same
in-flight ref as the other polls.

---

## Sequencing

| Order | Item | Why here | Size |
|---|---|---|---|
| 1 | **0** — `auth_url` split | Live bug; fixes refresh + device recovery for installs already out there, no UI | XS |
| 2 | **1** — sign-in form + session-bootstrap gate | The actual feature; depends on 0 for the API key | M |
| 3 | **3** — refresh on show/wake | Polish once the chain works | XS |
| 4 | **2** — register | Browser link only. Full in-app form deferred, with reasons above | XS (link) |

Item 0 ships on its own and should not wait for the form.

## Checks left behind

- Unit (`client::firebase::tests`, 5 cases): Identity Toolkit code → message mapping, including
  codes carrying a ` : detail` suffix, the MFA branch that must say "Link account", and the rule that
  an unrecognised code never leaks the raw Google string. Wrong password and unknown email map to the
  *same* message on purpose — distinguishing them is an account-enumeration oracle.
- Unit (`config::tests`, 3 cases): `VT_AUTH_URL` empty → `PROD_AUTH_URL`; a dev build may point at
  `http://127.0.0.1:5712`; a release build refuses any non-HTTPS override.
- Manual: sign in with the form → close the app → reopen → still signed in, timer usable.
- Manual: sign in, wait past token expiry (or clock-skew the test), confirm a silent refresh instead
  of a Welcome Back panel.
- Manual: Google-only account → form refuses with the "use Link account" message, not a raw Firebase
  error.
- Manual: unverified password account → refused by `session-bootstrap` with its own message, tokens
  cleared.

## What was built, where

| Piece | Location |
|---|---|
| `PROD_AUTH_URL`, `Settings.auth_url`, HTTPS-only override | [constants.rs](Tauri-App-Extension/src-tauri/src/constants.rs), [config.rs](Tauri-App-Extension/src-tauri/src/config.rs) |
| `FirebaseTokenService` now keyed on Auth-Backend | [firebase.rs](Tauri-App-Extension/src-tauri/src/client/firebase.rs) |
| `sign_in_with_password`, `sign_in_methods`, `PasswordSignInError` | [firebase.rs](Tauri-App-Extension/src-tauri/src/client/firebase.rs) |
| `session_bootstrap()` (member record + authorization gate) | [api/mod.rs](Tauri-App-Extension/src-tauri/src/client/api/mod.rs) |
| Three-step orchestration + rollback on refusal | `AgentController::sign_in_with_password` |
| `sign_in_with_password` command | [lib.rs](Tauri-App-Extension/src-tauri/src/lib.rs) |
| Sign-in form, links, refresh-on-focus | [App.tsx](Tauri-App-Extension/src/App.tsx), [App.css](Tauri-App-Extension/src/App.css) |

Deviation worth noting: "Switch account" on the Welcome Back panel no longer opens a browser. It
signs out and drops to the signed-out home view, which is now the form — the browser link is one
button away from there for provider accounts.
