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

## 2026-10-17: Discord-style Account and Profile settings

- Reference: the user-supplied Discord Account screenshot (`codex-clipboard-1112c774-021e-4d4a-9557-23b626020c6c.png`, 1410 x 888) and Main Profile screenshot (`codex-clipboard-e306db37-23e2-4f61-b3c8-071826fd11bc.png`, 1209 x 808).
- Runtime: the real SoftFix application at `http://127.0.0.1:1421/`, opened in the Codex in-app browser.
- Desktop captures: Account at 1410 x 890 CSS pixels; Profile at 1209 x 807 CSS pixels; devicePixelRatio 1. One/two pixel height differences were padded for comparison without distorting the source.
- Evidence folder: `C:/Users/unwie/.codex/visualizations/2026/10/17/01a14b4c-1818-7821-9757-4f89fc2806ae/`.
- Side-by-side inputs inspected: `comparison-account.png` and `comparison-profile.png`. Final screens: `settings-account.png`, `settings-profile-final.png`. `settings-profile-upload.png` demonstrates the tested upload state using existing SoftFix mission artwork; test images were removed after verification.

### Visual comparison and fixes

- Layout/spacing: near-full-window settings, 248px settings navigation, centered 700px account content, grouped 72px account rows, individual Edit controls, and nested account links reproduce the reference structure. Account/Profiles now appear first in navigation, fixing the initially incorrect mode-first order.
- Profile: the separate 240px customization rail, banner with overlapping circular avatar, profile details, Board/Activity tabs, and right-hand widgets follow the supplied Main Profile composition. SoftFix work data replaces Discord gaming content.
- Typography/colors: neutral charcoal surfaces, light gray text, subdued labels, thin gray dividers, and purple primary/edit states replace the previous blue/green form styling. Helvetica/Arial is the available font substitute for Discord's proprietary font.
- Imagery: uploaded avatar crops and 1200x400 banners render successfully and persist; animated uploads retain their original image data. The circular media clip is separated from the presence indicator, fixing the crop overlap.
- States/accessibility: named buttons/inputs, selected tabs, keyboard focus, image-removal actions, draft errors, Reset, Save Changes, and confirmation before leaving an unsaved profile are implemented. The save bar was corrected to remain inside the scroll viewport.
- Responsive: inspected Account and Profile at 390 x 844; no horizontal content overflow. Profile controls stack above the preview and board. Temporary viewport overrides were reset.

### Functional verification

- Account row opens the correct field editor and saves back to the shared account state.
- Board/Activity tabs show the matching view; Add Widget toggles real data widgets; Reset restores the saved draft.
- Leaving a changed profile prompts to keep editing or discard.
- Avatar upload -> crop -> Use this picture -> Save Changes -> full reload retains the image.
- Banner upload -> Save Changes -> full reload retains the image. Rendered image dimensions confirmed as 192x192 avatar and 1200x400 banner.
- Shared account/sidebar/toolbar avatars rendered the same saved image (four loaded avatar elements, one shared image source).
- Fresh full reload of the final code produced no new browser warnings or errors. A transient context error during source hot-reload cleared on a full reload.
- TypeScript and the Vite production build pass. Existing large-bundle advisory remains.

Remaining P3: platform font rendering differs from Discord's proprietary font; Discord-specific paid decorations and gaming integrations are outside SoftFix's data model. No remaining P0/P1/P2 issues in this scope.

## 2026-10-17: Responsive sizing and SoftFix visual alignment

The user approved the Discord structure and requested sizing appropriate to the current app window plus closer alignment with SoftFix's existing UI. The prior reference remains the structural baseline; SoftFix's shared design tokens are now authoritative for color and typography.

- Compared the previous desktop profile capture with `profile-softfix-refined.png` at 1209 x 807 in `comparison-softfix-refinement.png` in the existing evidence folder.
- Restored DM Sans/Manrope, navy card/canvas tokens, shared borders and radii, and theme-aware button/text colors. Work settings now use the same theme scope as Work, Dashboard and Lounge.
- Preserved user-chosen banner/accent colors; the uncustomized accent follows the application palette.
- The settings surface now fits the window with bounded gutters, a maximum width of 1480px and maximum height of 960px. Sidebars, avatar size, banner height, and content spacing adjust within readable limits.
- Container queries stack the profile board below its card at narrower settings widths. Compact controls stack above the preview in narrow windows. Short windows reduce whitespace without shrinking text.
- Browser-checked profile sizes: 1600 x 1000, 1200 x 760, 900 x 600, 390 x 844. No horizontal overflow; profile-card and board layouts switched as intended.
- Browser-checked Account sizes: 1200 x 760, 800 x 600, 390 x 844. Content widths matched scroll widths at every size.
- Save/Reset remained inside the visible window at 900 x 600 and 390 x 844. Temporary changes were reset.
- Verified the light theme's shared white/lavender surfaces and readable dark text, then restored the original dark preference. Fixed contrast of the upload label against a dark selected banner in light mode.
- Build and TypeScript checks pass. Temporary browser viewport overrides were reset; the profile preview remains open.

No remaining P0/P1/P2 issues found in this refinement scope.

## 2026-10-17: Separate bottom-left profile dock

- The profile/voice dock now occupies a separate grid row below the rail and sidebar and spans both left columns. Its left edge is at x=0; its right edge matches the sidebar's right edge.
- Conversation and context panes span both rows and retain the full available height.
- Verified the Lounge home and a channel, including expanded voice-preview controls at 1200 x 800 and 700 x 600. The dock stayed below the sidebar, flush left, and aligned at the right; the main pane reached the same bottom edge.
- Removed obsolete overlay padding from the sidebar. Short windows scroll the rail vertically; native icon titles preserve labels when the custom tooltip would be clipped by scrolling.
- Evidence: `lounge-dock-full.png` and `lounge-dock-fixed.png` in the existing evidence folder. Voice preview was disconnected after checking. Temporary viewport overrides were reset.

## 2026-10-17: Keep the dock inside the app frame

The requested left-edge alignment now includes an 8px frame inset rather than touching the outer boundary. The dock remains below both left columns, uses rounded corners on every side, and is capped to the visible window width. Narrow layouts also reserve an 8px bottom inset. Browser measurements with expanded voice controls confirmed containment at 700 x 600 and 390 x 700; the current app window was also checked. The user's voice-preview state was preserved. Evidence: `lounge-dock-contained-full.png` and `lounge-dock-contained.png`.

## 2026-10-17: Channel membership and voice-preview participants

- Channel rows now expose member counts and expandable avatar/name lists, including the current user only while joined. The right-side member panel uses the same membership rule and shows the total.
- Joining voice opens the matching channel and shows the current user's avatar/name beneath it. The participant microphone icon shares mute state with the bottom dock; disconnect removes the participant row. Voice labels now match the actual channel names and dock label.
- Existing calls are local voice previews, not a network calling service. Other channel members are not fabricated as connected voice participants.
- Increased sidebar content padding from 8px to 20px below its header. The sidebar scrolls above the separate bottom dock. Channel titles truncate instead of overlapping header actions.
- Browser verified expanded channel members, member-panel total, join, mute/unmute, and disconnect. Checked 1200 x 800 and 700 x 600; compact sidebar overflow scrolls and the dock remains within the viewport. Reset viewport overrides.
- TypeScript and Vite production build pass; git diff whitespace check passes. Evidence: lounge-channel-participants.png in the existing evidence folder.
## 2026-10-17: Text channels open directly

- Corrected the text/voice distinction: text rows are direct chat navigation, without expandable participant rows or join/leave controls. Channel membership remains in the header's member panel.
- Removed text-channel join prompts and composer gating, the directory's Joined filter, and its Join buttons. Every listed text channel opens immediately; voice preview toggles no longer mutate text membership.
- Browser verified coffee-break (previously not joined) opens directly with its editable composer, directory actions all say Open, and voice join/disconnect still adds/removes the voice-only participant row.
- TypeScript and Vite build pass. Evidence: lounge-text-channel-direct-open.png. Restored Nova Vanguard with voice disconnected after verification.

## 2026-10-17: Voice-room intro animation

- Added a voice-only welcome card above the chat when the current room's local voice preview is active. It shows the current profile avatar/name and the shared mute state, with explicit local-preview labeling.
- Intro uses a short fade/slide, delayed avatar reveal, a single ring pulse, and two decorative waveform cycles. Sidebar participant and dock connection rows also enter gently. No perpetual animation or simulated speaking status.
- Reduced-motion preferences disable all added motion. Compact/short windows use a smaller card and avatar.
- Browser verified join, disconnect cleanup, and replay on rejoin. Checked 700 x 600 with no card overflow and dock containment; reset viewport override. Animation names/durations verified through computed styles. Build and TypeScript pass.
- Evidence: voice-room-intro.png. Voice preview remains open for review.

## 2026-10-17: Independent voice rooms and their own text chat

- Split persisted voice-room definitions from text channels. Each server receives a standalone General voice room; voice creation writes only to voiceRooms, and text creation writes only to rooms. Stored voice rooms use the same validation as text rooms.
- Added dedicated voice and voice-chat routes. Voice entrances now appear only in the voice view. Text channels retain their own history and composer, independently of the active voice connection.
- Each voice row has an always-visible chat bubble at its far right (6px inset). It opens the room's separate voice-chat message/draft/read namespace without joining voice. Saved-message navigation supports voice chat.
- Clicking an already connected voice room returns to it; disconnect remains in the dock. Navigating to text channels keeps voice connected.
- Browser verified standalone empty voice chat, isolated draft storage (temporary draft cleared), text history preserved, join, connected-room navigation, and voice-specific creation dialog. Compact 700 x 600 checks confirmed the icon stays inside the row and the dock inside the viewport. Viewport override reset.
- TypeScript and production build pass. Evidence: independent-voice-room.png and separate-voice-chat.png. Local voice preview remains connected with its own chat open for review.

## 2026-10-18: Stable presence dot on hover

- Fixed the apparent dot enlargement caused by status background painting beneath a translucent hover border. Clipped the fill to the padding box; presence colors now use background-color so they preserve the clipping.
- Browser verified the red indicator in both normal and hovered states: 8px colored diameter, padding-box clipping, unchanged 62px row height. Tested in a temporary hidden tab and closed it afterward.
- Evidence: friend-status-hover-fixed.png and friend-status-hover-detail.png. Whitespace check passes.

## 2026-10-18: Voice-control UI from the Discord reference

The user explicitly narrowed this task to UI only; calling infrastructure and actual media capture are outside this change.

- Added a compact four-button camera/screen-share/activity/soundboard action bar above the profile row. Selection states use shared SoftFix colors and stay within the dock's existing width.
- Added connection-details and audio-device popovers, a volume slider, noise-suppression checkbox, activity cards, and six soundboard selection tiles. Preview labeling is explicit; connection details do not invent latency or network measurements.
- Camera, screen-share, and activity controls update placeholder tiles in the active voice room. No device capture, screen access, sound playback, or transport calls occur.
- Shared deafen state updates the profile status, participant microphone display, and room intro. Disconnect clears camera/screen/activity/deafen state and returns the microphone to muted.
- Browser verified every action bar panel, selection states, room layout previews, volume value updates, noise suppression toggle, deafen behavior, Escape dismissal/focus return, and disconnect cleanup. Checked the connection panel and expanded dock at 700 x 600; both remain inside the viewport. Temporary viewport reset and test tab closed.
- TypeScript and Vite build pass. Evidence: voice-controls-soundboard.png and voice-controls-compact.png in the existing evidence folder.

## 2026-10-18: Full voice-room UI coverage

Scope remains UI only, following the user's explicit instruction. Expanded the room beyond small dock popovers without adding calling or media services.

- Added a participant stage, self-tile options, name visibility, camera preview backgrounds/quality, screen-share source and quality layouts, focus/grid controls, expanded-room view, participant search, disconnected/join states, and a full in-room control bar.
- Centralized room/dock control state and reused VoicePanels in the room sidebar and dock popovers. Navigating to text chat closes the room panel while retaining voice; audio/layout settings stay synchronized across controls.
- Audio UI includes Input/Output/Processing sections, volumes, voice activity versus push-to-talk, editable keybind preview, sensitivity, mic/speaker test-selection states, noise suppression/echo/gain toggles, and reset defaults.
- Screen layout includes screen/window/tab choices, resolution, frame rate, audio inclusion, focus and stop controls. No screens/cameras are enumerated or captured.
- Soundboard includes search, favorites, My sounds, volume, no-results states, and local file-name selection with audio-type/10MB validation. No audio is played or uploaded to a server.
- Four activity layouts include search, selection/leave, local ready state, and local notes for brainstorm/check-in. No other participants or responses are simulated.
- Browser verified camera background/layout selection, share source/FPS/audio updates in the stage, favorites and search empty states, activity notes/readiness, audio modes/reset, Escape dismissal, expand/restore geometry, participant panel, chat continuity, and dock popovers outside the room. At 700 x 600 the room panel changes to a bounded overlay; controls and dock remain inside the window with no panel horizontal overflow. Viewport override reset and temporary test tab closed.
- TypeScript/Vite build and whitespace checks pass. Evidence: voice-expanded-full.png, expanded-voice-share.png, voice-expanded-compact.png.

final result: passed
