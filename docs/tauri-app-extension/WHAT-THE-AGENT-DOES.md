# What the Virtual Tracker agent does

**For IT administrators evaluating this software, and for the employees it
runs on.**

Owner: **Soft Fix** and **Virtual Callers**.
Developers: [Mohammed Hesham](https://github.com/Mohammed-HeshamMohammed),
[Mohammed Magdy](https://github.com/mo7amed-magdy).

---

## Why your antivirus may warn about this

**It probably will, and the warning is not a mistake.** This is
employee-monitoring software. At the Windows API level it does several things
that malware also does, and a scanner cannot tell intent from API calls:

| What it does | Why | Why a scanner objects |
|---|---|---|
| Installs global keyboard and mouse hooks | Measures activity level — how much real input happened | The same API a keylogger uses |
| Captures the screen periodically | Screenshots for the activity feed | The same thing spyware does |
| Reads the foreground window title and process | Attributes time to an app | Process reconnaissance |
| Reads the browser address bar | Categorises time by site rather than by "Chrome" | Reading another app's UI |
| Starts with Windows | Tracking works without being launched by hand | Persistence |
| Updates itself | Ships fixes without a manual reinstall | Downloading and running new code |
| Uploads captures and activity metrics | The product | Outbound data flow |

**The installer is currently unsigned.** Windows SmartScreen will show
"Windows protected your PC" and name an unknown publisher. That is expected
for an unsigned build with no download history — it is a statement about
reputation, not about what the file contains.

Some vendors additionally classify all employee-monitoring software as
**PUA / Riskware / `Application:Win32/Monitor`** as a matter of policy. That
classification is applied to signed commercial competitors too. It is not a
false positive and it will not be appealed away.

## What it does **not** do

- **It does not record what you type.** Keystrokes are counted, never stored.
  The activity score uses how many keys, how many *distinct* keys, and the
  rhythm between them — never which keys. There is an automated test in the
  codebase (`src-tauri/src/types.rs`) that fails the build if anyone adds a
  field capable of carrying keystroke content.
- **It does not read files, email, or messages.**
- **It does not run when the timer is stopped.** No timer, no capture.
- **It does not capture while you are idle.** Screenshots are skipped once
  idle is detected.

## What is collected, exactly

| Data | When |
|---|---|
| Screenshot images | Every 90–210s (configurable), only while a timer runs and you are not idle |
| Foreground app name and window title | Every 15s while tracking |
| Browser URL or domain | Every 15s while a browser is focused. An organisation can configure domain-only, which discards the full path |
| Input counts — keystroke count, distinct keys, mouse distance | Per scoring window. Counts only |
| Idle and active seconds | Per session |
| A "possibly a virtual machine" flag | Once, at device registration |

Administrators can exclude specific apps and domains from capture entirely,
and can enable domain-only URL storage.

## For IT: deploying it

Recommended exclusion paths — install location depends on the installer mode
in use:

```
%ProgramFiles%\Virtual Tracker Agent\
%LOCALAPPDATA%\Virtual Tracker Agent\
%USERPROFILE%\.virtualtracker\
```

- **Microsoft Defender / Intune**: add the install directory as a process and
  path exclusion, or approve the publisher once signing is in place.
- **Avast / AVG**: add the install directory to Exceptions.
- Deploy via Intune or GPO rather than asking employees to click through a
  SmartScreen warning — training people to bypass that warning is itself a
  security problem.

## Verifying a build

Installers are published on the project's GitHub Releases page and served
through the app's `/api/download`, which redirects to the current release
asset.

```powershell
Get-AuthenticodeSignature "$env:USERPROFILE\Downloads\<installer>.exe" | Format-List Status, SignerCertificate
```

`NotSigned` is expected today. Do not download the agent from anywhere other
than the official release page or the in-app download link.

## Questions this page exists to answer

If you are being asked to approve this software and something here does not
answer your question, that is a gap worth reporting — an agent that is hard
to verify is a worse product, not a safer one.
