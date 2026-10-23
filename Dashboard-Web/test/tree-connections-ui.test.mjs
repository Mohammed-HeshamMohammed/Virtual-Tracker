// The member tree as it is used: the chart's drags (arrange and reassign), the confirmation before
// anything is saved, a packed team's frame carried onto a manager in one move, the chart's own
// controls, the list view, the page's permissions and the requests the moves make. Rendered in
// jsdom - the chart lays itself out in its own coordinates, so a drag can be played through it -
// with the real API client talking to a stand-in backend.
//
// Replaces the "wiring:" and "group move:" source-text checks in tree-connections.test.mjs.
import test, { after } from "node:test"
import assert from "node:assert/strict"
import {
  installDom, createLoader, framerMotionStub, mount, click, settle, type, waitFor, React, Nothing, signedInStubs, fakeBackend, selectStub,
} from "./helpers/render.mjs"

const env = installDom()
after(() => env.restore())

let auth = { memberRole: "Owner", memberId: "boss" }
const loader = createLoader({
  stubs: {
    ...signedInStubs,
    "framer-motion": framerMotionStub,
    "@/shared/ui/select": selectStub,
    "@/shared/providers/app": { useTheme: () => ({ isDark: false }), useAuth: () => auth },
  },
})
const { MemberTreeConnectionsView } = loader.load("features/members/tree-connections/connections-view.tsx")
const { DEFAULT_TREE_CHART_SETTINGS } = loader.load("shared/ui/tree-chart.tsx")

const node = (id, role) => ({ id, name: id.toUpperCase(), email: "", role, hierarchy_status: "" })
const edge = (p, c) => ({ id: `${p}>${c}`, parent_member_id: p, child_member_id: c, relationship_type: "" })
const TEAM = Array.from({ length: 30 }, (_, i) => `t${i}`)
const smallTree = {
  nodes: [node("boss", "Owner"), node("m1", "Manager"), node("m2", "Manager"), node("e1", "Employee")],
  edges: [edge("boss", "m1"), edge("boss", "m2"), edge("m1", "e1")],
}
const bigTree = {
  nodes: [...smallTree.nodes, ...TEAM.map((id) => node(id, "Employee"))],
  edges: [...smallTree.edges, ...TEAM.map((id) => edge("m2", id))],
}

async function chart(tree = smallTree, props = {}) {
  const single = []
  const many = []
  const settingsChanges = []
  const view = await mount(
    React.createElement(MemberTreeConnectionsView, {
      ...tree, scope: "organization", viewerId: "boss", isDark: false, settings: DEFAULT_TREE_CHART_SETTINGS, canReassign: true,
      onReassign: async (id, parent) => {
        single.push([id, parent])
      },
      onReassignMany: async (ids, parent) => {
        many.push([ids, parent])
        return { moved: ids.length, unchanged: 0, skipped: [] }
      },
      onSettingsChange: (patch) => settingsChanges.push(patch),
      ...props,
    }),
  )
  const root = view.container
  const card = (id) => root.querySelector(`[data-node-id="${id}"]`)
  const at = (id) => ({ x: parseFloat(card(id).style.left), y: parseFloat(card(id).style.top) })
  const centre = (id) => ({ x: at(id).x + parseFloat(card(id).style.width) / 2, y: at(id).y + parseFloat(card(id).style.height) / 2 })
  const fire = (type, p, target = window, extra = {}) =>
    settle(() => target.dispatchEvent(Object.assign(new window.MouseEvent(type, { bubbles: true, clientX: p.x, clientY: p.y, button: 0, ...extra }), { pointerId: 1 })))
  /** A press on `el` at `from`, a move past the drag threshold, and a release at `to`. */
  const drag = async (el, from, to, extra = {}) => {
    await fire("pointerdown", from, el, extra)
    await fire("pointermove", { x: from.x + 15, y: from.y + 15 }, window, extra)
    await fire("pointermove", to, window, extra)
    await fire("pointerup", to, window, extra)
  }
  const mode = (titleStart) => click([...root.querySelectorAll("button")].find((b) => (b.getAttribute("title") ?? "").startsWith(titleStart)))
  const button = (text) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === text)
  return { view, root, card, at, centre, drag, mode, button, single, many, settingsChanges }
}

test("in Reassign, dropping a member on a manager asks first, and only Move saves", async () => {
  const c = await chart()
  await c.mode("Drag a member onto")
  await c.drag(c.card("e1"), c.centre("e1"), c.centre("m2"))
  assert.match(c.root.textContent, /Move E1 from M1 to report to M2\?/)
  assert.deepEqual(c.single, [], "nothing is saved until confirmed")
  await click(c.button("Cancel"))
  assert.deepEqual(c.single, [])
  await c.drag(c.card("e1"), c.centre("e1"), c.centre("m2"))
  await click(c.button("Move"))
  await waitFor(() => c.single.length === 1)
  assert.deepEqual(c.single, [["e1", "m2"]])
  await c.view.unmount()
})

test("a drop the rules refuse - a manager onto their own team - is never offered", async () => {
  const c = await chart()
  await c.mode("Drag a member onto")
  await c.drag(c.card("m1"), c.centre("m1"), c.centre("e1"))
  assert.equal(c.button("Move"), undefined)
  assert.deepEqual(c.single, [])
  await c.view.unmount()
})

test("in Arrange, a drag moves one card, and Shift moves a manager with their whole team - saving nothing", async () => {
  const c = await chart()
  await c.mode("Drag cards to rearrange")
  const before = { m1: c.at("m1"), e1: c.at("e1") }
  await c.drag(c.card("m1"), c.centre("m1"), { x: c.centre("m1").x + 100, y: c.centre("m1").y })
  assert.notDeepEqual(c.at("m1"), before.m1)
  assert.deepEqual(c.at("e1"), before.e1, "alone, the team stays")
  const moved = { m1: c.at("m1"), e1: c.at("e1") }
  await c.drag(c.card("m1"), c.centre("m1"), { x: c.centre("m1").x + 100, y: c.centre("m1").y }, { shiftKey: true })
  assert.equal(c.at("m1").x - moved.m1.x, 100)
  assert.equal(c.at("e1").x - moved.e1.x, 100, "with Shift, the team comes along")
  assert.deepEqual(c.single, [])
  await c.view.unmount()
})

test("a packed team's frame has a drag handle that, in Reassign, carries the whole group onto a manager in one request", async () => {
  const c = await chart(bigTree)
  const handle = () => [...c.root.querySelectorAll("[title]")].find((el) => /move (this whole group|all of them)/.test(el.getAttribute("title")))
  assert.equal(handle().getAttribute("title"), "Drag to move this whole group")
  await c.mode("Drag a member onto")
  assert.equal(handle().getAttribute("title"), "Drag onto a manager to move all of them")
  const h = handle().getBoundingClientRect ? handle() : handle()
  const from = { x: parseFloat(h.style.left || "0"), y: parseFloat(h.style.top || "0") }
  await c.drag(h, from, c.centre("m1"))
  await click(c.button("Move"))
  await waitFor(() => c.many.length === 1)
  assert.deepEqual([...c.many[0][0]].sort(), [...TEAM].sort())
  assert.equal(c.many[0][1], "m1")
  assert.deepEqual(c.single, [], "one request for the group, not thirty")
  await c.view.unmount()
})

test("the chart carries its own layout controls, and switches between cards and avatars", async () => {
  const c = await chart()
  // Layout, orientation and link style, each a select showing its current value.
  for (const label of ["Cartesian", "Vertical", "Curve"]) assert.ok(c.button(label), label)
  await click(c.button("Vertical"))
  const option = [...document.body.querySelectorAll("button, [role=option]")].find((el) => el.textContent.trim() === "Horizontal")
  assert.ok(option, [...document.body.querySelectorAll("button")].map((b) => b.textContent.trim()).join("|"))
  await click(option)
  assert.deepEqual(c.settingsChanges, [{ orientation: "horizontal" }])
  const cardWidth = parseFloat(c.card("e1").style.width)
  await click(c.button("Avatars"))
  assert.ok(parseFloat(c.card("e1").style.width) < cardWidth, "avatars are drawn smaller than cards")
  await c.view.unmount()
})

// ── the page and its requests ──────────────────────────────────────────────

const seenProps = { chart: null, list: null }
const pageLoader = createLoader({
  stubs: {
    ...signedInStubs,
    "framer-motion": framerMotionStub,
    "@/shared/ui/select": selectStub,
    "@/shared/providers/app": { useTheme: () => ({ isDark: false }), useAuth: () => auth },
    "@/features/members/tree-connections/connections-view": {
      MemberTreeConnectionsView: (props) => {
        seenProps.chart = props
        return null
      },
    },
    "@/features/members/tree-connections/list-view": {
      MemberTreeListView: (props) => {
        seenProps.list = props
        return null
      },
    },
  },
})

const backend = () =>
  fakeBackend((call) => {
    if (call.path.includes("member-relationships/move")) {
      return { body: { success: true, data: call.body.member_ids ? { moved: call.body.member_ids.length, unchanged: 0, skipped: [], parent_id: call.body.new_parent_id } : { moved: true } } }
    }
    if (call.path.includes("visual-tree")) {
      return { body: { success: true, data: { nodes: smallTree.nodes, edges: smallTree.edges, root_member_id: "boss", valid_root_member_ids: ["boss"] } } }
    }
    return { body: { success: true, data: [] } }
  })

async function openConnections(view) {
  seenProps.chart = null
  await click([...view.container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Connections"))
  await waitFor(() => seenProps.chart)
}

test("only the Owner and Super Admins may reassign, and the page's moves go to the move endpoint", async () => {
  const { MemberTreePage } = pageLoader.load("features/members/pages/member-tree-page.tsx")
  for (const [role, allowed] of [["Owner", true], ["Super Admin", true], ["Admin", false], ["Manager", false]]) {
    auth = { memberRole: role, memberId: "boss" }
    seenProps.chart = null
    backend()
    seenProps.list = null
    const view = await mount(React.createElement(MemberTreePage))
    await waitFor(() => seenProps.list)
    assert.equal(typeof seenProps.list.onReassign === "function", allowed, `${role}: list`)
    await openConnections(view)
    assert.equal(typeof seenProps.chart.onReassign === "function", allowed, `${role}: chart`)
    assert.equal(typeof seenProps.chart.onReassignMany === "function", allowed, `${role}: chart group moves`)
    await view.unmount()
  }

  auth = { memberRole: "Owner", memberId: "boss" }
  const calls = backend()
  const view = await mount(React.createElement(MemberTreePage))
  await waitFor(() => seenProps.list)
  await openConnections(view)
  const props = seenProps.chart
  await settle(() => props.onReassign("e1", "m2"))
  await settle(() => props.onReassignMany(["e1", "m1"], "m2"))
  const moves = calls.filter((c) => c.path.endsWith("/member-relationships/move"))
  assert.deepEqual(moves.map((c) => c.body), [
    { member_id: "e1", new_parent_id: "m2" },
    { member_ids: ["e1", "m1"], new_parent_id: "m2" },
  ])
  await view.unmount()
})

// ── the list view ───────────────────────────────────────────────────────────

const { MemberTreeListView } = loader.load("features/members/tree-connections/list-view.tsx")

async function list(props = {}) {
  const shown = []
  const single = []
  const view = await mount(
    React.createElement(MemberTreeListView, {
      ...smallTree, scope: "organization", viewerId: "boss", isDark: false, canReassign: true,
      onReassign: async (id, parent) => {
        single.push([id, parent])
      },
      onShowInChart: (id) => shown.push(id),
      ...props,
    }),
  )
  const root = view.container
  const rows = () => [...root.querySelectorAll('[aria-label="Show in the chart"]')].map((b) => b.closest("li"))
  // A row names its member first (and may name their manager after).
  const nameOf = (row) => {
    const text = row.textContent
    return ["BOSS", "M1", "M2", "E1"].map((n) => [n, text.indexOf(n)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1])[0]?.[0]
  }
  const rowOf = (name) => rows().find((r) => nameOf(r) === name)
  const names = () => rows().map(nameOf)
  const search = root.querySelector('input[placeholder^="Find a member"]')
  return { view, root, rowOf, names, search, shown, single }
}

test("the list follows the tree, folds a team away, and narrows by search and by role", async () => {
  const l = await list()
  assert.deepEqual(l.names(), ["BOSS", "M1", "E1", "M2"])
  await click(l.rowOf("M1").querySelector('[aria-label="Hide team"]'))
  assert.deepEqual(l.names(), ["BOSS", "M1", "M2"], "folding M1 hides their team")
  await click(l.rowOf("M1").querySelector('[aria-label="Show team"]'))
  await type(l.search, "e1")
  assert.deepEqual(l.names(), ["BOSS", "M1", "E1"], "a match keeps the managers above it")
  await type(l.search, "")
  const employeeFilter = [...l.root.querySelectorAll("button")].find((b) => /^Employee\d/.test(b.textContent.trim()))
  await click(employeeFilter)
  assert.ok(l.names().includes("E1") && !l.names().includes("M2"), "the role filter keeps employees (and who they report to)")
  await l.view.unmount()
})

test("Show in the chart hands the member over to the chart", async () => {
  const l = await list()
  await click(l.rowOf("E1").querySelector('[aria-label="Show in the chart"]'))
  assert.deepEqual(l.shown, ["e1"])
  await l.view.unmount()
})

test("the list changes a manager through the same guarded flow: offered except for the Owner, confirmed before saving", async () => {
  const l = await list()
  assert.equal(l.rowOf("BOSS").querySelector('[aria-label="Change manager"]'), null, "the Owner reports to nobody")
  await click(l.rowOf("E1").querySelector('[aria-label="Change manager"]'))
  const pick = [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("M2"))
  await click(pick)
  assert.deepEqual(l.single, [], "picking asks first")
  await click([...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === "Move"))
  await waitFor(() => l.single.length === 1)
  assert.deepEqual(l.single, [["e1", "m2"]])
  await l.view.unmount()
})

test("a viewer who may not reassign is offered no Change manager at all", async () => {
  const l = await list({ canReassign: false, onReassign: undefined })
  assert.equal(l.root.querySelector('[aria-label="Change manager"]'), null)
  await l.view.unmount()
})
