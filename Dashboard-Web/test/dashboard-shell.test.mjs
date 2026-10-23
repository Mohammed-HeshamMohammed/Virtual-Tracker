// The dashboard shell, rendered in jsdom: the frame every page sits in. Its own parts are real -
// the guided tour, the page explanations, the auto-hiding scrollbar and the page router - and the
// rest (session, sidebar, top bar, the pages themselves) are stand-ins that record what the shell
// hands them.
//
// Replaces source-text checks in help-mode, help-collect, auto-hide-scrollbar and
// notification-targets.
import test, { after } from "node:test"
import assert from "node:assert/strict"
import { installDom, createLoader, framerMotionStub, mount, settle, React, Nothing } from "./helpers/render.mjs"

const env = installDom()
after(() => env.restore())
window.Element.prototype.getBoundingClientRect = function () {
  return { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20, x: 10, y: 10 }
}

const Pass = ({ children }) => React.createElement(React.Fragment, null, children)
const seen = { topbar: null, pages: [], chunks: [] }

const Topbar = (props) => {
  seen.topbar = props
  return React.createElement("header", null, React.createElement("button", { "data-help": "Help: a guided tour.", "data-help-toggle": true }, "?"))
}
const PageContent = (props) => {
  seen.pages.push(props)
  return React.createElement("button", { "data-help": "Save: saves the page." }, "Save")
}

const shellStubs = {
  "framer-motion": framerMotionStub,
  "@/features/auth": {
    useAppShellReady: () => {
      const [activeItem, setActiveItem] = React.useState("pm-tasks")
      return { activeItem, setActiveItem, shellReady: true }
    },
    coerceNavItemForRole: (id) => id,
    registerDashboardPresence: () => () => {},
    subscribeAgentLinked: () => () => {},
    AuthSessionLoader: Nothing,
  },
  "@/shared/providers/app": {
    useTheme: () => ({ isDark: false }),
    useAuth: () => ({ isLoggedIn: true, sessionReady: true, memberRole: "Owner", memberId: "m1", retryConnection: () => {} }),
  },
  "@/features/auth/hooks/use-backend-connection-monitor": { useBackendConnectionMonitor: () => {} },
  "@/shared/ui/errors/dashboard-reconnect-overlay": { DashboardReconnectOverlay: Nothing },
  "@/infrastructure/api/backend-connection-events": { BACKEND_RECONNECTING_HINT: "", BACKEND_UNAVAILABLE_MESSAGE: "" },
  "@/shared/ui/layout": { Sidebar: Nothing, Topbar, PageSearchProvider: Pass },
  "@/shared/ui/layout/hierarchy-assignment-banner": { HierarchyAssignmentBanner: Nothing },
  "@/shared/ui/layout/policy-health-banner": { PolicyHealthBanner: Nothing },
  "@/features/activity/utils/timer-task-storage": { configureTimerStorageScope: () => {}, clearAllTaskTimerStateForScope: () => {} },
  "@/app/page-content": { PageContent },
  "@/app/prefetch-routes": { prefetchAppRoutesForRole: () => {} },
  "@/features/activity": { ActivityRuntimeProvider: Pass },
  "@/shared/ui/widget-error-boundary": { WidgetErrorBoundary: Pass },
}
const loader = createLoader({ stubs: shellStubs })
const { DashboardShell } = loader.load("app/dashboard-shell.tsx")
const { setHelpMode } = loader.load("shared/ui/help/index.ts")
const { pageHelp } = loader.load("shared/ui/help/page-help.ts")

test("the page container names the page and carries its explanation", async () => {
  const view = await mount(React.createElement(DashboardShell))
  const pane = view.container.querySelector("[data-page]")
  assert.equal(pane.getAttribute("data-page"), "pm-tasks")
  assert.ok(pageHelp("pm-tasks").length > 0)
  assert.equal(pane.getAttribute("data-help"), pageHelp("pm-tasks"))
  await view.unmount()
})

test("the page container's scrollbar shows on scroll - the shell hands that pane to the helper", async () => {
  const view = await mount(React.createElement(DashboardShell))
  const pane = view.container.querySelector("[data-page]")
  assert.equal(pane.dataset.scrollActive, undefined)
  pane.dispatchEvent(new window.Event("scroll"))
  assert.equal(pane.dataset.scrollActive, "true")
  await view.unmount()
})

test("the tour is mounted once for the whole dashboard", async () => {
  const view = await mount(React.createElement(DashboardShell))
  await settle(() => setHelpMode(true))
  assert.equal(view.container.querySelectorAll(".help-tour").length, 1)
  await settle(() => setHelpMode(false))
  assert.equal(view.container.querySelectorAll(".help-tour").length, 0)
  await view.unmount()
})

test("navigating with params, as a notification does, hands the page and its params to the page", async () => {
  seen.pages.length = 0
  const view = await mount(React.createElement(DashboardShell))
  await settle(() => seen.topbar.onNavigate("notifications", { thread: "t-1" }))
  const last = seen.pages.at(-1)
  assert.equal(last.activeItem, "notifications")
  assert.deepEqual(last.pageParams, { thread: "t-1" })
  assert.equal(view.container.querySelector("[data-page]").getAttribute("data-page"), "notifications")
  // A plain navigation afterwards does not carry the old params along.
  await settle(() => seen.topbar.onNavigate("pm-tasks"))
  assert.equal(seen.pages.at(-1).pageParams, undefined)
  await view.unmount()
})

// ── the page router ────────────────────────────────────────────────────────

const Chunk = (props) => {
  seen.chunks.push(props)
  return null
}
const chunkLoader = createLoader({
  stubs: {
    "framer-motion": framerMotionStub,
    "@/app/routes/chunk-loaders": { CHUNK_COMPONENTS: new Proxy({}, { get: () => Chunk }) },
    "@/features/members/pages/people-section-content": { PeopleSectionContent: (props) => { seen.chunks.push({ people: true, ...props }); return null } },
  },
})
const { PageContent: RealPageContent } = chunkLoader.load("app/page-content.tsx")

test("the page router passes a navigation's params on to the page it opens", async () => {
  seen.chunks.length = 0
  const view = await mount(React.createElement(RealPageContent, { activeItem: "notifications", onNavigate: () => {}, pageParams: { thread: "t-1" } }))
  const opened = seen.chunks.at(-1)
  assert.equal(opened.pageId, "notifications")
  assert.deepEqual(opened.pageParams, { thread: "t-1" })
  await view.unmount()
})
