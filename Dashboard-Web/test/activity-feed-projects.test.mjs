// The Activity pages can be narrowed to several projects: the control bar offers the choice, the
// feed request carries it, and both caches keep one project choice's results apart from another's.
// Rendered in jsdom with the real feed provider and control bar, and the real API client talking to
// a stand-in backend. Replaces a source-text check in time-activity-pdf-documents.test.mjs.
import test, { after } from "node:test"
import assert from "node:assert/strict"
import { installDom, createLoader, framerMotionStub, mount, click, settle, waitFor, React, signedInStubs, fakeBackend } from "./helpers/render.mjs"

const env = installDom()
after(() => env.restore())

const loader = createLoader({
  stubs: {
    ...signedInStubs,
    "framer-motion": framerMotionStub,
    "@/shared/providers/app": { useAuth: () => ({ isLoggedIn: true, memberId: "viewer-1", memberRole: "Owner" }), useTheme: () => ({ isDark: false }) },
  },
})
const { ActivityFeedProvider, useActivityFeedContext } = loader.load("features/activity/components/activity-feed-context.tsx")
const { ActivityControlBar } = loader.load("features/activity/components/activity-control-bar.tsx")
const api = loader.load("features/activity/services/activity-api.ts")
const { buildActivityFeedCacheKey } = loader.load("features/activity/utils/activity-feed-cache.ts")

const calls = fakeBackend((call) => {
  if (call.path === "/api/reports/filter-options") {
    return { body: { success: true, data: { members: [], projects: [{ id: "p-web", name: "Website" }, { id: "p-shop", name: "Shop" }] } } }
  }
  if (call.path === "/api/activity/feed") return { body: { success: true, data: [], members: [] } }
  return { body: { success: true, data: null } }
})

test("the feed request names the chosen projects, and leaves them out when none are chosen", async () => {
  api.clearActivityApiFeedCache()
  calls.length = 0
  await api.fetchActivityFeed({ type: "screenshots", memberId: "all", projectScopeOnly: false, projectIds: ["p-web", "p-shop"] })
  await api.fetchActivityFeed({ type: "screenshots", memberId: "all", projectScopeOnly: false })
  const feeds = calls.filter((c) => c.path === "/api/activity/feed")
  assert.equal(feeds.length, 2, "a different project choice is not served from the other's cache")
  assert.equal(feeds[0].query.projectIds, "p-web,p-shop")
  assert.equal("projectIds" in feeds[1].query, false)
  await api.fetchActivityFeed({ type: "screenshots", memberId: "all", projectScopeOnly: false, projectIds: ["p-web", "p-shop"] })
  assert.equal(calls.filter((c) => c.path === "/api/activity/feed").length, 2, "the same choice again is")
})

test("the page cache keeps one project choice apart from another", () => {
  const base = { type: "apps", memberId: "all", projectScopeOnly: false }
  const all = buildActivityFeedCacheKey("v", base)
  const web = buildActivityFeedCacheKey("v", { ...base, projectIds: ["p-web"] })
  const both = buildActivityFeedCacheKey("v", { ...base, projectIds: ["p-web", "p-shop"] })
  assert.equal(new Set([all, web, both]).size, 3)
})

test("picking projects in the control bar narrows the query every Activity page builds", async () => {
  const seen = {}
  function Probe() {
    const ctx = useActivityFeedContext()
    seen.query = ctx.buildQuery("screenshots")
    seen.key = ctx.getCacheKey(seen.query)
    return null
  }
  const noop = () => {}
  const bar = {
    pageId: "screenshots", selectedDay: new Date(), selectedDayLabel: "Today", isAllDays: false, isSelectedToday: true, isYesterday: false,
    showDayPicker: false, onCloseDayPicker: noop, onSelectDay: noop, onSelectAllDays: noop, onGoToToday: noop, onGoToYesterday: noop,
    onOpenDayPicker: noop, onShiftDay: noop, searchQuery: "", onSearchChange: noop, onClearSearch: noop, onResetFilters: noop,
    hasActiveFilters: false, searchPlaceholder: "Search", onRefresh: noop,
  }
  const view = await mount(
    React.createElement(ActivityFeedProvider, null, React.createElement(ActivityControlBar, bar), React.createElement(Probe)),
  )
  const projectsButton = () => [...view.container.querySelectorAll('button[aria-haspopup="listbox"]')].find((b) => b.textContent.includes("All projects"))
  await waitFor(() => projectsButton())
  assert.equal("projectIds" in seen.query, false, "every project to start with")
  await click(projectsButton())
  for (const name of ["Website", "Shop"]) {
    const option = [...view.container.querySelectorAll("button, [role=option], label")].find((el) => el.textContent.trim() === name)
    await click(option)
  }
  await settle()
  assert.deepEqual(seen.query.projectIds, ["p-web", "p-shop"])
  assert.match(seen.key, /p-web,p-shop/)
  await view.unmount()
})
