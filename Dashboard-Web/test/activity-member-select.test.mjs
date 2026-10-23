// The Activity pages' member picker: several members at a time (carried as one comma-joined id),
// each shown with their photo, and unticking the last one goes back to "all" only where "all" is
// allowed. Rendered in jsdom with the real feed provider and the real API client talking to a
// stand-in backend. Replaces source-text checks in time-activity-pdf-documents.test.mjs.
import test, { after } from "node:test"
import assert from "node:assert/strict"
import { installDom, createLoader, framerMotionStub, mount, click, waitFor, React, signedInStubs, fakeBackend } from "./helpers/render.mjs"

const env = installDom()
after(() => env.restore())

const loader = createLoader({
  stubs: {
    ...signedInStubs,
    "framer-motion": framerMotionStub,
    "@/shared/providers/app": { useAuth: () => ({ isLoggedIn: true, memberId: "viewer-1", memberRole: "Owner" }), useTheme: () => ({ isDark: false }) },
    // "My team" mode is its own feature; here the picker lists everyone in scope.
    "@/features/members/context/people-team-scope-context": {
      usePeopleTeamScope: () => ({ canToggleMyTeam: false, myTeamOnly: false, teamMemberIds: new Set(), teamMemberIdsLoading: false }),
    },
  },
})
const { ActivityFeedProvider, useActivityFeedContext } = loader.load("features/activity/components/activity-feed-context.tsx")
const { ActivityMemberSelect } = loader.load("features/activity/components/activity-member-select.tsx")
const { splitSelectedMemberIds, joinSelectedMemberIds } = loader.load("features/activity/utils/activity-scope-preferences.ts")

const members = [
  { id: "ann", name: "Ann Lee", initials: "AL", avatarUrl: "https://cdn.example/ann.png" },
  { id: "bob", name: "Bob Ray", initials: "BR", avatarUrl: null },
  { id: "cy", name: "Cy Fox", initials: "CF", avatarUrl: null },
]

async function picker(canSeeAllMembers) {
  window.localStorage.clear()
  fakeBackend((call) => {
    if (call.path === "/api/activity/scope") {
      return { body: { success: true, data: { viewerMemberId: "viewer-1", roleName: "Owner", canFilterByProject: true, canSeeAllMembers, projectScopeOnly: false, members, defaultMemberId: "ann" } } }
    }
    return { body: { success: true, data: [] } }
  })
  const state = {}
  function Probe() {
    const ctx = useActivityFeedContext()
    state.selected = ctx.selectedMemberId
    state.set = ctx.setSelectedMemberId
    return null
  }
  const view = await mount(React.createElement(ActivityFeedProvider, null, React.createElement(ActivityMemberSelect), React.createElement(Probe)))
  const trigger = () => view.container.querySelector('button[aria-haspopup="listbox"]')
  await waitFor(() => trigger())
  await click(trigger())
  const option = (name) => [...view.container.querySelectorAll("button")].find((b) => !b.hasAttribute("aria-haspopup") && b.textContent.trim().endsWith(name))
  return { view, state, option }
}

test("the picked members travel as one comma-joined id, and 'all' is none", () => {
  assert.deepEqual(splitSelectedMemberIds("all"), [])
  assert.deepEqual(splitSelectedMemberIds("a, b ,,c"), ["a", "b", "c"])
  assert.equal(joinSelectedMemberIds([]), "all")
  assert.equal(joinSelectedMemberIds(new Set(["a", "b", "a"])), "a,b")
})

test("several members can be picked, each shown with their photo; unticking the last goes back to all", async () => {
  const p = await picker(true)
  assert.ok(p.view.container.querySelector('img[src="https://cdn.example/ann.png"]'), "Ann's photo is in the list")
  await click(p.option("Ann Lee"))
  await click(p.option("Bob Ray"))
  assert.equal(p.state.selected, "ann,bob")
  await click(p.option("Ann Lee"))
  await click(p.option("Bob Ray"))
  assert.equal(p.state.selected, "all")
  await p.view.unmount()
})

test("where 'all' is not allowed, the last member cannot be unticked", async () => {
  const p = await picker(false)
  await waitFor(() => p.option("Bob Ray"))
  await p.state.set("bob")
  await waitFor(() => p.state.selected === "bob")
  await click(p.option("Bob Ray"))
  assert.equal(p.state.selected, "bob", "someone has to stay selected")
  await p.view.unmount()
})
