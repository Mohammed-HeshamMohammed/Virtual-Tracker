# Plan: a legacy Windows build of the agent (Windows 7, 8 and 8.1)

Revision 4, 2026-10-14, agent 1.1.11: building started. Revision 3 (same day)
reinforced the plan; revision 2 was 2026-10-08, at 1.1.10.

**Status: being built. Every release now builds both versions by default
(owner's decision, 2026-10-14). Not yet run on Windows 7: see "Build status".** Revision 2 replaces assumptions from revision 1
with things that were actually checked: the dependency sources, the import
table of an existing build, and upstream documentation. What was checked and
how is listed under "Evidence". What is still an assumption is listed under
"Still unverified", each with the gate that settles it.

**What revision 3 changed.** Rechecked against the code at 1.1.11 and
against upstream sources:
- The freeze has still not been done: the agent is on Tauri 2.11.5 but
  `Cargo.toml` still says `tauri = "2"` (E25).
- How old Windows is detected on the download page is now settled from
  sources, and one assumption in it was wrong (E26 to E28, U12).
- The two WebView2 109 builds differ in a way that matters: only the newer
  one has the fix for an image flaw that was exploited in the wild. The
  only build that can be sourced easily is the older one (E29, U10).
- `EventSetInformation` is confirmed missing from Windows 7 before an
  update, and the WebView2 loader imports it (E30, U4).

## Build status (revision 4)

Done, uncommitted, in the working tree:

| Piece | Where | Checked how |
| ----- | ----- | ----------- |
| Freeze on Tauri 2.11 (phase 0) | `src-tauri/Cargo.toml` (`~2.11` etc.), `package.json`, `.github/scripts/assert-windows7-stack.mjs` in both workflows | Guard passes on the current lockfile |
| Two builds from one codebase | `src-tauri/Cargo.toml` features `modern` (default) and `legacy-windows` | `cargo check` of both passes; 308 library tests and 356 frontend tests pass on the normal build |
| No WinRT in the legacy build | `src-tauri/src/notify.rs` (own notification window, `win7-notifications`); time zone reported by the window (`report_local_timezone`, `src/main.tsx`) instead of `iana-time-zone`; frontend notifications go through the `show_notification` command | Import audit below |
| Legacy update feed | `src-tauri/src/lib.rs` `updater_plugin()` asks `windows-legacy` | Server tests below |
| ctor/dtor patched for the win7 target | `src-tauri/patches/ctor-0.8.0`, `dtor-0.3.0`, `[patch.crates-io]` | They refused the target outright, and would otherwise have dropped the start-up constructors silently |
| Windows 7 build | `i686-win7-windows-msvc`, nightly-2026-10-01, `-Zbuild-std`, `+crt-static` | **Built locally: 15 MB, 32-bit. Import audit: nothing Windows 7 lacks except `EventSetInformation` (U4).** The same audit fails the normal build with 13 missing imports, so the check works. |
| Legacy config | `src-tauri/tauri.legacy.conf.json`: NSIS only, fixed WebView2 runtime from `src-tauri/webview2-fixed-runtime/`, own installer hooks | U1 settled: `tauri build` refuses the tier 3 target ("does not exist"), so the release job compiles with cargo and packages with `tauri bundle --target i686-win7-windows-msvc`, which accepts it. Done locally with a placeholder runtime: a 32-bit NSIS installer came out, with the legacy hooks; the normal hooks also compile. Signing the updater artifact needs the release key, which only CI has. |
| Installer check | `windows/installer-hooks-shared.nsh` + `installer-hooks.nsh` (normal: stops below Windows 10 with the legacy link) + `installer-hooks-legacy.nsh` (no check) | Not yet run on old Windows |
| Release job | `.github/workflows/release.yml` `release-windows-legacy`: after the normal release, allowed to fail, fetches and verifies the runtime, builds, audits imports, uploads the installer and `latest-legacy.json` | Not yet run in CI |
| Runtime fetch | `scripts/fetch-webview2-runtime.ps1`: hash check, Microsoft signature on every file, refuses anything but 109.0.1518.140 unless `WEBVIEW2_ALLOW_OLDER=1` | **Sourced: 109.0.1518.140 x86 from Microsoft's own server** (Microsoft Update Catalog, "Microsoft Edge-WebView2 Runtime Version 109 Update for x86 based Editions", 132 MB, SHA-256 `60b22c71…6a31`). It is an Edge Update package; the script unpacks it with 7-Zip (never runs it) to the same files as the runtime. Run locally: 395 MB unpacked, version matches, every program file signed by Microsoft after dropping Google's Widevine video plugin (signed by Google, not needed). Repository variables `WEBVIEW2_RUNTIME_URL` and `WEBVIEW2_RUNTIME_SHA256` are set. |
| Server | `Landing-Backend` download route (`platform=windows-legacy`, never mixed with the normal installer, User-Agent fallback) and update route (`windows-legacy` reads `latest-legacy.json`, 204 when absent, kill switch `AGENT_LEGACY_UPDATES=off`) | 8 new tests, 31 pass |
| Download pages | `Landing-Web` and `Dashboard-Web` download cards: "Windows 10 / 11" and "Windows 7 / 8 / 8.1" always shown, each linking straight to its installer; the detected one marked "Your computer" | Seen in the landing page preview on Windows 11 |
| Chromium 109 CSS | `src/App.css`: a plain colour before each of the 7 `color-mix()` | |
| PowerShell 2 | `scripts/get-browser-url.ps1` line 97 uses `New-Object` | |

Found while building, and handled:

- **The program has to be told where its WebView2 is.** Tauri reads that from
  `tauri.legacy.conf.json` at compile time, but even with the file passed as
  `TAURI_CONFIG` the setting reached the library and not the optimised
  program, so it would have looked for an installed WebView2 these machines
  do not have. The legacy build now sets it itself at start-up
  (`use_bundled_webview2` in `src-tauri/src/lib.rs`), and the release job
  fails if the built program lacks it. Checked in the packaged installer: the
  runtime installs to `webview2-fixed-runtime\` beside the program, the
  folder that code points at.
- **Installer size with the real runtime: 141 MB (x86).** Every legacy update
  downloads this too (U11).

Still needed before the first legacy release:

1. **A Windows 7 machine** for gates G2 to G4. Nothing in this build has run
   on Windows 7, 8 or 8.1 yet.
2. Not done on purpose: `supportedOS` entries in the app manifest (not needed
   to start; changes how some APIs report the Windows version). The CSP is
   unchanged, which is acceptable now that the shipped runtime is .140 (see
   "Security notes").

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
- The WebView2 109 build matters for security: 109.0.1518.140 has the fix
  for an actively exploited image flaw, 109.0.1518.78 (the one that is easy
  to download) does not. Shipping .78 is only acceptable with the image
  restrictions under "Security notes".
- The download page cannot rely on the browser's user-agent string: Chrome
  and Brave on Windows 7 say "Windows 10". Detection uses the browser's
  platform-version hint and the browser's own version instead.

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
| 2026-10-14 | Under the button, both installers are always listed by the Windows they are for, as the fallback if detection is wrong. |

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
| E25 | At agent 1.1.11 (2026-10-14) the lockfile is unchanged on the UI stack (`tauri` 2.11.5, `wry` 0.55.1, `webview2-com` 0.38.2), `Cargo.toml` still has `tauri = "2"` and every plugin at `"2"`, and `iana-time-zone` is still used at `src-tauri/src/client/api/session.rs` line 10. New frontend code since 1.1.10 adds nothing newer than Chromium 109 (`checkVisibility` in `src/utils/tour.ts` is Chromium 105 and is feature-tested; `color-mix()` is still 7 uses in `src/App.css`). | `Cargo.lock`, `Cargo.toml`, grep of `src/` |
| E26 | Since Chrome 107, Chromium reports `Windows NT 10.0` in its user-agent string on every Windows version. A Windows 7 user on Chrome 109 has been seen reporting Windows 10. | Chromium's user-agent reduction page, MDN, AskWoody report |
| E27 | The platform-version hint (`Sec-CH-UA-Platform-Version`, or `navigator.userAgentData.getHighEntropyValues(["platformVersion"])`) reports `0.0.0` on Windows 7, 8 and 8.1 alike, and 1 or higher on Windows 10 and 11. It exists in Chromium 95 and later. Firefox does not have it. | Eric Lawrence, "Determining OS Platform Version"; MDN |
| E28 | Chrome 109 and Firefox ESR 115 are the last versions of each that run on Windows 7, 8 and 8.1. Firefox still reports the real `Windows NT 6.x`. | Chrome and Firefox support notices; Firefox does not freeze old Windows versions |
| E29 | Edge 109.0.1518.140 (2023-09-15) fixed CVE-2023-4863, a heap overflow in WebP image decoding that was exploited in the wild. Builds before .140 are affected. The NuGet runtime package stops at 109.0.1518.78. | Microsoft release notes as quoted by the Canadian Centre for Cyber Security and AskWoody; nuget.org version index (E20) |
| E30 | Microsoft's TraceLogging reference says `EventSetInformation` is not present in RTM Windows 7, and documents Windows 8 as its minimum. The existing build imports it statically, and the string is in `WebView2LoaderStatic.lib` for x86 and x64. | Microsoft Learn; E10 |

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
| U4 | `EventSetInformation` is present on the members' Windows 7. E30 confirms it is absent before an update; which update adds it is not confirmed (KB2882822 is the likely one). A fully updated Windows 7 SP1 probably has it. | G2, on two machines: a fully updated Windows 7 SP1 and one with no updates after SP1. If the second fails, the installer checks for the export and says which update to install |
| U5 | The WebView2 loader from the current SDK starts a 109 runtime on Windows 7. Microsoft says SDKs from 1.0.1519 on do not support Windows 7. Tauri shipped this loader while still supporting Windows 7. | G2 |
| U6 | The NuGet package's folder layout is the fixed-version layout Tauri expects, and every binary in it carries a valid Microsoft signature. | G1 |
| U7 | The async runtime and networking stack (`tokio`, `mio`) work on Windows 7. | G3 |
| U8 | The updater's certificate check passes with the root certificates on these machines. | G4 |
| U9 | `scripts/get-app-icon.ps1` runs on PowerShell 2. | G3 |
| U10 | Settled. The 109.0.1518.140 runtime is unpacked from the same Microsoft package Edge 109.0.1518.140 ships in, so it carries the same fix (E29), and Microsoft's catalog server is the source. | Done |
| U11 | Settled: the legacy installer is 141 MB (x86) with the runtime inside (395 MB unpacked). | Done |
| U12 | Mostly settled by E26 to E28. Still to confirm: what Brave reports for the platform-version hint (Brave limits some high-entropy hints), and that Chrome 109 on Windows 8.1 reports `0.0.0` like Windows 7. | G2, by opening a test page in each browser on the test machine |

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
- **Which build**: 109.0.1518.140. It is the only 109 build with the fix
  for the exploited WebP flaw (E29). Every earlier 109 build, including the
  .78 on NuGet, decodes WebP images with a known, exploited bug.
- **Sourcing options**, in order of preference:
  1. The original Microsoft fixed-version package for 109.0.1518.140, if an
     archived copy can be obtained.
  2. The files from a Windows 8.1 or Server 2012 R2 machine that has
     WebView2 109.0.1518.140 installed (the Microsoft Update Catalog has the
     .140 update for those systems; it updates an existing install rather
     than installing fresh). Copy the version folder.
  3. The third-party NuGet package (E20), version 109.0.1518.78. Only with
     the image restrictions under "Security notes", which are then required,
     not optional.
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
  - **Detection, in order.** Only on Windows; the first rule that answers
    wins.
    1. **The platform-version hint, in Chromium browsers.** In the page,
       `navigator.userAgentData.getHighEntropyValues(["platformVersion"])`.
       `0.0.0` (major version 0) is Windows 7, 8 or 8.1. A major version of
       1 or more is Windows 10 or 11 (E27).
    2. **The Windows version in the user-agent string, in Firefox.**
       `Windows NT 6.1`, `6.2` or `6.3` is old Windows. Firefox reports this
       truthfully (E28); Chromium does not (E26).
    3. **The browser's own version, when 1 and 2 give no answer.** A
       Chromium browser at version 109 or lower on Windows is almost
       certainly on Windows 7, 8 or 8.1, because 109 is the last version
       those systems get and Windows 10 browsers update past it (E28). A
       Windows 10 machine held back on an old browser would also get the
       legacy installer, which is the safe direction: it runs there too.
    4. Otherwise treat it as modern.
  - **Why not the user-agent string alone.** Since Chrome 107 every
    Chromium browser says `Windows NT 10.0` on every Windows version (E26),
    so on its own it would hand Windows 7 the modern installer, which cannot
    start there.
  - **A test page.** The same detection code, shown as text ("This looks
    like Windows 7, 8 or 8.1: you'll get the legacy installer"), is what is
    opened in each browser on the test machine at G2. The Download button
    should show the same sentence under it, so a member can see the choice
    and use the other link if it is wrong.
  - **What the page sends.** When it detects old Windows it links to
    `/api/download?platform=windows-legacy`. The choice is made in the
    page, so the server never has to guess from a frozen string.
  - **Server** (`Landing-Backend/src/modules/download/download-routes.js`):
    - `findAsset` takes the first asset ending in `.exe` for Windows. It
      must skip `windows-legacy` assets there, and serve only those for
      `platform=windows-legacy`.
    - As a fallback for links opened directly, `platform=windows` is
      answered with the legacy installer when the request shows old
      Windows: a user-agent of `Windows NT 6.1` to `6.3`, or a Chromium
      version of 109 or lower on Windows. The server does not ask for the
      platform-version hint; the page has already used it.
    - A release with no legacy asset answers 404 for `windows-legacy` with
      a clear message. It never falls back to the modern installer.
  - **Both versions are always listed by Windows version.** Under the
    Download button, on both pages, a short list names each installer by the
    Windows it is for, so a member can pick the right one themselves if the
    detection is wrong, JavaScript is off, or the page is opened on another
    computer than the one being set up:

    | Your Windows | Download |
    | ------------ | -------- |
    | Windows 10 or 11 | My Virtual Tracker (standard) |
    | Windows 7, 8 or 8.1 (no longer supported by Microsoft) | My Virtual Tracker for older Windows |

    - Each row links straight to its installer
      (`/api/download?platform=windows` and
      `/api/download?platform=windows-legacy`), not through detection.
    - The row matching what was detected is marked ("Your computer"), so the
      list and the main button never disagree on screen.
    - One line explains how to check: "Not sure? Press the Windows key,
      type winver and press Enter."
    - One line says what happens on a wrong pick: the standard version will
      not start on Windows 7, 8 or 8.1 and says so; the older-Windows
      version also works on Windows 10 and 11 but is larger and kept on an
      older browser engine, so it is only for older Windows.
    - The list is plain links in the page's HTML, not built by script, so
      it shows even when the page's script fails on an old browser.
  - **Safety nets for a wrong guess or a file passed along by hand.**
    - The list above, on both pages.
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
- Narrowing the hosts is not enough on its own: avatars are uploaded by
  members and served from the agent's own API host, so an attacker who is a
  member could upload a crafted WebP image. If the legacy build ships any
  109 build older than .140, it must also do one of these:
  - show avatars as initials only, and load no member-uploaded image; or
  - have the server re-encode every uploaded image to PNG or JPEG before
    serving it (screenshots are already JPEG made by the agent).
- Ship 109.0.1518.140 if it can be sourced; then the above is a hardening
  step, not a requirement.
- The modern installer's refusal to run on old systems (phase 4) keeps
  members from ending up on a build with a newer, incompatible runtime.

## Phases and gates

Effort is relative: S is hours, M is days, L is more than a week.

### Phase 0: Freeze (S)

1. Pin Tauri and its plugins (see "Dependency freeze").
2. Add the lockfile guard to CI.

Exit: a `cargo update` can no longer move the agent off the Windows 7 line.

Status at 1.1.11 (2026-10-14): not done (E25). Every agent release until it
is done is one `cargo update` away from losing Windows 7. This is the one
step worth doing now even if nothing else in the plan is scheduled.

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
| The by-Windows list under the button, in the same browsers and with scripts turned off | Both rows show and each downloads its own installer; the detected row is marked when scripts run |
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
- [Chromium: User-Agent reduction](https://chromium.org/updates/ua-reduction)
- [MDN: User-Agent reduction](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/user-agent_reduction)
- [MDN: Sec-CH-UA-Platform-Version](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-CH-UA-Platform-Version)
- [Eric Lawrence: Determining OS platform version](https://textslashplain.com/2021/09/21/determining-os-platform-version/)
- [AskWoody: Chrome 109 on Windows 7 reporting Windows 10](https://askwoody.com/forums/topic/chrome-user-agent-suddenly-showing-windows-10-instead-of-7)
- [Canadian Centre for Cyber Security: Edge 109.0.1518.140 advisory](https://www.cyber.gc.ca/en/alerts-advisories/microsoft-edge-security-advisory-av23-561)
- [AskWoody: Edge 109 WebP fix for Windows 7, 8, 8.1](https://askwoody.com/forums/topic/microsofts-edge-109-updates-for-windows-7-8-8-1-2012-r2)
- [NVD: CVE-2023-4863](https://nvd.nist.gov/vuln/detail/cve-2023-4863)
- [Microsoft: EventSetInformation](https://learn.microsoft.com/en-us/windows/desktop/api/evntprov/nf-evntprov-eventsetinformation)
- [Microsoft: TraceLoggingSetInformation](https://learn.microsoft.com/en-us/windows/desktop/api/traceloggingprovider/nf-traceloggingprovider-traceloggingsetinformation)
- [thunk-rs](https://docs.rs/thunk-rs/latest/thunk/): link-time shims for missing Windows APIs, a possible answer to U4. Third party and use-at-own-risk by its own description.
