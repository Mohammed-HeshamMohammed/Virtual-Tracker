// notificationTarget: which page a notification opens, and WHICH ITEM on it.
//
// The bell used to resolve a link with `raw.split(/[?#]/)[0]`, throwing the
// query away, so a notification about one task could only ever open the Tasks
// page. These pin that the item survives, and that the historical link shapes
// all still resolve.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const bell = readFileSync(
  `${ROOT}shared/ui/layout/components/topbar/notifications-bell.tsx`,
  "utf8",
)

test("the query is parsed, not discarded", () => {
  // The exact line that caused the bug, applied to the whole link.
  assert.doesNotMatch(
    bell,
    /const candidate = fromQuery \? decodeURIComponent\(fromQuery\[1\]\) : raw\.split\(\/\[\?#\]\/\)\[0\]\s*\n\s*const pageId = candidate\.replace/,
    "the page id must be derived without throwing the rest of the link away",
  )
  assert.match(bell, /new URLSearchParams\(raw\.slice\(queryStart \+ 1\)\)/, "the query is read as params")
  assert.match(bell, /if \(key !== "page" && value\) params\[key\] = value/, "`page` names the page, it is not a param")
})

test("navigation carries the params through", () => {
  assert.match(bell, /onNavigate\(target\.pageId, target\.params\)/)
  assert.match(
    bell,
    /onNavigate\?: \(pageId: string, params\?: Record<string, string>\) => void/,
    "the handler must accept them",
  )
})

test("notificationPageId still exists for callers that only want the page", () => {
  assert.match(bell, /export function notificationPageId/)
  assert.match(bell, /return notificationTarget\(link\)\?\.pageId \?\? null/)
})

test("every notification the backend sends names the item it is about", () => {
  const backend = (rel) => readFileSync(`${ROOT}../Dashboard-Backend/${rel}`, "utf8")

  // Each of these used to link to a section only, so a click landed on a list
  // and left the reader to find the thing themselves.
  assert.match(backend("src/modules/tasks/task-assignments.js"), /task=\$\{taskId\}/)
  assert.match(backend("src/modules/clients/services/client-budget-notify.js"), /pm-clients\?client=\$\{clientId\}/)
  assert.match(backend("src/modules/projects/services/project-budget-notify.js"), /pm-projects\?project=\$\{projectId\}/)
  assert.match(backend("src/modules/notifications/first-login-notify.js"), /people-members\?member=\$\{memberId\}/)
  assert.match(backend("src/modules/auth/account-deactivation.js"), /people-members\?member=\$\{requestDoc\.memberId\}/)
  assert.match(backend("src/modules/activity/activity-alerts.js"), /activity-screenshots\?member=\$\{memberId\}/)
})

test("the Notifications page is a real page, or nothing could link to it", () => {
  // notificationTarget refuses any page id that is not in NAV_SECTIONS, so an
  // unregistered page would silently make every message link dead.
  const nav = readFileSync(`${ROOT}shared/ui/layout/config/nav-sections.ts`, "utf8")
  assert.match(nav, /id: "notifications"/)
  const chunks = readFileSync(`${ROOT}app/routes/resolve-chunk.ts`, "utf8")
  assert.match(chunks, /notifications: "profile"/)
})
