# Plan — Project chat, the Break Lounge, Friends, and controller-owned feature access

Status: **proposal — nothing built.** This file is the deliverable of the
discussion; no code changes accompany it. Research on free third-party APIs and
assets was done on 2026-09-26 (§14). The same day, every risk and unverified
item from the first draft was investigated and either resolved with evidence or
turned into a concrete gate (§10). Two things changed materially: the
"agent-only" mechanism (§13.2 — the first draft's design would not have worked)
and the screenshot protection (§3.3 — now proven with xcap's own capture method).

Four parts, planned together because they share one transport (the presence
WebSocket), one privacy rule (membership and relationship, never role), and one
rollout switch (a grant only one person can issue).

---

## 1. What was asked

**A. Project chat.** A Telegram/WhatsApp-style chat per project, available in
the tracker at all times — not only on breaks. Emojis, stickers, GIFs from a
free GIF library, and the usual conversational features (§3.1).

**B. The Break Lounge.** When a member is on a break, a controller icon appears
in the title bar. Opening it switches the whole tracker into a "lounge" layout:
games and hanging out with the other members of the same project. Ending the
break (or pressing Back to work) returns to the normal layout.

**C. A friend list that lives only inside the Tauri app** (§13). Friends unlock
1:1 messages and game invites.

**D. A controller-owned switch.** A member gets A–C only if the one controller
account (`mohamedhms3102@gmail.com`) grants it — directly, or by handing them a
single-use access code. Access is **not tied to an app version**: the code ships
dark in normal releases (1.1.1, 1.1.2, … 1.1.N) and the server decides who sees
it.

### Decisions locked

1. Chat, lounge, and friends are one plan, in phases.
2. **Owners cannot read chats of projects they are not assigned to, and cannot
   observe or interfere with a lounge.** Access follows project membership
   (rooms) or a mutual friendship (DMs); role never widens it.
3. The lounge opens **only** from the title-bar controller icon, and that icon
   exists **only in a lounge-eligible state** — by default, while the member is
   on a break of any kind (Pause or private break); the member's lounge policy
   can widen it to stopped, off-shift or time-off time or narrow it to nothing
   (§22.4 is the single source of truth). A break alone does not change the
   layout.
4. Feature access is issued by the controller only, by **both** routes: a
   controller-confirmed grant, and controller-minted redeemable codes.
5. This feature is **outside the Virtual Tracker product**. It is built and
   owned by the controller and their agents, and stays usable only by people the
   controller chooses (§4.0).
6. Chat is a "normal" messenger: emoji, stickers, GIF library, tiered feature
   set in §3.1.
7. Screen capture is not a concern **during any break** (owner's statement of
   how the agent behaves). Chat, however, is usable while working — see §3.3.
8. **Friends exist only inside the Tauri app** — no web UI, no web API surface
   (§13).
9. Third-party services must be **free** (§14). Anything paid or that forbids
   our architecture is rejected.
10. **Real third-party games** (Sudoku, Codenames-style, merge/farm games) may be
    offered in an **Arcade**, run in an isolated window, clearly labelled as
    *not part of Virtual Tracker*, and only from a controller-curated catalog
    whose entries have verified embedding rights (§16).
11. **Voice rooms** are wanted, but **no audio or video media may pass through
    the Virtual Tracker host**. Use a free third-party service or peer-to-peer;
    our server only mints short-lived tokens (§17).

---

## 2. Current state (verified in code)

- **Realtime rail exists.** [presence-gateway.js](Dashboard-Backend/src/modules/presence/presence-gateway.js) serves
  `/api/presence/ws`: authenticates, tracks `connectionsByMember`, exposes
  `sendToMember` / `broadcastToAll`, handles `ping` and `activity`. Multiple
  sockets per member are already normal. `presence-pubsub.js` (Redis) exists for
  cross-instance fan-out.
- **The agent already holds that socket.** [live_sync.rs](Tauri-App-Extension/src-tauri/src/agent/live_sync.rs) connects with
  `tungstenite`, forwards inbound text to the UI, and sends only a `ping`.
- **The webview cannot talk to the API itself.** The Tauri CSP is
  `connect-src 'self' ipc: http://ipc.localhost`
  ([tauri.conf.json:37](Tauri-App-Extension/src-tauri/tauri.conf.json:37)); all network access goes through Rust (`invoke`). The same
  CSP allows `img-src https: data: blob:`, so remote GIF/sticker images render
  without a CSP change.
- **Agent sessions are indistinguishable from web sessions.** The agent
  re-authenticates with `deviceId` + `agentSecret`
  (`verifyAgentDevice`, [activity/routes.js:2107](Dashboard-Backend/src/modules/activity/routes.js:2107)) and receives
  `auth.createCustomToken(firebaseUid)` with **no developer claims**
  ([routes.js:2173](Dashboard-Backend/src/modules/activity/routes.js:2173)). The only agent marker on requests is the
  advisory `X-Agent-Version` header (read at [routes.js:622](Dashboard-Backend/src/modules/activity/routes.js:622)). A token *claim* cannot
  fix this — claims in a custom token appear only on the first ID token, refreshes
  regenerate from the user record, and web and agent share one Firebase user. The
  fix is a separate device-signed proof (§13.2).
- **The agent stores its device credentials locally.** `device_id` +
  `agent_secret` live in the agent's credential file
  ([auth/tokens.rs](Tauri-App-Extension/src-tauri/src/auth/tokens.rs)); the server keeps only `sha256(secret)`
  ([agent-devices.service.js](Dashboard-Backend/src/modules/activity/agent-devices.service.js)). The web app never has them — which is
  what makes them usable as proof of "this is the Tauri agent".
- **Deployment: Coolify, one container per app, plus PostgreSQL and Redis.**
  Confirmed by the owner (and the Coolify project view): auth, Dashboard-Backend,
  Dashboard-Web, Landing-Web, notification and Web-Backend each run as one
  application, alongside a Postgres database and a Redis-type "RealTime" database.
  (The repo's [deploy/docker-compose.yml](deploy/docker-compose.yml) is the split-deploy variant and also runs one
  backend container.) Redis is already wired: `lib/redis/client.js` exposes
  `isRedisConfigured()`, `getRedisClient()` and `getRedisSubscriberClient()`, and
  [presence-pubsub.js](Dashboard-Backend/src/modules/presence/presence-pubsub.js) publishes on a Redis channel and falls back to an in-process
  emitter when `REDIS_URL` is unset. The existing rate limiter
  ([http/rate-limit.js](Dashboard-Backend/src/http/rate-limit.js)) is an in-process `Map`.
- **`xcap` captures the screen with GDI `BitBlt`** from the display DC
  (`xcap-0.3.3/src/windows/capture.rs` + `impl_monitor.rs`), which is what
  screen-capture exclusion is tested against in §3.3.
- **Devices are tracked.** `agent_devices` (device id, member, secret hash,
  `agent_source`, revoked) in [ensure-lookup-schema.js:1537](Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js:1537).
- **Break state exists in the agent.** `paused` / `handlePause` /
  `handleResume` in [App.tsx](Tauri-App-Extension/src/App.tsx); private break is a separate path in
  [PrivacyPanel.tsx](Tauri-App-Extension/src/components/views/PrivacyPanel.tsx) (`set_private_break`).
- **Title bar has room for one more button.**
  [TitleBar.tsx](Tauri-App-Extension/src/components/common/TitleBar.tsx) renders theme, notifications, update, minimize, close.
- **The agent already receives a per-member `capabilities` object.**
  `buildAgentWorkspace` returns `capabilities: { canLogManualTime }`
  ([workspace.service.js:155](Dashboard-Backend/src/modules/activity/workspace.service.js:155)) — the carrier for new flags.
- **Screenshots use `xcap`** ([capture/screen.rs](Tauri-App-Extension/src-tauri/src/capture/screen.rs)); no window is currently
  content-protected.
- **Project membership is a real table:** `project_members`
  ([ensure-lookup-schema.js:1342](Dashboard-Backend/src/lib/postgres/ensure-lookup-schema.js:1342)).
- **Messaging precedent.** [messages/routes.js](Dashboard-Backend/src/modules/messages/routes.js) does Owner↔member threads and
  checks participation on every read/write — the discipline to keep.
- **The controller/OTP machinery is planned, not built.**
  [PLAN-confidential-owner-access-overlay.md](PLAN-confidential-owner-access-overlay.md) defines the controller identity gate,
  the HMAC'd 8-digit email challenge, limits, and a kill switch. No
  `confidential-access` module exists yet. This plan reuses that design (§4).

### Trap to design around

The backend has many helpers that give `owner` / `superadmin` / `admin`
all-project scope (`PROJECT_SCOPE_ROLES` in `activity-scope.js` and
`bootstrap-service.js`, `MANAGEMENT_ROLES`, hierarchy visibility helpers). This
feature must **not** route through any of them; it queries `project_members` and
the friendship table directly. The confidential-overlay grantee gets no access
from that overlay either.

---

## 3. Product behaviour

### 3.1 Chat (project rooms; DMs between friends)

A **room** is either a project room (one per project the member is assigned to;
only *entitled* members of that project are in it — the header shows "N of M
project members have access") or a **DM** between two friends (§13). One engine,
two room kinds. Feature tiers:

| Tier | Features |
| --- | --- |
| **1 — messenger core** | Text (2,000 chars) · Unicode emoji with an in-app picker · **reactions** · **replies/quotes** · edit and delete **own** messages ("edited" mark) · **stickers** · **GIFs** · unread badges · typing indicator · "seen" markers · OS + in-app notifications (§3.3, §22.5) · **Do Not Disturb, quiet hours, per-room and per-member mute** (§22.6) · **personal sticker libraries, saved GIFs, GIF search** (§22.11) · **task/project link cards** (§22.10) · **report** (§3.4) |
| **2 — richer** | Image attachments (paste/drag) · @mentions · pinned messages · search within a room · link previews |
| **3 — not planned now** | Voice notes · file transfer · group DMs · threads/channels. (Member-uploaded stickers moved into Tier 1 — §22.11.) (Live **voice rooms** are planned separately and never run on our servers — §17.) |

- **Emoji.** Render with the OS emoji font (zero assets). The Windows emoji
  panel (Win+.) already works in the text box; the in-app picker is for
  reactions. Use a picker with **self-hosted data** bundled in the app — its
  default dataset URL is a CDN the CSP blocks (§14.2).
- **Stickers.** Curated packs owned by the controller (§14.3). Static or
  animated WebP; no Lottie in v1. A message stores only `sticker_id`.
- **GIFs.** Provider chosen and abstracted in §14.1 (Klipy; Tenor no longer
  exists; GIPHY is excluded). A GIF message stores
  `{provider, id, url, previewUrl, title, w, h}` — **not the GIF bytes** (stored
  only for a member's own "saved as sticker" copy, and only once the provider
  permits it — §22.11). If the
  provider later removes a GIF or shuts down, the message renders its `title`
  as a "GIF unavailable: <title>" placeholder instead of a broken image. The
  picker follows Klipy's attribution rules ("Search KLIPY" placeholder, "Powered
  by KLIPY" mark). Default rating filter is `g` (a work tool), env-tunable
  (`GIF_RATING`).
- **Typing / seen.** Ephemeral WebSocket signals; "seen" derives from
  `last_read_message_id` per member.

### 3.2 Break Lounge

1. Member starts a break (any kind) → if entitled, a **controller icon** appears
   in the title bar. Layout is unchanged.
2. Member clicks the icon → the tracker swaps to the **lounge shell**:
   - Left: their projects, each with a count of who is in that lounge.
   - Centre: the selected project's lounge — the game area.
   - Side: the same chat panel (one chat implementation, not two).
   - Top: a permanent **"Back to work" bar** with the break clock.
3. Ending the break by any route (Resume, timer, agent restart) closes the
   lounge and leaves the room.
4. The break stays a break: time keeps counting as idle. The lounge never
   converts to work time and never changes capture policy.
5. **Friend invites.** A friend can invite a friend to a private two-player game
   (§13.4). The invitee sees it as a DM card; accepting is possible only while
   they are on a break (the card says "Available when you're on a break").
6. **Getting back to work.** After 15 minutes in the lounge (env-tunable
   `LOUNGE_NUDGE_MINUTES`) a non-blocking banner reads "Your break has run 15
   minutes — back to work?" with a one-click **Back to work**. It repeats every
   15 minutes. It never closes the lounge by itself and never touches time
   accounting; the break clock in the bar keeps running.

Games are a registry: each game is a pure reducer `(state, action) → state` plus
a React view; the server only relays. v1 ships **tic-tac-toe**; trivia (§14.4)
is next. The host client holds game state (§7).

**Break gating is UI-only.** The server checks entitlement and membership on
lounge messages but does **not verify eligibility** (break state, lounge policy,
budget) — the agent's UI enforces §22.4. Ceiling: a modified client can play
while tracking — harmless to privacy, and the tracker still counts that time as
work. The server **does record** lounge open/close events for analytics
(§22.2); it joins them to the pause/resume intervals it already stores, so the
agent does not report breaks separately.

### 3.3 Privacy (the part that must be true)

- Rooms and DMs are visible only to their members who hold the grant — not
  owners, admins, managers, or the controller, unless they are a member.
- **Lounge state never leaves the room.** No lounge event goes through
  `broadcastToAll`, the presence snapshot, `changed` events, member lists,
  activity/timesheet/reports, exports, or audit views. An owner watching a
  member sees "on a break" and nothing more.
- No owner moderation tools in the lounge.
- **Chat leaks through screenshots unless we prevent it.** Chat is available
  while working, and owners can view screenshots. Breaks are not captured
  (decision 7), but a chat window open during work would be. So:
  - While the Chat or Lounge view is open, mark the tracker window
    **content-protected** (`set_content_protected(true)`; on Windows tao applies
    `WDA_EXCLUDEFROMCAPTURE`, documented as "the window does not appear at all"
    in captures; Windows 10 2004+). Turn it off when the view closes.
  - **Verified 2026-09-26** on Windows 11 (build 26200) with a test that copies
    `xcap`'s method exactly (GDI `BitBlt` `SRCCOPY` from the display DC): a red
    test window captured as red with no protection; with
    `WDA_EXCLUDEFROMCAPTURE` the captured pixel was the desktop behind it
    (window absent); with the older `WDA_MONITOR` it was black. Older Windows
    builds fall back to black — still no content.
  - The full shield design — state machine, capture-time watchdog, redaction
    fallback, anti-dodge rule and tests — is **§21**.
  - Remaining gate (Phase 1): repeat the same capture check against the **real
    Tauri/WebView2 window** with the actual `set_content_protected` call, and
    keep it as an automated smoke test. Side effect worth knowing: the chat
    window will also be blank in the member's own Snipping Tool and in screen
    shares — desirable here.
  - **OS notifications carry the sender only** ("Sara sent a message"), because
    a Windows toast is drawn by the shell, not by us, and cannot be excluded from
    capture. Message **previews** appear in a **protected in-app toast window**
    instead (§22.5), so chat still feels like Telegram or WhatsApp.
  - Keep the window title static so activity capture never records chat text.
- Honest limit: database and infrastructure operators can read chat rows.

### 3.4 Moderation without owner access (decided)

Owners never moderate. Instead:

- **Author** can delete their own message.
- **Mute** a room or a member (client-side, per member).
- **Block** a member (§13.3) — hides both directions, ends the friendship.
- **Report** — the reporter picks a message; the app shows exactly what will be
  sent (that message plus the 5 before it) and asks for confirmation. The
  snapshot goes **only to the controller**. It is the one path by which anyone
  reads chat outside a room, and the reporter consents to it each time.
- **Sanction** — the controller can revoke the reported member's grant (§4).

---

## 4. Controller-owned access (the switch)

### 4.0 Ownership and containment

- **One controller, no delegation.** No second controller, no owner/admin/tenant
  path to grant, and grantees cannot mint, share, or transfer access.
- **Not a product feature.** Not a role, not a plan/tenant entitlement, not
  shown in `docs/FEATURES.md`, Landing-Web content, pricing, release notes, or
  public env/bootstrap responses. Non-grantees get the same generic `404` as the
  overlay plan defines.
- **Deletable module.** All backend code in one directory
  (`Dashboard-Backend/src/modules/chat-lounge/`), tables prefixed
  `feature_access_*`, `chat_*`, `member_friend*`; all agent UI under one folder
  (`src/features/lounge/`). If it is ever spun out into its own service, it
  needs only token verification and a `project_members` lookup.
- Grants are per **member**, across customer tenants; social data (rooms,
  friends) never crosses tenants (§13.1).

### 4.1 Route 1 — controller grants directly

A **Feature access** card in Members → Roles, visible only to the controller
(beside the overlay plan's *Protected access* card). Feature keys:
`project_chat`, `lounge`, `friends`, `arcade` (grantable separately). Grant and revoke each
require a recent sign-in plus an 8-digit code emailed to the fixed controller
mailbox — the overlay plan §5 flow reused as-is. **Batch:** the challenge is
bound to the hash of the sorted target IDs, so one code authorises one visible
list.

### 4.2 Route 2 — controller mints redeemable codes

- The controller mints N single-use codes (feature keys, optional expiry,
  optionally **bound to a specific member** so a forwarded code fails).
  **Minting requires the same OTP challenge**; plaintext codes are shown once.
- Codes are ≥ 100 bits (20 base32 characters), stored only as
  `HMAC-SHA-256(server_secret, code)`, rate-limited on redeem (5 attempts/hour
  per member and per IP), constant-time compared, one generic failure message.
- **Redeem UI:** a neutral "Access code" field in agent Settings that does not
  name the feature. Redeeming consumes the code and creates the grant in one
  transaction. The controller can list outstanding codes (status only — never
  the plaintext) and revoke unused ones.

### 4.3 Common behaviour

- Revocation takes effect on the next request; the server drops the member from
  open rooms, cancels pending friend requests, and sends a generic
  `scope-changed`.
- **Delivery:** add `capabilities.projectChat`, `capabilities.lounge`,
  `capabilities.friends` to `buildAgentWorkspace`. Agents that predate the
  feature ignore the fields.
- **Enforcement is server-side.** Hiding the icon is presentation; every REST
  route and WS message re-checks *entitlement + membership/relationship*.
- **Old agents.** `capabilities.*` is returned as true only when the request's
  `X-Agent-Version` is ≥ `CHAT_LOUNGE_MIN_AGENT_VERSION` (server env, set to the
  first release that ships the UI). A granted member on an older agent simply
  sees nothing, and the controller card shows their agent version with "needs
  ≥ X" so the reason is visible. Agents frozen by the update contract stay
  frozen; that is accepted.
- **First-run notice.** Before first use the agent shows, and the member
  acknowledges (`feature_access_grants.notice_ack_at`), a plain statement:
  rooms and DMs are visible only to their members, kept 180 days, not visible to
  owners or admins, reports go to the controller only, and whoever operates the
  servers can technically read stored messages. No use until acknowledged.
- Kill switches `LOUNGE_ENABLED` / `PROJECT_CHAT_ENABLED` / `FRIENDS_ENABLED`
  (private, server-only env) make every grant inert while keeping rows.
- **Grant duration (decided):** no expiry by default; optional `expires_at`;
  revocation always available. An expired grant is inactive on read.

### 4.4 Dependency

The controller gate + OTP pipeline is shared with the overlay plan. Build it
once, generically (challenge has a `kind` and a bound target set). If the
overlay plan isn't being built soon, Phase 0 here builds the shared part and the
overlay plan reuses it later.

---

## 5. Data model (PostgreSQL)

> **§24.2 is the complete, current table list** (this section predates the
> arcade, voice, analytics, sticker-library, Pulse, standup and request tables).

New tables follow the tenancy pattern in [PLAN-customer-accounts-and-tenancy.md](PLAN-customer-accounts-and-tenancy.md) and are
covered by the probe in `verify-tenancy-isolation.js`. Schema goes in
`ensure-lookup-schema.js` (the real source of truth).

| Table | Purpose |
| --- | --- |
| `feature_access_grants` | `member_id`, `feature_key`, `status`, `granted_by`, `granted_at`, `expires_at NULL`, `revoked_by/at`, `source` (`direct`/`code`), `challenge_id` or `invite_id`, `notice_ack_at NULL`, `version`. One active row per (member, feature). |
| `feature_access_challenges` | The overlay plan's challenge table, generalised: `kind` (`grant`/`revoke`/`mint`), `target_set_hash`, `code_hash`, attempts, expiry, consumed/invalidated timestamps. |
| `feature_access_invites` | Redeemable codes: `code_hash`, `feature_keys`, `bound_member_id NULL`, `expires_at`, `redeemed_by/at`, `revoked_at`, `created_by`, `mint_challenge_id`. |
| `feature_access_attempts` | Durable security counters: `(member_id, kind, window_start) → count` for code redeem, friend-code redeem and proof-mint failures (kind-specific limits in §4.2/§13.1). Postgres, not Redis, so a Redis flush or redeploy cannot reset a brute-force window. |
| `feature_access_audit` | Append-only: requested, delivered, verified, granted, revoked, minted, redeemed, redeem-failed, report-viewed. Real actor IDs. |
| `chat_rooms` | `id`, `kind` (`project`/`dm`), `project_id NULL`, `member_low NULL`, `member_high NULL` (DM pair, `member_low < member_high`), unique per project / per pair. Project rooms are created lazily. |
| `chat_messages` | `id`, `room_id`, `sender_id`, `kind` (`text`/`sticker`/`gif`/`image`/`game_link`/`voice_link`), `body`, `payload JSONB`, `reply_to_id`, `client_msg_id`, `created_at`, `edited_at`, `deleted_at`. Index `(room_id, created_at DESC)`; unique `(room_id, sender_id, client_msg_id)` for idempotent send; Tier 2 adds a generated `tsvector` column with a GIN index for in-room search. |
| `chat_reactions` | `(message_id, member_id, emoji)` primary key. |
| `chat_reads` | `(room_id, member_id) → last_read_message_id, updated_at`. |
| `chat_reports` | `reporter_id`, `reported_id`, `room_id`, snapshot JSON (message + 5 prior), `created_at`, `handled_at`. Readable only by the controller. |
| `chat_sticker_packs`, `chat_stickers` | Controller-owned packs with `license`/`attribution` columns; bytes stored and served like screenshots (bytea + auth-gated GET with cache headers). |
| `chat_attachments` *(tier 2)* | Image bytes, same auth-gated GET pattern; allowlist png/jpeg/webp/gif, no SVG, size cap (5 MB each), EXIF stripped. **Shares the Postgres that already stores screenshots**, so add a per-room cap (default 200 MB) and count attachment bytes in the same DB-size monitoring; if it grows, archive to the object store the way screenshots are. |
| `member_friendships` | `member_low`, `member_high` (`low < high`), `status` (`pending`/`accepted`), `requested_by`, `requested_at`, `accepted_at`, `declined_at` (for the cool-down). Unique `(low, high)`. |
| `member_blocks` | `(blocker_id, blocked_id)`. |
| `member_friend_codes` | `member_id` unique, `code_hash`, `rotated_at`. |
| `friend_hidden_presence` | `member_id` — "appear offline" toggle. |

**No lounge tables.** Rooms and game state are in memory and vanish when the
room empties or the server restarts.

Retention (decided): a scheduled job purges chat older than
`CHAT_RETENTION_DAYS` (default **180**, rooms and DMs alike); deleted messages
are tombstoned then purged.

---

## 6. Protocol

> **§24.3 lists every endpoint group**, including the later arcade, voice,
> wellbeing and privacy routes; the list below is the chat core.

Split by durability:

- **Durable → REST** (auth context, validation, rate limit, idempotency). All
  chat/friend routes additionally require a valid agent proof (§13.2), sent as
  the `X-Agent-Proof` header; the WebSocket takes it as a `proof` query
  parameter next to the existing `token`:
  - `GET  /api/chat/rooms` — the caller's rooms (project + DM)
  - `GET  /api/chat/rooms/:roomId/messages?before=|after=&limit=`
  - `POST /api/chat/rooms/:roomId/messages` `{ kind, body|payload, replyToId, clientMsgId }`
  - `PATCH` / `DELETE /api/chat/messages/:messageId` (author only)
  - `PUT|DELETE /api/chat/messages/:messageId/reactions/:emoji`
  - `POST /api/chat/rooms/:roomId/read` · `POST /api/chat/messages/:messageId/report`
  - `GET /api/chat/stickers` · `GET /api/chat/stickers/:id/image`
  - `GET /api/chat/gifs/search?q=&page=` · `GET /api/chat/gifs/trending`
  - `GET/POST/DELETE /api/friends/…` (§13)
  - `POST /api/activity/agent/proof` `{ deviceId, agentSecret }` → `{ proof,
    expiresAt }` (a public route like the existing agent reauth, §13.2)
  - `GET/POST /api/feature-access/…` (controller-only; no recipient email in any
    body) and `POST /api/feature-access/redeem`
- **Ephemeral → existing WebSocket**, new message types:
  - client→server: `lounge.join {projectId}`, `lounge.leave`,
    `lounge.game {roomKey, gameId, action}`, `chat.typing {roomId}`
  - server→client: `chat.new`, `chat.edited`, `chat.deleted`, `chat.reaction`,
    `chat.typing`, `friend.request`, `friend.accepted`, `friend.presence`,
    `lounge.roster`, `lounge.game`, `lounge.invite`, `lounge.closed`

Every handler verifies entitlement and the membership/relationship, rate-limits
per socket (chat 20/min, game actions 10/s, typing 1/2 s), and caps payload size
(4 KB). Durable messages are pushed as `chat.new` after the REST write commits;
reconnect catches up with `GET …/messages?after=<lastId>`. Lounge, typing, and
friend-presence messages **never call `touchActivity`** — a game click is not
work activity and must not change online/idle computation.

### 6.1 What Redis holds and what Postgres holds

Rule: **Redis holds only rebuildable, short-lived state; Postgres holds anything
that must survive.** Wiping Redis loses nothing that matters. Every Redis use
follows the presence pattern — `isRedisConfigured()` → use Redis, otherwise an
in-process fallback — so dev and tests run without it.

| Concern | Where | Why |
| --- | --- | --- |
| Messages, reactions, reads, reports, friendships, blocks, grants, invites, challenges, audit | **Postgres** | Durable |
| Fan-out of `chat.*`, `friend.*`, `lounge.*` events to sockets on other instances | **Redis pub/sub**, one channel (`chatlounge:events`) beside `presence:changes`, reusing the existing publisher/subscriber clients | Makes scale-out to N backend containers safe with no extra code path |
| Typing indicator (3 s TTL), friend "in lounge" flag, lounge roster per room | **Redis keys with TTL**, refreshed by the socket heartbeat | Expires by itself if a socket dies |
| High-rate limits (chat send, typing, game actions, GIF search) | **Redis `INCR` + `EXPIRE`**, falling back to the in-process `Map` limiter | Shared across instances and survives a container restart |
| **Security limits** (code-redeem attempts, friend-code attempts, OTP attempts, proof-mint failures) | **Postgres counters** (extend `agent_devices.failed_attempts` for the proof route) | Must not reset when Redis is flushed or the app redeploys |
| Trivia question pool (Open Trivia DB batches) | **Redis list** with a 1-day TTL | Pure cache; the 1-per-5-s upstream limit is then trivial |
| Revoked-device / proof cache (60 s) | In-process `Map` | Tiny, per instance is fine |
| GIF search results | **Not cached** until Klipy confirms caching is allowed (§14.1); only in-flight de-duplication | Docs are silent |
| Search inside a room (Tier 2) | **Postgres full-text** (`tsvector` + GIN on `chat_messages`) | No new search service |

**Restarts and redeploys.** Every Coolify redeploy drops all sockets. The
protocol must therefore be restart-safe:

- The agent reconnects (existing backoff) and, if it is still on a break with the
  lounge open, **re-sends `lounge.join` automatically**.
- The game host's client **re-publishes its current game state** after a
  reconnect, so an in-progress game survives a redeploy; non-hosts resync from
  that snapshot (optionally also parked in Redis with a 10-minute TTL).
- Chat catches up with `GET …/messages?after=<lastId>`; nothing is lost because
  messages are committed to Postgres before being pushed.
- Typing and roster keys simply expire and refill.

**Agent transport (decided).** Because the CSP blocks direct network access from
the webview, extend `live_sync.rs`: a short read timeout plus an outbound channel
drained each tick (latency budget for games ≈ 100–250 ms). Widening
`connect-src` to the API host is not recommended.

---

## 7. Known ceilings (deliberate simplifications)

- **Host-authoritative games.** A player who patches the client can cheat. Fine
  for tic-tac-toe/trivia between colleagues; go server-authoritative only if a
  competitive game is added.
- **Rooms are per-instance objects; Redis carries events between instances.**
  Today there is one backend container, so a room lives entirely in that
  process. With `REDIS_URL` set (it is), events are also published on Redis so a
  second container would deliver to its own sockets (§6.1). Game state is not
  held server-side, so nothing to migrate.
- **Voice/video media never runs on our server.** The Coolify host already
  serves the web app, dashboard and tracking backend; a media server would
  compete for CPU and, above all, bandwidth. Voice is delegated to a third party
  or peer-to-peer, and our side only signs tokens (§17).
- **GIF link rot.** GIFs are stored as provider URLs (copying media needs the
  provider's written permission — §22.11), so a provider shutting down blanks old GIFs — exactly what
  happened when Tenor closed. Mitigated by the stored `title` placeholder (§3.1)
  and the provider interface (§14.1); the swap is one file.
- **Build-vs-buy.** A hosted chat SDK would supply stickers/GIFs/reactions out of
  the box. Rejected: it conflicts with owning the data and keeping chat
  unreadable to the wider product. The cost is that Tier 1 is a real messenger
  build.

---

## 8. Phases

Size is relative (S ≈ days, M ≈ 1–2 weeks, L ≈ several weeks of focused work).

| Phase | Size | Deliver | Gate to next |
| --- | --- | --- | --- |
| **0. Switch** | M (**0-lite: S**, §23.3 H8) | Controller gate + generic OTP challenge, grants, invite codes + redeem field, controller card (batch), `capabilities` flags + min-agent-version gate, kill switches, **agent proof** (§13.2), first-run notice. Feature disabled. | Grant, mint, redeem, revoke work end-to-end; non-controllers get 404; a web session with a valid Firebase token but no proof gets 404 on chat routes; proof expires and refreshes; revoking a device kills its proof within 60 s. |
| **1. Chat core** | L | Room tables, REST, WS push, text + emoji + reactions + replies + edit/delete, unread, typing, seen, mute, report, notifications (OS sender-only + protected in-app preview, §22.5), content protection, retention job. Agent Chat view (project rooms). | Owner not on the project is denied on REST **and** WS; the **real Tauri window** is absent from an `xcap`-method capture; boundary test (§9) is green. |
| **2. Friends + DMs** | M | Friend tables, requests, list UI, presence, block, friend code, DM rooms. | Friend presence exposes no tracking state; web session 404; cross-tenant code fails. |
| **3. Lounge shell** | M | Title-bar icon (break + entitled), layout swap, Back-to-work bar + nudge, roster, auto-leave on break end, tic-tac-toe, friend invites. | Lounge state absent from every presence/report/export surface; presence unchanged after a flood of lounge messages. |
| **4. Stickers + GIFs** | M | Sticker packs + controller upload screen; Klipy provider + picker with attribution; Licenses screen. | Klipy proxy question closed (§14.1: ask Klipy support; fallback already designed). |
| **5. Chat tier 2** | L | Image attachments, mentions, pins, search, link previews. | Link-preview fetcher passes SSRF review. |
| **6. More games** | S–M each | Trivia (Open Trivia DB), then chess (`chess.js`), Crazy Eights, draw-and-guess, word-tiles (§14.4). Optional controller alert webhook (§14.8). | — |
| **7. Arcade** | M | Third-party games in an isolated window: controller-curated catalog, disclaimer + acknowledgement, self-hosted open-source games first (Sudoku, Codenames-style), `game_link` chat messages (§16). | Arcade window proven to have no IPC, no popups/downloads, allowlisted navigation, blank in captures. |
| **W1. Resize & respond** | M | 3-button title bar, resizable window, size-driven layouts (§20.2–20.3). Independent of every other phase; best done **before Phase 1** so chat lands in a flexible shell. | Resize sweep 960 → 2560 px clean; window state restored on-screen. |
| **W2. Panels in slots** | L | Panel registry, per-mode layouts, move/pop-out menu, chat and friends as panels (§20.4–20.6). Replaces the view-based chat/friends screens of §19 as it lands. | Chat state survives work ↔ lounge; pop-out opens no second socket; timer panel pinned. |
| **W3. Free docking** | L | Drag-and-drop docking via dockview (§20.7). Optional. | Decided after W2 usage. |
| **8. Voice rooms** | S (v1) / L (native) | v1: third-party voice room in the isolated window with signed join tokens; native WebRTC only if v1 quality or UX falls short (§17). | Mic permission scoped per window; no media bytes on our host; room closes with the break. |

**Cut line.** Phases 0–3 are the product the request describes (private chat,
friends, the lounge). Phases 4–7 are enrichment and can each be dropped or
deferred without breaking anything before them.

The web dashboard gets **no** chat, lounge, or friends surface (decided).

Extra tracks from the 2026-09-27 pilot review — pilot charter, notifications
and Do Not Disturb, break policy and the break card, sticker libraries, task
cards and standup, analytics, Pulse, and the collection receipt and request
flow — are sized and sequenced in **§22.14**.

---

## 9. Test plan

Backend tests mock the DB, so new SQL/DDL is verified against real Postgres
(PGlite) per project practice.

**Access**
- Only the enrolled controller sees or calls feature-access routes.
- Ungranted member: chat/lounge/friend REST → 404, WS messages ignored,
  `capabilities` flags false.
- **Web session (valid Firebase token, no agent proof), even for a granted
  member → 404 on every chat, lounge and friend route and WS message.**
- **Agent proof** (§13.2): rejected when missing, tampered, expired, minted for a
  different member than the Firebase token's, or for a revoked device; a proof
  cannot be minted without the correct `agentSecret` (10 failed attempts lock the
  device, reusing the existing counter); a refresh always yields a fresh proof.
- **Boundary test (`access-boundary.test.js`).** Static: the `chat-lounge` module
  must not import the owner-sees-all helpers (`activity-scope`, `role-hierarchy`,
  `hierarchy/*`, bootstrap visibility helpers), and every SQL touching
  `chat_messages`/`chat_rooms`/`member_friendships` lives in one
  `repository.js` whose queries all join `project_members` or the DM pair. Live
  (PGlite): seed an Owner, Admin and Manager on other projects and assert every
  read/write path returns nothing.
- Owner/admin/superadmin **not assigned** to the project: cannot list, read,
  post, react, join, fetch stickers/attachments, or receive pushes. Assigned
  owner behaves as a normal member. No role can list anyone's friendships or DMs.
- Confidential-overlay grantee gets nothing extra.
- Revoke → room membership dropped, requests cancelled, pushes stop on the next
  message. Kill switches → every route and WS message denied.

**Codes**
- Mint needs a verified challenge; plaintext never stored or logged.
- Redeem is single-use under concurrency, respects expiry/binding/rate limits,
  one generic error for every failure.
- Grantee cannot mint; a redeemed code cannot be reused for another member.

**Privacy**
- Lounge events and friend presence never appear in presence snapshot, `changed`
  events, member responses, activity/timesheet reports, exports, or audit.
- Friend presence never includes working/idle/on-break state: it is computed
  from socket connectivity only, in a function that does not import
  `presence-service` status, and a test asserts the payload has no such field.
- **Presence invariance:** after a flood of lounge, typing and friend-presence
  messages, a member's online/idle status and activity timestamps are unchanged.
- Break ends by every route → member leaves the room, layout returns; the 15-minute
  nudge appears and does not close the lounge.
- Content protection toggles on with the chat/lounge view and off after. A
  smoke test creates the real window, calls the real `set_content_protected`,
  captures with `xcap`'s `BitBlt` method and asserts the window's pixels are not
  present (the same check that passed for a test window on 2026-09-26). Toast
  text contains no message body.
- First-run notice blocks use until acknowledged; the acknowledgement is stored.
- A GIF whose URL now 404s renders the titled placeholder.
- Report sends exactly the confirmed snapshot to the controller and to no one
  else.

**Friends**
- Requests only between two grantees in the same tenant; discovery only through a
  shared project room or a friend code; no member search.
- Block: no requests, no DMs, no presence, no lounge invites, either direction.
- Rate limits, friend cap, decline cool-down, unfriend silent; friend-code
  rotation invalidates the old code.

**Chat**
- Idempotent send (`clientMsgId`), ordering, pagination, reconnect catch-up,
  author-only edit/delete, reactions toggle, typing rate limit, size cap,
  retention purge.
- Sticker/attachment GET is membership-gated; SVG and oversized uploads rejected;
  the GIF provider key never reaches a client; a `GifProvider` stub proves the
  provider is swappable.

**Redis and restarts**
- With `REDIS_URL` unset, everything works on in-process fallbacks (dev/test).
- Flushing Redis mid-session loses only typing/roster/cache state: no message,
  friendship, grant or security counter is affected, and the roster refills on
  the next heartbeat.
- Two backend instances against one Redis: an event published on A reaches a
  socket on B exactly once (no echo loop on the publisher).
- A simulated redeploy (drop all sockets) → agents reconnect, re-join the lounge,
  the host re-publishes game state, chat catches up with no gap or duplicate
  (`clientMsgId` idempotency).
- Security counters (redeem, friend-code, OTP, proof-mint) survive a Redis flush
  and an app restart because they live in Postgres.

**Tenancy**
- New tables covered by the isolation verifier; cross-tenant reads return
  nothing.

**UI**
- Icon only in a lounge-eligible state (§22.4) and only when entitled; Back-to-work always visible;
  dark-mode parity; keyboard access for the icon, picker, friends list, and
  board; Licenses screen lists every attribution in §14.

---

## 10. Risks — each with its resolution

Every risk from the first draft was investigated on 2026-09-26. Status:
**Resolved** = evidence in hand, design settled; **Gated** = design settled, one
check must pass at a named phase gate (§8).

| # | Risk | Resolution | Status |
| --- | --- | --- | --- |
| 1 | Owner-sees-all helpers violate decision 2 | Single `repository.js`, every query joined to `project_members`/DM pair; static import-denylist test plus a live PGlite test seeding Owner/Admin/Manager (§9 boundary test) | Resolved |
| 2 | Chat visible in screenshots while working | `set_content_protected` (`WDA_EXCLUDEFROMCAPTURE`). **Proven** against `xcap`'s exact capture method on Windows 11 (window absent; `WDA_MONITOR` gives black). Body-less toasts, static window title (§3.3) | Gated: same check on the real Tauri window, Phase 1 |
| 3 | Scope: a full messenger plus a social graph | Size-labelled phases and a cut line at Phase 3 (§8) | Resolved |
| 4 | Agent-only enforcement | The first draft's token-claim idea **does not work** (custom-token claims land only on the first ID token; refresh rebuilds from the user record; web and agent share one Firebase user). Replaced by a device-signed proof (§13.2) | Resolved (design); tested in Phase 0 |
| 5 | GIF provider disappears (Tenor did, 2026-06-30) | `GifProvider` interface; provider-agnostic payload; stored `title` placeholder; sticker packs are self-owned (§3.1, §14.1) | Resolved |
| 6 | Media abuse without owner moderation | Rating `g` default, report-to-controller with consented snapshot, block, mute, controller revoke (§3.4) | Resolved |
| 7 | Friend presence becomes peer surveillance | Presence is only online / in lounge / offline from socket connectivity; separate function that never reads tracking status; test asserts payload shape; "Appear offline" toggle (§13.4) | Resolved |
| 8 | Member stays in the lounge too long | Permanent Back-to-work bar + 15-minute nudge (§3.2) | Resolved |
| 9 | Partly rolled-out rooms feel empty | "N of M project members have access" header (§3.1) | Resolved |
| 10 | Old or frozen agents | `CHAT_LOUNGE_MIN_AGENT_VERSION` gate on `capabilities`; controller card shows the agent version (§4.3) | Resolved |
| 11 | Extra socket messages disturb online/idle | Lounge/typing/friend messages never call `touchActivity`; presence-invariance test (§6, §9) | Resolved |
| 12 | Licence obligations | Licenses screen; Klipy attribution; CC BY credit; Open Trivia DB share-alike noted; OpenMoji excluded (§14.6) | Resolved |
| 13 | Multiple backend containers or a redeploy would break rooms | One container today; Redis pub/sub already deployed and used for fan-out; restart-safe protocol (auto re-join, host re-publishes state, `after=` catch-up) (§6.1, §7) | Resolved |
| 14 | Klipy proxy policy unclear (docs silent) | Search/trending proxied by our backend; media loaded direct from Klipy; if Klipy support objects, the agent calls Klipy itself using a key fetched at runtime (§14.1). Ads confirmed **optional** | Gated: one support question, Phase 4 |
| 15 | Emoji picker licence and CDN dependency | `emoji-picker-element` chosen: **Apache-2.0**, supports a local `dataSource` (§14.2) | Resolved |
| 16 | Overlay plan (controller/OTP) is unbuilt | Phase 0 builds the shared gate generically; overlay reuses it (§4.4) | Resolved |
| 17 | "Owners can't read" vs. operators can read rows | Stated in the first-run notice the member must acknowledge (§4.3) | Resolved (disclosed) |

---

## 11. Decisions on every earlier open question

| # | Question | Decision |
| --- | --- | --- |
| Q1 | Code flow | **Both** routes (§4.1, §4.2). |
| Q2 | Grant duration | No expiry by default; optional `expires_at`; revoke anytime. |
| Q3 | Web dashboard chat? | **No.** Chat, lounge and friends are agent-only. |
| Q4 | Harassment without owner moderation | Author delete + mute + block + **report-to-controller with a consented snapshot** + controller revoke (§3.4). |
| Q5 | Lounge in private break | Yes — any break state. |
| Q6 | Server-side break check | None; UI-only gating (§3.2). |
| Q7 | Retention | 180 days, env-configurable, rooms and DMs. |
| Q8 | Agent transport | Extend `live_sync.rs` (§6). |
| Q9 | DMs | **Yes, only between friends** (§13); no group DMs yet. |
| Q28 | Friend discovery and search — the original "no search, no directory" made the feature unusable | **Widened, not removed: search is scoped to people the member already shares a project with** (§25). No cross-project or cross-tenant directory. |
| Q29 | Restoring native-style window buttons | **Yes — minimize/maximize/restore/close, same position, restyled in the app's own `win-btn` language, not native chrome** (§20.2). |
| Q10 | GIF provider / proxy | **Klipy** behind a `GifProvider` interface; the backend proxies search/trending so the key stays server-side; media renders direct from Klipy URLs; no GIF bytes stored; ads not used (optional); rating `g`; GIPHY excluded; Tenor is dead. Fallback if Klipy objects to proxying: runtime key to the agent (§14.1). |
| Q13 | Emoji picker | `emoji-picker-element` (Apache-2.0) with self-hosted data; Frimousse (MIT, React) is the fallback if the web component fits badly. |
| Q14 | How "agent-only" is enforced | Device-signed proof (§13.2), not a token claim. |
| Q15 | Discord Activity games | Not addable (Discord-built, iframe-in-Discord). Equivalent games are built as reducers with free libraries (§14.4). Poker and watch-together skipped. |
| Q16 | Linking to Discord | Outbound controller alerts only, via an optional webhook, no message content; no chat bridge, no Discord login, no Activity SDK (§14.8). |
| Q21 | Pilot context, break policy, notifications, Pulse, sticker libraries, collection-review requests, standup helper | Decided 2026-09-27 and specified in **§22**. |
| Q20 | A flexible, resizable "work environment" shell | Yes, staged: W1 resize + size-driven layouts, W2 panels in slots with chat as one persistent panel, W3 optional free docking (§20). |
| Q19 | How games are delivered | Five modes — third-party webview, native in-app, forked from GitHub, homemade, outside link — each with its own rules; full list and gates in §18. |
| Q18 | Voice chat without loading the server | Yes — offload media entirely. v1 = a third-party voice room (Jitsi as a Service, free for 25 monthly users) in the isolated Arcade window; later options: P2P WebRTC with free TURN, or an SFU on a free tier (§17). |
| Q17 | Embedding real third-party games (Farm Merge Valley, Sudoku, Codenames) | Yes, via an **Arcade** in an isolated window and a controller-curated catalog; self-hosted open-source first, portal-distributed games only with an agreement, link-out otherwise. A disclaimer does not create rights — each entry needs verified terms (§16). |
| Q11 | Sticker art | Kenney Emotes (CC0) + Noto animated emoji (CC BY 4.0, credited) + controller-uploaded originals; no OpenMoji (share-alike); never lift Telegram/WhatsApp packs. |
| Q12 | Image attachments | Tier 2 (Phase 5). |
| — | Capture during breaks | Not a concern (decision 7). |
| — | Chat style | Telegram/WhatsApp-like (§3.1). |

---

## 12. Roles and permissions

> **§24.1 supersedes this section** where they differ: it adds the Manager
> (reach) and Sponsor roles and the rows for Pulse, standups, lounge rules and
> collection requests.

These are **feature roles**, separate from the application's Owner/Admin/…
roles (which grant nothing here). Only grants and friendships are stored;
every other role is a **derived predicate** in one file
(`chat-lounge/access.js`), and the matrix below is the test suite.

### 12.1 Roles

| Role | How it is derived | Notes |
| --- | --- | --- |
| **Controller** | Verified UID/member/email match to the enrolled controller (overlay plan §3.3) | Exactly one. Not a room member unless assigned. |
| **Grantee** | Active, unexpired `feature_access_grants` row for the feature | Required for everything below. |
| **Agent client** | Request carries a valid, unexpired agent proof for the same member and a non-revoked device (§13.2) | A *precondition*, not a person: web sessions never qualify. |
| **Room member** | Grantee ∧ agent client ∧ assigned in `project_members` (project room) or party to the DM | The only role that can read a room. |
| **Author** | `chat_messages.sender_id` = caller | Edit/delete own messages. |
| **Friend** | Accepted `member_friendships` row, neither side blocked | Unlocks DMs, presence, invites. |
| **Blocker / Blocked** | `member_blocks` row | Blocked party sees nothing different, just silence. |
| **Lounge host** | The client that created a game session | Transient; passes to another player on leave; no powers over the room. |
| **Lounge player / spectator** | Room member currently in that lounge | |
| **Reporter** | A room member filing a report | Consents to the exact snapshot. |
| **System** | Server jobs | Retention purge, grant expiry, kill-switch sweeps; never reads message bodies except to purge. |
| **Outsider** | Everyone else — including Owner, Admin, Manager not assigned, non-grantees, tenant admins, web sessions | Generic `404`, no hints. |

### 12.2 Permission matrix

✓ allowed · — denied (generic 404) · own = only their own item

| Action | Controller | Room member | Author | Friend | Outsider |
| --- | --- | --- | --- | --- | --- |
| Grant / revoke / mint access codes | ✓ | — | — | — | — |
| Read a project room | only if a member | ✓ | ✓ | — | — |
| Post, react, reply | only if a member | ✓ | ✓ | — | — |
| Edit / delete a message | — | — | own | — | — |
| Read a DM | only if a party | party | party | party | — |
| Send friend request | as a grantee | ✓ (to co-members) | — | — | — |
| See friend list / presence | own list | own list | — | own list | — |
| Join a lounge | only if a member | ✓ | ✓ | invited only | — |
| Upload / curate stickers | ✓ | — | — | — | — |
| Curate the Arcade catalog | ✓ | — | — | — | — |
| Play an Arcade game (needs `arcade` grant, on a break) | as a grantee | ✓ | ✓ | ✓ | — |
| Read reported snapshots | ✓ (only those filed) | — | — | — | — |
| Kill switches | ✓ | — | — | — | — |

---

## 13. Friends — Tauri-only

> **§25 is the complete, current friends design** — discovery, search, the full
> list UI, requests, and a widened (but still bounded) discovery rule. It
> supersedes §13.1's "no member search, no directory" and §13.5's sketch where
> they differ; §13.2–§13.4 (enforcement, relationship states, what friends
> unlock) are unchanged and still normative.

### 13.1 Scope and discovery

- Requires the `friends` grant **and** a valid agent proof (§13.2).
- **Same tenant only.** Friendships and friend codes never cross customer
  tenants.
- **No member search, no directory.** Two discovery paths only:
  1. **Shared project room.** From the member list of a room you belong to,
     "Add friend".
  2. **Friend code.** Each member has a personal, rotatable 10-character code
     they can share outside the app; entering it sends a request. Redeem is
     rate-limited (5/hour) with one generic failure message.
- Limits: 200 friends, 50 pending outgoing, 10 requests/hour; a decline starts a
  7-day cool-down for that pair.

### 13.2 What "only inside the Tauri app" means, and how it is enforced

Today the backend cannot tell the agent from the web (§2).

**Why not a token claim (first draft, rejected).** Firebase custom-token
developer claims appear only on the first ID token minted from that custom token;
later silent refreshes rebuild the token from the *user record's* claims, and
`setCustomUserClaims` is per user — but the web app and the agent sign in as the
**same** Firebase user, so a per-user claim cannot tell them apart. (Sources:
[Firebase custom tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens),
[firebase-js-sdk#6113](https://github.com/firebase/firebase-js-sdk/issues/6113),
[#9260](https://github.com/firebase/firebase-js-sdk/issues/9260).)

**Design — a device-signed "agent proof".** The agent already holds a secret the
web never has (`device_id` + `agent_secret`, §2).

1. New public route `POST /api/activity/agent/proof` `{ deviceId, agentSecret }`,
   sitting beside the existing agent reauth. It calls `verifyAgentDevice` (same
   `sha256` check, same 10-failure lockout, same revoked-device handling) and
   returns `{ proof, expiresAt }`.
2. `proof = base64url(payload) + "." + base64url(HMAC-SHA256(AGENT_PROOF_SECRET,
   payload))`, payload `{ v: 1, m: memberId, d: deviceId, exp }`, **TTL 60 min**.
   `AGENT_PROOF_SECRET` is a private server env var. Stateless: nothing stored.
3. The agent's Rust `ApiClient` refreshes the proof when < 10 minutes remain (or
   on a `AGENT_PROOF_REQUIRED` 404) and adds `X-Agent-Proof` next to the existing
   `X-Agent-Version` header
   ([client/api/session.rs:97](Tauri-App-Extension/src-tauri/src/client/api/session.rs:97)); `live_sync.rs` adds `&proof=` to the
   WebSocket URL.
4. Server helper `requireAgentClient(req, viewer)`: constant-time HMAC check,
   `exp` in the future, `m === viewer.memberId` (a proof for someone else is
   useless), and the device not revoked (`agent_devices.revoked_at`, cached 60 s
   and cleared on revoke). Any failure → the generic `404`.
5. Chat, friend, lounge and sticker/GIF routes and WS messages all call it. The
   web dashboard ships no UI, no API client, and no fields for any of it; a web
   session has a valid Firebase token but no proof.
6. Revoking a device (already supported) kills that device's access within 60 s;
   `revokeAgentDevicesForMember` covers all of a member's devices.

The proof is not a login credential — it proves the caller is a linked agent
device, and the Firebase token still proves *who*. Ceiling: someone holding their
own device secret could script the API — same person, same account, so this is
product scoping, not an adversarial boundary.

### 13.3 Relationship states

`none → pending (out / in) → friends`. Decline is silent. Cancel and unfriend
are silent. **Block** implies unfriend and hides both directions: no requests,
no DMs, no presence, no invites. Blocking never notifies the other side.

### 13.4 What friends unlock

- **DMs** — a `dm` room in the same chat engine; same retention, same privacy
  (owners cannot read), same report path.
- **Presence** — online / in a lounge / offline. **Never** working, idle or
  on-break state. An "Appear offline" toggle hides even that.
- **Game invites** — a two-player lounge (`roomKey` = the pair) opened from a DM
  card; joinable only while on a break.
- **Notifications** — "New friend request" / "New message from a friend": OS
  notification shows the sender only, the in-app protected toast shows the
  preview (§22.5).

### 13.5 UI

See §25 for the complete Friends UI; this stub is kept only as a pointer.

---

## 14. Free third-party APIs and assets (researched 2026-09-26)

Rule: free, no card, and compatible with our architecture (§2: the webview
cannot call the network; the agent's Rust side or our backend does).

### 14.1 GIFs — provider decision

| Provider | Status | Free? | Verdict |
| --- | --- | --- | --- |
| **Tenor** | **Shut down**: new keys stopped 2026-01-13; API ended 2026-06-30 ([9to5Google](https://9to5google.com/2026/06/30/google-tenor-api-gif-updates/)) | n/a | Dead — do not use |
| **Klipy** ([docs](https://docs.klipy.com/)) | Live. Founded by ex-Tenor staff; Tenor-compatible endpoints ([overview](https://dev.to/zuplo/exploring-the-klipy-api-29po)) | Yes, "lifetime free", production access by form | **Chosen** |
| **GIPHY** ([docs](https://developers.giphy.com/docs/api/)) | Live | Beta key 100 calls/hour; production is by application/paid | **Rejected**: docs prohibit proxying ("Do not proxy requests… either API calls or media URL loads") and require "Powered by GIPHY" |
| Imgur | Live | Free for moderate use | Not a GIF search engine — skip |

**Klipy details (from its docs/overview):**

- Base `https://api.klipy.com/api/v1/{API_KEY}/` — the **key is in the URL
  path**, so it must stay on the server (or in Rust, never the webview).
- `GET …/gifs/search`, `…/gifs/trending`, `…/gifs/{slug}`; the same shape for
  **stickers**, clips, memes.
- Params: `q`, `page`, `per_page` (default 24, min 8, max 50), `rating`
  (`g`/`pg`/`pg-13`/`r`), `locale`. Response
  `{ result, data: { data: [...], current_page, per_page, has_next } }`.
- **Ads are optional**: the Ads API "is completely optional" and can be
  enabled or disabled at any time ([Klipy developers](https://klipy.com/developers), [overview](https://dev.to/zuplo/exploring-the-klipy-api-29po)).
  `customer_id` is needed only for ads, so we send **no member identifier** to
  Klipy.
- **Attribution (verified):** use "Search KLIPY" as the search-field
  placeholder and show the "Powered by KLIPY" logo and watermark
  ([API overview](https://klipy.com/api-overview), [attribution page](https://docs.klipy.com/attribution)).
- **Proxying / caching: the docs say nothing either way** (unlike GIPHY, which
  forbids it). Resolution: (a) proxy search and trending through our backend so
  the URL-path key never ships in the app; (b) load media directly from the URLs
  Klipy returns and never store or re-host it; (c) before Phase 4 exits, send
  Klipy support one written question confirming server-side proxying of API calls
  is acceptable; (d) **if they object**, the fallback is already designed — the
  authenticated, proof-bearing agent fetches the key at runtime
  (`GET /api/chat/gifs/config`, in memory only, never written to disk) and
  Rust calls Klipy directly, the same "client side" model GIPHY requires.
  Either path sits behind the same `GifProvider` interface, so the UI does not
  change.

Decision: a small `GifProvider { search, trending }` interface with Klipy as the
only implementation; default `rating=g` (`GIF_RATING`); a Klipy sticker endpoint
can later supplement our own packs.

### 14.2 Emoji

| Item | Choice | Licence / limit |
| --- | --- | --- |
| Glyph rendering | OS emoji font | none needed |
| Picker + data | **`emoji-picker-element`** (web component) with `new Picker({ dataSource: '/emoji/data.json' })` pointing at the bundled `emoji-picker-element-data/en/emojibase/data.json`; its default is a jsDelivr CDN URL the CSP blocks ([README](https://github.com/nolanlawson/emoji-picker-element)) | **Apache-2.0** ([licence](https://github.com/nolanlawson/emoji-picker-element/blob/master/LICENSE)); emojibase data. Fallback if the web component fits badly: Frimousse (React, MIT — [repo](https://github.com/liveblocks/frimousse)) |
| Consistent artwork (optional) | Noto Emoji (Apache 2.0), Fluent Emoji (MIT), Twemoji via [jdecked/twemoji](https://github.com/jdecked/twemoji) (graphics CC BY 4.0, code MIT) | Credit required for CC BY |
| Avoid | OpenMoji (CC BY-SA 4.0 — share-alike) | ([licence guide](https://github.com/luizbizzio/emojis)) |

### 14.3 Stickers

| Source | Licence | Use |
| --- | --- | --- |
| [Kenney Emotes Pack](https://kenney.nl/assets/emotes-pack) (480 assets) | **CC0** | First pack, no credit needed |
| Noto animated emoji (`svg`, `lottie.json`, `webp`, `gif`) | **CC BY 4.0** ([discussion](https://github.com/google/fonts/issues/7011)) | Animated stickers; credit in Licenses screen |
| Controller-uploaded originals | Own | Ongoing |
| Klipy stickers | Provider terms | Optional supplement |
| Telegram/WhatsApp packs | Copyrighted | **Never** |

### 14.4 Games and content

| API | Terms | Use |
| --- | --- | --- |
| **Open Trivia DB** ([opentdb.com](https://opentdb.com/api_config.php)) | No key; **CC BY-SA 4.0** data; 1 request per IP per 5 s; 24 categories, 3 difficulties, session tokens to avoid repeats | Trivia game. Our **server** is the single caller: it fetches up to 50 questions per request (one call per 5 s is all we need), keeps them in a small cache, and hands rooms questions from it, using a session token to avoid repeats. Credit + CC BY-SA 4.0 noted in Licenses; the questions are shown, not republished as a dataset. |
| **JokeAPI** (`v2.jokeapi.dev`, [directory note](https://dev.to/0012303/10-free-facts-jokes-name-apis-with-no-key-2026-2ao8)) | No key; has a safe-mode filter | Optional "joke break" card |
| Word lists / tic-tac-toe / others | Local code | No API |

**Can Discord Activity games be added here? No — but the same kinds of games
can be built free.** Activities are web apps that run *inside Discord* in an
iframe and talk to the Discord client through its Embedded App SDK
([SDK](https://github.com/discord/embedded-app-sdk)); they depend on Discord's
host, OAuth and voice-channel session. The well-known ones (Chess in the Park,
Sketch Heads, Poker Night, Blazing 8s, Letter League) were developed by Discord
([announcement](https://discord.com/blog/server-activities-games-voice-watch-together)), so there is no code to take. Our CSP also sets
`frame-src 'none'`, so embedding third-party game pages is off the table by
design. The route is to write each game as a reducer in the game registry (§3.2):

| Discord-style game | Our version | Free building blocks |
| --- | --- | --- |
| Chess in the Park | Chess, two players | `chess.js` (BSD-2-Clause) for rules and check/mate detection; our own board view |
| Sketch Heads (Pictionary) | Draw-and-guess, project room | Canvas plus stroke relay over the WebSocket; a local word list (check its licence). [scribble.rs](https://github.com/scribble-rs/scribble.rs) (BSD-3) is a reference implementation only — it is a separate Go server with its own identity, so it can't be project-private |
| Blazing 8s | Crazy Eights | Own reducer; no library needed |
| Letter League | Word-tiles board | Own reducer plus a free dictionary list (check its licence) |
| Trivia | Trivia | Open Trivia DB (above) |
| Poker Night | **Skipped** — an 18+ gambling-style game in a work tool | — |
| Watch Together | **Skipped** — video embeds need iframes/CSP changes and carry provider terms | — |

`boardgame.io` (MIT) is a turn-based engine with its own server and socket layer
([repo](https://github.com/boardgameio/boardgame.io)); it would duplicate our WebSocket and identity handling, so it is **not**
used — the plain reducer registry is enough. Use original names and artwork; do
not reuse Discord's game names or branding.

### 14.5 Needed but no external API

Windows notifications (existing `tauri-plugin-notification` via `notify()`),
link previews (our own fetcher, Tier 2, SSRF-reviewed), profanity/rating
filtering (Klipy `rating` param), email OTP (existing Notify service).

### 14.6 Licenses screen

Ship one screen in the agent that lists: Klipy (attribution as its guidelines
require), Open Trivia DB (CC BY-SA 4.0), any Noto/Twemoji artwork (CC BY 4.0),
and each sticker pack's `license`/`attribution` column.

---

## 14.7 Configuration summary (all server-side, none public)

| Variable | Purpose |
| --- | --- |
| `AGENT_PROOF_SECRET` | HMAC key for agent proofs (§13.2) |
| `CHAT_LOUNGE_MIN_AGENT_VERSION` | Below this, `capabilities.*` stay false (§4.3) |
| `PROJECT_CHAT_ENABLED` / `LOUNGE_ENABLED` / `FRIENDS_ENABLED` | Kill switches (§4.3) |
| `CHAT_RETENTION_DAYS` | Default 180 (§5) |
| `LOUNGE_NUDGE_MINUTES` | Default 15 (§3.2) |
| `KLIPY_API_KEY`, `GIF_RATING` | GIF provider key and rating filter, default `g` (§14.1) |
| `CONTROLLER_ALERT_WEBHOOK` | Optional outbound webhook for controller alerts (§14.8); unset = alerts stay in the controller card only |

### 14.8 Linking to Discord or anything else (decided: outbound alerts only)

Asked whether this can be linked to Discord. Options and verdicts:

| Idea | Verdict |
| --- | --- |
| **Run our games as a Discord Activity** (Embedded App SDK) | **No.** It needs a Discord app, Discord login and Discord's iframe host, and it would take the games out of project membership and controller ownership (decisions 2 and 5). |
| **Bridge project chat or DMs into a Discord channel** (bot or webhook) | **No.** It would copy private room content to a third party owners and the app can't govern, defeating "owners can't read" and the consented-report model. |
| **"Sign in with Discord" / find friends via Discord** | **No.** Friends are discovered only through shared project rooms or a friend code within one tenant (§13.1); an external identity adds a cross-tenant lookup path. |
| **Controller alerts to a private Discord channel** (webhook) | **Yes, optional.** One `POST` of JSON to a Discord webhook URL, no bot. Events: "new report filed", "invite code redeemed", "burst of failed redeem/OTP attempts", "grant revoked". **Never message bodies** — a report alert only says a report exists; the snapshot is read in the controller card. |
| Same alerts to **ntfy**, **Telegram**, or email | **Yes**, same hook. Apprise API (available in Coolify) can fan one call out to any of them, but a plain webhook is enough to start. |
| Ops alerts (uptime, cron, errors) to Discord | Already supported by Uptime Kuma, Healthchecks and Bugsink/GlitchTip natively; not part of this feature. |

Implementation is one small `notifyController(event)` function that reads
`CONTROLLER_ALERT_WEBHOOK`, sends a fixed-shape JSON payload with no personal
data beyond opaque IDs, times out in 3 s, and never blocks or fails the request
that triggered it.

---

## 15. Rollout

1. Phase 0 deployed **disabled**; bind the controller; grant one test member.
2. Enable chat for that member + one teammate on a shared project; run the
   privacy tests against production-shaped data and the xcap check.
3. Ship the agent release containing Phases 1–3 (dark).
4. Grant a small group through the controller card or codes; watch for issues.
5. Widen at the controller's pace. Rollback: kill switch → revoke rows →
   revert UI. Chat rows are preserved.

---

## 16. Third-party games — the Arcade

Asked: can real games (Farm Merge Valley, Sudoku, Codenames) run inside, in a
webview, stated as third-party and not belonging to Virtual Tracker?
**Technically yes. Legally it depends on each game**, and that decides the
design.

> The five delivery modes for games — third-party webview, native in-app,
> forked from GitHub, homemade, and outside links — and the full game list are
> in **§18**. §14.4 and this section describe subsets of it.

### 16.1 Rights come first — a disclaimer is not a licence

Labelling a game "third party" tells users who owns it; it does not give us the
right to embed it. Three sourcing tiers, in order of preference:

| Tier | Source | Rights | Ads / tracking | Verdict |
| --- | --- | --- | --- | --- |
| **A** | **Self-hosted open-source games** on our Coolify (static site or small container) | The project's licence — e.g. Sudoku: [TN1ck/super-sudoku](https://github.com/TN1ck/super-sudoku) (MIT), [nirbhayagga/sudoku](https://github.com/nirbhayagga/sudoku) (app code MIT; check the puzzle-bank data terms); Codenames-style: [horsepaste](https://github.com/jbowens/horsepaste) (Go + Node, rooms shared by URL — **its licence could not be confirmed**; read the repo's LICENSE before use, else pick a clone with a clear licence) | None | **Start here** |
| **B** | **Distribution programs** built for embedding: [GameDistribution DGI](https://gamedistribution.com/publishers/embedded-links/) (iframe, under a publisher agreement) and [GameMonetize](https://gamemonetize.com/embed-games) (free embeds plus a [JSON/RSS feed](https://gamemonetize.com/rss-builder) usable in an iframe or WebView) | Their program terms, per game | **Games carry ads and third-party scripts** | Only after the controller accepts the terms and the tracking trade-off |
| **C** | **Link-out** — open the game's own page in the default browser (`opener:default` is already granted) | None needed | Whatever the site does | Fallback for anything that can't be embedded |

**Farm Merge Valley specifically:** it is listed on portals such as CrazyGames,
GamesGames and Miniplay ([CrazyGames page](https://www.crazygames.com/game/farm-merge-valley)), but CrazyGames' developer terms
allow iframe hosting only inside its own portal context and there is no public
permission for other sites ([developer terms](https://files.crazygames.com/documents/developer_terms_20250818.pdf)). So it cannot simply be
embedded from there. It could enter the catalog only through a Tier-B program
that carries it (check the catalog after onboarding) or as Tier-C link-out.
The rights holder could not be confirmed from the search, so don't assume.

**Codenames specifically:** the official game and its name belong to its
publisher; open-source clones exist under other names. Ship the clone under its
own name ("Word Spies" style), never as "Codenames".

**Sudoku** has no ownership problem: the puzzle genre is free and the MIT
projects above are complete. A free generator API exists
([Sugoku](https://github.com/bertoort/sugoku)), but a community-run API is a reliability risk; prefer the
self-hosted app.

### 16.2 Isolation: a separate window, not an iframe

- Open each game in its **own Tauri window** (label `arcade`), created from Rust.
  The app's capability file grants IPC only to the window labelled `main`
  ([capabilities/default.json](Tauri-App-Extension/src-tauri/capabilities/default.json)); per Tauri, a webview that matches no capability
  has **no access to the IPC layer at all**
  ([Tauri capabilities](https://v2.tauri.app/security/capabilities/)). So third-party JavaScript cannot call `invoke`, read
  agent credentials, or touch tracking.
- An iframe inside the main window is the worse option: it would force the main
  CSP's `frame-src 'none'` open. (Tauri also blocks `invoke` from iframes on
  Windows unless same-origin, but a separate window needs no such reasoning.)
- Hardening from `WebviewWindowBuilder` (verified to exist in the Tauri 2 API):
  `incognito(true)` and a throwaway `data_directory` so cookies and storage never
  persist; `on_navigation` restricted to the catalog entry's **pinned host
  allowlist**; `on_new_window` denies popups; `on_download` denies downloads;
  `content_protected(true)` so it is absent from screen captures; a fixed
  neutral title ("Arcade") so activity capture logs nothing revealing.
- Camera, microphone, geolocation and notification prompts must be denied.
  **Confirmed 2026-09-27:** wry's `WebViewBuilder::with_permission_handler(Fn(PermissionKind)
  -> PermissionResponse)` is exactly this hook, documented as fully supported
  via WebView2's `PermissionRequested` event on Windows. It is set **per
  webview**, so the arcade window's builder returns `Deny` for everything and
  the voice window's builder allows only `Microphone` (§17.4) — one line each,
  no shared global state. Remaining task: confirm `WebviewWindowBuilder`
  surfaces this wry option in the installed Tauri 2.11.5 (add it if not).
- The window opens only from the lounge (a break) and is **closed automatically
  when the break ends**; it never runs during work time.

### 16.3 Catalog, disclaimer, consent

- **Controller-curated catalog** (`arcade_games`): `id`, `title`, `tier`,
  `launch_url`, `allowed_hosts[]`, `provider_name`, `licence_or_terms_url`,
  `privacy_url`, `disclaimer_text`, `enabled`, `added_by`. Only enabled entries
  can launch; nothing loads from a URL typed by a member.
- **The URL never comes from JavaScript.** The UI calls a Rust command
  `open_arcade(gameId)`; Rust fetches the entry from the server (agent proof +
  `arcade` grant), validates it against the allowlist, and builds the window.
- **Disclaimer interstitial before a game's first launch** (acknowledgement
  stored in `arcade_acks (member_id, game_id, acked_at)`): "Third-party game —
  *not part of Virtual Tracker*. Provided by <provider>. Virtual Tracker does not
  operate, endorse, or receive any data from it. It may load its own ads and
  cookies and can see your IP address. Terms · Privacy." A one-line banner with
  the same wording stays on the launcher tile; no Virtual Tracker branding is
  placed on the game and none of the provider's is implied.
- The controller card gets an **Arcade catalog** screen (add/disable entries)
  and the licence/terms link is required to enable an entry.

### 16.4 Playing with colleagues

Third-party games bring their own multiplayer. A member starts a room in the
game (e.g. the self-hosted Codenames-style server) and shares it as a
**`game_link` chat message** `{ gameId, roomUrl }`. The chat server accepts it
only if `roomUrl`'s host is in that catalog entry's allowlist; clicking it opens
the Arcade window on that room. Room links are unauthenticated secrets, so they
live only inside room/DM chat (never in reports or alerts). Nothing about the
game's state passes through our servers except the link.

### 16.5 Data model, endpoints, config

- Tables: `arcade_games`, `arcade_acks` (above). Grants gain feature key
  `arcade` (§4.1); kill switch `ARCADE_ENABLED`.
- REST (agent proof + grant): `GET /api/arcade/games`, `POST
  /api/arcade/games/:id/ack`; controller-only `POST/PATCH /api/arcade/games`.
- Chat message `kind: "game_link"` (§5).
- Roles (§12): the Controller curates the catalog; every grantee can play;
  nobody else sees it (generic 404).

### 16.6 Tests and risks

- The `arcade` window has no IPC: a test page calling `window.__TAURI__.core.invoke`
  fails; a page navigating off its allowlist is stopped; popups and downloads
  are refused; cookies do not survive closing the window.
- The window is absent from an `xcap`-method capture (same check as §3.3).
- Break end closes every arcade window; a launch without a break is refused in
  the UI (server does not verify breaks, §3.2).
- `game_link` with an off-allowlist host is rejected by the server.
- Catalog entries cannot be enabled without a terms URL and acknowledgement text.
- **Risks:** Tier-B games run third-party ad code on employees' machines
  (malvertising, tracking) → off by default and only by controller decision;
  licence changes upstream → each entry stores its terms URL and is reviewed when
  its provider changes; a game's server going offline → the tile shows a
  "temporarily unavailable" state rather than an error; unclear rights →
  never enabled, use Tier C.

---

## 17. Voice rooms — media never touches our server

**Why offload.** Voice with good quality is bandwidth- and latency-sensitive. A
media server (SFU) shares a host that already runs the web app, dashboard and
tracking backend, so a busy voice room would degrade time tracking. The rule
(decision 11): **our server carries no audio.** It carries only chat/signalling
messages it already handles, plus a small signed token.

### 17.1 Options (free tiers researched 2026-09-26)

| Option | Media path | Free allowance | Effort | Notes |
| --- | --- | --- | --- | --- |
| **Jitsi as a Service (JaaS)** in the isolated Arcade window | Jitsi's servers (8x8) | **25 monthly active users** free ([pricing](https://cpaas.8x8.com/en/pricing/jitsi-as-a-service-pricing/)); then $0.35/MAU or fixed tiers | **Small** | Complete voice/video/chat UI, nothing to build. It is third-party, so it reuses the Arcade rules (§16): labelled, isolated, allowlisted host. |
| **P2P WebRTC mesh** (audio only, ≤ 4 people) | Directly between members' machines | Free; public STUN; TURN fallback via [Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/) (**1,000 GB/month free**, shared with SFU; $0.05/GB after) | Large | Zero server load; only signalling (our WS) and TURN credentials. Quality drops as people are added (each peer uploads N−1 streams). |
| **SFU on a free tier**, for bigger rooms | Provider's edge | [LiveKit Cloud Build](https://livekit.com/pricing): 5,000 WebRTC participant-minutes, 50 GB/month, **hard cap** ([summary](https://trtc.io/blog/details/livekit-pricing-2026)); or [Cloudflare Realtime SFU](https://developers.cloudflare.com/realtime/sfu/pricing): 1,000 GB/month free | Large | LiveKit ships client SDKs; Cloudflare's SFU is low-level and needs our own room logic. |
| Self-hosted media server (Jitsi/LiveKit on Coolify) | **Our host** | — | Large + ops | **Rejected** by decision 11. |

**Rough capacity check** (assumptions: Opus voice ≈ 40 kbps ≈ 18 MB per stream-hour):
LiveKit's 5,000 participant-minutes ≈ 83 person-hours a month — a handful of
short calls, then it stops. Cloudflare's 1,000 GB ≈ 55,000 stream-hours, i.e. far
beyond a small team's usage. JaaS's 25 MAU covers a small invited group.

### 17.2 Decision

1. **v1 = JaaS voice room in the Arcade window.** Least code and zero load on
   our host. Add it as a catalog entry (tier B/C, §16) with a "Voice room"
   type. Whole feature is: mint a join token, open the window, share the link.
2. **Later, only if needed** (full ranking and triggers in §17.6): P2P mesh for
   1:1 calls between friends (best quality, zero cost, TURN from Cloudflare's
   free pool); then, if free tiers or third-party audio become a problem,
   **LiveKit or Galène on a separate small VPS added to Coolify as a worker
   node** — our own media server that never shares the tracking host. All
   options sit behind a `VoiceProvider` interface so the UI does not change.
3. The 25-MAU and 5,000-minute limits are hard ceilings on free tiers; when a
   ceiling is hit, the button shows "Voice unavailable this month" rather than
   an error, and the controller alert webhook (§14.8) fires once.

### 17.3 How v1 works

- Voice opens from the lounge (a break), like games; leaving the break closes
  the window and the call.
- `POST /api/voice/rooms` (agent proof + `voice` grant, part of the `arcade`
  feature or its own key) creates a random, unguessable room name and returns
  a **short-lived JaaS JWT** signed by us (private key in server env). Claims
  restrict the room, set a **display alias** (not the member's full name or
  email, to limit what 8x8 sees), turn **recording/livestream off**, and expire in
  1 hour. **Confirmed 2026-09-27** from 8x8's own docs: header `alg`/`kid`/`typ`;
  payload `aud: "jitsi"`, `iss`, `sub` (App ID), `room`, `exp`, `nbf`;
  `context.user.{id,name,avatar,email,moderator}`; `context.features.recording`
  is the flag to force `false`, alongside `livestreaming`, `transcription`,
  `outbound-call`, and `hidden-from-recorder` (worth setting too). Only minting
  a real token against a JaaS account remains.
- The room link is shared in the project room or a DM as a
  `voice_link` chat message `{ provider, roomUrl }` (host allowlisted, like
  `game_link`); only room members see it. Room passwords/lobby stay on.
- No owner or admin can join or list rooms; there is no server-side directory of
  active calls beyond the token log.

### 17.4 Microphone permission — the technical catch

On Windows, WebView2 does not grant microphone access by itself; the Tauri
shell must answer the `PermissionRequested` event
([discussion](https://github.com/MicrosoftEdge/WebView2Feedback/issues/2930)). That matters twice:

- The **voice window** needs a Rust-side hook that allows the microphone (and
  only the microphone) for the pinned host.
- The **Arcade game windows** (§16.2) and the main window must **deny**
  microphone, camera and location. So the permission policy is per window
  label, default deny; one place in Rust, one test per window kind.
- A persistent, unmissable "Microphone is on" indicator in the window and the
  lounge bar; muted by default on join.

### 17.5 Privacy and limits

- Voice is on-break only, consistent with the lounge. No recording anywhere.
  The first-run notice (§4.3) gains a line: voice rooms are provided by a third
  party who receives audio, an alias, and the member's IP address.
- Content protection applies to the voice window too (§3.3).
- Not in scope: recording, transcripts, screen sharing, voice while tracking.

### 17.6 Exhaustive options survey (effort ignored, researched 2026-09-26)

Legend: **V** = confirmed in a source below; **U** = not confirmed, treat as a
lead. "Load on host" is the load on the Virtual Tracker Coolify server.

**A. Link-out to an app people already use** (open in the default browser)
| Option | Cost | Load on host | Notes |
| --- | --- | --- | --- |
| Google Meet / Microsoft Teams / Zoom free / Discord voice channel / Telegram voice chat | Free (U on exact limits) | None | Zero code; but identity, membership and privacy live outside the app, so owners-can't-read and project scoping are not enforced. Fallback only. |

**B. Hosted room embedded in the isolated window**
| Option | Cost | Load | Notes |
| --- | --- | --- | --- |
| **JaaS (Jitsi as a Service)** | **Free ≤ 25 MAU**, then $0.35/MAU or $99/300 MAU ([pricing](https://cpaas.8x8.com/en/pricing/jitsi-as-a-service-pricing/)) **V** | None | Full UI, JWT auth, recording can be disabled. **v1 pick.** |
| Public `meet.jit.si` via IFrame API | Free, no SLA ([API](https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe/)) **V** for the API; public-instance terms **U** | None | Fine for a test; not for anything private (no access control without JWT). |
| Whereby Embedded | From $9.99/month incl. 2,000 min ([pricing](https://whereby.com/information/embedded/pricing)) **V** | None | Not free. |

**C. Managed SDKs (we build the UI; provider carries media)**
| Option | Free allowance | Notes |
| --- | --- | --- |
| Daily, Agora, 100ms, Zoom Video SDK | **10,000 min/month each** ([comparison](https://banuba.medium.com/12-best-video-conferencing-apis-and-sdks-in-2026-tested-and-compared-768d04958577)) **V** | Same tier; pick on SDK quality. Overage roughly $0.003–0.009/participant-min. |
| Vonage Video API | First 100,000 free minutes for new customers ([pricing](https://www.vonage.com/communications-apis/video/pricing/)) **V** | Biggest free allowance; trial-style. |
| Stream Video | Free "Maker" plan with $100 credit ([pricing](https://getstream.io/video/pricing/)) **V**; minutes not stated | |
| **Cloudflare RealtimeKit** | Free while in beta; at GA audio-only ≈ **$0.0005/participant-min** ([pricing](https://developers.cloudflare.com/realtime/realtimekit/pricing)) **V** | GA price ≈ $5 per 10,000 audio minutes — the cheapest managed audio. Beta status is a risk. |
| Twilio Video | Alive — the end-of-life plan was reversed in Oct 2024 ([Twilio](https://www.twilio.com/en-us/changelog/-twilio-video-will-remain-a-standalone-product)) **V**; free tier **U** | Vendor-continuity risk. |
| Amazon Chime SDK | The *Chime app* ended 2026-02-20 but the SDK remains ([notice](https://answers.chime.aws/hc/en-us/articles/45510173388443-Support-for-Amazon-Chime-is-ending-February-20-2026)) **V**; free tier **U** | Skip: heavy AWS setup and a shaky brand. |
| Azure Communication Services | **No free audio tier** ([pricing](https://azure.microsoft.com/en-us/pricing/details/communication-services/)) **V** | Skip. |

**D. Infrastructure primitives (we build rooms on their edge)**
| Option | Free allowance | Notes |
| --- | --- | --- |
| Cloudflare Realtime SFU + TURN | **1,000 GB/month** shared; TURN free when used with the SFU ([docs](https://developers.cloudflare.com/realtime/turn/)) **V** | Low-level: we write room/participant logic. |
| LiveKit Cloud (Build) | 5,000 participant-min, 50 GB/month, hard cap ([pricing](https://livekit.com/pricing)) **V** | Best SDKs; the free tier is a taster. |

**E. Self-hosted, on a machine that is *not* the tracking host**
Coolify supports this directly: any Linux box with Docker and SSH becomes a
worker node and each resource picks its server
([multi-server docs](https://coolify.io/docs/knowledge-base/server/multiple-servers)) **V**. A small dedicated VPS keeps voice load
away from time tracking while staying under our ownership.
| Option | Footprint / capacity | Notes |
| --- | --- | --- |
| **LiveKit** (Go SFU, Apache-style OSS) | Reported 200+ participants on 4 vCPU / 16 GB ([comparison](https://whitelabelzoom.com/blog/best-self-hosted-video-conferencing-tools)) **V** | Best developer experience; UDP port range + TURN needed. |
| **Jitsi Meet** (Videobridge) | ~75–100 on the same spec **V** | Ready-made UI; heavier to run. |
| **Galène** | "Simplest possible setup" for a private room ([guide](https://www.bigiron.cc/guides/self-hosted-conference-bridge-jitsi-meet-vs-galene-vs-bigbluebutton-revisited)) **V** | Tiny Go server; small ecosystem. |
| mediasoup / Janus / Pion | Full-control engines ([overview](https://www.forasoft.com/learn/video-streaming/articles-streaming/sfu-comparison-mediasoup-janus-livekit-jitsi-pion)) **V** | Most build effort; only if a bespoke pipeline is wanted. |
| Element Call / MatrixRTC | Needs Synapse + LiveKit + coturn + JWT service ([setup](https://willlewis.co.uk/blog/posts/deploy-element-call-backend-with-synapse-and-docker-compose/)) **V** | Overkill and pulls in Matrix identity. |
| **Mumble** (voice only) | ~15–20 MB RAM idle, CPU mostly encryption; 512 MB is plenty for 50 users; port 64738 TCP+UDP ([Docker guide](https://oneuptime.com/blog/post/2026-02-08-how-to-run-mumble-server-in-docker-for-voice-chat/view)) **V** | By far the lightest server, but it speaks its own protocol, not WebRTC: no webview client. It would need the external Mumble app or a Rust client we write (protocol + Opus). |
| coturn (TURN only, for P2P) | Relays only the ~10–20 % of calls that can't connect directly (assumption) | Useful if the free Cloudflare TURN pool is ever exhausted. |

**F. Peer-to-peer, no media server at all**
WebRTC mesh, audio only, ≤ 4 people: each peer uploads N−1 Opus streams
(≈ 40 kbps each, assumption). Signalling rides our existing WebSocket; STUN is
free; TURN from Cloudflare's free pool. Zero server load, best privacy (audio
never reaches a third party unless relayed), and no vendor cap. Quality and
reliability fall off past 4 people. Works in the main window's WebView2 once the
microphone permission hook exists (§17.4).

**G. Hybrid** — P2P for 1:1 between friends, a hosted room for groups.

**Ranking by our constraints** (no load on the host, ownership, privacy, effort):

| Rank | Choice | Why |
| --- | --- | --- |
| 1 | **B: JaaS in the Arcade window** | Ships in days, zero load, free at our size, JWT-controlled rooms |
| 2 | **F/G: P2P for 1:1, hosted for groups** | Best privacy and zero cost; add when 1:1 calls matter |
| 3 | **E: LiveKit or Galène on a separate small VPS via Coolify** | Full ownership, no per-minute cap, still away from the tracking host — the "no effort limit" answer if free tiers or third-party privacy become a problem |
| 4 | **C/D: managed SDK or Cloudflare primitives** | Cheap and scalable when we want a custom UI without hosting |
| — | A link-out | Fallback only |
| — | Element Call, Chime, ACS, Whereby, Mumble-in-webview | Rejected (weight, cost, or no webview path) |

**When to move up the ladder:** JaaS monthly users near 25; complaints about
latency or dropouts; a decision that audio must not reach a third party (→ F or
E); a need for recording or transcripts (→ E or C).

### 17.7 Config and tests

- Server env: `JAAS_APP_ID`, `JAAS_KEY_ID`, `JAAS_PRIVATE_KEY` (private),
  `VOICE_ENABLED` kill switch.
- Tests: a token for room A cannot open room B; expired tokens are refused; the
  token carries no real name/email and has recording off; a non-granted or
  web-only session gets 404; the arcade window's mic request is denied while the
  voice window's is allowed; break end closes the voice window; when the free
  ceiling is reached the UI degrades cleanly and fires one alert.

---

## 18. Game catalog — by delivery mode

Legend for evidence: **V** = confirmed in a source, **U** = a lead not yet
confirmed (verify before the entry is enabled). Every mode obeys the Arcade
rules in §16 where a window is involved (isolated, labelled, break-only,
controller-curated).

### 18.1 The five modes

| # | Mode | Where the game runs | Rights | Multiplayer with colleagues | Load on our host | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| **1** | **Third-party inside the webview** | The provider's server, shown in the isolated Arcade window | Provider's program terms; needs an agreement (§16.1 tier B) | The game's own rooms, shared as a `game_link` | None | S per game, but legal/onboarding work |
| **2** | **Inside the app (native)** | The agent's own React UI; state relayed over our WebSocket (reducer registry, §3.2) | Classic/public-domain rules, so no licence issue — but **avoid trademarked names** | **Yes, natively**, scoped to a project room or a friend pair | Tiny (relay only) | M per game |
| **3** | **Forked from GitHub** | A fork we pin and self-host on Coolify, shown in the Arcade window | The repository's licence (recorded per entry) | The fork's own rooms, shared as a `game_link` | Small (a container), can live on a worker node | S–M per game |
| **4** | **Homemade originals** | Native, like mode 2, but original designs made for a team | Ours entirely | Yes, native | Tiny | M per game |
| **5** | **Links that run outside** | The member's default browser | The site's own terms; we only store a link | The site's own rooms, link shared in chat | None | S |

Modes 2 and 4 both live in the game registry; the difference is provenance
(a known classic vs. an original design). Modes 1, 3 and 5 are catalog rows
(`arcade_games`); mode 3 adds a Coolify service.

### 18.2 Catalog fields (extends §16.3)

`arcade_games` gains: `mode` (`webview_third_party` / `native` / `forked` /
`homemade` / `external_link`), `registry_id` (for modes 2 and 4, no URL),
`players_min`, `players_max`, `solo` (bool), `multiplayer` (`project_room` /
`friend_pair` / `own_rooms` / `none`), `licence`, `licence_url`,
`source_repo`, `pinned_commit` (mode 3), `trademark_note`, `status`
(`idea` / `vetted` / `enabled` / `retired`). A game cannot reach `enabled`
without `licence`/terms and, for mode 3, a `pinned_commit`.

### 18.3 Master game list

**Mode 2 — inside the app (native classics).** Use generic names.
| Game | Players | Basis | Name to use / note |
| --- | --- | --- | --- |
| Tic-tac-toe | 2 | Public-domain rules | **Phase 3 first game** |
| Chess | 2 | `chess.js` (BSD-2, **V**) for rules; own board | "Chess" is generic |
| Checkers / Draughts | 2 | Public-domain rules | |
| Four in a Row | 2 | Rules are free; **"Connect Four" is a trademark** | Use "Four in a Row" |
| Sea Battle | 2 | Rules are free; **"Battleship" is a trademark** | Use "Sea Battle" |
| Crazy Eights | 2–6 | Public-domain card game, standard deck | Avoid "Uno" |
| Hangman | 2–8 | Public domain | Local word list (check its licence) |
| Dots and Boxes | 2 | Public domain | |
| Minesweeper / Sudoku / 2048 (solo) | 1 | Public-domain mechanics | Or use the forks in mode 3 |

**Mode 4 — homemade originals (team-friendly, no external data).**
| Game | Players | Notes |
| --- | --- | --- |
| Draw & Guess | 3–10 | Canvas strokes relayed over WS; word packs authored by the controller |
| Word Tiles | 2–4 | Scrabble-style, generic name; free dictionary list, licence to check |
| Team Quiz Night | 3–20 | Controller-authored question packs; **never** built from real project or member data |
| Emoji Charades | 3–12 | Act with emoji only; reactions API reused |
| Two Truths and a Lie | 3–12 | Text prompts; nothing stored beyond the session |
| Pixel Canvas | 2–20 | Shared low-resolution board per room, resets on close |
| Word Chain / Story Relay | 2–10 | Turn-based text |
| Typing Race | 2–10 | Race a shared passage; optional, since typing overlaps work |
| Trivia (Open Trivia DB) | 1–20 | Data is CC BY-SA 4.0 (**V**, §14.4); server-cached questions |

**Mode 3 — forked from GitHub, self-hosted (shown in the Arcade window).**
| Game | Licence | Players | Notes |
| --- | --- | --- | --- |
| Sudoku — [TN1ck/super-sudoku](https://github.com/TN1ck/super-sudoku) | **MIT (V)** | 1 | Static site; easiest possible fork |
| Sudoku — [nirbhayagga/sudoku](https://github.com/nirbhayagga/sudoku) | **MIT app code (V)**; puzzle bank data terms to check | 1 | Offline PWA |
| [2048](https://github.com/gabrielecirulli/2048) | **MIT (V)** | 1 | Static site |
| Wordle-style — [Hugo0/wordle](https://github.com/Hugo0/wordle/) and [Guessle](https://github.com/jakerella/guessle) | **MIT (V)** (one clone excludes its `words.json` from the licence — check the word list) | 1 | Rebrand; avoid the NYT name |
| [Hextris](https://github.com/Hextris/hextris) | **GPL-3.0 (V)** | 1 | Self-hosting a modified copy is fine; only *redistributing* it triggers source duties |
| Pictionary — [scribble.rs](https://github.com/scribble-rs/scribble.rs) | **BSD-3 (V)**, some assets excluded | 2–12 | A real drawing game with private rooms; a small Go server |
| Codenames-style — [horsepaste](https://github.com/jbowens/horsepaste) | **Not confirmed (U)** — read its LICENSE first; if unclear, build the mode-4 version instead | 4–12 | Rooms shared by URL, no accounts; go with its own name |
| 8 board games — [LAN Games](https://github.com/kbennett2000/lan-games) (Monopoly, Risk, Battleship, Yahtzee, Life, Checkers, Connect Four, Tic-Tac-Toe; Node + Socket.io + SQLite) | **U** | 2–6 | Rename anything trademarked before exposing it |
| Jackbox-style party — [OpenPartyGames](https://github.com/asaf-shitrit/openpartygames) | **AGPL-3.0 (V)** | 3–12 | AGPL: a modified network-served fork must publish its source to users — only adopt if that is acceptable |
| Cartoon IO shooter — [TOSIOS](https://github.com/halftheopposite/TOSIOS) | **MIT (V)** | 2–20 | Optional; think twice about a shooter in a work tool |
| **Avoid** | Secret Hitler (**CC BY-NC-SA 4.0, V**) and Pretend You're Xyzzy / Cards Against Humanity clones (**CC BY-NC-SA, V**) | — | The non-commercial clause is hazardous in a business tool; the second is also unsuitable content |

**Fork process (mode 3):** pin an exact commit; copy the LICENSE and record it in
the catalog row; remove trademarks and branding; read the code for network calls
and telemetry (games run in a no-IPC window, but servers still need review); run
each fork as its own Coolify service with **no shared database or secrets**;
re-check upstream quarterly for security fixes. **Serve games from a separate
registrable domain**, not a subdomain of `myvirtualtracker.com` — a subdomain can
set cookies for the parent domain and reach the app ("cookie tossing").

**Mode 1 — third-party inside the webview.**
| Game | Source | Status |
| --- | --- | --- |
| Farm Merge Valley-style merge/farm games | Portals (CrazyGames lists it, **V**) but embedding there is not permitted outside its own portal (**V**); possible only through a GameDistribution or GameMonetize catalog (**U** whether it is in either) | Blocked until a programme agreement exists |
| Casual catalog (solitaire, mahjong, puzzle, merge, etc.) | [GameDistribution DGI](https://gamedistribution.com/publishers/embedded-links/) and [GameMonetize](https://gamemonetize.com/embed-games) feeds (**V**) | Off by default: ads and third-party scripts; needs a controller decision and an agreement |

**Mode 5 — links that run outside (opened in the default browser).** These are
catalog rows with a link and, where the site supports it, a "start a room and
paste the link in chat" helper. Terms of each site are **U** until vetted.
| Game / site | Kind | What we store |
| --- | --- | --- |
| [Skribbl.io](https://skribbl.io) — drawing, private rooms via link, no account (**V** in a roundup) | Pictionary | `game_link` room URLs |
| Gartic Phone — room codes, 4–30 players (**V** in a roundup) | Telephone-drawing | Room code link |
| Goose Goose Duck — lobby codes (**V** in a roundup) | Social deduction | Lobby link |
| [GameBuddies.io](https://gamebuddies.io) — about 20 free party games, no sign-up (**V** in a roundup) and [Foony](https://foony.com) — share-a-link rooms (**V**) | Party-game hubs | Hub link |
| Lichess "challenge a friend" links, Board Game Arena, Colonist.io | Chess / board games | Challenge or lobby link (**U**) |
| Farm Merge Valley on CrazyGames and Sudoku.com | Solo games | Plain link-out |

Because these open in the member's own browser, they are outside our window
rules: they run on their own network path, are not content-protected, and the
tracker's activity capture sees them like any browsing (they should be opened
only during a break, and breaks are not captured, §3.3). The catalog row states
"opens in your browser; not part of Virtual Tracker".

### 18.4 Rollout order

| Phase | Games |
| --- | --- |
| 3 — Lounge | Tic-tac-toe (mode 2) |
| 6 — More games | Trivia; Chess; Four in a Row; Sea Battle; Crazy Eights (modes 2/4); Draw & Guess and Word Tiles (mode 4) |
| 7 — Arcade | Forks first: Sudoku, 2048, Wordle-style, scribble.rs; then Codenames-style (fork if the licence is clear, else the mode-4 build); mode-5 links; mode-1 catalogs only after an agreement |

### 18.5 Tests specific to the catalog

- A row cannot be enabled without licence/terms; mode 3 also needs a pinned
  commit; mode 1 needs a recorded agreement reference.
- Trademark guard: a lint over catalog titles rejects a maintained list of
  protected names (Uno, Monopoly, Connect Four, Battleship, Scrabble, Codenames,
  Among Us, and similar) unless the row has a written permission note.
- A `game_link` host must appear in the row's allowlist (modes 1, 3, 5).
- Forks are reachable only on the games domain, never on an app domain, and set
  no cookies readable by the app.

### 18.6 Expanded lists — more games, GitHub repos, free APIs

Extends §18.3. **V** = confirmed in a source (2026-09-26); **U** = lead, open the
repo's LICENSE (or the site's terms) before enabling. "Rename" means the
original name is a trademark, so ship under a generic one (§18.5).

#### 18.6.1 More forks from GitHub (mode 3)

| Game | Repo | Licence | Players | Notes |
| --- | --- | --- | --- | --- |
| **Puzzle Pack** — 40+ single-player puzzles (Mines, Solo/Sudoku, Net, Galaxies, Loopy, Towers, Bridges, Unequal, …) | [Simon Tatham's Portable Puzzle Collection](https://www.chiark.greenend.org.uk/~sgtatham/puzzles/) | **MIT (V)**; JS/asm.js builds exist | 1 | One static deployment gives dozens of games — the best value per fork |
| Spyfall-style "find the odd one out" | [tannerkrewson/spyfall](https://github.com/tannerkrewson/spyfall), [dipsywong98/SpyFall](https://github.com/dipsywong98/SpyFall), [mahdi-barzegar-nazari/spyfall](https://github.com/mahdi-barzegar-nazari/spyfall) | **MIT reported (V)** — confirm each LICENSE; one uses Firebase (avoid) | 3–8 | Rename; swap the location list for neutral ones |
| Kahoot-style live quiz | [QuizDock](https://github.com/quizdock/quiz-dock) | **MIT (V)**, single Docker image | 2–50 | Players join by PIN, no accounts; runs entirely on our host. [ClassQuiz](https://github.com/mawoka-myblock/classquiz) is a fuller alternative (**U**) |
| LAN quiz | [Toohak](https://github.com/Arc676/Toohak) | **GPLv3 (V)** | 2–30 | Only if GPL is acceptable |
| Werewolf / Mafia | [OpenWerewolf](https://github.com/JamesCraster/OpenWerewolf), [Open Mafia Engine](https://github.com/open-mafia/open_mafia_engine) | **U** | 6–15 | Social deduction; good for larger groups |
| Avalon-style hidden roles | [avalon.ist](https://github.com/caracolplusplus/avalon.ist), [gene9831/avalon-boardgame](https://github.com/gene9831/avalon-boardgame) | **U** | 5–10 | Rename; the second uses boardgame.io + PostgreSQL |
| Quiz-show board | [tpavlek/Jeopardy](https://github.com/tpavlek/Jeopardy) | **U** | 3–12 | **Use our own clue packs.** Forks that pull real *Jeopardy!* clues (e.g. from J-Archive) reuse copyrighted content — avoid |
| Falling blocks | [jakesgordon/javascript-tetris](https://github.com/jakesgordon/javascript-tetris); multiplayer: [Red-Tetris](https://github.com/42plamusse/Red-Tetris) | **MIT (V)** for the first; **U** for the second | 1 / 2–8 | Rename ("Blocks"); "Tetris" is aggressively protected |
| Klondike solitaire | [warpdesign/html5-solitaire-js](https://github.com/warpdesign/html5-solitaire-js), [jhatzimalis/solitaire](https://github.com/jhatzimalis/solitaire) | **MIT (V)** for the first; **U** for the second | 1 | Offline, single file |
| Sea Battle | [BetoCarr/sea-warfare](https://github.com/BetoCarr/sea-warfare), [scc416/battleship](https://github.com/scc416/battleship) | **MIT (V)** for the first; **U** for the second | 2 | Rename; Next.js/Socket.IO stack |
| Draw-and-pass ("telephone") | [durancristhian/garlicphone](https://github.com/durancristhian/garlicphone), [evandocarmo/guess-the-drawing](https://github.com/evandocarmo/guess-the-drawing) | **U** | 4–12 | Skip clones that copy the original's branding |
| Bingo | [an MIT Firebase-based multiplayer Bingo](https://github.com/bcc44402-sudo/Bingo-) | **MIT (V)** | 2–50 | **Avoid** — it sends data to Firebase; build "Standup Bingo" natively |

Fork checks (from §18.3) apply to every row: pinned commit, LICENSE copied into
the catalog, branding stripped, no telemetry or third-party backends (reject
anything that needs Firebase or a hosted service we don't control), separate
games domain, no shared database.

#### 18.6.2 Free APIs that power games (server-side, cached)

| API | What it gives | Terms | Best used for |
| --- | --- | --- | --- |
| **Open Trivia DB** ([docs](https://opentdb.com/api_config.php)) | 24 categories, 3 difficulties | No key, **CC BY-SA 4.0**, 1 request per IP per 5 s **(V)** | Trivia, Team Quiz Night |
| **Deck of Cards API** ([site](https://deckofcardsapi.com/)) | Shuffle, draw, piles | **Free, no key, no formal quota (V)** | War, Go Fish, Hearts, Spades, Rummy (no stakes) — or just shuffle locally |
| **Datamuse** ([docs](https://www.datamuse.com/api/)) | Rhymes, related words, spelled-like, sounds-like | Free ≤ **100,000 requests/day**; **an API key becomes mandatory on 2027-01-01 (V)** | Word Association, Rhyme Battle, Hangman hints |
| **Free Dictionary API** ([site](https://dictionaryapi.dev/)) | Definitions, phonetics, audio | Free, **no key (V)** | Definition Bluff, word validation |
| **REST Countries** | Flags, capitals, populations, borders | No auth, unlimited **(V)** | Flag Quiz, Higher/Lower, geography |
| **Art Institute of Chicago API** ([open access](https://www.artic.edu/open-access/public-api)) | 100k+ artworks, 50k+ images | **CC0 images (V)** | "Guess the artist" |
| **The Met Open Access API** ([hub](https://www.metmuseum.org/hubs/open-access)) | 470k+ works with images | **CC0 (V)** | Art trivia, museum puzzles |
| **Wikipedia / Wikimedia APIs** ([limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits)) | Article text, links, images | Anonymous ≈ 100 req/s/IP; **a meaningful User-Agent is required**; text is CC BY-SA **(V)** | Wiki Race (native), page-guess quizzes |
| **PokéAPI** ([site](https://pokeapi.co/)) | Creature stats | No auth, **100 requests/IP/minute (V)**; sprites are a third party's artwork | Text-only trivia at most; skip sprites |
| **TheMealDB** ([docs](https://www.themealdb.com/api.php)) | Recipes | Free tier **(V)**; detailed terms **U** | "Guess the dish" (low fit) |
| **FreeToGame API** ([docs](https://www.freetogame.com/api-doc)) | Catalog of free-to-play PC and browser games with links | Free, no auth; **must credit FreeToGame with an active link (V)** | **Auto-populates the mode-5 link-out catalog** |
| **RAWG** ([terms](https://rawg.io/tos_api)) | Game metadata and covers | Key required; free for ≤ 100k MAU; **attribution backlink; no redistribution (V)** | Optional catalog artwork and descriptions |
| **JokeAPI** (v2.jokeapi.dev) | Jokes with a safe-mode filter | No key **(V)** | Joke Break |
| **Klipy** (§14.1) | GIFs and stickers | Free, ads optional **(V)** | In chat; sticker rounds |
| **Lichess API** ([docs](https://lichess.org/api)) | Play, puzzles, challenges; the Board API lets third-party UIs play real games | Free; the Board API needs each player's **OAuth `board:play` token (V)** | Not project-scoped (needs personal Lichess accounts). Use **challenge links** (mode 5) or the puzzle feed |

Every API call is made by our backend (never the webview), cached in Redis
(§6.1) within each API's rules, sends no member identifiers, and stores the
attribution text the terms require in the Licenses screen (§14.6).

#### 18.6.3 Libraries and engines (which to use, which to avoid)

| Library | Licence | Decision |
| --- | --- | --- |
| [chess.js](https://github.com/jhlywa/chess.js) | **BSD-2 (V)** | **Use** for chess rules |
| [chessground](https://github.com/lichess-org/chessground) (board UI) | **GPL-3.0 (V)** — a combined work must be GPL | **Avoid** in the proprietary agent; draw our own board |
| [stockfish.js](https://github.com/nmrugg/stockfish.js/) (AI opponent) | **GPLv3 (V)** | **Avoid** bundling it; if a computer opponent is wanted later, review the licence route first |
| [boardgame.io](https://github.com/boardgameio/boardgame.io) | **MIT (V)** | Not used (duplicates our socket and identity handling); a valid engine *inside forks* |
| [Colyseus](https://github.com/colyseus/colyseus) | **MIT (V)** | Not used for the same reason |
| PartyKit / Cloudflare Durable Objects | Free tier exists (**V**); ties us to Cloudflare | Not used |

#### 18.6.4 More native and homemade game ideas (modes 2 and 4)

All are reducer games on our relay; "data" says what feeds them. **S** ≈ days,
**M** ≈ a week or two.

| Game | Players | Data | Effort |
| --- | --- | --- | --- |
| Mancala | 2 | — | S |
| Reversi | 2 | — | S |
| Go (9×9) | 2 | — | M |
| Nim / Dots & Boxes | 2 | — | S |
| Snakes & Ladders, Ludo | 2–4 | — | S |
| Backgammon | 2 | — | M |
| Memory Match (emoji) | 1–4 | Emoji set | S |
| Sliding puzzle | 1 | Controller-uploaded images | S |
| Rock-Paper-Scissors tournament | 2–16 | — | S |
| 20 Questions / Hot Seat | 3–12 | Controller word packs | S |
| Would You Rather | 3–20 | Controller packs | S |
| Flag Quiz, Higher/Lower | 1–20 | REST Countries | S |
| Guess the Artist | 1–20 | AIC / Met CC0 | M |
| Word Association, Rhyme Battle | 2–10 | Datamuse | S |
| Definition Bluff (real vs invented definition) | 3–10 | Free Dictionary API | M |
| Wiki Race | 2–10 | Wikipedia API | M |
| War, Go Fish, Hearts, Spades, Rummy (no stakes) | 2–4 | Deck of Cards API or local shuffle | S–M each |
| Emoji Pictionary | 3–12 | Emoji set | S |
| Standup Bingo | 2–50 | Controller-authored squares | S |
| Team Trivia by category | 3–20 | Open Trivia DB + our packs | S |

Deliberately excluded: poker, blackjack with chips, and any betting mechanic;
shooters; anything using real project, task, or member data as content.

#### 18.6.5 Third-party webview and outside links (modes 1 and 5) — more entries

| Entry | Mode | Notes |
| --- | --- | --- |
| GameDistribution catalog ([DGI](https://gamedistribution.com/publishers/embedded-links/)) | 1 | Needs the publisher agreement; ads present |
| GameMonetize catalog ([embed](https://gamemonetize.com/embed-games), [JSON/RSS feed](https://gamemonetize.com/rss-builder)) | 1 | Free embeds and a JSON feed; ads present |
| Farm Merge Valley on [CrazyGames](https://www.crazygames.com/game/farm-merge-valley), GamesGames, Miniplay | 5 | Listed on all three **(V)**; link-out only — CrazyGames doesn't grant outside embedding |
| Poki, Y8, Kongregate-style portals | 5 | Link-out only (**U** terms) |
| NYT Games (Wordle, Connections, Spelling Bee) | 5 | Link-out only; some features need an account or subscription (**U**) |
| Skribbl.io, Gartic Phone, Goose Goose Duck, GameBuddies.io, Foony | 5 | Room links shared as `game_link`; no accounts **(V** in a roundup**)** |
| Wikiracer, Lichess challenge links, Board Game Arena, Colonist.io | 5 | Room/challenge links (**U**) |
| itch.io HTML5 games | 1 or 5 | Only where the creator permits embedding, per game (**U**) |
| Any F2P PC/browser game from the **FreeToGame API** | 5 | Auto-generated cards: title, genre, thumbnail, link, credit line |

### 18.7 Games in the picker

The lounge's Games tab (§19.7) shows every enabled entry as a tile with a badge
that states its origin: **Built in**, **Original**, **Open-source (hosted by us)**,
**Third-party (opens here)** or **Opens in your browser**, plus a players label
and, where required, a credit line. Third-party and browser tiles also carry the
one-line "not part of Virtual Tracker" note.

---

## 19. What the whole app looks like (text walkthrough)

Scope: the Tauri tracker (window 1100 × 750, fixed size, no OS frame — a custom
title bar, [tauri.conf.json](Tauri-App-Extension/src-tauri/tauri.conf.json)). Web dashboard changes are limited to the
controller screens (§19.11). Everything below appears **only for members with
the relevant grant**; everyone else sees the app exactly as it is today.

### 19.1 Ground rules

- **Same shell.** Title bar on top; the home screen keeps its left side panel
  (weekly activity, team status, projects, tasks, pinned Start/Pause/Stop and
  profile footer) and the timer area. New screens are **views** like today's
  Settings, Profile and Privacy panels (`view` is `home | settings | profile |
  privacy`; this adds `chat`, `friends`, `lounge`), each with the back header
  (`PanelBackHeader`).
- **Same look.** Existing theme (system / light / dark), `Icon` set, tooltips.
  The repo has a test that every button has a tip (`everyButtonHasATip`), so every
  new control ships with one.
- **Quiet by default.** No chat or game element appears while a member is
  working, other than two small sidebar rows and an unread badge.
- **Work never gets blocked.** The Start/Pause/Stop controls and the timer are
  identical in every state; the lounge sits on top of a break, never in place
  of the timer.

### 19.2 Title bar

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▣ My Virtual Tracker                        ◐  🔔②  ⬇   [🎮]   ─   ✕         │
└──────────────────────────────────────────────────────────────────────────────┘
   logo + title (drag area)               theme bell update lounge min close
```

`[🎮]` — the controller icon — is drawn **only** in a lounge-eligible state
(by default, on a break; see §22.4) **and** when granted. Tooltip: "Break
Lounge". The bell keeps its current role; new-message notifications follow the
ladder in §22.5 (protected in-app preview; sender-only OS toast).

### 19.3 Home while working (two new sidebar rows)

```
┌ title bar ───────────────────────────────────────────────────────────────────┐
├───────────────────────────┬──────────────────────────────────────────────────┤
│ Weekly activity  ◔ 74%    │                                                  │
│ Team status               │            Elapsed · Tracking                    │
│  ● Sara  ● Omar  ○ Lina   │                  02:14:37                        │
│                           │            Project: Atlas · Task: API            │
│ ── Social ────────────    │                                                  │
│ 💬 Chat            ③      │    (existing timer, screenshots card,            │
│ 👥 Friends      2 online  │     today's stats — unchanged)                  │
│                           │                                                  │
│ Projects                  │                                                  │
│  ▸ Atlas        ■■■□      │                                                  │
│  ▸ Nimbus       ■□□□      │                                                  │
│ Tasks …                   │                                                  │
├───────────────────────────┤                                                  │
│ [ Pause ]  [ Stop ]       │                                                  │
│ 👤 Mo · Employee  ● online│                                                  │
└───────────────────────────┴──────────────────────────────────────────────────┘
```

The **Social** group appears above Projects. Its rows carry an unread count and an
"N online" hint; nothing else on the screen changes.

### 19.4 Chat view (`view = chat`)

```
┌ title bar ───────────────────────────────────────────────────────────────────┐
│ ◂ Back   Chat                                                                │
├───────────────────┬──────────────────────────────────────────────────────────┤
│ Project rooms     │ # Atlas                    5 of 8 members have access ⋯  │
│  # Atlas       ③  │──────────────────────────────────────────────────────────│
│  # Nimbus         │  Sara  10:02   Did the deploy go out?                    │
│ Direct messages   │  Omar  10:03   ↳ replying to Sara: yes 🎉    👍2 🎉1     │
│  ● Sara           │  Sara  10:04   [ GIF: happy dance ]      Powered by KLIPY│
│  ○ Lina           │  Omar  10:05   [ sticker ]                               │
│                   │  Lina is typing…                                         │
│ ─────────────     │──────────────────────────────────────────────────────────│
│ 🔍 Search (tier2) │ [ 😊 ] [ 🖼 GIF ] [ ☺ Sticker ]  Type a message…    [ ➤ ]│
└───────────────────┴──────────────────────────────────────────────────────────┘
```

- Left rail: project rooms (only projects the member is assigned to) and DMs
  (friends only). Mute (🔕) and unread counts per row.
- Message menu (⋯): reply, react, edit/delete (own), **Report** (opens the
  consent dialog that shows exactly what will go to the controller, §3.4).
- Composer buttons open the emoji picker, the GIF search (with the "Search
  KLIPY" placeholder and the required logo), and sticker packs.
- Header "5 of 8 members have access" explains a quiet room (§3.1).
- A `game_link` or `voice_link` message renders as a card: "Sudoku party —
  third-party game · Join" / "Voice room · Join".

**First-run notice** (a modal before first use of chat): what is private, the
180-day retention, that owners can't read it, that reports go to the controller
only, and that server operators can technically read stored messages. One
"I understand" button.

### 19.5 Friends view (`view = friends`)

```
┌ title bar ───────────────────────────────────────────────────────────────────┐
│ ◂ Back   Friends                          [ Online ] [ Requests ② ] [ Add ]  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Online — 2                                                                   │
│  ● Sara Ali        in the lounge                        [ 💬 ] [ 🎮 ] [ ⋯ ]  │
│  ● Omar Nasser     online                               [ 💬 ] [ 🎮 ] [ ⋯ ]  │
│ Offline — 3                                                                  │
│  ○ Lina Hosny                                           [ 💬 ]        [ ⋯ ]  │
│                                                                              │
│ Add friend                                                                   │
│  • From a project room:  Atlas ▾  → pick a member                            │
│  • With a friend code:  [ ____-____ ]  [ Send request ]   My code: K7Q2-… ⟳  │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Presence is only **online / in the lounge / offline** — never "working", "idle"
  or "on a break" (§13.4). "Appear offline" lives in Settings.
- `[ 🎮 ]` invites a friend to a two-player game (they see a DM card; joining
  needs them to be on a break).
- The `⋯` menu: mute, unfriend, block. Requests tab: accept / decline (silent).

### 19.6 On a break — the lounge is one click away

The existing break UI ("On a break", Resume button) does not change. What appears
is the `[🎮]` icon in the title bar (§19.2) and, optionally, a small pill on the
timer area: "🎮 Lounge available". **The layout does not change until the member
clicks the icon** (decision 3).

### 19.7 The lounge shell (`view = lounge`)

```
┌ title bar ───────────────────────────────────────────────────────────────────┐
│ ⏸ On a break · 07:42          "Your break has run 15 min — back to work?"    │
│                                                        [ ▶ Back to work ]    │
├───────────────┬──────────────────────────────────────────────┬───────────────┤
│ Projects      │ [ Games ] [ Arcade ] [ Voice ]               │ # Atlas chat  │
│  Atlas   (3)  │                                              │ Sara: gg      │
│  Nimbus  (0)  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │ Omar: rematch?│
│               │  │Tic-tac │ │ Chess  │ │ Word   │ │ Draw & │ │ …             │
│ Friends       │  │  toe   │ │        │ │ Tiles  │ │ Guess  │ │               │
│  ● Sara       │  │Built in│ │Built in│ │Original│ │Original│ │ [ 😊 ][ ➤ ]  │
│  ● Omar       │  └────────┘ └────────┘ └────────┘ └────────┘ │               │
│               │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │               │
│ In this lounge│  │ Puzzle │ │ Quiz   │ │ Word   │ │ Sudoku │ │               │
│  ● Sara  ● Mo │  │  Pack  │ │ Night  │ │ Spies  │ │        │ │               │
│               │  │Open src│ │Open src│ │Open src│ │Open src│ │               │
│               │  └────────┘ └────────┘ └────────┘ └────────┘ │               │
└───────────────┴──────────────────────────────────────────────┴───────────────┘
```

- **Top bar** (always visible): break clock and the big **Back to work** button.
  The 15-minute banner sits here (§3.2). Ending the break by any route returns
  the member to Home.
- **Left rail:** projects with lounge counts, friends rail, and "In this lounge".
- **Centre tabs:** *Games* (built-in, original, open-source-hosted tiles),
  *Arcade* (third-party and outside-link tiles), *Voice* (start or join a room).
- **Right panel:** the same chat panel as §19.4 for the selected project.
- **In a built-in game:** the centre becomes the board with player names, turn
  indicator, a Leave button, and a rematch button; spectators can watch.

### 19.8 The Arcade tab and the third-party window

Tile badges follow §18.7. Clicking a third-party tile the first time shows the
interstitial:

```
┌──────────────────────────────────────────────────────────────┐
│  Third-party game — not part of Virtual Tracker              │
│  Sudoku · provided by <provider>                             │
│  Virtual Tracker doesn't operate, endorse, or receive any    │
│  data from it. It may load its own ads and cookies and can   │
│  see your IP address.       Terms · Privacy                  │
│                                                              │
│            [ Cancel ]            [ I understand — Open ]     │
└──────────────────────────────────────────────────────────────┘
```

The game then opens in its **own window** (§16.2):

```
┌──────────────────────────────────────────────────────────────┐
│ Arcade · Sudoku — third-party, not part of Virtual Tracker ✕ │  ← fixed strip
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                       (the game's page)                      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Windows for links that run outside simply open the default browser; the tile's
badge says so beforehand.

### 19.9 The voice window (§17)

A small separate window titled "Voice room · Atlas": the provider's call UI,
muted by default, with an always-visible "🎤 Microphone is on / muted" strip and
a Leave button. It closes when the break ends. Starting a room posts a
`voice_link` card into the project room.

### 19.10 Settings additions (`view = settings`)

- **Access code** — a neutral field ("Have an access code?"), §4.2.
- **Chat & friends:** message notifications on/off, "Appear offline", muted
  rooms list, "Show first-run notice again".
- **Licenses** — the Licenses screen (§14.6) with every credit and the Klipy,
  Open Trivia DB and open-source game notices.
- Existing privacy/break controls stay in the Privacy panel.

### 19.11 Web dashboard — controller only

- **Members → a member → Roles tab:** the **Feature access** card next to
  *Protected access* (§4.1): grant/revoke per feature (`project_chat`, `lounge`,
  `friends`, `arcade`, voice), batch select, code prompt, and the member's agent
  version with "needs ≥ X" when they're too old.
- **Codes:** mint single-use access codes, list outstanding ones by status,
  revoke unused ones.
- **Arcade catalog:** add, edit, disable entries (mode, licence link, allowlisted
  hosts, disclaimer text, status); licence and terms links are required to enable.
- **Sticker packs:** upload, order, credit lines.
- **Reports inbox:** the consented snapshots, with a "revoke access" action.
- Everyone else sees none of this, and direct URLs return a generic 404.

### 19.12 Edge and empty states

| Situation | What the member sees |
| --- | --- |
| No grant | Nothing new anywhere; the app is unchanged |
| Granted but the agent is too old | Nothing new; the controller card explains why |
| Kill switch on | The Social group and title-bar icon disappear on the next refresh |
| Offline / reconnecting | Existing "Connection lost" banner; chat shows a "reconnecting" strip, sending is queued for a few seconds then fails visibly |
| Break ends while in the lounge, a game window, or voice | Lounge, arcade windows and voice close; the member lands on Home; an in-progress game shows "opponent left" |
| Free voice ceiling reached | The Voice tab shows "Voice unavailable this month"; the controller gets one alert |
| GIF or third-party game gone | Titled placeholder / "temporarily unavailable" tile |
| Rate limited (typing, sending) | A brief inline "slow down" hint, not an error |
| Removed from a project | The room disappears from the rail; history stays unreadable to them |

### 19.13 Accessibility and polish

Keyboard reachability for the title-bar icon, tiles, board cells, emoji picker
and composer; visible focus states; dark-mode parity; reduced-motion respected
for reactions and sticker animation; the Back-to-work bar is the first focus
target when the lounge opens; all icon-only buttons carry text labels for
screen readers.

> **§20 supersedes the fixed-window assumptions in §19** once the workspace
> shell lands: chat, friends and the lounge become *panels* that can live in any
> layout, in work or break mode, instead of separate views.

---

## 20. The workspace shell — resizable, dockable, chat everywhere

The idea: turn the tracker from a fixed-size card into a flexible work
environment. Three title-bar buttons (minimize, **maximize/restore**, close);
layouts that follow the window's size; every part of the UI is a **panel** that
can be moved between slots or popped out into its own window; and **chat is one
panel that stays alive across work mode and the lounge**.

### 20.1 What exists today (verified in code)

- **The window is fixed.** `tauri.conf.json`: 1100 × 750, `resizable: false`,
  `decorations: false` (custom title bar). On top of that
  [window_layout.rs](Tauri-App-Extension/src-tauri/src/window_layout.rs) **pins the minimum size to the chosen size**
  (`set_min_size(Some(size))`) and eases the window to it when the layout changes.
- **Layouts already exist**, chosen by Rust, not by the user's drag: `LayoutKind`
  = **Standard** (1320 × 660, with a 296 px side column), **Wide** (1420 × 820,
  360 px column), **Extended** (1100 × 750, no column), **Focus** (1100 × 600).
  The preference is `auto | standard | wide | extended | focus`; Auto picks
  Standard or Focus from the screen's work area. The frontend applies a
  `layout-<kind>` CSS class, and `LayoutPreview` draws each in Settings.
- **CSS is class-driven, not fluid.** [App.css](Tauri-App-Extension/src/App.css) is 5,872 lines with only four
  `@media` rules; layout differences hang on the `layout-*` classes.
- **Window commands go through Rust**, not the JS window API:
  `minimize_current`, `close_window` in [commands/shell.rs](Tauri-App-Extension/src-tauri/src/commands/shell.rs); the
  capability file grants only hide/show/minimize/close/start-dragging.
- **`App.tsx` is the single orchestrator** (~2,800 lines): one `view` switch
  (`home | settings | profile | privacy`), polling tied to `view`.
- The timer and Start/Pause/Stop live in Rust (`pause_session`,
  `is_session_paused`, …), so any window can drive them through `invoke`.
- No window-state plugin is installed (position/size are not remembered beyond
  the layout preference).

### 20.2 The three-button title bar

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▣ My Virtual Tracker      ◐ 🔔② ⬇ [🎮] [🗨 Chat]        ─    ☐/❐    ✕       │
└──────────────────────────────────────────────────────────────────────────────┘
                                                     min  max/restore close
```

- **Restoring the classic three, in our own skin (decided 2026-09-27).** Windows'
  own minimize/maximize/close row comes back — same right-edge position, same
  order, same interaction (single click, double-click the drag area for
  maximize/restore) — but drawn with the app's own visual language, not the OS
  chrome:
  - **Same markup pattern as today's buttons.** [TitleBar.tsx](Tauri-App-Extension/src/components/common/TitleBar.tsx) already renders
    minimize and close as `<button class="win-btn">` with an inline SVG glyph
    and a `data-tip`; add **one more `win-btn`** for maximize/restore, same size,
    same hover/focus rules (`App.css` `.win-btn`, `.win-btn:hover`, `.win-close:hover`,
    `.win-btn:focus-visible`), positioned **between** minimize and close (the
    conventional order) — no new class of control, no native title bar.
  - **Glyph:** an outlined square for maximize; two overlapping squares (the
    Windows "restore" glyph) when maximized — same stroke weight and viewBox
    convention as the existing minimize (a single rule) and close (an X) icons,
    so it reads as one family, not a native import.
  - **Colour and states:** inherits the theme tokens the other two already use
    (light/dark, hover, disabled); it never gets `.win-close`'s red hover — only
    close does.
  - New Rust command `toggle_maximize_current` beside `minimize_current` (same
    pattern; no capability widening). The icon flips between maximize and restore;
    **double-clicking the drag area** does the same, per Windows convention.
- `resizable: true`, with a floor of about 960 × 520 (`NARROWEST` in
  `window_layout.rs`), and the pinned minimum removed.
- **Frameless-window resize and Snap Layouts (decided 2026-09-27): adopt
  [tauri-plugin-decorum](https://github.com/clearlysid/tauri-plugin-decorum) (or its maintained fork) rather than
  hand-roll it.** It does exactly what W1 needs for a `decorations: false`
  window: resize-edge hit-testing, and — the risk §20.9 had flagged as merely
  "accepted" — **native Windows 11 Snap Layout on our own custom maximize
  button**, via a small child-HWND overlay that answers `WM_NCHITTEST` with
  `HTMAXBUTTON` so hovering it opens the OS flyout exactly as it would over a
  native caption button. This closes the Snap-flyout loss instead of accepting
  it, at the cost of one more dependency.
- Remember size, position and maximized state per monitor (use
  `tauri-plugin-window-state` or a small addition to `prefs.rs`); a restored
  window must land fully on-screen if a monitor was unplugged.

### 20.3 Layouts driven by window size

Reuse the four layouts you already have, but let **the window's size choose the
layout** instead of the layout choosing the window's size. The frontend measures
the client area (a `ResizeObserver`) and picks a size class; each class maps to
an existing `layout-<kind>` so the current CSS keeps working, with one new one on
top.

| Client width (starting thresholds, to tune) | Layout | What it shows |
| --- | --- | --- |
| < 1100 or height < 620 | **Focus** | Timer + tasks; social panels open as a drawer |
| 1100 – 1279 | **Extended** | Sidebar + main; chat as a right-hand drawer |
| 1280 – 1479 | **Standard** | Adds the 296 px side column (chat or insights) |
| 1480 – 1899 | **Wide** | 360 px side column, roomier main |
| ≥ 1900, or maximized on a large screen | **Workspace** (new) | Three columns plus an optional bottom dock (§20.4) |

Preference values become: **Auto (new default — follows the window)**, the four
**pinned** presets (today's behaviour: fixed size, chosen in Settings), and
**Workspace**. **Any manual resize or maximize switches the preference to Auto**
with a one-time toast ("Layout now follows the window size"); pinned presets stay
available under Settings → Window layout → "Lock size". Each layout keeps
working from its own minimum width upward, so there are no in-between widths that
fall outside every layout.

### 20.4 Panels and slots

Everything the UI shows becomes a registered **panel**:

| Existing panels | New panels |
| --- | --- |
| Timer & clock, Start/Pause/Stop (pinned), Projects, Tasks, Weekly activity, Team status, Management card, Insights/Screenshots | **Chat**, **Friends**, **Games** (lounge tiles), **Arcade**, **Voice**, Notifications |

A registry entry: `id`, title, icon, minimum size, preferred slot, `requires`
(a grant such as `project_chat`), `modes` (`work`, `lounge`, or both), and the
component. **Slots:** `left`, `center`, `right`, `bottom`, and `float`. A
**layout** is an ordered list of panels per slot, stored **per mode** (`work`,
`lounge`) and **per size class**.

Invariants:

- **The timer and Start/Pause/Stop panel is pinned** — it cannot be hidden,
  closed or popped out of reach, and it looks and behaves the same in every
  layout and mode (§19.1).
- A panel whose grant is missing is not registered at all, so it cannot appear.
- On small layouts, panels collapse into tabs or drawers rather than
  overflowing.
- Each panel owns its polling and **pauses it while hidden** (today's polling is
  tied to `view === "home"`).

### 20.5 Chat everywhere (work and lounge)

```
WORK mode, Workspace layout                   LOUNGE mode (after clicking 🎮)
┌───────────┬──────────────────┬─────────┐    ┌───────────┬──────────────────┬─────────┐
│ Projects  │  Timer 02:14:37  │ # Atlas │    │ Projects  │  Games │Arcade│… │ # Atlas │
│ Tasks     │  (pinned)        │  chat   │    │ Friends   │  ┌──┐ ┌──┐ ┌──┐  │  chat   │
│ Team      │  Today / stats   │ ─────── │    │ In lounge │  └──┘ └──┘ └──┘  │ (same   │
│           │                  │ Friends │    │           │                  │  panel) │
├───────────┴──────────────────┴─────────┤    ├───────────┴──────────────────┴─────────┤
│ bottom dock: Notifications / Insights  │    │ ⏸ break 07:42        [▶ Back to work] │
└────────────────────────────────────────┘    └────────────────────────────────────────┘
```

- **One chat panel, one store.** Chat has a single registry id (`chat`) and a
  single store keyed by room. Switching between the work preset and the lounge
  preset changes the *layout*, not the panel: scroll position, drafts, the
  selected room and typing state carry over.
- **Its states:** collapsed (unread badge only), docked in any slot, drawer,
  or popped out.
- **A break alone still does nothing to the layout** (decision 3). Clicking `🎮`
  applies the lounge preset; **Back to work** (or the break ending) restores the
  work preset the member had.
- **Screenshot protection follows the panels**: any window that currently shows
  a Chat, Friends, or lounge panel is content-protected (§3.3), including
  popped-out windows; with chat docked all day the main window is simply always
  protected. OS toasts stay sender-only; previews use the protected toast window
(§22.5), which is itself on the shield's window list (§21.4).

### 20.6 Pop-out windows

Any panel can be popped out (panel menu → **Pop out**; **Dock back** or closing
the window returns it).

- **Mechanism:** Rust creates a secondary `WebviewWindow` (label
  `panel-<id>`) that loads the same frontend with `?panel=<id>`. These are *our
  own* UI, so they get a **minimal capability** (`panel`): the app's own commands
  it needs, no more — unlike Arcade and voice windows, which stay isolated with no
  IPC (§16.2).
- **State sharing:** one network connection and one source of truth. The socket
  lives in Rust ([live_sync.rs](Tauri-App-Extension/src-tauri/src/agent/live_sync.rs)) and **emits Tauri events to every window**;
  each window's store subscribes and catches up over REST (`?after=`), so
  popping chat out never opens a second socket. The timer already lives in Rust.
- Popped-out windows use the same 3-button title bar (without the tracker
  actions), remember position, and close with the app.
- Closing the main window to the tray keeps its popped-out panels hidden with
  it and restores them together.

### 20.7 How much layout freedom — three stages

| Stage | Delivers | Effort | Notes |
| --- | --- | --- | --- |
| **W1 — Resize & respond** | 3-button title bar, `resizable`, size-driven layouts (existing four + Workspace), remembered window state, Auto default | M | Mostly Rust config plus a `ResizeObserver` that picks the layout class; reuses today's CSS |
| **W2 — Panels in slots** | Panel registry, per-mode/per-size layouts, "**Move to… / Pop out / Hide**" menu on each panel (no drag-and-drop), chat/friends as panels, layout presets, Reset layout | L | Requires extracting panels out of `App.tsx`; the keyboard-friendly way to rearrange |
| **W3 — Free docking** | Drag-and-drop tabs, split groups, floating groups, maximise-a-panel | L | Use a library instead of writing one: **[dockview](https://github.com/dockview/dockview)** (MIT, zero dependencies; tabs, groups, grids, splitviews, floating and maximizable groups, popout) is the pick; alternatives [react-mosaic](https://github.com/nomcopter/react-mosaic) (Apache-2.0) and [rc-dock](https://github.com/ticlo/rc-dock) (Apache-2.0); flexlayout-react is ISC (some listings say MIT). Use our own Rust-created pop-out windows (§20.6) rather than the library's `window.open` popouts |

The recommendation is **W1 → W2 now, W3 only if people want free-form docking**;
W2 already delivers "views ported in and out" in a controllable way.

### 20.8 Layout storage

Local only: a JSON blob in the existing preferences (`prefs.rs`) — layouts per
mode and size class, pinned/floating state, last window rect per monitor. No
server sync and no owner visibility (it isn't tracking data). "Reset layout"
restores presets: **Focus, Standard, Wide, Workspace, Lounge**. A corrupt or
unknown layout falls back to the preset for the current size class.

### 20.9 Risks and how they're handled

| Risk | Handling |
| --- | --- |
| The CSS assumes fixed widths (5,872 lines, four `@media` rules) | Keep each layout's minimum width equal to today's (Extended 1100, Standard 1180+, Wide 1300+); a **resize-sweep smoke test** renders 960 → 2560 px wide and asserts no clipping/overflow |
| `App.tsx` extraction is large | Do it panel by panel in W2, each extraction shipped behind the existing views; no big-bang rewrite |
| Snap Layouts flyout lost on a custom maximize button | Accept, or add the non-client hit-test trick; verify on Windows 11 |
| A resizable window changes screenshot framing | Capture is screen-based (`xcap`), independent of window size — no change |
| Polling multiplies with more panels | Each panel pauses when hidden; one shared poll per data source |
| Pop-out windows leak chat into screenshots | Content protection applies per window (§20.5); tested per window kind |
| Users lose track of a hidden panel | Reset layout, plus a "Panels" menu listing every panel with its state |
| Docking a panel over the timer | The timer panel is pinned and undockable (§20.4) |
| Multi-monitor / DPI edge cases | Restore logic clamps to a visible work area; tested at 100/125/150 % scaling |
| Scope creep into a "whole IDE" | The registry decides what exists; ideas below are not commitments |

### 20.10 Tests

- Title bar: maximize ↔ restore toggles, double-click on the drag area toggles,
  the icon and tooltip follow state; every new button has a tip (existing test).
- Size classes: each threshold flips to the right layout; a manual resize sets
  Auto once; pinned presets still size the window as they do today.
- Window state: size/position/maximized persist per monitor and clamp on-screen.
- Panels: registry rejects an entry without a grant; layouts round-trip; a
  corrupt layout falls back safely; the timer panel cannot be moved or hidden.
- Chat continuity: switching work ↔ lounge keeps scroll, draft, selected room
  and the single socket; popping out opens no second connection; every
  chat-showing window is content-protected.
- Pop-out: dock back on close; restored together after a tray hide.
- Resize-sweep smoke test (§20.9).

### 20.11 "Full work environment" — panels we could add later (not commitments)

The registry makes each of these a self-contained addition: a **Tasks board**
(kanban), a **Notes / scratchpad**, a **Team feed**, a **Calendar and time-off**
panel, a **Focus timer** (Pomodoro), **Pinned links**, and **Standup notes**.
None is in scope until asked for; the point is that W2 turns each into one panel
instead of a rewrite.

### 20.12 Decisions and questions

| # | Decision / question | Recommendation |
| --- | --- | --- |
| W-1 | Does a manual resize switch the preference to Auto? | **Yes**, with a toast; pinned presets stay behind "Lock size" |
| W-2 | Ship W1 alone first? | **Yes** — it's small and unlocks everything else |
| W-3 | Free docking (W3)? | Defer; decide after W2 is in use |
| W-4 | Should chat be allowed to stay popped out while the main window is minimized? | **Yes**; it is content-protected like any chat window |
| W-5 | Sync layouts across a member's devices? | **No** — local only |
| W-6 | Keep the pinned Extended/Focus presets? | **Yes**, for small screens and existing users |

---

## 21. The privacy shield — chat never appears in screenshots

Requirement: when the agent takes a screenshot, **chat (and friends, lounge,
voice and arcade content) must not be in it**, whether it is docked in the main
window (§20), popped out, or open in a lounge or game window — while the member
still sees it normally, and **without weakening the monitoring the screenshots
exist for**.

### 21.1 What exists today (verified in code)

- **One capture choke point.** Every screenshot goes through
  `ScreenCapture::capture_jpeg_data_url(blur: bool)` in
  [capture/screen.rs](Tauri-App-Extension/src-tauri/src/capture/screen.rs): `xcap` grabs the active monitor, the image is optionally
  blurred, JPEG-encoded, and returned. That is the one place to hook.
- **There is already a "sensitive" path** — `sensitive_apps.rs` decides when to
  blur for a personal messaging app or site. It is a *light* blur (sigma 2.5,
  by design), so text can remain partly legible: **not good enough for our
  chat**, which must not be visible at all.
- **On Windows `xcap` captures with GDI `BitBlt`** from the display, and the
  Windows capture-exclusion flag hides a window from exactly that path
  (proven 2026-09-26, §3.3).
- Activity capture reads foreground window names (`capture/window.rs`) and
  browser URLs through UI Automation (`uia_url.rs`).
- The app also runs on macOS and Linux code paths (`cfg(target_os)` blocks), so
  the shield must say what it does there.

### 21.2 Why "hide the panel" is harder than it sounds

The operating-system flag works **per top-level window**, not per panel. A chat
panel docked in the main window (§20.5) shares that window with the timer, so
excluding it hides the **whole tracker window** from screenshots. That is fine —
screenshots show what someone is working on, and the tracker's own window isn't
it — **provided the excluded window doesn't cover work**: an excluded window is
*absent* in the capture, so whatever is behind it is still recorded.

That last point is the integrity rule that drives the design:

> **Never hide work to hide chat.** A screenshot with chat hidden must still
> show everything that is *not* chat, including whatever sits behind the chat
> window. Covering the chat with an opaque or blurred patch would let someone
> dodge screenshots by parking the chat window on top of their work, because
> the patch (unlike an excluded, absent window) hides what the window sits on.

So the shield prefers the **OS exclusion flag (window is absent, work behind it
is captured)** over **blurring the chat's own area (the window is still there,
just unreadable)**.

### 21.3 Three layers

| Layer | What it does | Where | Integrity effect |
| --- | --- | --- | --- |
| **1. OS exclusion** (primary) | `set_content_protected(true)` on every window that is showing a social panel — Windows `WDA_EXCLUDEFROMCAPTURE`: the window is absent from the capture | Rust, per window | None: what's behind the window is captured |
| **2. Watchdog at capture time** | Right before each capture, for every window that *should* be protected, read its real display affinity (`GetWindowDisplayAffinity`); if it isn't protected, **re-apply it and re-check** before grabbing the screen | `capture_jpeg_data_url` | None |
| **3. Heavy-blur fallback** | Only if layer 1 can't be guaranteed (macOS/Linux, a failed re-apply, an old Windows build that only supports the black variant): apply **the existing blur, 5 % stronger and sized to the text, over the chat box only** — the private panel's own rectangle, not the rest of the window — in the captured image, and **label it** | `capture_jpeg_data_url`, after `capture_image`, before the ordinary blur and JPEG encode | Small: the chat box is unreadable but the timer and the rest of the window stay as captured; the window itself already covers what is beneath it, so a blur hides nothing extra (§21.6 covers the parked-over-work case) |

Never "skip the screenshot" as the fail-safe: skipping while chat is open would
let anyone switch monitoring off by opening chat. Fail-safe means *blur the chat
box*, not *omit the screenshot*.

### 21.4 The shield state machine (Rust)

A `PrivacyShield` in Rust owns one fact per window: **`social_visible`** — true
when any panel of a private kind (chat, friends, lounge, voice controls) is
mounted **and** visible in that window.

- The frontend reports panel visibility through one command,
  `set_panel_visibility(panelId, visible, rect)`; the panel registry (§20.4)
  marks each panel `private: true|false`. Rust folds the reports into
  `social_visible` per window.
- **Protect first, show second.** When a private panel is about to appear, Rust
  applies protection and confirms it *before* the panel is allowed to render
  (the frontend awaits the command). There is never a frame with chat visible
  and the window unprotected.
- **Unprotect late.** After the last private panel is hidden, protection stays
  on for a short grace period (about 500 ms) so a capture that lands mid-fade
  can't catch the tail of the animation.
- **Default deny.** A window that has not reported yet (a fresh pop-out, an
  app restart, a crash-restored layout) starts **protected**, and stays so until
  it reports that it has no private panel.
- **The protected toast window (§22.5) and every private panel are on the
  list**: chat, friends, the lounge chat side panel, voice controls, **Pulse**,
  **standup preview**, and the collection-request form (its evidence is personal).
- **Any window that can display chat is covered** — main, every `panel-*`
  pop-out (§20.6), the lounge view, and the voice window. Arcade windows are
  protected too (§16.2), for a different reason: third-party content.
- **Tray/hidden windows:** a hidden window is never a capture target; nothing to
  do.

### 21.5 Redaction fallback in detail (layer 3)

Used only where the OS flag can't be relied on. The registry of protected
rectangles is `(window, rect)` pairs in **physical screen pixels**:

- A panel rect comes from the frontend (`getBoundingClientRect() ×
  devicePixelRatio`) plus the window's **client-area origin** (not its outer
  frame); a whole-window rect comes from Tauri's window position and size.
- Convert to image pixels using the captured monitor: `x_img = (x_screen −
  monitor.x) × image_width / monitor.width`, same for y, so multi-monitor
  offsets and DPI scaling (100 / 125 / 150 %) are handled by one formula.
- Rects are refreshed on window move/resize and on every panel layout change,
  and **re-read immediately before capture**; a rect older than a second is
  treated as stale and widened to the whole window.
- **How the blur is done (decided: the existing blur, 5 % stronger, chat box
  only).** The owner's call: the existing blur is good, so the new one is the
  **same kind of Gaussian** (`image::imageops::blur`, the same call the code
  already makes) at **1.05× the existing strength**, applied to the panel's
  rectangle only, plus an 8-pixel margin to catch shadows and animation. The
  rest of the image is left alone.
  1. **Order:** run it **after** the existing resize to `MAX_SCREENSHOT_WIDTH`
     (1280) — the existing 2.5 sigma is measured in those downscaled pixels, so
     the new one is too. Rectangles are converted into that image's space.
  2. **Strength:** `sigma = max(2.5 × 1.05, 0.303 × text_px)`, capped at 6, where
     `text_px` is the panel's body-text height **as it appears in the captured
     image** (`css_font_px × devicePixelRatio × resize_ratio`; the frontend
     reports the font size with the rect). The `0.303` is the existing blur's
     ratio on a 1920-wide screen (2.5 ÷ 8.7 px) times 1.05.
  3. **Composite** the blurred crop back over the same rectangle with a clean
     edge, not a feathered halo, so no half-blurred text peeks out.
  **Why not a flat 2.625.** A fixed sigma is only "good" where the screenshot is
  heavily downscaled. Measured on 2026-09-26 (below): a bare 5 % bump is
  indistinguishable from the existing blur, which is unreadable on 1920-wide and
  larger screens but still legible to a person on a 1366-wide laptop with 16 px
  text. Tying sigma to the text's size in the image keeps the strength
  consistent — the owner's reference look on a 1920 screen, 5 % stronger —
  and raises it only where text stays large. The named constants are
  `PRIVATE_PANEL_BLUR_MARGIN = 1.05` and `PRIVATE_PANEL_TEXT_RATIO = 0.303`.

  **Measurement (the actual capture pipeline, simulated):** chat-style text drawn
  at 13–20 px on 1280, 1366, 1920, 2560 and 3840-wide screens (light and dark),
  resized with Lanczos to 1280 wide, blurred, JPEG q72, cropped and zoomed 3×
  (a generous attacker), then read by **Windows OCR**:

  | Blur sigma | Words recovered by OCR | Human reading (worst case: 1366 wide, 16 px) |
  | --- | --- | --- |
  | none (control) | 8–100 % depending on screen size | readable |
  | **2.5 (today)** | **0 %** in all 12 scenarios | legible with effort |
  | **2.625 (+5 %)** | **0 %** | legible with effort — same as today |
  | 4.0 | 0 % | word shapes only; not readable |
  | 6.0 / 8.0 | 0 % | unreadable |

  Limits of the test: it used OCR plus one reviewer's eyes, not adversarial
  deblurring; the strength constants should be re-checked against real chat
  screenshots before release.
- **Which rectangle.** Each *private panel* reports its own rect (chat, friends,
  the lounge chat side panel, voice controls), so the timer, Start/Pause/Stop
  and the rest of the tracker window stay visible in the shot. If a private
  panel's rect is stale (older than a second) or never reported, fall back to
  the **whole tracker window's rect** for that capture rather than risk leaking.
- **Blur, not the existing "sensitive app" path.** The current
  `blur: bool` blurs the *entire* image (sigma 2.5) for a personal messaging app.
  The private-panel blur is separate and regional and never weaker than it; both
  can apply to one screenshot, and where they overlap the stronger one wins.
- Platforms: **Windows** uses layers 1 and 2 first; **macOS** has an equivalent
  window flag, but whether it is honoured by newer capture APIs is **unverified**,
  so treat macOS as layer 3 until tested; **Linux** has no reliable per-window
  exclusion, so it is layer 3 only.

### 21.6 Keeping the record honest

- When layer 3 fires, the screenshot upload carries a small flag —
  `redactions: [{ kind: "private_panel", areaPercent }]` — so an owner viewing it
  sees a labelled "private panel blurred" area, not an unexplained smudge that
  looks like tampering. No coordinates, no content.
- **Anti-dodge rule.** A blurred (or excluded-and-empty) chat window that covers a
  large part of the screen would otherwise hide the work behind it. If the
  blurred area exceeds **35 %** of the screen, the shot is additionally marked
  `obscuredByPrivatePanel`, so an owner sees a monitoring gap and not a clean
  screenshot. Layer 1 (window absent) never triggers this because what is
  behind the window is captured.
- The member sees a small **"Hidden from screenshots"** badge with a tooltip on
  private panels, so the protection is visible to them, not silent.

### 21.7 Other leaks the shield must close

| Leak | Closure |
| --- | --- |
| Windows notification text | OS toasts carry the sender only; previews only in the protected in-app toast (§22.5) |
| Window titles in activity capture | Private windows keep a fixed neutral title; message text never enters a title, tooltip, or taskbar preview text |
| UI Automation reading our own windows | `uia_url.rs` and window capture ignore windows owned by the tracker's own process |
| Logs and crash reports | Never log message bodies, GIF titles, room names or friend names; a test greps logs for canaries |
| Clipboard | Not captured by the agent; nothing to do |
| Third-party game / voice windows | Protected too (§16.2, §17.4) and outside the app's IPC |
| The member's own screen-share or Snipping Tool | Blank for protected windows — intended, and mentioned in the notice |
| Windows Recall-style OS snapshots | **Unverified** whether the flag excludes them; check on a Copilot+ machine before promising it |

### 21.8 Tests

Automated, using the real capture path, not a stand-in:

- **Hidden-not-black:** open a protected window over a sentinel "work" window;
  run `capture_jpeg_data_url`; assert the sentinel pixels **are** visible and the
  chat window's colour **is not** (the window is absent, work behind it kept) —
  extends the 2026-09-26 GDI test.
- **Protect-before-show:** show a private panel and capture in the same tick;
  assert the chat pixels never appear (the frontend must await protection).
- **Grace period:** hide the panel, capture within 200 ms → still protected;
  after ~600 ms → unprotected (so ordinary use isn't affected).
- **Default deny:** a freshly created pop-out window is protected until it
  reports no private panel.
- **Watchdog:** force the affinity to `NONE`; the next capture re-applies it (or,
  failing that, falls to layer 3) and the chat is still absent.
- **Blur geometry:** synthetic images at 100/125/150 % scaling, two monitors
  with offsets and a negative-origin monitor; the blurred rectangle lands on
  the right pixels; pixels *outside* the rectangle (and its margin) are
  byte-identical to the input; a stale or missing rect widens to the window.
- **Blur strength:** render real chat text at 11, 12, 14 and 16 px on 1280, 1366,
  1920, 2560 and 3840-wide screens (light and dark) through the real resize →
  blur → JPEG path. Assert: the sigma equals `max(2.625, 0.303 × text_px)` capped
  at 6; **Windows OCR recovers 0 %** of the words (the 2026-09-26 harness in the
  scratchpad becomes a repo test tool); and the worst case (1366 wide, 16 px) is
  visually reviewed against a saved reference image. Re-run whenever the
  constants change.
- **Never weaker than today:** for every scenario the private-panel sigma is ≥
  2.625.
- **Only the chat box:** with the timer and the chat panel both visible in one
  window, the timer's pixels are unchanged and the chat's are blurred.
- **Anti-dodge:** a chat area covering more than 35 % of the screen yields the
  `obscuredByPrivatePanel` flag; layer 1 never does.
- **Metadata:** layer-3 shots carry `redactions` and nothing else about the
  panel; layer-1 shots carry none.
- **Leaks:** log canary grep; toast body absent; window title static.
- **Platforms:** the macOS and Linux paths run the layer-3 tests in CI on those
  targets or are explicitly marked unsupported for chat until they do.

### 21.9 Decisions and questions

| # | Decision / question | Recommendation |
| --- | --- | --- |
| S-1 | Guarantee = OS exclusion, with a capture-time watchdog and a redaction fallback | **Yes** (§21.3) |
| S-2 | If protection can't be confirmed, skip the screenshot? | **No** — blur the chat box and label it; skipping would let chat switch monitoring off |
| S-7 | Fallback treatment: paint or blur? | **The existing blur, 5 % stronger, chat box only** — with sigma tied to the text's size in the image so small screens aren't weaker (§21.5); no flat paint, no heavy downscale |
| S-3 | Is it acceptable that a docked chat hides the whole tracker window from screenshots on Windows? | **Yes** — the tracker window isn't the work; what's behind it is still captured |
| S-4 | Panel-precise hiding (only the chat, timer stays visible) | Only via layer 3 or an *attached* separate chat window; **not recommended** — extra complexity and the attached-window jitter for no monitoring benefit |
| S-5 | Show owners that a region was redacted? | **Yes**, flag + area percent only |
| S-6 | Support chat on macOS/Linux at launch? | **Windows first**; other platforms only after layer 3 is verified there |

---

## 22. Pilot decisions (2026-09-27) — break policy, notifications, Pulse, stickers, transparency

The owner reviewed the brainstorm list and accepted every item. This section
turns each answer into a design. Where an answer leaves a real choice, the
choice made here is marked **[decided here — confirm]**.

### 22.1 Context: a consented pilot, not a product release

The social layer is **under development, is not shipped as part of Virtual
Tracker's release**, and runs **by agreement** with employees who opt in, because
its costs are not covered by the business yet. That turns several earlier ideas
into a written **pilot charter**:

| Charter item | What it says |
| --- | --- |
| **Scope** | Only members who opt in (grant + acknowledged notice, §4.3). No one is enrolled by default. |
| **No harm to the business** | The feature is dormant by default (all kill switches off); it never changes time accounting, capture policy or the tracker's Start/Pause/Stop; a resource budget applies (§22.14); one switch turns everything off. |
| **Not part of the release** | Code lives in one module (§4.0) on its own branch until the sponsor approves. It is merged only **dormant** (every switch defaults off) after security review, following the existing branch-sync workflow. It is absent from release notes, public docs and pricing. |
| **Costs** | Free tiers only (§14); if a free ceiling is hit the feature degrades (§17) rather than spending money. Who pays beyond that is agreed before enabling. |
| **Duration and decision gate** | A fixed pilot window (suggested 8 weeks) ending in a continue / change / stop decision using the metrics in §22.2. |
| **Exit** | Any participant can leave at any time: the grant is revoked, their DMs and personal stickers are exported on request and deleted, friendships end. |
| **Sponsor visibility** | The business sponsor sees the pilot **roster** (who is enrolled) and the **aggregate metrics** — never messages, DMs, voice or lounge activity by person. |
| **Data use** | Only the categories listed in §22.2 and §22.9; anything new needs a new acknowledgement. |
| **Ownership / IP** | As agreed between the developer and the business; outside this plan. |

This replaces the earlier idea of an org-level "social features" switch for
now: with an opt-in pilot, the roster plus the kill switch does the same job. If
the feature ever becomes a product, the org-level switch (from the product
brainstorm) comes back.

### 22.2 Analytics: measure everything in the lounge, never the content

Every lounge and chat interaction produces an **event without content** in
`social_events (member_id, kind, ref, started_at, ended_at, meta)`:

| Family | Events / measures |
| --- | --- |
| Lounge | opens, duration, share of breaks that open it, time-to-open after a break starts, games played by type and mode, invites sent/accepted, buddy offers shown/accepted |
| Chat | messages per day per member (count only), rooms active, stickers/GIFs used (kind and pack, never content), reactions, reports filed |
| Attention | notification opt-outs, DND and quiet-hours use, mutes per room |
| Break behaviour | break length before vs. during the pilot, breaks per day, breaks that used the lounge, breaks that hit the limit, lounge budget exhausted |
| **Social minutes** | time with a private panel focused, split *working* (timer running) vs. *break* — shown to the member and, in aggregate, to the sponsor; **never** counted as active or idle |
| Pulse | response rates and score distributions (§22.9) |

- **Where it goes:** raw events are kept 90 days, then rolled up to daily
  aggregates. The controller sees per-cohort dashboards; **a member sees their
  own numbers** ("my lounge time this week"); a manager sees **team aggregates
  only when the team is at least 5 people**, so no one can be picked out.
- **What is never recorded:** message text, GIF titles, room or friend names in
  events, who played whom, what was said in voice.
- **Why:** the owner wants to use the numbers to improve the analysis and the
  product; the pilot's continue/stop decision rests on them.

### 22.3 Grant by cohort

The controller card (§4.1) gains **"Grant to a project team / to a friend group"**
in one confirmed action (still one OTP over the visible list), so a room isn't
empty on day one. A cohort grant records `source = cohort` and the project, and
adding a member to that project later does **not** silently enroll them — they get
an invitation to opt in.

### 22.4 Break policy and lounge eligibility

**Facts in the code today (verified):**
- The break limit is **per project**: `break_time_seconds` (default 600 s, 1 min –
  8 h) with a `disable_break_limit` switch; the agent enforces it in
  `agent/tracker/break_state.rs`, and **a break ends by itself at the limit —
  "Break ended — timer resumed"** (`tick_paused`).
- **Pause** and **private break** both stop the timer; a private break needs a
  reason and a length (clamped to the limit) and also blocks capture.
- `member_capture_settings` holds per-member overrides and the server-decided
  work window (`outsideWorkHours`, `recheckInSec`, `breakUntilMs`); **only
  management may change capture settings — the break is the member's own**
  (`mayAccessMemberCaptureSettings`).
- Capture during a **plain Pause** is not proven blocked by what I read (only
  private break sets `captureBlocked` on the server). The privacy shield (§21)
  protects the lounge either way; **verify** the plain-Pause behaviour.

**Three layers:**

| Layer | What it controls | Owner | Touches core tracker? |
| --- | --- | --- | --- |
| **L1 — existing** | How long a break may last (per project); Pause and private break | Management via the project | No |
| **L2 — lounge policy (new, in the pilot)** | *Whether* and *how much* someone may use the lounge, per member | Controller defaults; managers for their reports (same reach rule as capture settings) | **No** — stored in the lounge module (`feature_access_grants.settings`), enforced by the agent's lounge UI |
| **L3 — per-member break limit (optional, later)** | A member-specific break length and a daily total, overriding the project | Management | **Yes** — a new field on `member_capture_settings`, delivered through the existing scoring-settings poll, applied in `break_state.rs` (member override beats project). **[decided here — confirm]** Not in the pilot; needs the business's agreement |

**L2 settings** (all visible to the member under Settings → "Your lounge rules"):
`loungeAccess` = `breaks_only` (default) | `breaks_and_stopped` | `always` | `off`;
`dailyLoungeBudgetSec` (none by default); `offShiftAccess` (default on);
`buddy` (default on); `pulse` (default on, §22.9).

**Use cases — who can enter and what happens:**

| # | Situation | Timer | Lounge | Counts against | What ends it |
| --- | --- | --- | --- | --- | --- |
| 1 | **Plain Pause**, project limit on | stopped | **Open** | The break limit (L1) and the lounge budget | Limit reached → break ends, timer resumes, lounge closes |
| 2 | Plain Pause, project switch "no limit" | stopped | **Open** | Lounge budget only | The member, the 15-min nudge, or the budget |
| 3 | **Private break** (reason + minutes) | stopped, capture blocked | **Open** | Break limit (length clamped to it) | The chosen length, or the member |
| 4 | Break limit about to end | stopped | Open, with a **60-second warning** | — | Limit reached (no snooze — the limit is the organisation's) |
| 5 | **Stopped** (no session) during work hours | — | `breaks_and_stopped` / `always` only | Lounge budget | The member |
| 6 | **Outside the work window** (off shift) | — | **Open** if `offShiftAccess` | Nothing | The member |
| 7 | **Approved time-off day** | — | Same as off shift | Nothing | The member |
| 8 | Working, timer running | running | **Closed** (icon hidden); chat still available | — | — |
| 9 | Member whose `loungeAccess = off` | any | Icon hidden; chat unaffected | — | — |
| 10 | Two projects with different limits | — | Follows the project **being tracked** when the break began (existing behaviour) | That project's limit | — |
| 11 | Daily lounge budget used up | stopped | Icon disappears for the day; chat and the break itself continue | — | Next day |
| 12 | Shift with a **scheduled break/lunch window** (future) | stopped | Open inside the window | The window | Window end |
| 13 | Manager / owner | any | **Same rules as everyone** — no special access, no oversight of others' lounge | Same | Same |
| 14 | Idle detected by the system (not a break) | running | Closed; a **break card** may offer "Start a break?" (§22.7) | — | — |
| 15 | Break ends while a game/voice/arcade window is open | resumes | **Closes everything**; the game shows "opponent left" | — | — |
| 16 | Agent restart or reconnect mid-break | unchanged | Re-opens only if still on a break, within the remaining allowance | — | — |

**"Some can, some cannot":** a support desk can be `off` or `breaks_only` with a
short project limit; leads can be `always`. Changes are logged (who, when, what);
the member sees their own rules; nobody sees another member's lounge activity.

### 22.5 Notifications — a Telegram / WhatsApp feel that respects the shield

The chat window follows Telegram/WhatsApp conventions (bubbles, avatars, unread
divider, jump-to-latest, swipe/quick reply, pinned chats). Notification delivery
is a ladder:

| Situation | What appears |
| --- | --- |
| Chat window focused on that room | Nothing — the new message just arrives; unread badge on other rooms |
| App visible but unfocused | A **protected in-app toast** (small frameless always-on-top window, content-protected, non-focus-stealing) with avatar, name, a ≤ 72-character **preview**, and **Reply** / **Mute 1 h**; auto-dismisses after ~6 s |
| App minimized or in the tray | An **OS notification** (Windows toast via the installed notification plugin; the OS equivalent elsewhere) showing the **sender only**, plus a tray dot and the taskbar overlay badge |
| Do Not Disturb / quiet hours | Badge only, no toast, no sound (§22.6) |

Previews live in our own protected window because the OS toast is drawn by the
shell and can be captured in screenshots (§3.3). The OS notification is
deliberately sender-only. A subtle sound follows the system's own mute and the
member's DND. The OS's own Focus Assist / Do Not Disturb is honoured for free.

### 22.6 Do Not Disturb, quiet hours, and muting

| Control | Options |
| --- | --- |
| **Do Not Disturb (now)** | 30 min · 1 h · 2 h · until tomorrow · until I turn it off; a moon icon in the chat header |
| **Quiet hours (schedule)** | Per weekday windows, plus a one-tap **"Follow my work hours"** (quiet outside the server's work window, the same window the capture policy uses) |
| **Focus** | Optional: auto-DND while a task timer has been running for N minutes (off by default) |
| **Delivery level** | Always · Breaks and off-hours only · Badge only (no popups) |
| **Mute a room** | 1 h · 8 h · until tomorrow · forever; @mentions can still break through (toggle) |
| **Mute a member** | Stop notifications from that person everywhere (messages stay visible), or **hide** their messages in a room |
| **Mute all** | One switch |
| **Exceptions** | "Allow from…" starred friends and starred rooms during DND |
| **Presentation** | Preview on/off (in-app toast), sound on/off, badge on/off, per-room and global |
| **Share my quiet status** | Optional: friends see a 🌙 when DND is on |

DND and mutes are per member and stored in the member's preferences (local +
synced to the module so they follow the person to another device). They never
affect capture, break accounting or time.

### 22.7 All break types, the break card, and the 2-hour nudge

**Every break type opens the lounge** (subject to §22.4): plain Pause, private
break, and off-shift or time-off time. The existing 2-hour "Still going?"
notification becomes a **break card** — a small non-modal card near the title bar
or tray (also usable as a "big tooltip"):

```
┌───────────────────────────────────────────┐
│ 2 hours straight — time for a short break?│
│ [ Start break ] [ Open lounge ] [ Snooze ]│
└───────────────────────────────────────────┘
```

- **Start break** = the existing Pause. **Open lounge** = Pause, then apply the
  lounge layout (the work ↔ lounge switch of §20.5). **Snooze** 15/30 min.
- **Triggers:** the 2-hour nudge; a scheduled break window (future); a buddy
  offer (§22.8); long system-detected idle; and the 60-second "break ending"
  warning (which only informs — the limit is not snoozable).
- Respects DND (only the informational break-ending card ignores it).
- Auto-hides after ~20 s; keyboard reachable; carries a tooltip on every button
  (the existing guard test).

### 22.8 Break buddy

Only **mutual friends** who are **both on a break** and **both opted in**
("Open to a buddy" on the break card or in the lounge) are matched. The offer is a
break-card suggestion: "Sara is on a break too — 5-minute game? / quick chat?".
Declining is silent, has a cool-down, and reveals nothing. The "open to a buddy"
flag is the *only* break-related signal friends ever see, and only when the
member turns it on (§13.4 otherwise stays true).

### 22.9 Pulse: meaningful questions, and what the answers may be used for

Two different things, kept apart (the split is the design; the visibility rule
below was **decided by the owner on 2026-09-27**):

| | Daily question / trivia | **Weekly Pulse** |
| --- | --- | --- |
| Purpose | Fun; a reason to open the lounge | A short wellbeing and workload check |
| Content | Trivia (§14.4), light prompts | 3 questions: energy (1–5), workload (light / fine / heavy), and an optional "anything blocking you?" |
| Frequency | At most one a day, skippable | At most one a week, skippable with no penalty |
| Data use | **Aggregate popularity only; never analysed per person** | Below |

**How Pulse data may be used:**
1. **The member sees their own trend first** (energy and workload over weeks,
   alongside their own break and long-session patterns).
2. **Who sees an individual's answers (decided): the member and their
   managers** — the members' direct management chain, by the same reach rule the
   capture settings use. Nobody else sees individual answers; **anyone outside
   that chain (the sponsor, the controller, other managers) sees team-level
   aggregates only, and only when the team is ≥ 5 people.** Because this is
   health-adjacent and visible to a manager, the safeguards are part of the
   design: (a) every Pulse screen says **"Your manager will see this answer"**
   *before* it is answered; (b) the free-text field is optional and labelled the
   same way; (c) skipping a week is free and invisible; (d) the answers are
   never used for evaluation (item 4); (e) consent is versioned (§23.3).
   *Option for the owner to consider:* an "answer privately (aggregate only)"
   choice per response would likely improve honesty; not adopted unless asked.
3. The system produces **recommendations, never automatic changes**. Examples:
   "workload heavy three weeks running — suggest a capacity review", "long
   sessions without breaks — suggest scheduled breaks", "your most focused hours
   look like 9–12 — suggest protecting them". A member's recommendation can
   **pre-fill a request to lower collection** (§22.12); a manager decides.
4. **Never used for** evaluation, ranking, discipline, pay, or to change what is
   captured on its own. Written into the pilot charter (§22.1).
5. Pulse needs its **own acknowledgement**, separate from the monitoring notice:
   the monitoring-notice hash is a consent trigger for every member (changing what
   it covers forces everyone to re-acknowledge), so Pulse must not be folded into
   it. Turning Pulse off deletes the member's answers.

Why the split: trivia answers say nothing about productivity, and analysing them
per person would erode trust in the lounge; a short explicit Pulse is meaningful
and consented.

### 22.10 Task and project link cards; the work ↔ lounge switch

- Typing `#` in the composer searches **tasks and projects the member can
  access**; pasting a task link works too. The message stores only the **id**; the
  card is resolved **per viewer** at render time (title, project, status, assignee)
  and shows "a task you can't access" to anyone without reach — so a card can
  never leak a task title.
- Card actions: **Open in tracker** (jumps to it in the main window) and, for the
  member's own assigned tasks, **Start timer** (with a confirmation).
- A `game_link` / `voice_link` / break-card action can trigger the **work ↔ lounge
  switch** (§20.5) even when the member wants only a brief look: the card can
  open the lounge as a **compact overlay** first ("peek") and expand to the full
  lounge on demand.

### 22.11 Sticker libraries — presets, personal, saved GIFs

Tray tabs: **Recent · Favourites · My stickers · Packs · GIFs**.

- **Preset packs:** curated by the controller (§14.3), each with its licence
  credit.
- **My stickers (per person):**
  - **Upload** PNG / WebP / GIF, cropped to 512 × 512, ≤ 512 KB, animated ≤ ~3 s,
    up to 300 per member; validated and re-encoded server-side, EXIF stripped.
    (The agent's `image` dependency currently ships JPEG only, so PNG/WebP
    support must be enabled or done server-side.)
  - **Save from a message:** "Add to my stickers" on any sticker or image sent to
    the member (copies the reference; identical bytes are stored once).
  - **Save a GIF as a sticker (decided 2026-09-27: yes, like WhatsApp).** Two
    paths behind one switch, `GIF_SAVE_AS_STICKER_BYTES`:
    1. **Today, until the provider says yes: a favourite reference** (provider id
       and URL) that appears in the sticker tray and works everywhere a sticker
       does. If the provider drops the GIF, the tray shows the titled
       placeholder.
    2. **Once Klipy confirms in writing: "Save as sticker" copies the file** into
       the member's library (re-encoded, capped, deduplicated by hash), so it
       survives the provider and can be sent like any personal sticker.
    **Why WhatsApp can and we can't yet:** it is a large partner with commercial
    agreements that cover storing and re-serving GIFs; a provider's terms decide
    this, not the technology (GIPHY, for instance, requires written approval
    before caching media). Klipy's docs are **silent**, and silence is treated as
    "not yet allowed". **Send Klipy one email now** asking: (1) may our server
    proxy search calls, (2) may results be cached, (3) may media a user saves be
    stored and transcoded, (4) may it be re-served to other users inside private
    chats, (5) what attribution applies to saved stickers. Members can always
    upload files they own.
- **Klipy stickers:** the provider's sticker endpoint appears as its own search,
  next to GIF search.
- **Ownership and safety:** personal stickers are visible only where sent; a
  member can only send what they own or saved; reports (§3.4) cover them; a
  removed member's stickers are deleted with their data.
- **Storage:** Postgres bytea with an auth-gated GET, the same pattern as
  screenshots (§5), plus a per-member quota.

### 22.12 "What was collected about me" and asking for less

**The receipt.** The tracker already has `getMyCaptureSummary` (today's
screenshots, app events, apps, domains, active seconds). The Privacy panel grows a
**Collection** view: last 7 / 30 days by day, **what was collected** (counts by
category), **what was never collected** (breaks, private breaks, outside work
hours, private chat panels, the member's own exclusions), who can see each
category, and the retention period.

**Asking for less (a governed request, not a self-service toggle).** Capture
settings are deliberately management's to change (`setMemberCaptureSettings` is
management-only), so this is a request flow on top:

1. The member opens **Request a change**: picks the category (screenshot
   cadence, default blur, URL/domain capture, app-name detail, a specific
   exclusion), the value they want, and a reason.
2. The app **auto-attaches evidence** from the receipt (counts, the days
   concerned) and lets the member **flag individual screenshots** as "shouldn't
   exist".
3. The request goes to the member's **manager chain** (the existing hierarchy,
   using the same reach rule as capture settings). The manager **approves,
   approves in part, or denies with a reason**. An unanswered request escalates
   after a set time (suggest 5 working days) to the next level.
4. **Approval applies the change through the existing `setMemberCaptureSettings`**
   with the manager as the actor — so the audit trail (`updated_by`) already
   exists — and notifies the member.
5. **"Proven excess" is objective where it can be:** a screenshot taken during a
   recorded break or outside the work window, or cadence above the
   organisation's own maximum, is **automatically upheld** (the screenshot is
   removed and the cause raised as a bug). Everything else is a manager's
   judgement.
6. **Floors:** an organisation can set a minimum collection level below which
   requests cannot go (compliance); the request form shows it.
7. Tables: `capture_change_requests` (member, field, current, requested, reason,
   evidence JSON, status, decided_by, decision_note, sla_due_at, decided_at) and
   `capture_flagged_items`. Reducing collection does **not** change the monitoring
   notice's capability hash, so it does not force anyone to re-consent.

This flow is a **core-tracker feature**, independent of the social layer; it is
listed here because the pilot depends on trust. It needs the business's approval
like any core change.

### 22.13 Standup helper — share your own numbers, on your terms

- **Generate a card** from the member's own data: yesterday's tracked time by
  project and task, tasks completed, optional note. Never apps, URLs or
  screenshots unless the member ticks them.
- **Preview, then choose where it goes:** post to a project room or DM (a normal
  message card, readable only by that room's members), or **Submit to manager** —
  a dashboard record for their manager(s) within reach, separate from chat.
- **Management access:** managers can already see these figures in the reports
  they have reach for; the card adds nothing they couldn't see, it just lets the
  member volunteer context. Nothing here gives owners access to chat.
- Cards are **immutable snapshots** with a timestamp; the member can delete their
  own posted card, and a submitted standup follows the report retention rules.

### 22.14 Phasing, dependencies, resource budget, open questions

| Track | Work | Depends on | Size |
| --- | --- | --- | --- |
| **P — Pilot charter** | Charter, enrolment/notice, roster, exit/erasure | Phase 0 | S |
| **N — Notifications** | Delivery ladder, protected toast window, DND/quiet hours/muting | Phase 1, shield (§21) | M |
| **B — Break policy & card** | L2 lounge policy, break card, 2-hour nudge upgrade, break-ending warning, use-case tests | Phase 3 (lounge) | M |
| **S — Stickers** | Personal libraries, saved GIFs, Klipy stickers | Phase 1 (rooms), then Phase 4 | M |
| **T — Task cards & standup** | `#` cards, standup helper | Phase 1 | M |
| **A — Analytics** | `social_events`, roll-ups, three dashboards | Phase 1 | M |
| **R — Pulse** | Question, consent, trend view, recommendations | A, Phase 3 | M |
| **C — Collection receipt & requests** | Receipt, request flow, auto-upheld cases | Core approval | L |
| **L3 — Per-member break override** | Optional core change | Business approval | M |

**Resource budget (no harm to the business):** with social features enabled the
agent may add at most ~30 MB RAM and ~0 % CPU when idle; with them **off** it adds
nothing (modules unloaded); the emoji picker data and sticker caches load lazily.
A "Social off" switch in Settings unloads everything at once.

**Open questions (defaults given):**

| # | Question | Default |
| --- | --- | --- |
| Q22 | Who sees an individual's Pulse answers? | **Decided: the member and their managers.** Everyone else sees aggregates for teams ≥ 5 only (§22.9) |
| Q23 | Do per-member break limits (L3) belong in the pilot? | No — pilot uses L1 + L2 only |
| Q24 | Who approves collection-change requests, and after how long does it escalate? | Direct manager; escalate after 5 working days |
| Q25 | May a saved GIF be stored as bytes? | **Decided: yes, like WhatsApp — once Klipy confirms in writing;** until then a favourite reference, switch `GIF_SAVE_AS_STICKER_BYTES` off (§22.11) |
| Q26 | Does plain Pause block capture today? | **Resolved 2026-09-27 — yes, but by a different mechanism than private break; §23.5 H18 has the full trace and a UI gap it surfaces.** |
| Q27 | Pilot length and the metrics that decide continue / change / stop | 8 weeks; adoption (weekly active grantees), lounge share of breaks, break length vs. baseline, Pulse response rate, "would you miss it?" |

---

## 23. Consistency audit (2026-09-27)

**Method.** The whole plan was read section by section; every claim was checked
against the other sections and against the code facts recorded above.

### 23.1 Verdict

The **core chain is connected**: grant → agent proof → room membership → shield →
notifications → analytics. Every hop has a named owner, a test and a failure
mode. The holes are at the **seams**, in two places:

1. Sections written later (§16–§22) added features without updating the
   reference sections (§5 data model, §6 endpoints, §12 roles, §14.7 config).
   §24 is now the single consolidated reference.
2. The new **manager-facing** features (Pulse visibility, standups, lounge
   policy, collection requests) need the management hierarchy — which the
   original design **forbids** the chat module to touch. That is a real design
   conflict, resolved in H1.

### 23.2 Contradictions found and fixed in place

| # | Contradiction | Fix (already applied) |
| --- | --- | --- |
| C1 | Decision 3, §3.2, §9, §19.2 said the lounge icon exists *only on a break*; §22.4 lets policy widen it to stopped/off-shift/time-off | Decision 3 now says "lounge-eligible state", §22.4 is the single source of truth; §9 and §19.2 updated |
| C2 | §3.2 said the server never learns about breaks/lounge; §22.2 analytics needs lounge events | §3.2 now states the server records lounge open/close and joins them to the pause/resume intervals it already stores |
| C3 | "Body-less toast" in §13.4, §19.2, §20.5, §21.7 and Phase 1 vs. §22.5 (sender-only OS toast + protected in-app preview) | All rewritten to the §22.5 ladder |
| C4 | The protected toast window was not on the shield's window list (§21.4) | Added, with the Pulse, standup and collection-request panels |
| C5 | GIF bytes "never stored" (§3.1, §7) vs. the owner's decision to save GIFs as stickers | §3.1/§7/§22.11 reconciled: reference now, bytes once Klipy permits, behind `GIF_SAVE_AS_STICKER_BYTES` |
| C6 | Pulse individual answers "only if the member shares" (§22.9) vs. the owner's decision | §22.9 now: visible to the member and their managers, with the safeguards listed there |

### 23.3 Holes found — and how each is closed

| # | Hole | Resolution |
| --- | --- | --- |
| **H1** | The boundary test forbids `chat-lounge` from importing hierarchy helpers (§9), but Pulse, standups, lounge policy and collection requests are *defined by* management reach | **Two modules.** `chat-lounge` (chat, friends, lounge, arcade, voice, stickers, notifications, analytics ingestion) keeps the no-hierarchy rule. `wellbeing-policy` (Pulse, standups, lounge policy, collection requests) is the **only** module allowed to use the reach helpers (`mayAccessMemberCaptureSettings` / `getVisibleMemberIds` style), and never touches chat tables |
| **H2** | Managers need screens, but Q3 says the dashboard has no social surface | Unchanged for **chat, lounge and friends** (agent only). The **manager screens** live in the web dashboard, dormant behind flags in one folder: *Wellbeing* (Pulse per report + team aggregates), *Standups*, *Lounge rules* editor, *Collection requests* inbox, and the *Sponsor* view. They ship dormant like everything else (§22.1) |
| **H3** | Consent is scattered: a first-run notice (§4.3), Pulse consent, arcade acknowledgements, third-party voice | One table, `feature_access_consents (member_id, kind, version, acked_at, withdrawn_at)`; kinds `social_notice`, `pulse`, `voice_third_party`, `arcade:<gameId>`. The monitoring-notice hash is **not** touched (changing it forces everyone to re-consent) |
| **H4** | "Member does nothing" (Route 1) vs. "opt-in" (pilot) | An **enrolment state machine**: *Granted* → *Invited* (notice shown) → **Active** (acknowledged) → *Suspended* (kill switch/revoke) → *Left*. A grant alone gives nothing; only **Active** members appear in rooms |
| **H5** | No offboarding rule | Table below (§23.4): what happens to each data type when a member leaves the pilot, is archived, or is removed from a project |
| **H6** | Erasure vs. backups: a restored database resurrects deleted messages | An append-only `erasure_log`; **after any restore, replay it** before the feature is re-enabled; backup retention stated in the notice |
| **H7** | Tenancy: general read isolation is not enforced yet | **Pilot is restricted to one tenant** (`SOCIAL_PILOT_TENANT_IDS`). No customer tenant is enabled until the isolation verifier (a live probe) covers every new table (§24.2) |
| **H8** | Phase 0 (OTP, email templates, invite codes) is heavy for a small pilot | **Phase 0-lite (recommended first):** an env allowlist `SOCIAL_PILOT_MEMBER_IDS` plus a controller-only CLI/route to add and remove members, agent proof, kill switches, consent ledger. The OTP challenge and invite codes follow when the pilot proves worthwhile |
| **H9** | Non-Windows agents would receive capabilities they can't honour | Agent sends `X-Agent-OS`; `capabilities.social` is false unless OS is Windows (§24.4) |
| **H10** | Release engineering unspecified | Rides a normal agent release under the update contract (readiness probe, frozen agents, both NSIS and MSI feeds); bump `CHAT_LOUNGE_MIN_AGENT_VERSION`; nothing in the installers changes |
| **H11** | **Elevation.** Per your notes the agent runs elevated (`requireAdministrator`). Windows blocks **drag-and-drop from a non-elevated Explorer into an elevated window** | Sticker upload and image attach must use **file picker and clipboard paste**, not drag-and-drop; **verify** paste behaviour and toast click-activation from an elevated process |
| **H12** | DND schedules need a timezone, but the design rule is "no agent-side timezone dependency" | Follow the capture-policy pattern: the **server** computes `quietNow` and `recheckInSec` from the member's timezone and the work window; the agent obeys the boolean |
| **H13** | The repo's guard tests: every button needs a tip, every input a `data-help`, plus a guided tour | Every new control ships with tip/help text; the **Social** group and lounge get tour steps; the tests are in each phase's gate |
| **H14** | "Sponsor" appears in the charter but has no identity or screen | Sponsor = the tenant **Owner** (or a named member in pilot config), read-only: roster + aggregates (§22.2), no rooms, no individual data |
| **H15** | Analytics events are agent-reported and spoofable | Accepted for a pilot (they are informational, never enforcement); rate-limited, size-capped, proof-required; roll-ups scheduled and pinged to a cron monitor if adopted |
| **H16** | New endpoints and tables were never listed together | §24 consolidates roles, tables, endpoints, the capabilities payload and config |
| **H17** | Test plan (§9) covers §3–§15 but not §16–§22 | Coverage list in §23.6 |
| **H18** | Plain Pause and screenshots (Q26) — **resolved by tracing the code** | See §23.5's write-up: capture is blocked, but through the tick-loop branch, not the capture gate — and that gap has a small user-facing consequence, now fixed in the design |

### 23.4 Offboarding and erasure rules (H5)

| Data | Member leaves the pilot | Member archived / removed from the company | Removed from one project |
| --- | --- | --- | --- |
| Grant / enrolment | Revoked; consents withdrawn | Revoked automatically | Unchanged |
| Project-room messages | Remain, shown as **"Former member"**, until retention (180 days) | Same | Their access to that room ends; history unreadable to them |
| DMs | Deleted for both sides after **30 days** (the other party can export first) | Same | Unchanged |
| Friendships, friend code, blocks | Deleted | Deleted | Unchanged |
| Personal stickers, saved GIFs, prefs | Deleted | Deleted | Unchanged |
| Pulse answers | **Deleted** (the member's data) | Deleted; team aggregates already rolled up stay | Unchanged |
| Submitted standups | Follow report retention | Same | Unchanged |
| Analytics events | Identifiers dropped at roll-up | Same | Unchanged |
| Chat reports | Kept until handled + 90 days | Same | Unchanged |
| Grant audit | Kept (real actor IDs) | Kept | Unchanged |
| Erasure ledger | Entry written | Entry written | — |

### 23.5 Verification backlog — resolved 2026-09-27, and what's left

Six of the ten items were run down today, three against the real code and one
against a live capture. Two genuinely need a built Tauri binary to finish, and
those are called out as the Phase 1 gate they already were.

**Resolved**

1. **Does a plain Pause block screenshots? Yes — traced in the actual Rust,
   not inferred.** `pause()` ([agent/tracker/mod.rs:268](Tauri-App-Extension/src-tauri/src/agent/tracker/mod.rs:268)) sets `self.paused` and
   starts the break-limit timer (`self.breaks.begin()`), but **never touches the
   capture gate** (`self.events.gate.set_break(...)`). That call exists only on
   the **private-break** path (`run_break`, wired solely from
   [commands/insights.rs](Tauri-App-Extension/src-tauri/src/commands/insights.rs) → `set_private_break`
   ([agent/controller/api.rs:28](Tauri-App-Extension/src-tauri/src/agent/controller/api.rs:28))). What actually stops screenshots on a
   plain Pause is the **tick loop's branch**: `tick()` diverts to `tick_paused()`
   whenever `self.paused` is true ([tick.rs:195](Tauri-App-Extension/src-tauri/src/agent/tracker/tick.rs:195)), and `tick_paused` has **no call to
   `upload_screenshot`** anywhere in it — screenshots only happen in `tick()`'s
   active branch and in `tick_offline`. So capture *is* blocked on a plain
   Pause, by omission rather than by the gate.
   - **The consequence this surfaces (now fixed in the design):**
     `capture_status()` ([agent/controller/api.rs:81](Tauri-App-Extension/src-tauri/src/agent/controller/api.rs:81)) reports `gate.state()`, and
     during a plain Pause that state is `CaptureBlock::Allowed` (private break
     and outside-hours are the only two `OnBreak`/`OutsideWorkHours` states) —
     so the member's own capture-status UI can say "capturing is allowed"
     while nothing is actually being captured. Harmless to privacy (less is
     captured, not more) but confusing, and it is exactly the kind of gap that
     erodes the trust this whole feature depends on (§10, the culture argument).
     **Fix, in scope for whichever phase touches `CaptureGate` next, independent
     of the social plan:** add `CaptureBlock::Paused` alongside `OnBreak`, set it
     from `pause()`/`resume()` the same way `run_break` sets `OnBreak`, and give
     it its own message ("On a break — nothing is being captured"). This also
     means the L2 lounge-eligibility check (§22.4) can read one gate state
     instead of reasoning about `self.paused` and the capture gate separately.
2. **`set_content_protected` / `WDA_EXCLUDEFROMCAPTURE` mechanism — reconfirmed
   today, and one new caveat found.** `tauri::WebviewWindow::set_content_protected`
   ([tauri-2.11.5/src/webview/webview_window.rs:2227](https://docs.rs/tauri/2.11.5/tauri/webview/struct.WebviewWindow.html)) calls straight through to
   tao's `SetWindowDisplayAffinity(..., WDA_EXCLUDEFROMCAPTURE)`
   (present in both tao 0.35 and 0.37, which is what's in `Cargo.lock`) — the
   exact API the 2026-09-26 same-process test exercised directly. Today's attempt
   to protect a **different, unrelated process's** window (a standalone Edge
   window from a script) returned `ERROR_ACCESS_DENIED` even with matching user
   session and no elevation on either side — a real Windows restriction on
   affecting a window you don't own from outside it. **This does not weaken the
   plan**, because production code always calls `set_content_protected` on a
   window **the Tauri app itself created**, i.e. always same-process, exactly
   like the 2026-09-26 test that succeeded — but it is worth recording as the
   reason a "protect someone else's window" idea would never have worked anyway,
   and as one more reason pop-out panel windows (§20.6) must be created by our
   own Rust, not adopted from elsewhere.
3. **`GetWindowDisplayAffinity` for the capture-time watchdog (§21.4, layer 2)
   — confirmed available and working**, same-process: after
   `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`, `GetWindowDisplayAffinity`
   read back `0x11` correctly in the 2026-09-26 run. The watchdog design stands
   as written.
4. **WebView2 permission handling — confirmed at the library level, and it is
   exactly the per-window hook §16.2/§17.4 assumed.** `wry` exposes
   `WebViewBuilder::with_permission_handler(Fn(PermissionKind) -> PermissionResponse)`,
   documented as "Fully supported via WebView2's PermissionRequested event" on
   Windows (also native support on macOS/Linux/Android). This is a **per-webview**
   builder option, which matches the plan directly: the voice window's builder
   allows `Microphone`, and the main/arcade window builders return `Deny` (or
   `Default`, i.e. Chromium's own prompt, which must not be used since it would
   ask the member and possibly leak into the arcade window's own UI) for
   everything. Tauri's `WebviewWindowBuilder` needs to expose this wry option if
   it doesn't already — **check the installed Tauri 2.11.5 surface for it** as the
   one remaining Phase-8/16 task here; the underlying mechanism is no longer in
   question.
5. **JaaS JWT shape — confirmed from 8x8's own docs**, resolving what was an
   unknown: header `alg`/`kid`/`typ`; payload `aud: "jitsi"`, `iss` (the
   configured app identity — 8x8 docs example is illustrative, confirm the exact
   string against the tenant's own app), `sub` (App ID), `room`, `exp`, `nbf`;
   `context.user` (`id`, `name`, `avatar`, `email`, `moderator`); and, critically,
   `context.features.recording` — **the flag §17.3 needs to force off**, plus
   `livestreaming`, `transcription`, `outbound-call`, `hidden-from-recorder`.
   §17.3's "verify the exact claim names against JaaS docs" is done; only minting
   the token with a real JaaS App ID/key remains, which needs the account.
6. **Frameless-window resize handles — the plugin ecosystem answer, not a gap.**
   [tauri-plugin-decorum](https://github.com/clearlysid/tauri-plugin-decorum) and its
   maintained continuation add exactly what W1 needs on Windows: **native Windows
   11 Snap Layout on a custom maximize button** (a small child HWND overlay
   answering `WM_NCHITTEST` with `HTMAXBUTTON`) plus resize-edge handling for a
   `decorations: false` window. **Decision: adopt it (or its approach) for W1**
   rather than hand-rolling hit-testing, closing the Snap-flyout risk noted in
   §20.9 outright instead of accepting the loss.

**Still open — need a built Tauri binary or an external account, not more reading**

| Item | Why it can't be closed from source alone | Blocks |
| --- | --- | --- |
| The exclusion check on the **real Tauri/WebView2 window** (including the protected toast window) | Needs the actual app compiled and running; today's tests used a WinForms window and a standalone Edge window as stand-ins for the *mechanism*, which is now proven — only the wiring into the real window remains | Phase 1 gate (unchanged) |
| Klipy's written answers (proxy, cache, store, re-serve, attribution) | Needs their support team to reply | Phase 4 gate (unchanged) |
| **Elevated agent**: paste, toast click-activation, drag-drop into an elevated window | Needs the installed elevated agent to test against; H11's mitigation (file picker + paste, not drag-drop) already assumes the worst case | Phase 1 (stickers/notifications) |
| macOS content-protection with newer capture APIs; Windows Recall exclusion | Needs those OS/hardware targets | Non-Windows chat; disclosure accuracy |
| Datamuse requires an API key from 2027-01-01 | A calendar fact, not a technical unknown — just needs doing before that date | Word games, whenever they ship |

### 23.6 Test coverage still to write for §16–§22

Arcade (isolation, allowlists, consents); voice (token scoping, mic policy per
window); notifications (ladder, protected toast content-protected and
non-focus-stealing, DND/quiet-hours/mutes, server-driven `quietNow`); personal
stickers (quotas, validation, dedupe, erasure); collection requests (state
machine, escalation, auto-upheld cases, manager reach, audit); Pulse (consent
versioning, who-sees-what matrix, aggregate threshold, deletion on withdrawal);
standups (snapshot immutability, reach); lounge policy (every row of §22.4 as a
table-driven test); analytics (no content, roll-up, k ≥ 5 threshold); enrolment
state machine; offboarding table (§23.4); erasure replay after restore;
resource budget (memory ceiling with social on, zero with it off).

### 23.7 Dependencies and the critical path

```
Tenancy isolation verifier ─┐
Controller gate (Phase 0-lite) ──┬─► Chat core (P1) ─► Friends (P2) ─► Lounge (P3) ─► Break policy/card (B)
Agent proof ─────────────────────┘        │                              │
Shield (§21) ─► Protected toast ─► Notifications (N) ◄──────────────────────┘
W1 (resize) ─► W2 (panels) ─► chat as a panel
Analytics (A) ─► Pulse (R) ─► needs wellbeing-policy + manager screens (H1, H2)
Core approval ─► Collection receipt & requests (C), L3 per-member break limit
Klipy answers ─► GIF proxy, save-as-sticker bytes
```

The **critical path** is unglamorous: tenancy isolation → controller gate → agent
proof → chat core with the shield. Everything social sits on those four.

---

## 24. Consolidated reference (single source of truth)

### 24.1 Roles and permissions (replaces §12 where they differ)

| Role | Derived from | Notes |
| --- | --- | --- |
| Controller | Enrolled UID/member/email | One person; grants, codes, catalog, sticker packs, reports, kill switches |
| Sponsor | Tenant Owner (or named member) | Read-only: roster and aggregates; no rooms, no individual data |
| **Manager (reach)** | The management hierarchy for a specific member | Sees a report's **Pulse answers, submitted standups, lounge rules, collection requests**; **never** chat, DMs or lounge activity unless a room member |
| Grantee / Active member | Grant + consent | Required for social features |
| Agent client | Valid agent proof | Precondition for chat-lounge routes; **not** required for the dashboard manager screens |
| Room member, Author, Friend, Blocker/Blocked, Lounge host/player, Reporter, System, Outsider | As §12.1 | Unchanged |

| Action | Controller | Sponsor | Manager (reach) | Active member | Outsider |
| --- | --- | --- | --- | --- | --- |
| Read a room / DM | only if a member | — | only if a member | ✓ (own rooms) | — |
| See who is enrolled | ✓ | ✓ | own reports | own status | — |
| See aggregate social metrics | ✓ | ✓ | team ≥ 5 | own numbers | — |
| See an individual's **Pulse answers** | — | — | **✓ (their reports)** | own | — |
| See **team Pulse aggregates** | ✓ | ✓ | ✓ (team ≥ 5) | own trend | — |
| Read submitted **standups** | — | — | ✓ (their reports) | own | — |
| Set a member's **lounge rules** | defaults | — | ✓ (their reports) | sees own | — |
| Decide a **collection-change request** | — | — | ✓ (their reports) | files & tracks own | — |
| Flag a screenshot as excess | — | — | — | ✓ (own) | — |
| Grant / revoke / mint | ✓ | — | — | — | — |

### 24.2 Tables by module (all new tables join the tenancy probe)

| Module | Tables |
| --- | --- |
| **chat-lounge** | `feature_access_grants`, `feature_access_challenges`, `feature_access_invites`, `feature_access_attempts`, `feature_access_audit`, **`feature_access_consents`**, `chat_rooms`, `chat_messages` (kinds: text, sticker, gif, image, game_link, voice_link, **task_card**, **standup_card**), `chat_reactions`, `chat_reads`, `chat_reports`, `chat_sticker_packs`, `chat_stickers`, **`chat_user_stickers`**, **`chat_prefs`**, **`chat_room_prefs`**, **`chat_member_mutes`**, `chat_attachments`, `member_friendships`, `member_blocks`, `member_friend_codes`, `friend_hidden_presence`, **`arcade_games`**, **`arcade_acks`**, **`voice_rooms`**, **`social_events`**, **`social_rollups`**, **`erasure_log`** |
| **wellbeing-policy** | **`lounge_policy`**, **`pulse_responses`** (question bank ships as static config), **`standups`**, **`capture_change_requests`**, **`capture_flagged_items`** |
| **Core, read/used only** | `member_capture_settings` (written by an approved request through `setMemberCaptureSettings`), `project_members`, existing notification tables, `agent_devices` |

### 24.3 Endpoint groups

| Group | Base path | Agent proof | Who |
| --- | --- | --- | --- |
| Agent proof | `POST /api/activity/agent/proof` | — (uses device secret) | agent |
| Feature access | `/api/feature-access/…` (+ `/redeem`) | for redeem only | controller / member |
| Chat, stickers, prefs | `/api/chat/…` | **yes** | active members |
| Friends (list, search, requests) | `/api/friends/…` (§25.5) | **yes** | active members |
| Lounge, arcade, voice | WS types + `/api/arcade/…`, `/api/voice/…` | **yes** | active members |
| Analytics ingest | `POST /api/social/events` | **yes** | agent |
| Pulse & standups (member) | `/api/wellbeing/pulse`, `/api/wellbeing/standups` | **yes** | active members |
| Wellbeing (manager/sponsor) | `/api/wellbeing/reports/…` | **no** (dashboard) | managers, sponsor |
| Lounge rules | `/api/wellbeing/lounge-policy/…` | no (manager) / yes (member read) | managers, member |
| Collection receipt & requests | `/api/privacy/collection/…` | member: either client; decide: manager | member, managers |

### 24.4 The one capabilities payload

```
capabilities: {
  canLogManualTime,                         // existing
  social: {
    v: 1,
    projectChat, friends, lounge, arcade, voice, pulse, standup,   // grant ∧ kill switch ∧ min-version ∧ Windows
    policy: { loungeAccess, dailyLoungeBudgetSec, offShiftAccess, buddy },
    quiet: { now: bool, recheckInSec },     // server-computed (H12)
    consentsNeeded: ["social_notice", "pulse", ...]
  }
}
```

Returned only when the request carries `X-Agent-Version` ≥
`CHAT_LOUNGE_MIN_AGENT_VERSION` **and** `X-Agent-OS` is Windows; otherwise
`social` is absent.

### 24.5 Configuration and kill switches (server-only)

`SOCIAL_PILOT_TENANT_IDS`, `SOCIAL_PILOT_MEMBER_IDS` (Phase 0-lite),
`AGENT_PROOF_SECRET`, `CHAT_LOUNGE_MIN_AGENT_VERSION`, `PROJECT_CHAT_ENABLED`,
`LOUNGE_ENABLED`, `FRIENDS_ENABLED`, `ARCADE_ENABLED`, `VOICE_ENABLED`,
`PULSE_ENABLED`, `STANDUP_ENABLED`, `COLLECTION_REQUESTS_ENABLED`,
`CHAT_RETENTION_DAYS` (180), `SOCIAL_EVENTS_RETENTION_DAYS` (90),
`LOUNGE_NUDGE_MINUTES` (15), `GIF_RATING` (g), `KLIPY_API_KEY`,
`GIF_SAVE_AS_STICKER_BYTES` (off), `JAAS_APP_ID` / `JAAS_KEY_ID` /
`JAAS_PRIVATE_KEY`, `CONTROLLER_ALERT_WEBHOOK` (optional). All default **off**.

### 24.6 Consent kinds

`social_notice` (what is private, retention, operators can read, reports),
`pulse` (who sees answers, what they are used for), `voice_third_party`,
`arcade:<gameId>`. Each is versioned; a new version re-prompts only that kind.

---

## 25. Friends — the complete design (discovery, search, list, requests)

Written because a friends feature with no way to find anyone and no search is
not a feature — it's a settings screen nobody opens. This section replaces
§13.1's discovery rule and §13.5's UI sketch with a working design, and is
explicit about the one real trade-off it makes.

### 25.1 The trade-off, made explicitly

The original rule — "no member search, no directory" — was written to stop
Virtual Tracker from becoming a company-wide people-finder layered on top of a
monitoring tool: a global search box that lets anyone type a name and learn
where someone works is a real privacy regression, independent of chat.

**The fix keeps that boundary but moves it to where it should be**, in place of
removing it:

> **A member can search and browse only the people they already share a
> project with** (their own `project_members` rows) — never anyone outside
> that set, and never a cross-tenant or company-wide list.

This is not a smaller version of a directory; it's the same set of people the
member's tracker sidebar and project chat already show them by name every day.
Nothing new becomes visible — the feature now just lets them **act** on names
they can already see, instead of typing a friend code by hand. Cross-project
and cross-tenant discovery stays exactly as closed as before.

### 25.2 Discovery paths

| Path | Scope | How |
| --- | --- | --- |
| **1. Colleague search (new)** | Everyone in a project the member is entitled in | A search box (§25.4) over the member's own `project_members` rows, grouped by project, filtered by name as they type |
| **2. Shared project room** | Same set, reached from inside a room | "Add friend" on a name in a room's member list (unchanged from §13.1) |
| **3. Friend code** | Anyone, but only if they hand you the code out of band | Unchanged from §13.1 — the only path that can ever cross projects, because the other person actively chose to share it |

No path ever lists someone the searcher shares **no** project with, and no path
ever exposes another tenant. `GET /api/friends/search` therefore is not "search
all members" — it is "search the union of members across the caller's own
`project_members` rows", computed server-side from the caller's identity, never
from a client-supplied scope.

### 25.3 Data needed (no new tables beyond §13/§24)

Search reads `project_members` joined to the member table — already the exact
join the boundary test in §9/§23 requires everything here to go through. No new
storage: friendship state is still `member_friendships`/`member_blocks`/
`member_friend_codes` from §5/§24.2. One addition: `member_friendships` gains
`source` (`colleague_search` / `shared_room` / `friend_code`) purely for the
audit trail — never shown to either party, only usable by the controller if a
report is filed.

### 25.4 The Friends screen — full UI

```
┌ title bar ───────────────────────────────────────────────────────────────────┐
│ ◂ Back   Friends                     [ All ▾ ] [ Online ] [ Requests ② ]     │
├──────────────────────────────────────────────────────────────────────────────┤
│ 🔍 Search your colleagues or friends…                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│ FRIENDS — 7                                                                  │
│  ● Sara Ali        Atlas · in the lounge          [ 💬 ] [ 🎮 ] [ ⋯ ]        │
│  ● Omar Nasser     Atlas, Nimbus · online         [ 💬 ] [ 🎮 ] [ ⋯ ]        │
│  ○ Lina Hosny      Nimbus · offline               [ 💬 ]        [ ⋯ ]        │
│  … 4 more                                                                    │
│                                                                              │
│ PEOPLE YOU WORK WITH — 12          (colleagues who aren't friends yet)       │
│  Mona Adel         Atlas                                    [ + Add friend ]│
│  Karim Fathy       Nimbus                                   [ + Add friend ]│
│  … 10 more, or keep typing to search                                        │
│                                                                              │
│ Add by code:  [ ____-____ ]  [ Send request ]      My code: K7Q2-9X  ⟳      │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Search box behaviour.** Typing filters **both** sections live: *Friends* by
name, and *People you work with* by name across every project the member is
in — the same colleague set §25.2 defines, never wider. Empty query shows
friends first, then a capped, alphabetically sorted slice of colleagues (say
50) with "keep typing to see more" rather than dumping the whole set.

**Filters.** `All` (default) groups by relationship as above; `Online` collapses
to currently-connected friends; `Requests` switches to the pending view below.
A per-project filter chip appears when the member is in more than a handful of
projects, so "people you work with" doesn't become one long undifferentiated
list on a busy account.

**Requests view:**

```
│ RECEIVED — 2                                                                 │
│  Mona Adel wants to be friends            [ Accept ] [ Decline ]            │
│ SENT — 1                                                                     │
│  Karim Fathy · sent 2 days ago                          [ Cancel ]          │
```

**Per-friend menu (⋯):** message, invite to a game, mute, **view shared
projects** (which of the member's own projects they're both in — not new
information, just surfaced), block, unfriend.

**Empty and edge states:** no colleagues yet (not assigned to any project) →
"You'll see people here once you're on a project"; a search with no matches →
"No one matches '…' among your colleagues"; a blocked person never appears in
search results in either direction, silently (§13.3 unchanged).

### 25.5 Protocol additions (extends §6/§24.3)

- `GET /api/friends` — the member's friends with presence and shared-project
  tags (replaces treating this as implicit).
- `GET /api/friends/search?q=` — colleagues (as scoped in §25.2) and existing
  friends matching `q`; paginated (50/page); rate-limited (30/min) like any
  other search endpoint; agent proof required, same as every friends route.
- `GET/POST /api/friends/requests`, `POST /api/friends/requests/:id/accept|decline|cancel`
  — the request lifecycle made explicit as endpoints rather than folded into a
  generic friends POST.
- Everything else (friend codes, block, presence, invites) is unchanged from §6.

### 25.6 Tests (extends §9)

- Search never returns a member the caller shares no project with, under any
  query — property-tested by generating random project overlaps.
- Search never crosses tenants, mirroring the existing tenancy tests.
- A blocked relationship is invisible to search in both directions.
- Pagination and rate limits hold under a burst of keystrokes (debounced
  client-side, capped server-side regardless).
- The `source` column is written correctly for each of the three discovery
  paths and is never returned in any API response.
- UI: search filters both sections live; the Requests badge count matches the
  server; keyboard-only flow (tab to search, arrow through results, enter to
  open a profile card) works with the existing tour/tooltip guard tests.
