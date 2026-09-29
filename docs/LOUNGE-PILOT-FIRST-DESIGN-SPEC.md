# Lounge pilot — first product and design specification

Status: **design proposal; no Lounge implementation exists.** Source of truth for detailed behavior: [PLAN-break-lounge-and-project-chat.md](../PLAN-break-lounge-and-project-chat.md), especially §§19, 22–26. This document scopes the first design pass and does not replace the plan.

## Problem and design direction

Employees need a voluntary place to chat with project colleagues and spend a break together without changing how their work is tracked. The controller needs to invite a small employee cohort, see who accepted, and end access with a clear device removal choice. The current tracker already has notifications and updates, but its **Update now** action starts the ordinary app update; a Lounge invitation needs a distinct choice flow.

The revised design is based on the current Windows tracker shell, not a new dashboard. Its employee prototype loads `Tauri-App-Extension/src/App.css` directly: the 38px title bar, 340px pinned sidebar, page-area, elapsed-time card, notification dropdown, button styles, Segoe UI typography, and dark/light tokens come from the app. The Lounge opens only after the employee elects to install the private pilot and enters it from an eligible break. The company web dashboard gains a controller-only access view based on its 272px sidebar and shared dark palette. Current builds are unsigned development builds; the interface must not claim otherwise.

### Existing UI baseline and proposed additions

| Surface | Reused from production code | New design element |
| --- | --- | --- |
| Invitation | `TitleBar` bell and `.notification-dropdown`/`.notification-item` in `App.css` | Lounge-specific invitation copy and **Review options** action; not the updater's **Update now** handler |
| Release choice | `.agent-tray`, `.side-panel`, `.page-area`, `.page-clock`, `.btn` | Modal with equal-weight standard/preview choices; normal timer remains visible behind it |
| Break Lounge | Existing title bar, 340px sidebar shell, pinned **Resume tracking**/**Stop** controls, `.page-clock`, buttons and theme tokens | Sidebar scroll area becomes project-room/friend navigation; main area has a real conversation, live room activity and people; **Back to work** stays visible, with break duration separate from unchanged work time |
| Controller | Dashboard-Web sidebar width and `SIDEBAR_THEME_DARK` palette | Lounge grant, status, per-device cleanup and deactivation UI; this is still a concept, not an implemented dashboard route |

The first Figma exploration is retained on a page explicitly marked superseded. The new app-based Figma page contains five visual reference images taken from the CSS-backed prototype. Those images are **not editable component layers**; the HTML/CSS prototype is the editable source for this pass, and the next Figma pass should reconstruct the new elements as components on top of the verified app baseline.

### Lounge engagement revision

The first Lounge canvas was too sparse to suggest a place an employee would choose to open. The revised screen borrows the **interaction pattern** of a lively community app—persistent rooms, recognizable people, readable conversation, and an activity someone can join immediately—without copying Discord branding, colors, artwork, or its public-server model. It remains inside My Virtual Tracker's real window, typography and dark palette.

At a glance, an entitled employee should see: which of their assigned project rooms is active; how many entitled teammates are here; a current, human-scale conversation; a specific tic-tac-toe invitation; the room roster; a message composer; and a persistent break clock plus return action. That is the value proposition of opening Lounge, not merely the presence of a chat feature. For a cold-start room, the design must replace fake activity with an honest empty state and a clear first action; it must never imply people are online when they are not.

The prototype's room switching and local message composition are design-only interactions using sample data. Reactions and friend DMs shown there are **later-tier previews**, not P0 shipping commitments. The first implementation is still gated by the security, privacy, signed-proof, tracking-parity and release checks in the main plan. A game invitation in a mockup does not mean tic-tac-toe or realtime chat exists in current builds.

### Product thinking used to choose the first design

| Direction considered | Useful part | Decision |
| --- | --- | --- |
| Social tools always visible on Home | Easy discovery | Keep only small Chat/Friends rows for entitled members; the work screen stays focused |
| Lounge automatically opens when a break begins | Immediate use | Reject; a break should never force a layout switch |
| A new independent tracker app | Clear separation | Reject for the pilot because tracking and updates would diverge |
| Private Lounge component in the existing shell | Opt-in and stable work controls | **Use for this design**, subject to a real Tauri feasibility test |
| Download link in an email or web page | Simple invitation | Reject; the member chooses from their authenticated agent and the download is device-bound |
| Grant silently activates Lounge | Low friction | Reject; invitation, release choice and notice acknowledgement stay explicit |
| Controller revoke removes every local file instantly | Simple story | Reject as impossible for offline devices; show immediate access denial and separate pending cleanup |

The riskiest product assumption is that employees understand “standard app” versus “Lounge preview” without thinking the standard security update is optional. Test the choice screen with 3–5 employees before building the private release path. Ask them what each button will do, and whether they believe tracked time continues in both cases.

## People and jobs

- **Employee, invited:** decide whether to join the optional pilot while continuing normal work.
- **Employee, active:** use project chat and enter the Lounge during an eligible break; return to work immediately.
- **Employee, revoked:** understand that access ended and, if files were kept, request removal from this device or all devices.
- **Controller:** invite eligible employees, review installation state per device, revoke access with a keep or remove policy, and see cleanup receipts. The controller is the one account identified in the main plan; email text alone is not authorization.
- **Company Owner/Admin/Super Admin:** assign ordinary employment roles. Those roles permit normal company functions according to existing policy but do not grant Lounge access.

## First design screens and flow

| # | Surface | Primary action | Required visible details |
| --- | --- | --- | --- |
| 1 | Employee Home + notification centre | Open Lounge invitation | Existing timer and Start/Pause/Stop stay recognizable; invitation includes a single **Review options** action and no chat content |
| 2 | Private pilot choice | **Install Lounge preview** or **Stay on standard app** | Private pilot label, version and size placeholder, plain privacy summary, ordinary tracker updates continue either way; closing makes no choice |
| 3 | First-use notice | **I understand** | Room/DM membership, 180-day message retention, report-to-controller exception, server operator access; acceptance is separate from installation |
| 4 | Break Home → Lounge | **Open Lounge** | Break begins on normal Home; eligible title-bar Lounge icon appears; the timer and break status are still visible |
| 5 | Lounge shell | **Back to work** | Persistent break clock and return action; project room list, game area and chat panel; project access count; chat readable only to room members |
| 6 | Controller access | **Grant access** / **Deactivate** | Member identity, grant state, invited/standard/installed/active status, device list, last seen, per-device cleanup state; controller challenge before changes |
| 7 | Deactivation choice | **Keep installed** or **Remove next time online** | Access ends immediately in both cases; the deletion option says when it can complete; no promise of immediate offline removal |
| 8 | Member access ended | **Remove Lounge** | Clear inactive state; removal on this device or all devices; distinguish local component removal from server data erasure |

The clickable first prototype covers screens 1, 2, 5, 6 and 7. Screens 3, 4 and 8 are annotated states for the next design pass.

## Goals and pilot measures

These are **proposed pilot thresholds**, not measured results. Confirm cohort size before using rates.

| Goal | Proposed measure | When |
| --- | --- | --- |
| Employees understand the release choice | At least 4 of 5 usability participants correctly explain both choices and ordinary updater behavior without prompting | Before implementation |
| Employees can start and end a break without confusion | At least 4 of 5 complete “enter Lounge, return to work” while identifying current break state | Prototype test |
| Invitations lead to informed choices | At least 80% of delivered invitations record an explicit choice or dismissal; no duplicate sound for a single invite | First 2 pilot weeks |
| Revocation behaves predictably | 100% of tested revoke cases lose server access immediately; cleanup pending/complete is accurately shown for each test device | Release gate |
| Tracking stays correct | No change in Start/Pause/Stop, screenshots, offline replay or manual time across absent, installed, active, revoked and removed states | Release gate |

## Requirements and acceptance criteria

### P0 — first employee pilot

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| P0-01 | Employee-only baseline | A person with no active member record and assigned role cannot use protected tracker or web functions, even if they load the sign-in shell or installer |
| P0-02 | Separate Lounge entitlement | An employee with an ordinary role but no controller grant sees no Lounge offer, assets, routes or room data |
| P0-03 | Invitation | A grant produces one protected in-app invitation and one background OS notification with the standard sound, subject to OS/quiet settings; reconnecting does not repeat the sound |
| P0-04 | Choice | Selecting **Stay on standard app** installs nothing; selecting **Install Lounge preview** opens the consent/install path; closing the panel records no choice; ordinary tracker updates proceed in all three cases |
| P0-05 | Distribution | Only an entitled, authenticated, registered agent can obtain the private component; copied files never confer server access. Current artifacts are labeled unsigned development builds |
| P0-06 | Break entry | Starting a break leaves the Home layout in place; the Lounge icon appears only when policy and entitlement allow; clicking it opens the Lounge |
| P0-07 | Return to work | A persistent **Back to work** action is visible in Lounge and is first in keyboard focus order; ending a break by any route closes Lounge and returns Home |
| P0-08 | Room privacy | Project chat checks project assignment and active grant on every read, write and socket event; Owner/Admin/Super Admin roles alone do not widen room access |
| P0-09 | Controller revocation | Controller may choose **Keep installed** or **Remove next time online**; both deny Lounge APIs and close sockets as soon as revocation commits |
| P0-10 | Removal | Cleanup is durable, per device and retryable; only Lounge files/settings/keys are removed; member may request it later if the controller chose keep |
| P0-11 | Tracking parity | Existing timer, capture, offline queue, updater and PowerShell fallback pass the matrix in main plan §26.9 |
| P0-12 | Honest status | UI distinguishes offer, installing, active, access ended, cleanup pending and removed. No UI claims that an unsigned build is signed |

### P1 — after a small pilot validates P0

Chat reactions/replies, friends and direct messages, per-room notification controls, game invitations, richer controller cohort tools, multi-device removal progress and robust keyboard/low-motion polish. They may be prototyped now but do not block the earliest Lounge access validation unless the corresponding feature is enabled.

### P2 — later

Arcade links, voice rooms, stickers/GIF libraries, Pulse, standups, analytics dashboards, collection requests, configurable docking and additional platforms. The main plan retains their detailed constraints and dependencies.

## Accessibility and content rules

- Use existing `Segoe UI Variable` / `Segoe UI` type and the tracker color tokens; support dark and light themes.
- Each icon has an accessible name and tooltip. All new controls have visible focus, at least 44 × 44 px hit areas where space allows, and clear disabled/error text.
- Do not put message bodies, project names or friend names in the locked-screen invitation.
- The install choice uses equal visual weight for **Stay on standard app** and **Install Lounge preview**. No countdown or implied penalty for declining.
- Break status and **Back to work** stay visible even when chat, a game or an install error is open.
- Say **Remove Lounge from this device** for local removal; use a separate confirmation for server data export/erasure.

## Roadmap update — Now / Next / Later

This is a dependency order, not a calendar promise. Status reflects the repository: Lounge feature code is not implemented.

| Horizon | Outcome and work | Status | Depends on / exit gate |
| --- | --- | --- | --- |
| **Now** | Validate the employee invitation, choice, first-use notice, break entry, Lounge shell and controller revoke concepts with prototype tests | Design in progress | 3–5 employees can explain the choices and complete the break flow |
| **Now** | Prove dormant component loading, employee role checks, controller identity, grant state and cleanup path in the real Tauri app | Not started | Must preserve tracker parity, ordinary updater and PowerShell fallback |
| **Next** | Build private delivery, idempotent notifications, enrolment state, per-device cleanup and first project chat/Lounge pilot | Not started | Tenancy isolation probe, agent proof, privacy shield, P0 acceptance criteria |
| **Next** | Add friends/DMs and core messenger controls | Not started | Active pilot and room privacy checks |
| **Later** | Games catalog, Arcade, voice, stickers/GIFs, Pulse and workspace docking | Not started | Pilot evidence, provider/rights validation and feature-specific gates in main plan |
| **Later** | Signing of standard and private builds | Not started | Signing infrastructure and verified release process; not required to describe current employee tests accurately |

**Change from earlier roadmap wording:** the private delivery/choice and reversible deactivation flow now precede broad social features. The first design focuses on P0, while the full plan remains the backlog for later phases. No dates or staffing estimates are asserted without team capacity information.

## Open questions for review

1. **Engineering, blocking:** Can the current elevated Tauri host safely load a versioned local Lounge web bundle with a strict IPC boundary, or must the pilot use a separate full installer built from the same core revision?
2. **Product, nonblocking for first design:** Should the invitation say “Lounge preview” or “Private Lounge pilot” in employee-facing copy?
3. **Controller/product, blocking before implementation:** Which employee cohort and devices participate in the first test, and who approves the pilot charter and retention notice?
4. **Design/engineering, blocking before implementation:** How will the notification action be distinguished from the existing `TitleBar` ordinary `Update now` handler?

## Handoff

App-based visual references: [Private Lounge — app-based design revision in Figma](https://www.figma.com/design/WN6SbX0FfpvDNk7rkpPuB3/Private-Lounge-app-based-design-revision?node-id=4-54). Editable interaction source: [Lounge pilot prototype](prototypes/lounge-pilot-first-design.html). These screens are design proposals with sample names/data only. The five Figma references show invitation, release choice, the revised social-hub Lounge, controller access and deactivation; the original four AI-generated editable frames are archived as a superseded exploration. Review the choice buttons, whether the Lounge feels worth opening, break return path and revoke dialog with employees and the controller before implementing release mechanics.
