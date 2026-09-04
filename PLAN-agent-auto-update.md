# PLAN — Agent update publishing, detection, and auto-update

Status: **proposal, nothing implemented.**
Scope: `Tauri-App-Extension`, `.github/workflows/release.yml`, `Landing-Backend`
(download endpoint), + one small Dashboard-Backend endpoint in Phase U5.

Goal: a change merged to `main` becomes a signed release that every installed
agent **detects and applies on its own**, without ever costing someone their
tracked time.

There are two halves to that sentence and they fail independently:

| Half | Question it answers | Status today |
|---|---|---|
| **Publish** (§A) | Does a push to `main` produce something an agent *can* detect? | 🔴 **Broken — nothing is detectable, ever** |
| **Consume** (§B) | Given something to detect, does the agent apply it safely? | 🔴 Applies it unsafely — stops the timer |

Both halves must ship for the feature to exist at all. §A is the one that
turns "no updates" into "updates"; §B is the one that stops updates from
being harmful. Order: **A1 → B1 → A2 → B2 → …** (§D).

**Before building any of it, work through §F** — eleven things that decide
whether this design works at all and that cannot be checked from the
repository: repo visibility, which keypair is in the signing secret, whether
the users are local admins, and so on. Four of them are blocking, and each one
fails silently if it is wrong.

## Answers to §F so far, and what they force

| Check | Answer | Consequence |
|---|---|---|
| F.1 visibility | **Will be private** | 🔴 `releases/latest/download/latest.json` is unusable — the agent fetches it anonymously. The feed moves to Landing-Backend (**A.8**), which is the right answer **whether the repo is public or private** (**A.10.1**). One ordering trap: `GITHUB_PAT` must be set *before* the flip or `/api/download` dies and takes the rollout path with it (**A.10.2**) |
| F.2 which keypair | *Unknown* | 🔴 **No longer moot — check this first (H.4.3).** If the secret holds the deployed key `8216A44B…`, the manual rollout is avoidable entirely via a bridge release (H.4.4). Only if it does not is a fresh keypair free (A.8.4) |
| F.3 key password | *Unknown* | Moot — same |
| F.4 bot can push to `main` | *Possibly not* | The `bump` job must stop pushing to `main`. Version comes from the tag instead (**A.9**) |

**These three collapse into one fact — with one exception found later.**
`plugins.updater.endpoints` is compiled into the binary. Every agent already
installed points at `github.com`, and a private repo will 404 it — so the
existing fleet cannot be redirected to a new feed by any server-side change.

> ⚠️ **H.4 revisits this and finds the exception.** The URL half is solvable
> without touching a machine (H.4.2: keep a *public releases-only repo* under
> the original name and move the source to a renamed private one). What is left
> is the signature half, which depends entirely on **F.2** — whether the
> signing secret holds the key deployed agents already trust. If it does, a
> single **bridge release** (H.4.4) carries the whole fleet across and the
> manual rollout disappears. **Answer F.2 before planning around A0.**

That is not a cost this plan adds; it is a cost F.1 already imposed. But it
pays for itself immediately, because that same one-time rollout can carry
*everything else that is currently unfixable in the field*:

- the new endpoint (Landing-Backend, A.8),
- a **fresh signing keypair**, which is why F.2 and F.3 stop mattering — you do
  not need to recover a key nobody remembers, you need to stop depending on it,
- the `currentUser` install mode, if C.1 goes that way (§2),
- the B1 guard, so the first update the fleet ever applies is already safe.

**One manual rollout, then auto-update works from that version forward.** Plan
it as a single release and get everything into it; a second manual rollout is
much harder to justify than the first.

---

# PART A — PUBLISHING: making an update exist and be detectable

## A.0 What exists today (verified against CI logs and the live releases, not assumed)

| Piece | Where | State |
|---|---|---|
| Release workflow | [release.yml](.github/workflows/release.yml) | `workflow_dispatch` only — **no push trigger** |
| Version bump | `bump` job | patch/minor/major, writes `package.json` + `tauri.conf.json` + `Cargo.toml`, commits to `main`, tags `agent-v<x.y.z>` |
| Build matrix | `release` job | windows-latest / macos-latest / ubuntu-latest, `tauri-action@v0`, `includeUpdaterJson: true` |
| Signing secrets | `TAURI_SIGNING_PRIVATE_KEY`(+`_PASSWORD`) | Passed to the action — **effect unverifiable from outside; see A.1** |
| Updater artifacts | `tauri.conf.json` `bundle` | **`createUpdaterArtifacts` is absent** |
| Endpoint | `tauri.conf.json` `plugins.updater.endpoints` | `…/releases/latest/download/latest.json` — **anonymous, so it dies when the repo goes private** (A.8) |
| Pubkey | `tauri.conf.json` `plugins.updater.pubkey` | minisign `8216A44B8570A492` |
| Key files in repo | `updater-key.pem.pub`, `Tauri-App-Extension/updater-key.pem.pub` | **Two *different* keys — see A.2** |
| Installer distribution | [download-routes.js:15](Landing-Backend/src/modules/download/download-routes.js:15) | Reads GitHub `releases/latest`, ~5 min metadata cache |
| Repo visibility | GitHub API | `public` today, **going private** (F.1). That removes the GitHub feed entirely (A.8) and makes the runner-minute cost real again (A.3) |

## A.1 🔴 The defect that makes everything else moot

**`latest.json` does not exist on any release. It never has.**

Release `agent-v0.4.21` (a fully green run, all five jobs `success`) published
exactly seven assets: `.msi`, `.exe` (NSIS), `.dmg`, `.app.tar.gz`, `.deb`,
`.rpm`, `.AppImage`. No `latest.json`. No `.sig`. Same for every release before
it.

The CI log says why, in one line, on **every platform job**:

```
Looking for artifacts in:
  …\Virtual Tracker Agent_0.4.21_x64_en-US.msi
  …\Virtual Tracker Agent_0.4.21_x64_en-US.msi.sig        ← candidate
  …\Virtual Tracker Agent_0.4.21_x64_en-US.msi.zip        ← candidate
  …\Virtual Tracker Agent_0.4.21_x64-setup.exe.sig        ← candidate
  …\Virtual Tracker Agent_0.4.21_x64-setup.nsis.zip       ← candidate
Found artifacts:
  …\Virtual Tracker Agent_0.4.21_x64_en-US.msi
  …\Virtual Tracker Agent_0.4.21_x64-setup.exe
…
Signature not found for the updater JSON. Skipping upload...
```

Those `.sig` and `.zip` paths are the ones `tauri-action` *looked for* and did
not find. Tauri v2 does not build updater artifacts unless
**`bundle.createUpdaterArtifacts`** is set, and it is not set in
[tauri.conf.json](Tauri-App-Extension/src-tauri/tauri.conf.json). No updater
bundle ⇒ no signature ⇒ `tauri-action` skips `latest.json` ⇒ the endpoint
`releases/latest/download/latest.json` returns **404**.

Now trace the client. `check()` treats HTTP 204 as "no update" and 200 as an
answer; **404 is neither, so it raises**. In
[App.tsx:198](Tauri-App-Extension/src/App.tsx:198) that lands in the `catch`:

- on the mount check ([App.tsx:770](Tauri-App-Extension/src/App.tsx:770)) it is
  swallowed into `console.error` — silent, on every launch, on every machine;
- on the menu check it shows *"Couldn't check for updates. Try again later."*

So the honest description of today's product is: **auto-update is wired end to
end and has never once been able to fire.** Every "we shipped a fix" since the
feature landed reached only whoever re-downloaded the installer by hand from
the landing page. This is a one-line config fix (A.4) and it is the single
highest-value change in this document.

> Because the client half has never run against a real feed, none of §B's
> behaviour has ever been exercised in production either. Fixing A.1 without
> B.1 turns a dormant bug into a live one on every tracked machine
> simultaneously. **A.1 and B.1 ship together or not at all.**

## A.2 🔴 Two public keys, one of which cannot verify anything

```
updater-key.pem.pub                      → minisign 8216A44B8570A492   ← matches tauri.conf.json
Tauri-App-Extension/updater-key.pem.pub  → minisign ED55D4ADD4061EE2   ← matches nothing
```

The second file is a different keypair entirely. If `TAURI_SIGNING_PRIVATE_KEY`
in Actions holds the private half of `ED55…`, then the moment A.1 is fixed CI
will happily publish a signed `latest.json` that **every agent rejects** with a
signature failure — and per §5.2 that is a hard stop, i.e. a fleet that can
never update again until a new installer is hand-rolled out.

Needs: (1) delete the stale key file, (2) prove in CI that the private key in
the secret derives the pubkey in `tauri.conf.json` (A.4, step 4), before the
first signed release goes out.

## A.3 🟠 Nothing releases on a push to `main`

The push trigger was deliberately removed, and the reasoning in the workflow
header was sound *at the time*: a release builds three platforms (Windows 2×,
macOS 10× the Linux runner-minute cost) in a private repo, so releasing on
every push to `main` charged a full paid matrix build to a CSS tweak or a
`Cargo.lock` sync.

**The repo is currently `public` but is going back to private (F.1)**, so take
the cost argument as live: paid minutes, three platforms, per release. The path
filter below is therefore load-bearing rather than tidiness — it is what keeps
an auto-release from charging a full matrix build to a docs tweak. (The larger
consequence of private is A.8: the GitHub feed stops working at all.)

But the requirement here is "push to `main` ⇒ detectable update", so the
trigger must come back **with the cost problem actually solved rather than
re-introduced**. Three constraints shape it:

1. **Path filter.** Only a change under `Tauri-App-Extension/**` can change the
   agent binary. Nothing else may start a matrix build.
2. **Loop safety.** The `bump` job commits `package.json` / `tauri.conf.json` /
   `Cargo.toml` — all under `Tauri-App-Extension/**` — back to `main`. That
   commit matches the path filter and would re-trigger the workflow forever.
   GitHub does not run workflows for pushes authored with `GITHUB_TOKEN`, which
   breaks the loop today, **but that is a property of the token, not of the
   workflow**: swap in a PAT for branch protection and the loop returns
   silently. Guard it explicitly (A.5).
3. **Opt-out, not opt-in.** A path-filtered auto-release is only worth it if
   the escape hatch is cheap: `[skip release]` in the commit subject, plus the
   existing `workflow_dispatch` retained for manual major/minor bumps.

## A.4 Fixes to the build (the part that makes an update exist)

**1 — `Tauri-App-Extension/src-tauri/tauri.conf.json`**, in `bundle`:

```jsonc
"createUpdaterArtifacts": true
```

This is the whole of A.1. With `pubkey` already set and the signing key in the
environment, Tauri emits `<installer>.sig` next to each installer and
`tauri-action` composes and uploads `latest.json`.

**2 — pin the updater bundle per platform.** `"targets": "all"` builds both MSI
and NSIS on Windows; the updater must use **NSIS** (`.exe`), since the MSI path
cannot self-replace a running install. Keep both targets (the MSI is useful for
managed deployment) but ensure the updater artifact is the NSIS one.

**3 — delete `Tauri-App-Extension/updater-key.pem.pub`** (A.2). Keep exactly
one committed pubkey, at the repo root, and treat `tauri.conf.json` as its
source of truth.

**4 — assert the key identity in CI**, in `verify`, before anything expensive:

```yaml
- name: assert updater signing key matches the shipped pubkey
  env:
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
  run: |
    set -euo pipefail
    test -n "$TAURI_SIGNING_PRIVATE_KEY" || { echo "signing key secret is empty"; exit 1; }
    # derive the public key from the secret and compare to tauri.conf.json
    # (npx tauri signer sign of a scratch file, or minisign -R), fail on mismatch
```

Fail loudly here rather than discovering it from a fleet that stopped updating.

**5 — one `latest.json`, written once.** All three matrix jobs upload to the
same release; each `tauri-action` run rewrites `latest.json` with the platforms
it knows about. It merges with what is already on the release, but the read is
not atomic, so two jobs finishing within the same window can produce a
`latest.json` **missing a platform**. That is not a loud failure — it is a
platform that silently never updates. Fix: a serial `updater-json` job that
`needs: [release]`, downloads every `*.sig` and installer URL from the
published release, composes the complete document, and uploads it last:

```json
{
  "version": "0.4.23",
  "pub_date": "2026-09-04T09:35:17Z",
  "notes": "…",
  "platforms": {
    "windows-x86_64": { "signature": "…", "url": "https://github.com/…/Virtual.Tracker.Agent_0.4.23_x64-setup.exe" },
    "darwin-aarch64":  { "signature": "…", "url": "https://github.com/…/Virtual.Tracker.Agent_aarch64.app.tar.gz" },
    "linux-x86_64":    { "signature": "…", "url": "https://github.com/…/Virtual.Tracker.Agent_0.4.23_amd64.AppImage" }
  }
}
```

Uploading it **last, after all three builds succeed**, also gives the release a
natural commit point: until `latest.json` exists, no agent sees the release, so
a half-built release is invisible rather than broken (A.6, "one platform's
build fails").

**6 — the release must be published, not draft.** `releases/latest` ignores
drafts and prereleases. `releaseDraft: false` / `prerelease: false` are already
correct; keep them, and note that flipping either one is equivalent to
switching auto-update off for the whole fleet.

## A.5 The push trigger (the part that makes it happen on `main`)

```yaml
on:
  workflow_dispatch:
    inputs:
      bump: { description: Semver bump type, type: choice, options: [patch, minor, major], default: patch }
  push:
    branches: [main]
    paths:
      - 'Tauri-App-Extension/**'
      - '.github/workflows/release.yml'

concurrency:
  group: agent-release
  cancel-in-progress: false   # ← see A.6 "two pushes in quick succession"
```

and, as the first step of `verify`:

```yaml
- name: skip bot bumps and opted-out commits
  run: |
    subject=$(git log -1 --pretty=%s)
    author=$(git log -1 --pretty=%ae)
    case "$subject" in
      "chore(tauri-agent): bump version to "*) echo "version-bump commit — nothing to release"; exit 78 ;;
      *"[skip release]"*)                      echo "opted out"; exit 78 ;;
    esac
    [ "$author" = "41898282+github-actions[bot]@users.noreply.github.com" ] && { echo "bot commit"; exit 78; }
    exit 0
```

Push events always take `bump: patch` (`github.event.inputs.bump || 'patch'`
already handles this). Minor and major stay a deliberate manual dispatch.

**Cost, honestly.** This is a full three-platform build per agent-touching push
to `main`, and on a private repo that is the exact charge the original removal
was avoiding. The path filter is what makes it proportionate — backend, dashboard, landing and docs changes are the bulk of
this repo's traffic and none of them trigger it. If agent-touching pushes still
turn out to be frequent enough to hurt, the next lever is batching (a scheduled
daily release that runs only when `main` has agent commits since the last tag),
not removing the trigger again — undetectable updates are the more expensive
failure.

## A.6 Publish-side cases, and what happens

### Trigger and versioning

| Case | Behaviour |
|---|---|
| Push to `main` touching `Tauri-App-Extension/**` | Verify → patch bump → tag → build → publish → `latest.json`. This is the main line |
| Push to `main` touching nothing else | No workflow run at all (path filter) |
| The `bump` job's own commit lands on `main` | Skipped by the guard in A.5, belt-and-braces on top of `GITHUB_TOKEN` not re-triggering |
| Commit subject contains `[skip release]` | Skipped — the escape hatch for a comment-only or docs-only agent change |
| Manual dispatch with `minor` / `major` | Unchanged from today |
| Two agent pushes seconds apart | `cancel-in-progress: false`. **Do not cancel a release mid-flight**: `bump` has already pushed a tag and commit, so a cancelled run leaves a tag with no release behind it — a version that exists in git and nowhere else. Let it finish; the second push releases the next patch |
| A push arrives while a release is building | Queued behind it by the concurrency group; releases serialise |
| Tag already exists | Existing check refuses to overwrite (`git rev-parse "$tag"`) and fails the run — correct, keep it |
| Two people dispatch manually at once | Same concurrency group; the second queues |
| `bump` cannot push to `main` (branch protection) | Hard failure, visible. Needs either a protection exemption for the bot or a release-branch flow. **Decide before enabling the push trigger** (§C) |
| A release is cut with no functional agent change | Harmless: a version bump alone is a valid release; agents update to it and nothing changes |

### Build and publish

| Case | Behaviour |
|---|---|
| `verify` fails (cargo test / tsc / vitest) | No bump, no tag, no release. The gate exists precisely so a broken commit never becomes a signed artifact the fleet installs |
| One platform's build fails | `fail-fast: false` — the others still publish. `updater-json` `needs: [release]` so it does **not** run, and without `latest.json` the release is invisible to every agent. A partial release is a no-op, not a broken one. Fix the platform and re-dispatch |
| Signing key secret empty or wrong | Caught in `verify` by A.4 step 4, before any paid build |
| Signing key rotated | New pubkey must ship in `tauri.conf.json` **in an installer users already have** before any release is signed with the new key. Rotation is therefore a two-release dance: release N ships the new pubkey (still signed with the old key), release N+1 signs with the new key. Getting this backwards bricks updating fleet-wide |
| GitHub Releases outage / upload 5xx | Run fails, no `latest.json`, nothing to detect. Re-dispatch |
| Assets uploaded but `latest.json` upload fails | Same as above — release exists, is invisible to agents, is still valid for the landing-page download path |
| A non-agent release is published later | 🔴 `releases/latest` is **repo-wide**. Any future release for a backend or the dashboard becomes "latest" and the agents' endpoint starts serving *its* (absent) `latest.json`. Every release in this repo is currently an agent release; if that ever changes, the endpoint must move to a pinned per-component path or a backend-served feed (§C.4) |
| Release deleted / rolled back | Agents fall back to the previous release as "latest", which is **older** than what they run. Refused client-side by the downgrade guard (§5.3). This is exactly why that guard is not optional |

### Platform and architecture coverage

| Case | Behaviour |
|---|---|
| Windows x86_64 | `windows-latest` is x64 ⇒ `windows-x86_64` covered. The employee fleet is Windows; this is the case that matters |
| Windows arm64 | Not built, not in `latest.json`, no update offered. Acceptable today; note it rather than pretend otherwise |
| macOS aarch64 | `macos-latest` is Apple Silicon ⇒ `darwin-aarch64` covered |
| **macOS x86_64** | **Not built.** An Intel Mac gets no `darwin-x86_64` entry and silently never updates. Either add a `macos-13` matrix entry or state that Intel Macs are unsupported — silence is the one option that is wrong |
| Linux x86_64 | AppImage is the updater artifact; `.deb`/`.rpm` are install-only and cannot self-update |
| Unsigned / unnotarised macOS build | Updates apply, Gatekeeper warns on first launch. Out of scope here, tracked with Authenticode (below) |
| Windows Authenticode absent | Already optional in the workflow (`HAS_WINDOWS_CERT`). Without it SmartScreen/AV may block the *downloaded installer the updater runs*, so an unsigned build is a plausible cause of "the update downloaded and then nothing happened" |

### Downstream consumers

| Case | Behaviour |
|---|---|
| Landing-page download | [download-routes.js:15](Landing-Backend/src/modules/download/download-routes.js:15) reads `releases/latest`; a new release goes live for `/api/download` within its ~5 min metadata cache. Unaffected by any of the above except a release with no Windows installer |
| Backend/agent version skew | An auto-updating fleet reaches a new agent version faster than before. Release ordering rule: **ship the backend change first, agent second**, whenever the agent depends on a new endpoint |
| **Repo is private (decided)** | 🔴 A GitHub asset URL returns 404 for every agent: private-repo assets need an `Authorization` header the updater does not send, and embedding a repo token in the agent would hand a repository credential to every employee machine. **The GitHub endpoint is off the table** — the feed moves to Landing-Backend (A.8). Everything else in A.4/A.5 still applies; only where the feed is served from changes |
| Minisign private key exposure | On a public repo the workflow file, logs and release assets are world-readable. The signing key lives only in Actions secrets and is never echoed; keep it that way — the pubkey being public is by design, the private key leaking means anyone can sign an "update" the whole fleet installs |

## A.7 How to verify the pipeline actually works

Do not declare A done because CI is green — green is exactly what it was for
every release that shipped no `latest.json`.

1. The configured endpoint answers. **This is the acceptance test for Part A**;
   add it as a final workflow step so a release that fails it fails loudly.
   Under A.8 that is the backend feed, checked **anonymously — no PAT, no
   `Authorization` header**, because that is exactly how the agent will call
   it and a check that authenticates proves nothing:

   ```bash
   curl -fsS "https://<landing-host>/api/agent/update/windows/x86_64/0.0.1"   # expect 200 + signature
   curl -fsS -o /dev/null -w '%{http_code}' \
        "https://<landing-host>/api/agent/update/windows/x86_64/$JUST_RELEASED"  # expect 204
   ```
2. `version` in that document equals the tag just built.
3. Each platform `url` is a real, downloadable asset URL on that release.
4. Install release N on a clean Windows VM, publish N+1, launch, and observe the
   agent detect it — end to end, once, by hand, before trusting it.
5. `minisign -Vm <installer> -P <pubkey from tauri.conf.json>` verifies against
   the *shipped* pubkey, not the one in the CI secret.
6. The feed's `url` is downloadable **anonymously** — follow the 302 all the
   way to bytes. A proxy route that works for your logged-in browser and 404s
   for an unauthenticated client is the single most likely way A.8 fails.

## A.8 Delivery through Landing-Backend (required when private, correct when public)

The signature is what makes an update trustworthy, not where the JSON was
served from. So moving the feed off GitHub costs nothing in security and is
mostly plumbing you already have.

> Titled for the private case because that is what forces it, but this is the
> recommended feed **regardless of visibility** — see A.10.1 for why leaving the
> GitHub endpoint in place while public is a latent fleet-wide outage.

### A.8.1 Why not the alternatives

| Option | Verdict |
|---|---|
| Embed a GitHub token in the agent | **No.** Ships a repository credential to every employee machine, unrevocable without another manual rollout |
| A second, public releases-only repo | Workable, and it fixes F.9 for free. Costs a cross-repo PAT and a second place to look. **Keep as the fallback** if backend work is unwelcome |
| Public release assets on a private repo | Not a thing GitHub offers. Assets inherit repo visibility |
| **Landing-Backend serves the feed** | **Recommended.** The PAT-proxy pattern already exists and is proven in production for installer downloads; it fixes F.9 as a side effect; and it is the same endpoint U5's staged rollout and minimum-version would need anyway |

### A.8.2 The endpoint

```
GET /api/agent/update/{{target}}/{{arch}}/{{current_version}}
```

Tauri substitutes those placeholders itself, so `tauri.conf.json` becomes:

```jsonc
"updater": {
  "active": true,
  "endpoints": ["https://<landing-host>/api/agent/update/{{target}}/{{arch}}/{{current_version}}"],
  "pubkey": "<the NEW key — A.8.4>"
}
```

Behaviour:

- **204 No Content** when the caller is already current. The plugin treats this
  as "no update" cleanly — unlike the 404 it gets today (A.1), this is the
  status the client is designed around.
- **200** with the standard body for that one platform:

```json
{
  "version": "0.4.23",
  "pub_date": "2026-09-04T09:35:17Z",
  "notes": "…",
  "url": "https://<landing-host>/api/agent/update/download/0.4.23/windows-x86_64",
  "signature": "<contents of the .sig asset, inline>"
}
```

### A.8.3 What the backend does

Three small pieces, all of them variations on code that already exists in
[download-routes.js](Landing-Backend/src/modules/download/download-routes.js):

1. **Resolve the latest agent release.** Same `releases/latest` API call with
   the PAT, same 5-minute cache. Filter to tags matching `agent-v*` so a future
   non-agent release cannot hijack it — **this is the F.9 fix**, and it costs
   one line here instead of a redesign later.
2. **Inline the signature.** Fetch the `.sig` asset for the requested platform
   with the PAT and put its contents in the response. Cache alongside the
   release metadata; it is a few hundred bytes and changes only per release.
3. **Proxy the download.** Exactly the existing trick: fetch the asset URL with
   the PAT and `redirect: "manual"`, then 302 the caller to the signed object
   URL GitHub hands back. The plugin follows redirects, and the signed URL needs
   no auth. `/api/download` already does this — the new route differs only in
   pinning an explicit version and platform rather than sniffing by extension.

**Version comparison stays on the client.** The backend may answer 204 as an
optimisation, but it must never be the only thing standing between an agent and
a downgrade — §5.3 still refuses an older version whatever the feed says. A
compromised or simply buggy backend must not be able to roll the fleet back.

### A.8.4 The new keypair (F.2/F.3 = unknown)

Do not go looking for the old private key. Since the manual rollout is
unavoidable anyway, generate a new one and make the rollout carry it:

```bash
npx tauri signer generate -w ./updater-key.pem   # keep the password
```

- Private key + password → Actions secrets (`TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) **and** a password manager, so F.2 and
  F.3 are never "I don't remember" again.
- Public key → `tauri.conf.json` `plugins.updater.pubkey`, and the single
  committed `updater-key.pem.pub` at the repo root. Delete
  `Tauri-App-Extension/updater-key.pem.pub` (A.2) — with a fresh key, both
  existing files are dead weight, and leaving two around is how this ambiguity
  started.
- The CI assertion in A.4 step 4 still goes in. Its job now is to stop the
  *next* key mismatch, and it is the reason F.2 never becomes an unanswerable
  question again.

Because the old key signed nothing that any agent ever accepted, this is not a
key rotation in the dangerous sense (A.6, "signing key rotated"). There is no
installed base verifying against the old pubkey in anger. **This is the one and
only moment when changing the key is free** — after the rollout it goes back to
being a two-release dance.

### A.8.5 What this costs if Landing-Backend is down

Updates do not happen. That is all — §5.2 already treats an unreachable feed as
a silent no-op with backoff, indistinguishable from being offline. The tracker
itself does not depend on this endpoint. It is worth saying explicitly because
it is the one new single point of failure this design introduces, and the
failure mode is "no updates for a while", not "broken agent".

## A.9 Releasing without pushing to `main` (F.4 = possibly not)

Today the `bump` job commits three version files to `main` and pushes a tag.
If branch protection lands on `main` — even just "require a pull request" —
that push fails and every release fails with it, after `verify` has already
run and possibly after a tag exists. Worse, the failure arrives unattended
under the push trigger (A.5).

**Make the tag the source of truth and stop writing to `main` at all.**

```bash
# in `bump`, replacing "read package.json, commit, push to main"
latest=$(git tag -l 'agent-v*' --sort=-v:refname | head -1)   # agent-v0.4.22
current=${latest#agent-v}
# …bump patch/minor/major as before → $next
# write the version into the workspace, but DO NOT commit it
node -e "…set version in package.json + tauri.conf.json…"
sed -i -E "0,/^version = …/s//version = \"${next}\"/" Cargo.toml
git tag -a "agent-v${next}" -m "Agent v${next}" && git push origin "agent-v${next}"
```

The build job then checks out that tag and applies the same version write
before building (the tag points at the unbumped tree, so the version has to be
re-derived — one shared script, called from both jobs).

What this buys:

| | Today | Tag-driven |
|---|---|---|
| Needs write access to `main` | Yes | **No** — only tag push |
| Survives branch protection | No | Yes (unless tags are protected too — check that) |
| Re-trigger loop risk (A.5) | Real, guarded | **Gone** — nothing lands on `main` |
| Version visible in the repo | Yes | No — `main` shows a stale number |

That last row is the trade, and it is worth naming: after this, the version in
`package.json` on `main` is a **development placeholder, not the shipped
version**. Anyone reading the repo to answer "what version is live?" gets the
wrong answer, so the tag list becomes the authority and the README should say
so. Given that the alternative is releases that fail whenever someone tightens
branch protection, that is a good trade — but it is a real one.

If tags turn out to be protected as well, the fallback is a `release/*` branch
the bot owns, with the tag cut from there. Do not go back to pushing `main`.

---

## A.10 Visibility: public, private, and the flip between them

F.1 answered "will be private", and A.8 is written for that. But the design has
to be correct **before, during, and after** the flip — and one of those three is
currently a trap.

### A.10.1 The A.8 feed is visibility-independent — adopt it either way

The agent never talks to GitHub under A.8; it talks to Landing-Backend, which
holds the credential. That is true whether the repo is public or private, so
**A.8 is the right answer for both** and should not be framed as private-only:

| If the repo is… | A.8 feed | GitHub feed (today's config) |
|---|---|---|
| **Public** | Works. `agent-v*` filtering (F.9) still earns its place | Works — until someone flips the setting |
| **Private** | Works, unchanged | **Dead for every installed agent, permanently** |
| **Flipped public → private** | No change, no rollout | Fleet stranded: the endpoint is compiled into each binary, so the only repair is a manual reinstall on every machine |
| **Flipped private → public** | No change | n/a |

The asymmetry is the whole argument: **private → public is free; public →
private is a fleet-wide reinstall.** Staying on the GitHub endpoint while public
means one settings toggle — by anyone with repo admin, possibly for an unrelated
reason — permanently disables updates for every installed agent, silently, with
no server-side way to recover.

### A.10.2 🔴 The ordering trap: the download endpoint dies *before* the rollout can happen

`GITHUB_PAT` has **no default** —
[env.js:79](Landing-Backend/src/config/env.js:79) is
`readString(source, "GITHUB_PAT")` with no fallback — and the token is attached
only `if (pat)`
([download-routes.js:104](Landing-Backend/src/modules/download/download-routes.js:104)).
On a public repo the anonymous call succeeds, so **the PAT being unset is
invisible today**.

The moment visibility flips without it:

1. `getLatestRelease` → `GitHub API error (404)` → throws
   ([download-routes.js:24](Landing-Backend/src/modules/download/download-routes.js:24))
2. the catch returns **HTTP 500**
3. `/api/download` and `/api/download-agent` are dead
4. the landing page's download button is dead

And that endpoint is precisely what the one-time manual rollout (A0) depends on.
Flip first and you cannot download the installer that fixes the problem, except
by going to the GitHub releases UI directly as an authenticated maintainer.

> **Set `GITHUB_PAT`, redeploy Landing-Backend, and confirm `/api/download`
> still 302s — *before* changing visibility.** This is a five-minute check that
> prevents a self-inflicted outage of the only distribution channel.

### A.10.3 The `browser_download_url` fallback is public-only

`routeDownload` has two redirect paths
([download-routes.js:107-135](Landing-Backend/src/modules/download/download-routes.js:107)):

1. `fetch(asset.url, { redirect: "manual" })` → 302 to the signed object URL.
   Needs the PAT on a private repo; the signed URL it returns needs no auth,
   which is what makes the proxy work.
2. fallback to `asset.browser_download_url`.

**Path 2 only works on a public repo.** On a private repo that URL 404s for the
unauthenticated browser the user is holding — so the request appears to succeed
(a 302 goes out) and then fails in the user's downloads, which is worse than a
clean error.

Path 2 is only reached when path 1 returns no `Location`, which on a private
repo means the PAT is missing or wrong. So on a private repo, reaching the
fallback *is itself the bug*. Make it explicit rather than silent:

```js
if (asset.browser_download_url) {
  // Only usable while the repo is public - on a private repo this URL 404s
  // for the unauthenticated browser. Reaching here with a private repo means
  // the PAT is missing or wrong (see A.10.2); fail loudly instead of handing
  // out a link that dies in the user's downloads folder.
  if (!pat) { /* 302 as today */ } else { /* 502 + log: signed-URL redirect missing */ }
}
```

### A.10.4 Transition order

| # | Step | Why this position |
|---|---|---|
| 1 | Set `GITHUB_PAT` (repo-scoped, read-only on contents), redeploy Landing-Backend | A.10.2 — must precede the flip |
| 2 | Verify `/api/download` still 302s to a working installer | Proves step 1 before it matters |
| 3 | Build the A.8 feed endpoint; verify it serves `204`/`200` correctly while the repo is still public | Easiest to debug while both feeds work |
| 4 | Ship the rollout build (new endpoint + new pubkey + B1 guard + install mode) | The one manual rollout, per the header |
| 5 | Confirm a real agent updates itself end to end (F.11) | Last moment the GitHub feed still exists as a comparison |
| 6 | **Flip visibility to private** | Everything that depended on public is already migrated |
| 7 | Re-verify `/api/download` and the update feed | Catches anything step 1 missed |

Steps 1–3 are reversible and can sit in place indefinitely while public. Only
step 6 is one-way in practice.

### A.10.5 Rate limits

Unauthenticated GitHub API is **60 requests/hour per IP**, shared by every
visitor hitting the backend. The 5-minute release cache
([download-routes.js:6](Landing-Backend/src/modules/download/download-routes.js:6))
keeps that to ~12/hour today, so it is not a live problem — but the A.8 feed
adds *every agent in the fleet* polling for updates. Those hits must land on the
same cache, not on GitHub, or the fleet becomes a self-inflicted rate-limit
denial of service against its own update channel.

With the PAT set the limit is 5,000/hour and the question disappears. A third
reason to do A.10.2 step 1 regardless of visibility.

### A.10.6 What still breaks on the flip, unavoidably

Every agent installed **before** the rollout build points at
`github.com/.../releases/latest/download/latest.json`, compiled in. When the
repo goes private those agents get 404 forever. Nothing server-side can reach
them; A.8 cannot help an agent that never asks Landing-Backend.

That is the A0 manual rollout, and it is why the header calls it unavoidable.
The only thing this section adds: **do the rollout while the repo is still
public**, because that is the window in which the old endpoint still works and
`/api/download` is still trivially reachable for whoever is doing the install.


# PART B — CONSUMING: applying an update without costing anyone their time

## B.0 What exists today

| Piece | Where | State |
|---|---|---|
| `tauri-plugin-updater` | [Cargo.toml](Tauri-App-Extension/src-tauri/Cargo.toml), [lib.rs:674](Tauri-App-Extension/src-tauri/src/lib.rs:674) | Registered |
| Capability | `capabilities/default.json` | `updater:default` granted |
| Check-on-mount | [App.tsx:770](Tauri-App-Extension/src/App.tsx:770) | Runs once on mount |
| Manual check | [App.tsx:1478](Tauri-App-Extension/src/App.tsx:1478) | Two menu entries |
| Clean-exit flush | [lib.rs:965](Tauri-App-Extension/src-tauri/src/lib.rs:965) `RunEvent::Exit` | Calls `controller.stop()` |
| Crash-safe progress | [progress_store.rs](Tauri-App-Extension/src-tauri/src/agent/progress_store.rs) | Survives unclean exit (PS-1/PS-2) |

So the consuming half is **not greenfield** — it ships, and it runs on every
launch. The work is making it safe, not making it exist. It has simply never
had anything to find (A.1).

## 1. 🔴 The defect that matters

Today's flow, in full:

```js
const update = await check();
if (update) {
  await update.downloadAndInstall();
  await relaunch();          // ← unconditional
}
```
[App.tsx:198](Tauri-App-Extension/src/App.tsx:198), invoked unconditionally on
mount at [App.tsx:770](Tauri-App-Extension/src/App.tsx:770).

Trace what `relaunch()` does:

1. `relaunch()` ends the process → Tauri emits `RunEvent::Exit`
2. [lib.rs:965](Tauri-App-Extension/src-tauri/src/lib.rs:965) calls `exit_controller.stop()`
3. → `flush_and_stop_tracker("quit")` ([controller.rs:145](Tauri-App-Extension/src-tauri/src/agent/controller.rs:145))
4. → **`post_session_action("stop", …)`** — the session is closed *server-side*
5. Agent restarts, asks for the open session, finds none → **tracking does not resume**

**An employee working with the timer running has it silently stopped by an
update, mid-task, with no warning and no resume.** They lose the time between
the stop and whenever they notice, and their manager sees a gap in the day.

For a product whose entire purpose is accurate time capture, this is the worst
available failure mode, and it is on the default path for every user on every
launch — **latent only because A.1 has kept `check()` from ever returning an
update.** Fixing Part A arms it fleet-wide.

> Note the exit handling itself is *correct* — flushing on exit is what stops
> an unclean shutdown losing time (PS-3). The bug is deciding to exit at all
> while a timer is running.

## 2. 🟠 The constraint nobody can code around

`tauri.conf.json` sets `"installMode": "perMachine"`, so the agent installs to
`%ProgramFiles%`. The updater downloads the NSIS installer and runs it —
**writing to Program Files requires administrator rights**.

On a managed employee machine, the user is typically not a local admin. So:

- the update either fails outright, or
- raises a UAC prompt the employee cannot satisfy,
- on **every launch**, because the check runs on mount and never records that
  it cannot succeed.

**Auto-update and `perMachine` are close to mutually exclusive without a
privileged helper service.** This is the same decision as Issue #5's A7 in the
other plan, and it must be settled before U2 (§C).

Note the interaction with Part A: once `latest.json` exists, this stops being
theoretical on the same day. If the answer is `currentUser`, the switch itself
needs a migration — an agent installed per-machine is not upgraded in place by
a per-user installer, so the changeover release must be pushed out through the
landing-page download, once, with the old install uninstalled.

## 3. Requirements

**Functional**
1. A change merged to `main` produces a release agents can see (Part A).
2. Check on start, and periodically for long-running instances.
3. Apply updates automatically, without the user managing it.
4. **Never** interrupt an active timer.
5. Never lose queued events.
6. Manual "check now" stays available and reports honestly.
7. An administrator can force a minimum version.

**Non-functional**
8. Failure is silent to the employee and visible to whoever can act.
9. No update loop: a bad build must not reinstall itself forever.
10. No downgrade, ever — including from a deleted release or a compromised feed.
11. Signature verification is non-negotiable (provided by the plugin, given A.2).

## 4. Design — one rule collapses most of the complexity

> **An update is applied only at a moment where restarting costs nothing.**

Everything else follows from that. The update lifecycle becomes a small state
machine rather than a pile of special cases:

```
        ┌──────── periodic / on-start check
        ▼
     [Idle] ──no update──► [Idle]
        │ update found
        ▼
  [Downloading] ──fail──► [Backoff] ──► [Idle]
        │ verified (minisign, by the plugin)
        ▼
    [Staged] ── waits for a safe point ──┐
        │                                │
        │  safe point reached            │ not safe yet: stay staged,
        ▼                                │ keep tracking, re-evaluate
    [Applying] ── flush queue ───────────┘
        │  install + relaunch
        ▼
   [Verifying] ── started OK? ──yes──► [Idle] (new version)
        │ no (crash-loop guard)
        ▼
    [Quarantined] — stop retrying, report
```

**A "safe point" is any of:**
- no session open (never started, or already stopped);
- the user explicitly quits;
- the machine is idle past the idle-stop threshold and the session has already
  been auto-stopped by idle escalation;
- the user accepts an offered restart.

**Staging is what makes this cheap.** Download and verify eagerly — that part
is safe at any time and gets the bytes on disk while the network is good. Only
the *install + restart* waits. A user who never stops their timer still gets
the update the moment they quit for the day.

### 4.1 Where the logic belongs

**In Rust, not in `App.tsx`.** The current check lives in a React effect, which
means it only runs while a window exists — but this app runs in the tray with
the window closed for most of the day, and `start_hidden` is a supported
preference. An update policy implemented in the webview cannot see the
tracker's state and does not run when the window is hidden.

The tracker already owns the session state, the queue, and a tick loop with
periodic work (`maybe_refresh_display_names`, `maybe_refresh_activity_scoring`).
Update checking is the same shape: `maybe_check_for_update` on that loop,
reusing the interval-and-backoff pattern already there.

The UI keeps only: a manual "check now", and a "restart to finish updating"
affordance when an update is staged.

### 4.2 Check cadence

- On start, once, after the tracker is initialised (not on window mount).
- Every 4 h thereafter while the process lives, jittered ±30 min so a fleet of
  a few hundred agents does not hit the release the same second one lands.
- Immediately on a manual "check now".
- Never more than once per 15 min, whatever asks.

That bounds worst-case detection latency at ~4.5 h after a release is
published, which is the right trade for a background agent: a push to `main`
reaches every running machine the same working day, without polling GitHub in a
tight loop from every desk.

## 5. Every case, and what happens

### 5.1 Session state at the moment an update is ready

| Case | Behaviour |
|---|---|
| No session ever started | Apply immediately |
| Session stopped | Apply immediately |
| **Session active (tracking)** | **Stage only. Never interrupt.** Apply on stop/quit |
| Session paused (break) | Stage. A pause is still an open session server-side; stopping it would end the break early and look like the employee quit |
| Idle, before escalation stops the timer | Stage — the session is still open |
| Idle-escalation has auto-stopped the session | Safe point: apply |
| Window hidden in tray, session active | Stage. Invisible restarts are worse, not better |
| Window hidden, no session | Apply. Nothing to lose and nobody to interrupt |
| Sign-in flow open (browser callback pending) | Defer: restarting kills the local callback server and the user's half-finished login |
| A screenshot or upload is in flight | Defer to the next tick; do not tear down mid-request |
| Machine suspending / OS shutting down | Do not start applying. The installer must never be interrupted by a suspend |
| Manual "check now" while tracking | Offer: "Update ready — restart now?" with an explicit warning that the timer will stop. User's choice, made knowingly |

### 5.2 Network and download

| Case | Behaviour |
|---|---|
| Offline at check time | Silent no-op. Retry next interval; never surface to the employee |
| **Endpoint 404 (no `latest.json`)** | **Today's real state (A.1).** Treat as "no update", not as an error. Log once per process. The manual check must not claim "couldn't check" when the honest answer is "nothing published" |
| `latest.json` malformed, or missing this platform's key | Treat as "no update". A platform absent from the feed (A.6) must be silent, not an error dialog |
| Download fails part-way | Exponential backoff (1m → 5m → 30m → 2h, capped). Never a tight retry loop |
| Signature verification fails | **Hard stop.** Do not retry with the same version, do not fall back to unsigned. Report and quarantine that version. See A.2 — a key mismatch lands here fleet-wide |
| Corporate proxy / TLS interception blocks GitHub | Indistinguishable from offline; same silent backoff. Surfaces to an admin through the reporting in U3, not to the employee |
| Metered / very slow link | Deferred by the backoff naturally; not worth detecting explicitly |
| Disk full while staging | Fail like any download failure, clean up the partial file |
| Staged file deleted or corrupted before applying | Re-verify at apply time; on mismatch discard and re-stage |

### 5.3 Version

| Case | Behaviour |
|---|---|
| Same version offered | No-op |
| Newer version | Normal path |
| **Older version offered** | **Refuse.** A deleted release, a rolled-back tag, or a tampered endpoint must never downgrade an agent — an older build may lack a security fix. Compare semver, do not trust ordering from the feed |
| Several versions behind | Normal path — the updater installs the latest, not each step |
| Feed version equals the running version but assets differ | No-op. Version is the only identity; re-cutting a release under the same version is a release-process error (the tag guard in A.6 prevents it) |
| Backend requires a newer agent | Forced update (§5.5) |

### 5.4 Failure after install

| Case | Behaviour |
|---|---|
| Install fails (permissions — §2) | Record the failure reason. **Stop retrying every launch**; a UAC prompt on every start trains people to click through prompts |
| Installer blocked by AV / SmartScreen | Same treatment as a permission failure: record, back off, report. Correlated with the Authenticode gap in A.6 |
| Relaunch fails | The installer has already replaced the binary; next manual start runs the new version. Nothing to do |
| **New build crashes on start** | Crash-loop guard: persist `{version, launch_count, first_seen}`. Three failed starts of the same version ⇒ quarantine it, stop updating, report. Otherwise a bad release turns into an infinite reinstall loop across the fleet |
| Quarantined version is later superseded | A *newer* version than the quarantined one is allowed through — quarantine pins one bad version, it does not switch updating off permanently |
| Update applied, backend now incompatible | Version skew is a release-ordering problem, not an updater one — see A.6 and §8 |

### 5.5 Policy (Phase U5, only if wanted)

| Case | Behaviour |
|---|---|
| Admin sets a minimum version | Agents below it update at the next safe point; if none arrives within a grace period, prompt the user directly |
| Emergency/mandatory update | Same, with a shorter grace period and an explicit UI |
| Staged rollout | Server decides eligibility per device; the agent just asks |

### 5.6 Machine and OS-session cases

The cases above assume one agent, one user, one machine. None of these do.

| Case | Behaviour |
|---|---|
| **Two Windows users on one PC, `perMachine` install** | Both autostart their own agent against one shared binary. Whichever one applies the update **replaces the binary under the other's running process**. Windows keeps the open file handle valid, so the other agent keeps running the old code until it restarts — silently mixed versions on one machine. Not harmful in itself, but it makes "what version is this machine on" unanswerable (F.6) |
| Update while another user's instance is running | The NSIS installer cannot replace a locked binary. Install fails; treat exactly like a permission failure (§5.4) — record and stop retrying, do not loop |
| Fast user switching / RDP with two live sessions | Same as above. The apply step must tolerate "another instance holds the binary" as an ordinary outcome, not an error worth surfacing to an employee |
| 🔴 **`relaunch()` races the single-instance plugin** | [lib.rs:662](Tauri-App-Extension/src-tauri/src/lib.rs:662) registers `tauri-plugin-single-instance` first, and a second launch calls `show_main_window` on the *existing* instance and exits. If the new process starts before the old one has fully exited, it detects the old instance, pops its window, and quits — **the update installs and the agent never restarts into it**. Wait for exit, or have the installer do the relaunch, rather than assuming `relaunch()` is atomic |
| Machine sleeps mid-download | Download resumes or restarts under the existing backoff. Nothing special |
| **Machine sleeps or reboots mid-install** | The dangerous window. An NSIS install interrupted part-way can leave a half-written install directory. This is the one place a rollback story would actually earn its keep — see §G. Minimum viable: do not begin applying when a shutdown is already signalled (§5.1), and treat a failed launch afterwards as the crash-loop guard's problem |
| OS forces a reboot (Windows Update) mid-install | Same as above |

### 5.7 On-disk state across versions

Six files are written by version N and read by version N+1. An update that
cannot read its own predecessor's state loses data silently.

| File | Compatibility | Status |
|---|---|---|
| `pending-events.jsonl` | Serialized `ActivityEvent`. **Verified in both directions** — an old event without `url` parses (serde defaults a missing `Option` to `None`), and an unknown future field is ignored rather than rejected. Three tests added in `types.rs` | ✅ tested |
| `preferences.json` | Every field already carries its own `serde(default)`, with a comment explaining exactly this hazard — adding a field must not wipe a user's other settings | ✅ by design |
| `classifications.json` | An unparseable file is discarded and refetched; names fall back to raw exe names until the next refresh | ✅ by design |
| `tracker-progress.json` | `PersistedProgress` has no per-field defaults. Adding a field here **would** break recovery of an in-flight session across an update — the exact case PS-1/PS-2 exist to protect | ⚠️ add `#[serde(default)]` before the shape ever changes |
| `agent-store.json` / keyring | Credentials live in the OS keychain (`keyring` 4.x), not the file. Unaffected by agent version | ✅ |
| Updater staging state (§4) | New in U2. Must be versioned from the start, and must tolerate its own absence | design note |

> 🔴 **The silent-drop hazard.** [queue.rs:81](Tauri-App-Extension/src-tauri/src/queue.rs:81)
> does `let Ok(batch) = serde_json::from_str(&line) else { continue; }` — an
> unparseable line is **dropped with no log and no counter**. That is the right
> resilience choice (one bad line must not block a backlog), but it means a
> format break would silently discard captured work and look like nothing
> happened. The tests above are what stop that being invisible; a `log::warn!`
> with a count on the drop path would make it observable if it ever happens.

### 5.8 Install-time environment

| Case | Behaviour |
|---|---|
| `%TEMP%` redirected or not writable | Download fails; ordinary backoff. Worth logging distinctly — it is a machine misconfiguration, not a transient network fault |
| Antivirus quarantines the staged installer between download and apply | Re-verify at apply time (already in §5.2) catches the file being gone; then it is a normal failure. Given the agent's own AV profile this is not hypothetical |
| Roaming profile — `~/.virtualtracker` syncs across machines | Queue and progress files could arrive from a *different* machine's session. Out of scope to solve, but worth knowing before someone reports "duplicate time on two PCs" |
| Disk full at install (as opposed to download) | Install fails, binary may be partially replaced. Crash-loop guard is the backstop |
| ⚠️ **Corporate TLS interception** | `reqwest` is configured `default-features = false, features = [… "rustls-tls"]`, which in reqwest 0.12 trusts the **bundled Mozilla root set**, not the Windows certificate store. A corporate MITM proxy whose private root is installed in Windows — and therefore trusted by every browser on the machine — would **not** be trusted by the agent. If that is the case, the agent cannot reach the API *at all*, not merely the update feed, so it would present as "the product does not work here" rather than "updates are broken". **Verify before an enterprise deployment** (F.12): the fix is `rustls-tls-native-roots`, a one-line feature change |


## 6. Queue and progress safety

Both are already solved and must be *used*, not rebuilt:

- **Queued events** — `queue.rs` is disk-backed and survives restart, so the
  worst case is delayed upload, not loss. Still, flush before applying so the
  common case is clean.
- **In-flight progress** — `progress_store.rs` mirrors active/idle seconds on
  every credited tick (PS-1/PS-2), so even a hard kill mid-update loses at most
  one tick.

`// ponytail: no new persistence for updates - the queue and progress store
already cover the two things that could be lost. The only new state is
{staged version, quarantine list, launch counter}, which is a few fields.`

---

# PART C — Decisions needed before building

1. **`perMachine` or `currentUser`?** (§2) Auto-update effectively requires
   `currentUser` unless you ship a privileged updater service. This is the same
   question as A7 in the AV plan — answer it once, for both. If `currentUser`
   wins, the changeover release needs a manual push (§2).
2. **May an update ever stop an active timer?** This plan says **no**, and
   everything above follows from that. If "yes, after warning" is acceptable,
   §5.1 collapses to a prompt.
3. ~~**Can `github-actions[bot]` push to `main`?**~~ **Answered (F.4): maybe
   not.** Resolved by not needing it — the tag becomes the source of truth
   (A.9). Remaining sub-question: **are tags protected too?** If so, the
   fallback is a bot-owned `release/*` branch.
4. ~~**Is `releases/latest` safe as the endpoint long-term?**~~ **Answered
   (F.1): the repo is going private, so it is not usable at all.** The feed
   moves to Landing-Backend (A.8), which also settles F.9. Remaining
   sub-question: **backend feed, or a second public releases-only repo?**
   A.8.1 recommends the backend; the second repo is the lower-effort fallback
   if backend work is unwelcome. **This is the one decision that blocks A1.**
5. **Intel Mac: build it or declare it unsupported?** (A.6) Either is fine;
   silently never updating those machines is not.
6. **Is a forced-minimum-version needed?** If not, skip U5 entirely.
7. **Who does the manual rollout, and when?** A0 (§D) requires reinstalling
   every agent by hand once. That is a scheduling and comms question, not an
   engineering one, and it gates every phase after it. Decide the window before
   building, not after.

---

# PART D — Phasing

The F.1/F.4 answers reorder this. The old plan assumed the installed fleet
could be reached; it cannot (see the answers table at the top), so everything
now hangs off one manual rollout — and that rollout must be *complete*, because
there will not be a second one.

| Phase | Content | Size |
|---|---|---|
| **A1** | 🔴 **Make updates exist and be fetchable.** `createUpdaterArtifacts: true`; fresh keypair (A.8.4); single committed pubkey; key-identity assertion in `verify`; Landing-Backend feed + signature inlining + anonymous download proxy (A.8); `agent-v*` tag filter (fixes F.9); endpoint reachability assertion, checked unauthenticated, as the last workflow step | ~1½ days (backend included) |
| **B1** | 🔴 **Guard auto-update.** Do not `relaunch()` while a session is open — stage instead, apply on stop/quit. Smallest possible fix to the §1 defect | ~half day |
| **A0** | 🔴 **The one manual rollout.** Build one installer carrying A1 + B1 + the new endpoint + the new pubkey + the C.1 install-mode decision, and install it on every machine by hand. **Everything before this is invisible to the fleet; everything after it is automatic.** Not optional, not deferrable, and not repeatable — get every irreversible decision into this build | scheduling, not engineering |
| **A2** | Tag-driven versioning, no push to `main` (A.9); path-filtered `push: main` trigger with `[skip release]` guard; `cancel-in-progress: false` | ~1 day |
| **B2** | Checking moves into the tracker loop with interval + backoff and jitter; stage/apply state machine; downgrade refusal; crash-loop guard; unreachable-feed treated as "no update" | ~2 days |
| **B3** | UI: "restart to finish updating" affordance; manual check reports staged state honestly; install-failure reporting for admins | ~1 day |
| **A3** | *Optional* — Intel Mac matrix entry (F.8); Authenticode certificate (F.7) | ~half day |
| **U5** | *Optional* — server-driven minimum version and staged rollout. Cheap now: the backend already owns the feed | ~1 day + backend |

**A1 → B1 → A0 is the shippable unit and the ordering is not negotiable.** A1
without B1 would arm §1 on every machine at once; B1 without A1 guards a path
that cannot execute; and neither reaches anybody without A0. Roughly two days
of work plus a rollout window, and it turns "we have never shipped an update to
anyone" into "a merge to `main` reaches the fleet without anyone losing time".

**What to fold into A0 while you have the chance**, because each one otherwise
costs a second hand-rollout: the install mode (C.1 — `perMachine` vs
`currentUser`, and F.5 says non-admin users make this urgent), agent version
reporting (F.6 — without it you cannot tell whether any of this worked), and
Authenticode signing (F.7) if the certificate is obtainable in time.

# PART E — Tests

**Publish (Part A)** — these are workflow assertions, not unit tests:

- `latest.json` is reachable at the configured endpoint after a release, with a
  `platforms` entry for every platform the matrix built. Fails the run if not.
- `version` in `latest.json` equals the tag.
- The private key in the secret derives the pubkey in `tauri.conf.json`.
- A push touching only `Dashboard-Web/**` starts no release run.
- The bump commit does not start a release run.
- A failed platform build leaves the release without `latest.json`.

**Consume (Part B)**:

- **Already done, in `types.rs`:** three on-disk compatibility tests covering
  §5.7 — an old queued event without `url` still parses, an unknown future
  field is ignored rather than rejected, and a screenshot with a URL round
  trips. These pin the agent-to-agent format boundary that an auto-update
  crosses on every machine.
- `is_safe_to_apply()` as a pure function over `{session state, sign-in
  pending}` — table-driven across every row of §5.1. This is the whole design
  in one function, so it is the one that must be pinned.
- Downgrade refusal: offered `0.4.20` while on `0.4.21` ⇒ refused.
- Crash-loop guard: three failed starts of the same version ⇒ quarantined; a
  newer version afterwards is still accepted.
- Backoff: repeated failures do not produce a tight loop.
- Signature failure does not retry the same version.
- A 404 endpoint yields "no update", not an error toast.
- Staged update survives a process restart (staged state is persisted, not
  in-memory).
- An update staged while tracking applies after `stop_session`.
- `relaunch()` actually reaches the new version rather than being absorbed by
  the single-instance plugin (§5.6) — the one case that fails *silently as a
  success*, so it needs a real end-to-end check, not a unit test.
- `PersistedProgress` still deserializes after a field is added to it (§5.7).

---

# PART F — What you need to check yourself

Everything in Parts A and B was verified from the repository, the published
releases, and the CI logs. The items below **cannot** be verified from there —
they live in Actions secrets, repository settings, and on the machines the
agent is actually installed on. Each one can independently make auto-update
either not work or not be safe, and each one fails *silently*.

Work through these before A1 ships. The order is deliberate: F.1–F.4 are
blocking, the rest can be answered while building.

## F.1 🔴 Repository visibility — blocking

**Why it matters.** The agent fetches `releases/latest/download/latest.json`
anonymously. Public repo ⇒ works. Private repo ⇒ 404 for every agent, forever,
and no amount of fixing the build changes that (A.6). It also decides whether
the push trigger costs anything (A.3).

**How to check.** Settings → General → Danger Zone shows current visibility, or:

```bash
curl -s https://api.github.com/repos/Mohammed-HeshamMohammed/Virtual-Tracker | grep '"visibility"'
```

**✅ ANSWERED: the repo will be private.** The API says `public` today, so the
change is still to come — but plan for private, since a design that only works
until someone flips a setting is not a design.

**What it means.** The GitHub endpoint is dead: the agent cannot authenticate
and must not be given a token to try. The feed moves to Landing-Backend
(**A.8**), the runner-minute cost is real again (A.3), and — because the
endpoint is compiled into the binary — **every installed agent needs a manual
reinstall to be pointed anywhere new** (A0 in §D). This one answer is why the
phasing changed.

**But the design must not depend on this answer.** A.10 works through public,
private, and the transition between them. Three things follow that are easy to
miss if you only plan for the end state:

- The A.8 feed is correct for **both** visibilities, so adopt it even if the
  flip is postponed indefinitely (A.10.1). Staying on the GitHub endpoint while
  public means one settings toggle permanently strands the fleet.
- 🔴 **`GITHUB_PAT` must be set before the flip**, or `/api/download` returns
  500 and the download button dies — the very path the manual rollout needs
  (A.10.2).
- **Do the rollout while still public** (A.10.4/A.10.6): that is the only window
  where the old endpoint still resolves and installers are trivially reachable.

## F.2 🔴 Which keypair is in `TAURI_SIGNING_PRIVATE_KEY` — blocking

**Why it matters.** A.2 — there are two public keys in the repo and only one of
them matches `tauri.conf.json`. Sign with the wrong half and the first release
that agents *can* see is one they all reject, permanently, with no way back
except a hand-rolled installer.

**How to check.** Settings → Secrets and variables → Actions confirms the
secret *exists* but not its value — GitHub will not show it back to you. So
check it against the copy you generated it from:

```bash
# on the machine that holds the private key
minisign -R -s /path/to/updater-key.pem -p /tmp/derived.pub && cat /tmp/derived.pub
# must print:  untrusted comment: minisign public key: 8216A44B8570A492
```

**✅ ANSWERED: unknown — and it no longer matters.** F.1 already forces a
manual reinstall of every agent, and no agent has ever successfully verified
anything against the old key, so there is no installed base to keep compatible.
**Generate a fresh keypair and put it in that build** (A.8.4). This is the one
moment when changing the key is free; after A0 it goes back to being the
two-release dance in A.6.

**Still do the archaeology-proofing part:** store the new private key and
password in a password manager as well as in Actions secrets, and land the CI
assertion (A.4 step 4) so this question is never unanswerable again.

## F.3 🔴 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` correctness — blocking

**Why it matters.** A wrong or missing password fails the *build*, not the
release — loudly, but only after paying for three matrix builds.

**✅ ANSWERED: unknown — moot for the same reason as F.2.** The new keypair
comes with a password you choose and record now. The CI assertion in A.4 step 4
verifies it on the cheap Linux runner before the matrix, so a wrong password
costs seconds rather than three builds.

## F.4 🔴 Can `github-actions[bot]` push to `main` unattended — blocking for A2

**Why it matters.** The `bump` job commits and tags on `main`. It works today
because someone dispatches it and watches. Under a push trigger it happens
unattended, and a branch-protection rule added later turns every release into a
failed run — with a tag already pushed and no release behind it (A.6).

**⚠️ ANSWERED: possibly not.** "Possible" is a bad answer here, because the
failure is unattended and lands *after* a tag has been pushed — a version that
exists in git and nowhere else.

**Resolved by removing the requirement.** A.9 makes the tag the source of
truth, so `bump` never writes to `main` at all. That also deletes the
re-trigger loop (A.5) as a class of bug rather than guarding against it.

**One thing still to check:** are *tags* protected? Settings → Rules → tag
rulesets. If they are, the fallback is a bot-owned `release/*` branch with the
tag cut from there — not going back to pushing `main`.

## F.5 🟠 Are your users local administrators?

**Why it matters.** §2 — `installMode: perMachine` writes to `%ProgramFiles%`.
Non-admin users get a UAC prompt they cannot satisfy, on every launch. This is
the single decision (C.1) that determines whether auto-update can work at all
on the fleet you actually have, and it is a fact about their IT setup, not
about this code.

**How to check.** Ask whoever manages the machines. Failing that, on one
representative machine: `net localgroup Administrators` and see whether the
logged-in user is in it.

**A bad answer means.** Non-admins ⇒ switch to `currentUser`, which needs a
one-time manual reinstall across the fleet (§2). Better to know before shipping
an update mechanism that will never complete.

## F.6 🟠 What versions are actually installed out there

**Why it matters.** Every plan phase assumes the fleet runs *something*
recent. If machines are on 0.4.9 from August, the first successful update is a
13-version jump — fine mechanically (§5.3, "several versions behind"), but it
means any assumption about what the installed client does is wrong, including
the `App.tsx` behaviour described in §B.0.

**How to check.** The agent already reports to the backend on session actions;
if it sends a version, query it. If it does not, that is worth adding *before*
auto-update, because it is also how you will tell whether updates are landing.

**A bad answer means.** No visibility ⇒ you will not be able to tell A1 worked,
only that CI is green — which is what it has been all along.

## F.7 🟠 Is `WINDOWS_CERTIFICATE` set?

**Why it matters.** The workflow already treats Authenticode as optional
(`HAS_WINDOWS_CERT`), and no signature makes SmartScreen and AV more likely to
block **the installer the updater downloads and runs** — an update that
downloads, verifies, and then quietly does nothing (§5.4).

**How to check.** Settings → Secrets: does `WINDOWS_CERTIFICATE` exist? Or look
at any recent Windows job: the "import Windows Authenticode certificate" step
shows `skipped` when it is absent — it did on `agent-v0.4.21`.

**A bad answer means.** Not blocking, but it moves "AV blocked the installer"
from unlikely to expected, so budget for the reporting in B3.

## F.8 🟠 Which platforms do you actually support?

**Why it matters.** A.6 — `macos-latest` is Apple Silicon only, so Intel Macs
get no `darwin-x86_64` entry and silently never update. Same for Windows arm64.

**How to check.** Look at the fleet, not at the matrix.

**A bad answer means.** Intel Macs in use ⇒ add a `macos-13` matrix entry.
None ⇒ write that down in the plan so the gap is a decision rather than an
oversight.

## F.12 🟠 Does the agent work behind corporate TLS interception?

**Why it matters.** `reqwest` is built `default-features = false` with
`rustls-tls` ([Cargo.toml:43](Tauri-App-Extension/src-tauri/Cargo.toml:43)),
which in reqwest 0.12 trusts the **bundled Mozilla root set**, not the Windows
certificate store. Many corporate networks terminate TLS at a proxy and present
a private root CA that is pushed into the Windows store — every browser on the
machine trusts it; a webpki-roots client does not.

If that applies, the agent cannot reach the API **at all** — this is not an
update-only problem, and it would present as "the product does not work at this
customer" rather than anything update-shaped. It is listed here because it is
the failure mode most likely to be misdiagnosed as an updater bug.

**How to check.** On a machine behind the proxy:

```powershell
# Does the agent's own HTTP stack get through?
#   - browser works but this fails  => webpki-roots is the cause
#   - both fail                     => ordinary network/firewall issue
curl.exe --ssl-no-revoke -sS -o NUL -w "%{http_code}
" https://<api-host>/health
```
Then check the agent log for TLS/certificate errors on `post_events`.

**Answer:** ❓ open — and only reachable by testing on a real corporate network.

**What it means.** If confirmed, switch the feature to
`rustls-tls-native-roots` so the OS trust store is used. One line, but it must
be in the A0 rollout build: an agent that cannot reach the API also cannot be
updated to a version that can.

## F.9 Repo-wide `releases/latest` — is it still safe?

**Why it matters.** A.6 — `releases/latest` is repo-wide. Every release here is
an agent release *today*. The first time a backend or dashboard release is
published from this repo, it becomes "latest" and the agents' endpoint starts
serving a release with no `latest.json` on it.

**How to check.** Are there plans to tag or release any other component from
this monorepo?

**✅ FIXED IN PASSING.** The A.8 backend feed filters releases to `agent-v*`
tags (A.8.3 step 1), so a future backend or dashboard release cannot become the
agents' "latest". One line, because the feed is now code you own rather than a
GitHub convention you inherit.

## F.10 Actions minute budget and concurrency

**Why it matters.** Only if F.1 comes back private. Then A.3's cost analysis is
live again and you want the actual number.

**How to check.** Settings → Billing → Actions minutes used this month, against
the ~15 min a release run currently takes across three platforms.

## F.11 The one end-to-end test nobody can do for you

**Why it matters.** A.7 items 1–3 can be asserted in CI. Item 4 cannot: install
release N on a clean Windows VM, publish N+1, launch it, watch it update. Every
piece of this plan can be individually correct and the whole still fail — on
UAC, on AV, on a proxy, on a key mismatch. Do it once, by hand, before trusting
the mechanism with the fleet.

**A bad answer means.** Whatever it means, you found it on one VM instead of on
everyone's machine at once.

## Summary

| # | Check | Answer | Where it lands |
|---|---|---|---|
| F.1 | Repo public or private | **Private** | Feed moves to Landing-Backend (A.8) — correct for **both** visibilities (A.10.1); manual rollout A0. 🔴 **Set `GITHUB_PAT` before flipping** or `/api/download` 500s (A.10.2) |
| F.2 | Which keypair is in the secret | 🔴 **check first** | Decides whether A0 happens at all (H.4.3). Old key present ⇒ bridge release, no manual rollout |
| F.3 | Signing key password | *Unknown* | Moot — same |
| F.4 | Bot can push to `main` | *Possibly not* | Tag-driven versioning (A.9). **Still check: tag rulesets** |
| F.5 | Users are local admins | ❓ **open** | Picks the deployment shape in H.3.1 — B (`currentUser`, self-update) or C (IT-deployed, self-update off). **Must be answered before A0** |
| F.6 | Installed versions in the field | ❓ open | Fold version reporting into A0 or stay blind |
| F.7 | Authenticode certificate | ❓ open | Into A0 if obtainable; else expect AV blocks |
| F.8 | Intel Mac / arm64 Windows in use | ❓ open | A3, or write off explicitly |
| F.9 | Future non-agent releases here | — | ✅ fixed by the `agent-v*` filter in A.8.3 |
| F.10 | Actions budget | — | Live again now that private is decided (A.3) |
| F.11 | One manual end-to-end update | 🔴 | Do it on a VM before A0, not during |
| F.12 | Corporate TLS interception | ❓ open | webpki-roots vs the Windows store (5.8). If it bites, the agent fails wholesale, not just updates — one-line fix, but it must be in A0 |

**Two things gate the one build you get to hand out — and one decides whether
you hand out anything at all.**

**F.2 comes first now.** H.4.3 shows the manual rollout is only unavoidable if
the original signing key is unrecoverable. Checking one secret can delete the
single most expensive step in this plan.

**F.5 is the critical path.** It is the last open answer that can still
change what goes into the one build you get to hand out, and unlike the others
it cannot be fixed later by an update — a `perMachine` agent that cannot
elevate is an agent that never updates itself.

**A.10.2 is the critical *order*.** It changes nothing about what to build, but
getting it backwards breaks the distribution channel the rollout runs on:
set `GITHUB_PAT`, verify `/api/download`, do the rollout, *then* flip
visibility. Free to get right, expensive to get wrong.

# PART G — What this plan deliberately does not do

- **No delta/patch updates.** Full installer replacement is what the plugin
  does and the installer is ~4 MB — see **G.1** for the measurements and why
  splitting the artifact would make this harder, not easier.
- **No custom update server** beyond the thin feed A.8 forces. F.1 (private
  repo) took the zero-backend option away; the answer is still the smallest
  possible one — three routes over the release metadata Landing-Backend already
  fetches, with GitHub storing and serving the bytes and minisign, not the
  backend, deciding what is trustworthy. Not a build system, not an artifact
  store, not a rollout engine (U5 can add that later, cheaply, on top).
- **No rollback-to-previous.** Quarantining a bad version and stopping is
  enough; automatic rollback needs two known-good binaries on disk and a
  supervisor, which is a much larger thing to get right than to want.
  `// ponytail: quarantine, not rollback - revisit only if a bad release
  actually ships and quarantine proves insufficient.`
- **No release-per-commit granularity beyond patch.** Push to `main` always
  bumps patch; minor and major stay deliberate manual acts.

## G.1 Why the update is one whole installer, and why that is not the problem

A reasonable objection: every update re-downloads the entire ~4 MB installer
even for a one-line change. Doesn't shipping one fat artifact make updating
harder than shipping loose files you could replace individually?

**Where the 4 MB actually is.** Measured on `agent-v0.4.22`:

| Artifact | Size | |
|---|---|---|
| `x64-setup.exe` (NSIS — what Windows updates download) | **4.06 MB** | |
| `x64_en-US.msi` | 5.98 MB | |
| `aarch64.dmg` | 5.25 MB | |
| `amd64.AppImage` | **77.91 MB** | bundles the whole GTK/WebKit runtime — Linux only, not a shipped target |
| Built frontend (`dist/`, embedded into the binary) | **~344 KB** | `index.js` 290 KB + `index.css` 54 KB |

So the webview app is **about 8% of the download**. The other ~92% is the
compiled Rust binary and its dependency tree — tokio, reqwest + rustls, the
image encoder, `xcap` screen capture, the Tauri/wry webview bindings. That is
one native executable. There is no "ship it as loose files" option for it;
splitting is only meaningful for the 344 KB of frontend.

**What is already loose.** Two files ship beside the binary rather than inside
it — `get-browser-url.ps1` and `get-browser-url-macos.applescript`
(`bundle.resources`). Which is a useful demonstration of the trade: those are
exactly the files an employee could edit to change what the agent reports, and
the AV plan already flags the PowerShell one as the single loudest malware
heuristic in the product. Loose files are not free.

**Why embedding is the right default here specifically.** This is monitoring
software whose output people have an incentive to influence:

- Embedded UI and logic can only be altered by patching a signed binary.
  Loose JS beside the exe can be edited by anyone who can write to the install
  directory — and the whole point of §2's `perMachine`/`currentUser` question
  is that some deployments put that directory inside the user's own profile.
- One artifact, one signature. Loose files each need signing, or you trust an
  unsigned manifest, which is a strictly weaker chain than the minisign
  signature the updater already verifies.
- **Partial-update states cannot happen.** A file-by-file update that fails
  halfway leaves new UI against old Rust, or vice versa — the failure mode
  §5.6 already calls the dangerous one. Installer replacement is closer to
  atomic, and its failure mode is "old version still runs", which is safe.

**Is 4 MB worth optimising?** No. A 500-machine fleet updating monthly moves
~2 GB/month in total, from an object store behind a redirect. Against that,
delta updates would need a patch format, a per-version patch matrix, a
fallback to full download, and their own signature story — several hundred
lines of security-relevant code to save a few megabytes nobody is paying for.

**What actually makes updating hard here** — none of which loose files would
improve, and two of which they would make worse:

| Real difficulty | Where | Would loose files help? |
|---|---|---|
| No `latest.json` has ever been produced | A.1 | No |
| Restarting stops the user's timer | B/§1 | No |
| `perMachine` needs elevation the user lacks | §2 | No — the write target is the same |
| The endpoint is compiled into the binary | A.10.6 | **Marginally yes** — a loose config file could be repointed without a reinstall. But it would also let anyone repoint the agent's update feed, which is a far worse trade |
| Mixed versions across users on one machine | §5.6 | **Worse** — more moving parts to get out of step |

`// ponytail: one signed artifact, full replacement. The 4 MB is not the
// bottleneck; the restart and the elevation are.`

# PART H — Solving the four hard problems

G.1 ended by naming the four things that actually make updating hard here.
A.4 solves the first. This part solves the other three — and shows that one of
them silently decides another.

| # | Problem | Where | Solved by |
|---|---|---|---|
| P1 | No `latest.json` has ever been produced | A.1 | ✅ A.4 — one config key plus a CI assertion |
| P2 | Applying an update stops the user's timer | §1 | **H.2** |
| P3 | `perMachine` needs elevation the user does not have | §2 | **H.3** |
| P4 | The endpoint is compiled into every deployed binary | A.10.6 | **H.4** — and it turns on F.2 |

## H.2 P2 — Applying an update without stopping the timer

### H.2.1 The mechanism that makes this easy

Tauri v2's updater already splits the two halves this design needs:

```ts
const update = await check();
await update.download();   // fetch + verify signature. Safe at ANY time.
await update.install();    // replace the binary. Safe only at a safe point.
```

Today's code calls `downloadAndInstall()`
([App.tsx:203](Tauri-App-Extension/src/App.tsx:203)), which fuses them and is
the entire cause of P2. **Splitting that call is most of the fix** — download
eagerly whenever an update appears, install only when restarting is free.

### H.2.2 Where the decision lives

Not in `App.tsx`. That effect only runs while a window exists, and this app
spends most of the day in the tray with the window closed (`start_hidden` is a
supported preference). An update policy that cannot run headless is not a
policy.

The tracker tick already does periodic work of exactly this shape —
`maybe_refresh_display_names`, `maybe_refresh_activity_scoring`. Add
`maybe_apply_staged_update` beside them, reusing the interval-and-backoff
pattern already there.

### H.2.3 The safe-point predicate

One pure function, which is the whole design and therefore the thing to test:

```rust
/// A restart is free only when nothing is mid-flight that a restart would
/// destroy. Deliberately conservative: staying staged costs a delay, applying
/// at the wrong moment costs someone their tracked time.
pub fn is_safe_to_apply(s: &AgentState) -> SafePoint {
    if s.session_open     { return SafePoint::No("session open"); }   // active OR paused
    if s.sign_in_pending  { return SafePoint::No("auth callback server live"); }
    if s.upload_in_flight { return SafePoint::No("post in progress"); }
    if s.os_shutting_down { return SafePoint::No("shutdown signalled"); }
    SafePoint::Yes
}
```

`session_open` covers active **and** paused deliberately — a pause is still an
open session server-side (§5.1), and ending one mid-break looks to a manager
exactly like the employee stopped working.

### H.2.4 Staged state must survive a restart

Persist it beside the other agent state, atomically, in the shape §5.7 asks for:

```jsonc
// <data-dir>/pending-update.json
{ "schema": 1, "version": "0.4.23", "installer": "…/staged/setup.exe",
  "downloaded_at": "…", "attempts": 0 }
```

- `schema` from the first version — §5.7's whole point.
- Re-verify the file at install time (§5.2): a staged installer can be
  quarantined by AV or deleted between download and apply.
- `attempts` feeds the crash-loop guard (§5.4). Three failed applies of the
  same version ⇒ quarantine it and stop.

### H.2.5 Every case, resolved

| Situation | Download | Install |
|---|---|---|
| Idle agent, no session | now | now |
| Tracking | now | on stop/quit |
| Paused | now | on resume→stop, or quit |
| Idle escalation already stopped the session | now | now |
| Sign-in in progress | now | after the callback completes |
| Window hidden, tracking | now | on stop/quit |
| User clicks "check now" while tracking | now | **offer**, with the cost stated: "this will stop your timer" |
| OS shutting down | — | never start; the next launch applies it |
| Agent quit before a safe point arrived | already staged | on next launch, before tracking begins |

**The last row is what makes this work in practice.** An employee who never
manually stops their timer still gets the update, because quitting the app — or
the machine restarting — is itself a safe point, and the staged installer is
still on disk.

### H.2.6 What ships first

**U1 is a few lines and removes the damage**, before any of the machinery above:

```diff
- await update.downloadAndInstall();
- await relaunch();
+ await update.download();                 // safe at any time
+ if (!(await isSafeToApply())) return;    // staged; retry on a later tick
+ await update.install();
```

Even with the check implemented crudely — "is there an open session?" over the
existing session state — that turns "silently stops your timer" into "waits".
The rest of H.2 makes it robust; U1 makes it stop being harmful.

## H.3 P3 — Elevation, per deployment shape

There is no single answer, because there are three genuinely different
deployments and the right choice differs between them. What is *not* an option
is the current combination: `perMachine` + self-update + non-admin users
silently produces an agent that can never update itself.

### H.3.1 The three shapes

| Shape | Install mode | Who updates | Verdict |
|---|---|---|---|
| **A. Self-service, users are local admins** | `perMachine` | The agent | Works, but every update raises UAC. Training employees to click through UAC prompts from a monitoring agent is its own security problem |
| **B. Self-service, users are NOT admins** | **`currentUser`** | The agent | **The only shape where silent auto-update works.** Installs to `%LOCALAPPDATA%`; no elevation, ever |
| **C. IT-deployed (Intune / GPO / SCCM)** | `perMachine` (MSI) | **IT, not the agent** | Correct for managed fleets. The agent should *disable* self-update here and let the deployment tool own versioning |

### H.3.2 The recommendation

**Ship B as the default, support C explicitly, and stop treating A as viable.**

- B is what makes the feature work for the typical customer.
- C is what enterprise IT will insist on anyway, and it is nearly free: the MSI
  is already built (`targets: "all"`), and "do not self-update" is a flag.
- A is the current state and the worst of both — elevation prompts *and* a
  self-updater that mostly fails.

### H.3.3 Making C real: one setting

```jsonc
// preferences.json, overridable by a machine-level value IT can push
{ "autoUpdate": "enabled" | "notify-only" | "disabled" }
```

- `disabled` for shape C, set by the deployment package. The agent still
  *reports* its version (F.6) so IT can see drift; it simply never installs.
- `notify-only` for shape A: surface that an update exists rather than raising
  UAC unprompted.
- Read it from a machine-level source IT can push, **not only** the
  user-writable preferences file — otherwise an employee can switch off their
  own updates, which on a monitoring agent is a policy hole rather than a
  preference.

### H.3.4 Migrating `perMachine` → `currentUser` (D3)

One-way, and it needs care: to Windows these are two different products.

| Case | Behaviour |
|---|---|
| Fresh machine | Installs to `%LOCALAPPDATA%`. Nothing to migrate |
| Existing `perMachine` install | The new installer does **not** replace it. Both can exist and both can autostart. **The A0 rollout must uninstall the old one first** |
| Two users on one machine sharing a `perMachine` install | Each now needs their own install; the shared one must go, or §5.6's mixed-version case becomes permanent |
| User data (`~/.virtualtracker`) | Untouched by either installer — queue, progress and credentials survive. **Verify explicitly during A0** rather than assuming |
| Autostart entry | `tauri-plugin-autostart` writes `HKCU\…\Run` in both modes so it survives, but a stale entry pointing into `Program Files` must be cleaned |

**A0 is the only cheap moment to do this**, because it is already a manual
touch on every machine. Later means a second one.

## H.4 P4 — The compiled-in endpoint, and the question that decides it

### H.4.1 Reaching an already-deployed agent needs two things

An installed agent acts on an update only if it gets **both**:

1. a `latest.json` at the URL compiled into it —
   `github.com/Mohammed-HeshamMohammed/Virtual-Tracker/releases/latest/download/latest.json`, and
2. a signature over it verifying against the pubkey compiled into it —
   minisign **`8216A44B8570A492`**.

Miss either and the fleet is unreachable. They fail for different reasons, and
only one is fixable by choice.

### H.4.2 The URL half is solvable — without touching any machine

GitHub redirects a renamed repository, and a **new** repository created under
the old name takes that name over. So:

1. rename `Virtual-Tracker` → `Virtual-Tracker-Source`, then make it private;
2. create a **new public repo** named `Virtual-Tracker` holding nothing but
   releases;
3. publish agent releases into it from the private repo's workflow.

Existing agents keep resolving
`.../Virtual-Tracker/releases/latest/download/latest.json`, now served by the
releases-only repo. **The source goes private and the fleet stays reachable.**

Caveats, stated plainly:

- Release **binaries were already public** on a public repo. This changes
  nothing about their exposure; only source history moves behind the wall.
- That history does not vanish from forks or from cached object SHAs. If the
  worry is "the source was never meant to be public", this does not
  retroactively fix it — it stops future exposure.
- It fixes F.9 for free: the public repo holds *only* agent releases, so
  `releases/latest` cannot be hijacked by a future backend release.

### H.4.3 The signature half turns on F.2 — and that is the real gate

Producing a `latest.json` that deployed agents *accept* requires signing with
the private key for `8216A44B8570A492`.

| F.2 / F.3 outcome | What becomes possible |
|---|---|
| **The secret holds `8216A44B…` and the password is known** | **No manual rollout.** Ship a *bridge release* signed with the old key (H.4.4); the fleet updates itself onto the new endpoint and new key |
| The secret holds `ED55D4ADD4061EE2`, or the password is lost | **Manual rollout is forced.** Nothing you can sign will be accepted by a deployed agent, and A.8.4's "generate a fresh key, it is free" applies exactly as written |

> **This reframes A.8.4.** A fresh keypair is free *only after* accepting the
> manual rollout. If the original key is recoverable, checking F.2 first is
> worth real money — it is the difference between touching every machine and
> touching none.
>
> **Check F.2 before doing anything else in this plan.**

### H.4.4 The bridge release (only if F.2 is favourable)

One release whose only job is to move the fleet, signed with the **old** key:

| It carries | Why |
|---|---|
| The new endpoint (Landing-Backend, A.8) | The point of the exercise |
| The **new** pubkey in `tauri.conf.json` | Rotates the key going forward |
| `createUpdaterArtifacts` (A.4) | So it can itself produce updates |
| The U1 guard (H.2.6) | So the first update the fleet ever applies does not stop anyone's timer |
| `currentUser` install mode (H.3), if chosen | The one-way change, done once |

Signed with the old key so deployed agents accept it; every release *after* it
is signed with the new key, which that release has just installed. This is the
standard two-release rotation, and it is why a new pubkey must ship one release
ahead of the key that signs with it.

**The order is unforgiving:** publish the bridge, confirm real agents have
taken it (F.6 version reporting, or wait out the check interval), *then* rotate
the signing secret. Rotate first and the bridge itself becomes unverifiable.

### H.4.5 Preventing a third occurrence

The endpoint stays compiled in, and that is correct — A.10.6 explains why a
loose, editable endpoint is worse. What changes is *what it points at*:
infrastructure you control, rather than a GitHub URL whose behaviour depends on
a repository setting. Landing-Backend can be repointed, cached, versioned or
failed over without touching a single machine. This class of problem does not
recur.
