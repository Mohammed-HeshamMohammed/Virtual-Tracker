// notificationTarget: which page a notification opens, and WHICH ITEM on it.
//
// The bell used to resolve a link with `raw.split(/[?#]/)[0]`, throwing the query away, so a
// notification about one task could only ever open the Tasks page. These run the real resolver,
// a rendered bell, and the page router, and check where a click actually leads.
import test, { after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { installDom, createLoader, framerMotionStub, mount, click, React, Nothing } from "./helpers/render.mjs"

const env = installDom()
after(() => env.restore())

const loader = createLoader({
  stubs: {
    "framer-motion": framerMotionStub,
    "@/shared/providers/app": { useAuth: () => ({ memberId: "m1", memberRole: "Employee" }), useTheme: () => ({ isDark: false }) },
  },
})
const { notificationTarget, notificationPageId, NotificationsBellView } = loader.load(
  "shared/ui/layout/components/topbar/notifications-bell.tsx",
)
const { resolveChunkId } = loader.load("app/routes/resolve-chunk.ts")

test("the item a link names survives, and `page` names the page rather than being a param", () => {
  assert.deepEqual(notificationTarget("pm-tasks?task=t-1"), { pageId: "pm-tasks", params: { task: "t-1" } })
  assert.deepEqual(notificationTarget("/?page=pm-projects&project=p-9"), { pageId: "pm-projects", params: { project: "p-9" } })
  assert.deepEqual(notificationTarget("people-members?member=m-2"), { pageId: "people-members", params: { member: "m-2" } })
})

test("every historical link shape still opens its page, and a link to no page opens nothing", () => {
  assert.deepEqual(notificationTarget("/?page=activity-screenshots"), { pageId: "activity-screenshots", params: undefined })
  assert.deepEqual(notificationTarget("/people/members"), { pageId: "people-members", params: undefined })
  assert.deepEqual(notificationTarget("people-members"), { pageId: "people-members", params: undefined })
  for (const dead of ["", "/", null, undefined, "no-such-page?x=1", "/?page=nowhere"]) {
    assert.equal(notificationTarget(dead), null, String(dead))
  }
})

test("notificationPageId gives just the page, for callers that only want that", () => {
  assert.equal(notificationPageId("pm-tasks?task=t-1"), "pm-tasks")
  assert.equal(notificationPageId("no-such-page"), null)
})

test("the Notifications page is a real page the router opens, so a message notification can link to it", () => {
  assert.deepEqual(notificationTarget("notifications?thread=th-1"), { pageId: "notifications", params: { thread: "th-1" } })
  assert.equal(resolveChunkId("notifications"), "profile")
})

test("clicking a notification in the bell navigates to its page with its item, marks it read, and closes the panel", async () => {
  const marked = []
  const navigated = []
  const controller = {
    feed: {
      unread: 1,
      items: [{ id: "n-1", recipient_id: "m1", type: "task_assigned", title: "New task", message: "Fix the header", link: "pm-tasks?task=t-1", read: false, created_at: Date.now() }],
    },
    busy: null,
    error: null,
    refresh: () => {},
    dismissError: () => {},
    markRead: (ids) => marked.push(...ids),
    clear: () => {},
    markAllRead: async () => {},
    clearRead: async () => {},
    clearAll: async () => true,
  }
  const view = await mount(React.createElement(NotificationsBellView, { controller, onNavigate: (page, params) => navigated.push([page, params]) }))
  const bell = view.container.querySelector('button[aria-haspopup="dialog"]')
  await click(bell)
  assert.equal(bell.getAttribute("aria-expanded"), "true")
  const row = [...view.container.querySelectorAll("button")].find((b) => b.textContent.includes("Fix the header"))
  await click(row)
  assert.deepEqual(navigated, [["pm-tasks", { task: "t-1" }]])
  assert.deepEqual(marked, ["n-1"])
  assert.equal(bell.getAttribute("aria-expanded"), "false")
  await view.unmount()
})

// Kept as a cross-package meta-guard: the links are written by six different backend flows, and
// this is the one place that sees all of them next to the resolver above. Each one used to link
// to a section only, so a click landed on a list and left the reader to find the thing.
test("every notification the backend sends names the item it is about", () => {
  const backend = (rel) => readFileSync(fileURLToPath(new URL(`../../Dashboard-Backend/${rel}`, import.meta.url)), "utf8")
  const links = {
    "src/modules/tasks/task-assignments.js": /task=\$\{taskId\}/,
    "src/modules/clients/services/client-budget-notify.js": /pm-clients\?client=\$\{clientId\}/,
    "src/modules/projects/services/project-budget-notify.js": /pm-projects\?project=\$\{projectId\}/,
    "src/modules/notifications/first-login-notify.js": /people-members\?member=\$\{memberId\}/,
    "src/modules/auth/account-deactivation.js": /people-members\?member=\$\{requestDoc\.memberId\}/,
    "src/modules/activity/activity-alerts.js": /activity-screenshots\?member=\$\{memberId\}/,
  }
  for (const [file, pattern] of Object.entries(links)) assert.match(backend(file), pattern, file)
  void Nothing
})
