# Plan: a legacy Windows build of the agent (Windows 7, 8 and 8.1)

Revision 2, 2026-10-08. Agent version at time of writing: 1.1.10.

**Status: plan only. No product code has been changed and no legacy build
has been produced or run.** Revision 2 replaces assumptions from revision 1
with things that were actually checked: the dependency sources, the import
table of an existing build, and upstream documentation. What was checked and
how is listed under "Evidence". What is still an assumption is listed under
"Still unverified", each with the gate that settles it.

## Summary

- Build one extra variant of the same agent for Windows 7 SP1, 8 and 8.1.
  It ships its own copy of the WebView2 109 files inside the app folder, so
  nothing has to be installed on the member's machine (Route A).
- The agent is currently on the **last Tauri line that can run on Windows 7**
  (2.11). Tauri 2.12 dropped Windows 7. The agent's `Cargo.toml` allows any
  2.x, so an ordinary dependency update would end this plan. Freezing that is
  the first action.
- The existing build cannot start on Windows 7 for five separate reasons
  found in its import table. Four have a known fix in this plan. One depends
  on a Windows update being present and has to be tested on a real system.
- The one hard external dependency is a **Windows 7 machine to test on**.
  Everything up to gate G1 can be done without it. Nothing after G1 can.

## Who this is for

| Windows | Members | Priority |
| ------- | ------- | -------- |
| 7 SP1   | 1       | Highest  |
| 8       | 3       |          |
| 8.1     | 1       |          |

A build that runs on Windows 7 also runs on 8 and 8.1, so Windows 7 is the
target. Windows 8 and 8.1 need strictly less: the import audit shows they
already have every system DLL the build asks for except the C runtime.

## Decisions made

| Date | Decision |
| ---- | -------- |
| 2026-10-08 | Windows 7 is the highest priority. |
| 2026-10-08 | WebView2 cannot be installed on these machines. Hard constraint. |
| 2026-10-08 | **Route A**: bundle the WebView2 109 fixed-version runtime in the app folder. Route B (no WebView2 at all) is the fallback only. |
| 2026-10-08 | Windows 11 Smart App Control is deferred. No code-signing certificate while the app is in development. |
| 2026-10-08 | Windows 7 machine is on Service Pack 1. Bitness of the five machines is unknown. |
| 2026-10-09 | One Download button for everyone. The download page detects old Windows and hands over the legacy installer. No wrapper installer that contains or downloads both builds. |

## Decisions needed from the owner

1. **Freeze the whole agent on Tauri 2.11 while the legacy build exists.**
   Recommended. The alternative is a second manifest and lockfile for the
   legacy build, which is more work and is described under "Dependency
   freeze". Either way, `tauri = "2"` must stop floating.
2. **Ship one 32-bit legacy build.** Recommended, because bitness is unknown
   and a 32-bit build runs on both. The alternative is two builds, two
   WebView2 runtimes and a doubled test matrix.
3. **A Windows 7 SP1 machine for testing**: a VM with the owner's own
   licence and media, or remote access to the member's real machine. Without
   one of these the plan stops at gate G1.
4. **Which WebView2 109 build to ship.** See "WebView2 109 runtime".

## Evidence

What was checked for revision 2, and how.

| # | Finding | How it was checked |
| - | ------- | ------------------ |
| E1 | The agent resolves to `tauri` 2.11.5, `wry` 0.55.1, `tao` 0.35.3, `webview2-com` 0.38.2. The JS side is `@tauri-apps/api` 2.11.1 and `@tauri-apps/cli` 2.11.4. | `Cargo.lock`, `package-lock.json` |
| E2 | Tauri 2.12 ended official Windows 7 support and raised its minimum Rust to 1.90. `wry` 0.57 moved to `windows` 0.62, recorded upstream as dropping Windows 7. | Tauri 2.12 announcement, `wry` changelog (see Sources) |
| E3 | `windows-core` 0.62 links `CoTaskMemAlloc`, `CoTaskMemFree`, `CoIncrementMTAUsage` and `CoCreateFreeThreadedMarshaler` to `combase.dll`, which Windows 7 does not have. 0.61 links them to `ole32.dll`. | `windows-core-0.62.2/src/imp/bindings.rs`, `windows-core-0.61.2/src/imp/` |
| E4 | `windows-core` 0.62.2 is already in the agent's tree. The only crate that pulls it in is `iana-time-zone` 0.1.65, a direct dependency. | `cargo tree --locked -i windows-core@0.62.2` |
| E5 | `iana-time-zone` on Windows uses the WinRT class `Windows.Globalization.Calendar`. | `iana-time-zone-0.1.65/src/tz_windows.rs` |
| E6 | The only other WinRT user in the tree is `tauri-winrt-notification` 0.7.3, reached through `tauri-plugin-notification` and `notify-rust`. None of `tauri`, `wry`, `tao`, `tray-icon`, `muda`, `webview2-com` or the other plugins use WinRT namespaces. | grep of each crate's source |
| E7 | The notification plugin's `windows7-compat` feature picks the Windows 7 path **at runtime**. The WinRT path stays compiled into the binary. | `tauri-plugin-notification-2.4.0/src/desktop.rs` lines 245 to 258 |
| E8 | The existing build imports 30 DLLs and 490 functions. See "Import audit". | Import table of `target/debug/virtual-tracker-agent.exe` (x64, built 2026-09-28) read with a throwaway PE parser |
| E9 | The build links the C runtime dynamically. There is no `.cargo/config.toml` and no `crt-static`. | Import table, repo and user cargo config |
| E10 | The WebView2 loader that `webview2-com-sys` links statically references `EventSetInformation`, in both x86 and x64. | String search of `WebView2LoaderStatic.lib` |
| E11 | Locked dependencies need Rust up to 1.89 (`aes` 0.9.3, `notify-rust` 4.18.0; many at 1.88). Building with an old stable Rust that still supported Windows 7 (1.77) is therefore not possible. | `rust-version` of every locked crate |
| E12 | `getrandom` 0.3.4 and 0.4.3 and `rustls-platform-verifier` 0.7.0 change behaviour on `target_vendor = "win7"`: a different random source, and smaller certificate-chain structs that match Windows 7. | Source of each crate |
| E13 | The Rust targets `x86_64-win7-windows-msvc` and `i686-win7-windows-msvc` are tier 3, support all of `std`, ship no prebuilt artifacts and are tested nightly by their maintainer. | rustc platform-support page |
| E14 | `tao` reaches every DPI and pointer API newer than Windows 7 through runtime lookup, not static imports. | `tao-0.35.3/src/platform_impl/windows/util.rs` and `event_loop.rs` |
| E15 | `wry` 0.55.1 requires WebView2 interfaces newer than 109 only in opt-in features: browser extensions (`ICoreWebView2Profile7`) and memory usage level (`ICoreWebView2_19`). The agent uses neither. | `wry-0.55.1/src/webview2/mod.rs`, grep of the agent |
| E16 | `xcap` 0.3.3 captures with GDI `BitBlt` and falls back to `GetDeviceCaps` when `Shcore.dll` cannot be loaded. | `xcap-0.3.3/src/windows/` |
| E17 | The agent's own Win32 calls all exist on Windows 7. | grep of every `windows::Win32` use in `src-tauri/src` |
| E18 | The autostart task XML is schema version 1.2, which Windows Vista and later accept. | `src-tauri/src/autostart_task.rs` line 53 |
| E19 | Fixed-version WebView2 above 109 fails to start on Windows 7, 8 and 8.1. 109 is the last line. Microsoft's download page only offers the latest two major versions. | Microsoft Edge blog and distribution docs |
| E20 | A third-party NuGet package `WebView2.Runtime.X86` lists versions 109.0.1518.61 and 109.0.1518.78. | nuget.org version index |
| E21 | The current WebView2 installer crashes on Windows 7. This is Tauri's stated reason for dropping it, and it means installing WebView2 was never a dependable option for these machines. | Tauri 2.12 announcement |
| E22 | `Tauri` config supports `webviewInstallMode: fixedRuntime`. | `tauri-utils-2.9.3/src/config.rs` |
| E23 | Frontend: `color-mix()` is used 7 times in `src/App.css` and needs Chromium 111. No JavaScript API newer than Chromium 109 was found. | grep of `src/` |
| E24 | `scripts/get-browser-url.ps1` line 97 uses `[Type]::new(...)`, which needs PowerShell 5. | Script source |

### Import audit

The existing x64 debug build was read for its import table. A debug build
probably keeps more imports than a release build, so this overstates. The
legacy release build must be audited again at gate G1.

Imports that Windows 7 SP1 cannot satisfy:

| Import | Comes from | Missing on | Fix |
| ------ | ---------- | ---------- | --- |
| `api-ms-win-crt-*.dll` (11 DLLs), `vcruntime140.dll`, `vcruntime140_1.dll` | Dynamic C runtime | 7, 8, 8.1 unless an update or redistributable happens to be installed | Static C runtime |
| `api-ms-win-core-synch-l1-2-0.dll`: `WaitOnAddress`, `WakeByAddressAll`, `WakeByAddressSingle` | Rust standard library | 7 | Windows 7 Rust target |
| `bcryptprimitives.dll`: `ProcessPrng`; `kernel32.dll`: `GetSystemTimePreciseAsFileTime` | Rust standard library, `getrandom` | 7 | Windows 7 Rust target |
| `api-ms-win-core-winrt-l1-1-0.dll`: `RoGetActivationFactory` | `windows-core`, used by `iana-time-zone` and `tauri-winrt-notification` | 7 | Remove both WinRT users from the legacy build |
| `combase.dll`: `CoCreateFreeThreadedMarshaler`, `CoIncrementMTAUsage` | `windows-core` 0.62 through `iana-time-zone` | 7 | Same |
| `advapi32.dll`: `EventSetInformation` | WebView2 loader | 7 without update KB2882822 **[unverified]** | Test on a clean Windows 7 SP1. If missing: installer prerequisite check, or a link-time shim. |

Everything else in `kernel32`, `user32`, `gdi32`, `shell32`, `ole32`,
`advapi32`, `crypt32`, `ws2_32`, `dwmapi`, `comctl32`, `propsys` and `ntdll`
was read by name and looks present on Windows 7. That reading was done from
memory of the Windows API, not against a Windows 7 export list, so gate G1
replaces it with a mechanical check.

## Still unverified

Each item names the gate that settles it.

| # | Assumption | Gate |
| - | ---------- | ---- |
| U1 | `tauri build` accepts the tier 3 target with `-Zbuild-std` and produces an NSIS installer. | G1 |
| U2 | C dependencies (`ring`, bundled SQLite) build for the `win7` target and for 32-bit. | G1 |
| U3 | After the fixes, the release build imports nothing Windows 7 lacks. | G1 |
| U4 | `EventSetInformation` is present on the members' Windows 7. | G2 |
| U5 | The WebView2 loader from the current SDK starts a 109 runtime on Windows 7. Microsoft says SDKs from 1.0.1519 on do not support Windows 7. Tauri shipped this loader while still supporting Windows 7. | G2 |
| U6 | The NuGet package's folder layout is the fixed-version layout Tauri expects, and every binary in it carries a valid Microsoft signature. | G1 |
| U7 | The async runtime and networking stack (`tokio`, `mio`) work on Windows 7. | G3 |
| U8 | The updater's certificate check passes with the root certificates on these machines. | G4 |
| U9 | `scripts/get-app-icon.ps1` runs on PowerShell 2. | G3 |
| U10 | WebView2 109.0.1518.140 contains the 2023 libwebp fix and 109.0.1518.78 does not. | Check Microsoft's Edge 109 release notes before choosing a build |
| U11 | Installer and update size with the runtime bundled. Microsoft states current fixed-version binaries are over 250 MB unpacked. | G1 |
| U12 | What old Chrome, Firefox and Brave on Windows 7, 8 and 8.1 report as their Windows version, in the user-agent string and through the platform-version hint. The download page's detection depends on it. | G2, by opening a test page in each browser on the test machine |

## Design

### Dependency freeze

Finding E2 makes this the first action, before any spike work.

- Pin `tauri` to `~2.11` in `src-tauri/Cargo.toml`, and the Tauri plugins to
  the versions in the current lockfile.
- Pin the JS packages `@tauri-apps/api` and `@tauri-apps/cli` to 2.11.
- Add a CI guard in the style of `.github/scripts/assert-updater-platform-trust.mjs`
  that fails when `Cargo.lock` shows `tauri` outside 2.11, `wry` outside
  0.55, `webview2-com` outside 0.38, or `windows-core` 0.62 or later in the
  legacy dependency tree.
- Cost: the modern build also stays on Tauri 2.11 and misses later Tauri
  fixes and features.
- Exit: when the modern build needs Tauri 2.12 or later, give the legacy
  build its own manifest and lockfile in a sibling folder that points at the
  same source files. That is a contained change, deferred until needed.

### Toolchain

- Target: `i686-win7-windows-msvc` (and `x86_64-win7-windows-msvc` only if
  decision 2 goes the other way).
- Toolchain: one pinned nightly date, with the `rust-src` component, and
  `-Zbuild-std`. The modern build stays on stable.
- An old stable Rust is ruled out by E11.
- The `win7` target is needed for more than the standard library: E12 shows
  two crates that only behave correctly on Windows 7 when built for it.
- Static C runtime: `-C target-feature=+crt-static`, set for the legacy
  target only.
- If `tauri build` rejects the tier 3 target (U1): build the exe with
  `cargo` directly and package it with `tauri bundle`.

### Removing WinRT from the legacy build

Two crates, two call sites.

| Crate | Used at | Legacy replacement |
| ----- | ------- | ------------------ |
| `iana-time-zone` | `src-tauri/src/client/api/session.rs` line 10, `local_timezone()` | Read the Windows zone name with `GetDynamicTimeZoneInformation` and map it to an IANA name with the CLDR `windowsZones` table. The function already returns `Option`, so an unmapped zone is `None`, which the server already handles. |
| `tauri-plugin-notification` | `src-tauri/src/lib.rs` lines 292 to 294 and 345, `src/utils/notify.ts` | One app command, `notify(title, body)`. The modern build implements it with the plugin. The legacy build implements it with the `win7-notifications` crate directly. The frontend calls the command in both builds. |

Mechanics:

- Both crates become optional dependencies behind a default `modern`
  feature. The legacy build uses `--no-default-features --features legacy-windows`.
- `src-tauri/capabilities/default.json` grants `notification:default`. With
  the plugin absent that permission does not exist, so the legacy config
  overlay selects a legacy capability file without it.

### WebView2 109 runtime

- **Why bundling is the only webview route**: E19 and E21.
- **Architecture**: the runtime must match the app. A 32-bit agent needs the
  x86 runtime, which runs on 32-bit and 64-bit Windows.
- **Sourcing options**, in order of preference:
  1. The original Microsoft package for 109, if an archived copy can still
     be obtained.
  2. The files from a machine that already has WebView2 109.0.1518.140
     installed. This is the newest 109 build.
  3. The third-party NuGet package (E20), version 109.0.1518.78.
- **Verification, whatever the source**: every `.exe` and `.dll` in the
  folder must carry a valid Microsoft Authenticode signature. The folder's
  SHA-256 manifest is recorded in the repo. CI refuses to bundle a runtime
  that does not match.
- **Storage**: not in git. A private release asset or CI cache, fetched by
  hash.
- **Wiring**: `bundle.windows.webviewInstallMode` set to `fixedRuntime` in
  the legacy config overlay.
- **Known limit**: a fixed-version runtime cannot run from a network or UNC
  path. The per-machine install under Program Files is fine.
- **Size**: every legacy installer and every legacy update carries the
  runtime. If measured size (U11) is a problem for these members'
  connections, the later optimisation is to install the runtime once in its
  own folder and point the app at it with the documented
  `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` variable. Not in scope until measured.

### Architecture: one 32-bit build

Side effects of a 32-bit agent on 64-bit Windows, to check at G3:

- The PowerShell it spawns is the 32-bit one.
- File-system redirection can change which icon is found for programs under
  `System32`.
- Reading the foreground process name, input hooks, UI Automation and
  screenshots are not affected by bitness.

### Release channel

Rule: a legacy agent is never offered a modern build, and a modern installer
never lands on an old system.

- **Channel identity lives in the binary.** Under the `legacy-windows`
  feature the updater is built with target `windows-legacy`, so the update
  URL becomes `/api/agent/update/windows-legacy/{arch}/{version}` even if
  the config overlay is forgotten.
- **Server rules** in `Landing-Backend/src/modules/update/update-routes.js`:
  - `windows-legacy` reads a separate manifest asset, `latest-legacy.json`.
  - A release without that asset answers 204 for `windows-legacy`. It never
    answers 503 and never falls back to the modern manifest.
  - Rollout percentage, minimum self-update version and forced-update floor
    apply to both channels.
  - A kill switch setting turns legacy updates off (always 204).
- **CI** in `.github/workflows/release.yml`:
  - A `windows-legacy` job with the pinned nightly and the overlay.
  - A distinct asset name, for example
    `My-Virtual-Tracker_v[version]_windows-legacy_x86-setup.exe`.
  - `includeUpdaterJson: false`. The job writes `latest-legacy.json` itself,
    so it cannot race the modern job over `latest.json`.
  - A failed legacy job must not block or unpublish the modern release.
- **Downloads: the page picks the installer.** This is the main install
  path. One Download button, the same for everyone; a member on Windows 7, 8
  or 8.1 is handed the legacy installer, everyone else the modern one. No
  wrapper installer, and modern members never download the bundled runtime.
  - **Where the button lives.** Both pages build the same link,
    `/api/download?platform=windows`:
    `Landing-Web/src/lib/site-urls.ts` and
    `Dashboard-Web/shared/ui/agent-download-choices.tsx`.
  - **Detection, in order.** The first that gives an answer wins.
    1. In the page, ask the browser for its platform version
       (`navigator.userAgentData.getHighEntropyValues(["platformVersion"])`,
       Chromium only). Windows 7, 8 and 8.1 report a major version of 0;
       Windows 10 and 11 report 1 or more. **[unverified]**
    2. Otherwise read the user-agent string: `Windows NT 6.1`, `6.2` or
       `6.3` is old Windows. Firefox reports this truthfully.
    3. Otherwise treat it as modern.
  - **Why the user-agent string alone is not enough.** Chromium froze the
    Windows version in its user-agent string at `Windows NT 10.0` around
    version 107 to 110, so Chrome 109 or Brave on Windows 7 may claim to be
    Windows 10. **[unverified]** Step 1 exists for that case.
  - **What the page sends.** When it detects old Windows it links to
    `/api/download?platform=windows-legacy`. The choice is made in the
    page, so the server never has to guess from a frozen string.
  - **Server** (`Landing-Backend/src/modules/download/download-routes.js`):
    - `findAsset` takes the first asset ending in `.exe` for Windows. It
      must skip `windows-legacy` assets there, and serve only those for
      `platform=windows-legacy`.
    - As a fallback for links opened directly, `platform=windows` with a
      user-agent of `Windows NT 6.1` to `6.3` is answered with the legacy
      installer.
    - A release with no legacy asset answers 404 for `windows-legacy` with
      a clear message. It never falls back to the modern installer.
  - **Safety nets for a wrong guess or a file passed along by hand.**
    - A small "Windows 7 or 8? Get this version" link under the button, on
      both pages.
    - The modern installer refuses to run below Windows 10 and names the
      legacy download (phase 4).
    - The legacy installer needs no check. It also runs on Windows 10 and
      11, so a wrong guess in that direction still gives a working app.

### Security notes

- The bundled WebView2 109 gets no security fixes. Its last update was in
  2023.
- The app only loads its own bundled pages, but its CSP allows images from
  any `https:` host (`tauri.conf.json`), and the UI shows avatars and
  screenshots (`SidebarFooter.tsx`, `ProfilePanel.tsx`, `ScreenshotsCard.tsx`).
  Image decoding in an unpatched Chromium is the realistic exposure.
- Legacy build: narrow `img-src` to the app itself, `data:`, `blob:` and the
  agent's own API host.
- Prefer the newest 109 build that can be sourced (U10).
- The modern installer's refusal to run on old systems (phase 4) keeps
  members from ending up on a build with a newer, incompatible runtime.

## Phases and gates

Effort is relative: S is hours, M is days, L is more than a week.

### Phase 0: Freeze (S)

1. Pin Tauri and its plugins (see "Dependency freeze").
2. Add the lockfile guard to CI.

Exit: a `cargo update` can no longer move the agent off the Windows 7 line.

### Phase 1: Spike (M)

On a throwaway branch. Four gates, cheapest first. Stop at the first failure
that has no fix inside phase 2.

**G1: it builds and the imports are clean. No Windows 7 machine needed.**

1. Make the two WinRT removals and the static C runtime, roughly, on the
   branch.
2. Build the release exe for the `win7` target with the pinned nightly.
3. Audit the import table again. Pass: no import from the table above
   remains, apart from `EventSetInformation`.
4. Obtain a 109 runtime, verify its signatures, bundle it, build the NSIS
   installer and record its size.

Settles U1, U2, U3, U6, U11.

**G2: it starts on Windows 7. Needs the test machine.**

1. Install on a clean Windows 7 SP1 with no WebView2 present.
2. Pass: the window opens and draws the sign-in screen.
3. Confirm nothing was written outside the install folder and the user's
   app-data folder.

Settles U4, U5. **This is the go or no-go for Route A.** A failure here that
cannot be fixed moves the plan to Route B.

**G3: it works.** Run the checklist under "Test matrix" on Windows 7.
Settles U7, U9.

**G4: it installs and updates.** Publish two legacy versions to a test
release and update from one to the other on the test machine. Settles U8.

### Phase 2: Legacy build variant (M)

| Change | Where |
| ------ | ----- |
| `modern` and `legacy-windows` features, optional WinRT crates | `src-tauri/Cargo.toml` |
| Windows zone to IANA lookup for the legacy build | `src-tauri/src/client/api/session.rs`, new small module |
| `notify` command with two implementations | `src-tauri/src/lib.rs`, `src-tauri/src/commands/`, `src/utils/notify.ts` |
| Updater target `windows-legacy` under the feature | `src-tauri/src/lib.rs` line 343 |
| Config overlay: fixed runtime, NSIS only, legacy capabilities, narrowed CSP | new `src-tauri/tauri.legacy.conf.json`, new legacy capability file |
| Static C runtime and build-std for the legacy target only | new `src-tauri/.cargo/config.toml` or CI flags, to be chosen at G1 so the modern build is unaffected |
| `supportedOS` entries for Windows 7, 8, 8.1 and 10 | `src-tauri/build.rs` |
| Plain-colour fallback before each `color-mix()` | `src/App.css` |
| `New-Object` in place of `[Type]::new(...)` | `scripts/get-browser-url.ps1` line 97 |
| Build variant constant, shown in About and sent to the server | `src-tauri/src/constants.rs` |

Exit: the modern build's tests and behaviour are unchanged, and the legacy
build passes G1 to G3 again from the real branch.

### Phase 3: Release channel (M)

As designed under "Release channel": the update feed, the CI job, the
download route and the detection on both download pages. Exit: G4 passes
against production infrastructure with a test release; a release with no
legacy asset is shown to answer 204 on the legacy update channel; and the
Download button hands the legacy installer to every browser tried on the
test machine and the modern one on Windows 10 and 11.

### Phase 4: Guardrails (S to M)

- **Import check as a repo script and CI step.** Compare the legacy exe's
  imports against an export list dumped once from a real Windows 7 SP1. The
  build fails on any import that list lacks.
- **Modern installer refuses old systems.** An NSIS hook in
  `src-tauri/windows/installer-hooks.nsh` stops below Windows 10 and names
  the legacy download.
- **Server visibility.** `report_agent_open`
  (`src-tauri/src/agent/controller/api.rs`) also sends the OS version and
  build variant. Agent Versions shows them and does not flag a legacy agent
  as outdated against the modern version. Touches `Dashboard-Backend`.
- **Lockfile guard** from phase 0 stays in place.

### Phase 5: Rollout (S)

1. The Windows 7 member installs by hand. Someone watches the first full day
   of tracking.
2. One Windows 8 member, then the remaining three.
3. The first automatic update is released to one machine through the rollout
   percentage before the rest.

## Test matrix

Systems: Windows 7 SP1 with no further updates, Windows 7 SP1 fully updated,
Windows 8, Windows 8.1. Windows 8 matters most by head count and is the
least commonly tested. Each run uses the real installed exe.

| Check | Pass |
| ----- | ---- |
| Download button, in old Chrome, Firefox and Brave | Each is handed the legacy installer |
| Install on a machine with no WebView2 | Completes with no download and no WebView2 installer |
| First launch | Window opens, sign-in screen draws correctly |
| Sign-in | Browser link flow and the `virtualtracker://` deep link both work |
| Tracking | Timer starts, screenshot captured and uploaded, visible in the dashboard |
| Activity | Foreground app and idle time recorded |
| URL capture | Works in old Chrome, Firefox and Brave, or fails quietly |
| Time zone | The session is booked to the right calendar day |
| Tray | Icon, menu, start, pause, quit |
| Notification | Shown in the Windows 7 style |
| Start at login | Scheduled task created, app starts after sign-in |
| Sleep and resume | Tracking pauses and resumes correctly |
| Offline queue | Activity recorded offline uploads after reconnect |
| Update | Legacy to legacy update succeeds and the app restarts |
| Uninstall | Removes the app, the runtime folder and the scheduled task |

## Rollback

- Legacy and modern are separate channels, so a bad legacy release cannot
  touch modern users.
- A bad legacy update: turn the legacy kill switch on (204 for everyone),
  then publish a fixed legacy version. Agents that already updated get the
  fix through the same channel.
- A legacy agent that will not start after an update: reinstall the previous
  legacy installer by hand. Sign-in and queued activity live in app data and
  survive the reinstall.
- Phases 0 and 2 are ordinary code changes and revert as such.

## Maintenance and end of life

- New frontend code must keep working on Chromium 109 for as long as the
  legacy build exists.
- Dependency updates to the UI stack are frozen (phase 0).
- Legacy support is best-effort and is stated as such to members.
- Retire the legacy build when the last of the five members is off Windows
  7, 8 and 8.1, or when a security issue in the frozen stack cannot be
  mitigated. Retiring it lifts the Tauri freeze.

## Risks

| Risk | Effect | Mitigation |
| ---- | ------ | ---------- |
| No Windows 7 test machine | Plan stops at G1 | Decision 3 |
| The loader or runtime will not start on Windows 7 | Route A fails at G2 | Route B |
| The 109 runtime cannot be sourced with valid Microsoft signatures | No webview | Three sourcing options. Route B. |
| A later nightly breaks the tier 3 target | Legacy stops compiling | Pinned nightly date, moved only on purpose |
| A dependency update adds an import Windows 7 lacks | Legacy stops launching | Import check in CI, lockfile guard |
| The Tauri freeze blocks a fix the modern build needs | Modern build held back | Split manifests, described under "Dependency freeze" |
| WebView2 109 is unpatched | Security exposure through images | Narrowed CSP, newest 109 build |
| Large updates on slow connections | Updates fail or are skipped | Measure at G1. Split runtime install if needed. |
| Root certificates out of date on Windows 7 | Update checks fail, tracking still works | Test at G4. Document the fix for the one machine. |

## Route B: no WebView2 at all

The fallback if G2 fails. The agent has no window of its own. The Rust core
keeps running and the member's own browser shows the UI.

Carries over unchanged: capture, tracking, the offline queue, uploads,
sign-in tokens and autostart, which is everything under
`src-tauri/src/capture`, `src-tauri/src/agent`, `src-tauri/src/client`,
`src-tauri/src/auth` and `src-tauri/src/queue.rs`. The phase 0 freeze, the
toolchain, the WinRT removals, the static C runtime and the release channel
are all still needed.

| Has to be built | Detail |
| --------------- | ------ |
| Windowless start | **[unverified]** that the Tauri runtime starts with no WebView2 when no window is created. If not, a separate binary in the same crate. |
| Native tray menu | Today's tray menu is a webview window (`src-tauri/src/tray_menu.rs`). Needs Open, Start, Pause, Break, Quit as a native menu. |
| Local UI server | Serve `dist/` from `127.0.0.1` on a random port. `tiny_http` is already used this way in `src-tauri/src/auth/server.rs`. |
| Command bridge | One generic dispatch route for the 65 `#[tauri::command]` functions. |
| Frontend transport | Send `invoke` over `fetch` outside Tauri. `@tauri-apps/api/core` is imported in 10 files. |
| Events | Rust pushes to the UI from 2 places. Becomes server-sent events or polling. |
| Updates | The check starts in the UI today (`src/App.tsx`). Has to move to Rust. |

Security of the local server, required because the agent runs elevated:
bind to `127.0.0.1` only, a random secret per launch on every request, and
`Host` and `Origin` checks so another website cannot call the agent.

Lost: the frameless window and layout modes
(`src-tauri/src/window_layout.rs`) and the buzz window
(`src-tauri/src/buzz.rs`).

Browser floor: Chrome 109, Firefox ESR 115 or Brave on Chromium 109. Older
browsers get an "update your browser" page.

Smallest version: tray-only tracking with sign-in, and the existing web
dashboard for everything visual.

## Related: Windows 11 Smart App Control

**Deferred by the owner on 2026-10-08. Nothing here is scheduled.** Until
signing is possible, Windows 11 machines with Smart App Control on cannot
install the agent.

- Cause: releases are unsigned. `.github/workflows/release.yml` has signing
  steps but no certificate, and `require_windows_signing` is off.
- SmartScreen shows a warning the member can click past. Smart App Control
  blocks outright with no per-app override.
- The fix is signing every release with a certificate from a trusted
  authority: the installer, the app exe, the uninstaller and the update
  package.
- The current CI step imports a PFX file. Newly issued certificates keep the
  key on a hardware token or cloud service, so that step will need to call
  the provider's signing tool.
- **[unverified]** Smart App Control may require an RSA certificate, and may
  put PowerShell in a restricted mode where `Add-Type` fails. Both bundled
  scripts use `Add-Type`.
- Once releases are signed with SHA-256, Windows 7 needs update KB4474419 to
  verify them.
- There is no safe workaround to offer members. Turning Smart App Control
  off is their own security decision and should not be the official
  instruction.

## Sources

- [Announcing Tauri 2.12](https://v2.tauri.app/blog/tauri-2.12): Windows 7 support ended, minimum Rust 1.90
- [Tauri issue 12550](https://github.com/tauri-apps/tauri/issues/12550): discussion of dropping Windows 7
- [wry 0.57.0 release notes](https://v2.tauri.app/release/wry/v0.57.0/): `windows` 0.62 drops Windows 7
- [rustc platform support: win7-windows-msvc](https://doc.rust-lang.org/nightly/rustc/platform-support/win7-windows-msvc.html)
- [Rust blog: updated baseline standards for Windows targets](https://blog.rust-lang.org/2024/02/26/Windows-7/)
- [Rust users forum: building the win7 targets](https://users.rust-lang.org/t/how-to-build-rust-targets-win7-windows-msvc-myself/134976)
- [Microsoft: Edge and WebView2 ending support for Windows 7 and 8/8.1](https://blogs.windows.com/msedgedev/2022/12/09/microsoft-edge-and-webview2-ending-support-for-windows-7-and-windows-8-8-1/)
- [Microsoft: Distribute your app and the WebView2 Runtime](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- [Microsoft Q&A: WebView2 Runtime 109.0.1518.140 on Windows 7](https://learn.microsoft.com/en-us/answers/questions/1661814/latest-version-of-microsoft-edge-webview2-runtime)
- [NuGet: WebView2.Runtime.X86](https://www.nuget.org/packages/WebView2.Runtime.X86)
- [thunk-rs](https://docs.rs/thunk-rs/latest/thunk/): link-time shims for missing Windows APIs, a possible answer to U4. Third party and use-at-own-risk by its own description.
