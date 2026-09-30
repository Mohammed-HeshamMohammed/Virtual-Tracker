# Design QA

- Source visual truth: `https://www.figma.com/design/WN6SbX0FfpvDNk7rkpPuB3/SoftFix-Workplace-%E2%80%94-Work---Lounge-design-review?node-id=24-1958`
- Implementation: `http://127.0.0.1:1421/`
- Source capture: selected Figma frame in Codex in-app browser
- Implementation capture: Codex in-app browser tab 3 at a forced 1440 × 900 CSS viewport
- Density normalization: 1 CSS pixel to 1 device pixel
- State: `Nova Vanguard / #general-orbit`, default squad state

## Full-view comparison evidence

The source and implementation were both opened and visually inspected in the in-app browser. The implementation preserves the four-region composition, title-bar-colored gutters, rounded panel edges, channel hierarchy, mission-card position, crew grouping, and dock placement. The generated mission artwork follows the source's violet/cyan orbital-scene art direction.

## Focused-region comparison evidence

- Left navigation: server rail, event card, grouped text/voice channels, and the voice/profile dock were checked at readable scale.
- Center: welcome block, date divider, message rhythm, mission card, reactions, and composer were checked at readable scale.
- Right roster: heading, live card, role groups, statuses, offline treatment, and health footer were checked at readable scale.

## Findings

- Latest workplace-menu refinement: the Discord server-dropdown pattern is now applied to a Soft Fix Workplace menu with workspace overview, teammate invitation, workspace settings, project/task creation, meeting scheduling, integrations, notifications, security, workplace profile, inactive-project filtering, and workspace ID actions. No server-management actions remain.
- Audio-device and input-profile choices now use side-opening radio submenus matching the supplied interaction reference, with workplace-call device labels such as USB headset, conference speakerphone, HDMI display audio, and conference room speaker.
- Latest composer/audio refinement: the message composer now exposes GIF, sticker, emoji, and Apps & Commands panels above the composer. Audio chevrons now open detailed reference-style menus with device/profile selection, volume controls, an input level meter, push-to-talk, and Voice Settings.
- Latest voice-dock refinement: the bottom dock now follows the supplied Discord voice-control references with noise cancellation next to disconnect, camera/screen-share/activity/soundboard actions, direct mute/deafen buttons, and separate upward-opening input/output device selectors.
- Latest Settings effect: the control-dock gear now opens a centered two-pane settings window over a dimmed and subtly softened workspace, following the supplied Discord reference while using Soft Fix content and tokens.
- Latest scoped refinement: the voice/profile controls were removed from the channel sidebar and rebuilt as a separate floating control dock. It spans the far-left rail and channel column, keeps an 8px outer edge gap, and both left columns end above it.
- Earlier P2: roster avatars stretched horizontally because the text flex selector also targeted the avatar span.
  - Fix: narrowed the flex selector to the second child only.
  - Post-fix evidence: final 1440 × 900 browser capture shows circular roster avatars.
- P3: the generated mission artwork is more cinematic and brighter than the Figma image. It remains within the same indigo/violet/cyan visual direction and fits the card crop cleanly.

## Required fidelity surfaces

- Fonts and typography: Inter family, compact weights, small metadata sizing, and source-like hierarchy are implemented.
- Spacing and layout rhythm: panel tracks, 8px gutters, rounded edges, dense channel rows, message rhythm, and dock dimensions match the source intent.
- Colors and tokens: navy surfaces, muted slate text, violet accents, and cyan/green presence states are centralized as CSS variables.
- Image quality and asset fidelity: mission art is a project-local 1672 × 909 PNG with a wide card crop; icons use Phosphor rather than handmade SVGs.
- Copy and content: source channel, message, mission, role, roster, and status content is reproduced.

## Interaction checks

- Channel switching updates the selected row, channel title, welcome heading, and composer placeholder.
- Join squad toggles to `Squad joined`.
- Sending a message adds the new `aria.exe` message and clears the composer.
- Floating mute/deafen controls retain their interactive state outside the channel sidebar.
- Microphone and headphone chevrons open independent device menus above the dock; device selections update their checkmark and close the menu.
- Camera, screen share, activities, soundboard, noise cancellation, disconnect, mute, and deafen all expose visible toggle states and reference-style hover tooltips.
- GIF/sticker/emoji tabs, media search, Soft Fix app discovery, input/output volume sliders, input profile, device choice, and push-to-talk were exercised in-browser.
- Workspace-menu open/close, inactive-project toggle, input profile selection, and input/output side submenus were exercised in-browser.
- Settings opens from the gear, switches categories, closes with the X/backdrop/Escape, and reopens without losing the underlying workplace screen.
- Browser console: no warnings or errors.

## Follow-up polish

- Replace remaining reaction emoji with final reaction assets if the production design system provides them.
- Add real avatar artwork when employee/community profile assets are approved.

final result: passed
