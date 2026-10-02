// The Members tree Connections view: the geometry and rules behind it, with no browser.
import test from "node:test"
import assert from "node:assert/strict"
import { buildTreeModel, collapsedBeyond, descendantsOf, edgesAfterMove, maxDepth, pathToRoot, visibleIds } from "../features/members/tree-connections/model.ts"
import { computeLayout, DEFAULT_LAYOUT_OPTIONS } from "../features/members/tree-connections/layout.ts"
import { buildLinks } from "../features/members/tree-connections/link-set.ts"
import { facingSides, linkPath } from "../features/members/tree-connections/links.ts"
import { canReassign, validManagersFor } from "../features/members/tree-connections/rules.ts"
import { parseOffsets, pruneOffsets, serializeOffsets } from "../features/members/tree-connections/offsets.ts"
import { searchMembers } from "../features/members/tree-connections/search.ts"
import { buildTreeSvg, escapeXml, initialsOf } from "../features/members/tree-connections/export-svg.ts"

const node = (id, role, extra = {}) => ({ id, name: extra.name ?? id.toUpperCase(), email: `${id}@x.com`, role, ...extra })
const edge = (parent, child) => ({ parent_member_id: parent, child_member_id: child })

//  owner
//   admin
//    mgrA -- empA, empB
//    mgrB -- empC
//   client (outside the tree)
const NODES = [
  node("owner", "Owner"),
  node("admin", "Admin"),
  node("mgrA", "Manager"),
  node("mgrB", "Manager"),
  node("empA", "Employee"),
  node("empB", "Employee"),
  node("empC", "Employee"),
  node("client", "Client"),
]
const EDGES = [edge("owner", "admin"), edge("admin", "mgrA"), edge("admin", "mgrB"), edge("mgrA", "empA"), edge("mgrA", "empB"), edge("mgrB", "empC")]
const model = () => buildTreeModel({ nodes: NODES, edges: EDGES })

// ---- model -------------------------------------------------------------------------------------

test("model: parents, children, roots and depth", () => {
  const m = model()
  assert.equal(m.parentOf.get("empA"), "mgrA")
  assert.deepEqual(m.childrenOf.get("mgrA"), ["empA", "empB"])
  assert.ok(m.roots.includes("owner"))
  assert.ok(m.roots.includes("client"), "someone with no manager starts a tree of their own - nobody disappears")
  assert.equal(m.depthOf.get("empA"), 3)
  assert.equal(maxDepth(m), 4)
})

test("model: one manager each (the last edge wins) and no Owner under an Owner", () => {
  const m = buildTreeModel({
    nodes: [node("o1", "Owner"), node("o2", "Owner"), node("e", "Employee"), node("m1", "Manager"), node("m2", "Manager")],
    edges: [edge("o1", "o2"), edge("m1", "e"), edge("m2", "e")],
  })
  assert.equal(m.parentOf.get("o2"), null)
  assert.equal(m.parentOf.get("e"), "m2")
  assert.deepEqual(m.childrenOf.get("m1"), [])
})

test("model: members the server flags as needing a manager are orphans, not roots", () => {
  const m = buildTreeModel({
    nodes: [node("owner", "Owner"), node("lost", "Employee", { hierarchy_status: "hierarchy_assignment_required" })],
    edges: [],
    validRootIds: ["owner"],
  })
  assert.deepEqual(m.orphans, ["lost"])
  assert.deepEqual(m.roots, ["owner"])
})

test("model: a cycle in the data does not hide anyone or loop forever", () => {
  const m = buildTreeModel({ nodes: [node("a", "Manager"), node("b", "Manager")], edges: [edge("a", "b"), edge("b", "a")] })
  assert.equal(m.depthOf.size, 2)
})

test("model: descendants, path to the root, visibility under collapsed teams", () => {
  const m = model()
  assert.deepEqual(descendantsOf(m, "mgrA").sort(), ["empA", "empB"])
  assert.deepEqual(pathToRoot(m, "empA"), ["empA", "mgrA", "admin", "owner"])
  assert.deepEqual([...visibleIds(m, new Set(["mgrA"]))].sort(), ["admin", "client", "empC", "mgrA", "mgrB", "owner"])
  assert.deepEqual([...collapsedBeyond(m, 2)].sort(), ["admin"], "show two levels: owner and admin, fold admin's team")
})

test("model: an optimistic reassignment swaps exactly one edge", () => {
  const next = edgesAfterMove(EDGES, "empA", "mgrB")
  assert.equal(next.filter((e) => e.child_member_id === "empA").length, 1)
  assert.equal(next.find((e) => e.child_member_id === "empA").parent_member_id, "mgrB")
  assert.equal(next.length, EDGES.length)
})

// ---- layout ------------------------------------------------------------------------------------

const O = DEFAULT_LAYOUT_OPTIONS

function overlaps(a, b, o = O) {
  return Math.abs(a.x - b.x) < o.nodeWidth && Math.abs(a.y - b.y) < o.nodeHeight
}

test("layout: a manager sits above their team and levels stack downward", () => {
  const m = model()
  const { positions } = computeLayout(m, new Set(), O)
  assert.ok(positions.get("admin").y > positions.get("owner").y)
  assert.ok(positions.get("mgrA").y > positions.get("admin").y)
  const mid = (positions.get("empA").x + positions.get("empB").x) / 2
  assert.ok(Math.abs(positions.get("mgrA").x - mid) < 1, "centred over the team")
  assert.equal(positions.size, NODES.length)
})

test("layout: no two cards overlap, vertical or horizontal", () => {
  for (const orientation of ["vertical", "horizontal"]) {
    const { positions } = computeLayout(model(), new Set(), { ...O, orientation })
    const points = [...positions.values()]
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) assert.equal(overlaps(points[i], points[j]), false, `${orientation} ${i} ${j}`)
    }
  }
})

test("layout: horizontal runs left to right", () => {
  const { positions } = computeLayout(model(), new Set(), { ...O, orientation: "horizontal" })
  assert.ok(positions.get("admin").x > positions.get("owner").x)
  assert.ok(positions.get("empA").x > positions.get("mgrA").x)
})

test("layout: collapsing a manager removes their team from the layout", () => {
  const { positions } = computeLayout(model(), new Set(["mgrA"]), O)
  assert.equal(positions.has("empA"), false)
  assert.equal(positions.has("mgrA"), true)
})

test("layout: everything is at or beyond the margin, and bounds contain every card", () => {
  const { positions, bounds } = computeLayout(model(), new Set(), O)
  for (const p of positions.values()) {
    assert.ok(p.x - O.nodeWidth / 2 >= 0 && p.y - O.nodeHeight / 2 >= 0)
    assert.ok(p.x + O.nodeWidth / 2 <= bounds.maxX && p.y + O.nodeHeight / 2 <= bounds.maxY)
  }
})

function bigTeam(n) {
  const nodes = [node("boss", "Manager"), ...Array.from({ length: n }, (_, i) => node(`e${i}`, "Employee"))]
  const edges = Array.from({ length: n }, (_, i) => edge("boss", `e${i}`))
  return buildTreeModel({ nodes, edges })
}

test("layout: seventy reports are packed into a grid inside one frame, not a seventy-wide row", () => {
  const m = bigTeam(70)
  const { positions, groups, bounds } = computeLayout(m, new Set(), O)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].memberIds.length, 70)
  assert.ok(bounds.maxX < 70 * (O.nodeWidth + O.siblingGap) / 3, `width ${bounds.maxX}`)
  const points = [...positions.values()]
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) assert.equal(overlaps(points[i], points[j]), false)
  const frame = groups[0]
  for (const id of frame.memberIds) {
    const p = positions.get(id)
    assert.ok(p.x - O.nodeWidth / 2 >= frame.x - 1 && p.x + O.nodeWidth / 2 <= frame.x + frame.width + 1, "inside the frame, across")
    assert.ok(p.y - O.nodeHeight / 2 >= frame.y - 1 && p.y + O.nodeHeight / 2 <= frame.y + frame.height + 1, "inside the frame, down")
  }
})

test("layout: a small team is a plain row, and grids do not apply to polar", () => {
  assert.equal(computeLayout(bigTeam(3), new Set(), O).groups.length, 0)
  assert.equal(computeLayout(bigTeam(70), new Set(), { ...O, layout: "polar" }).groups.length, 0)
})

test("layout: polar fans the tree out around the root", () => {
  const m = model()
  const { positions } = computeLayout(m, new Set(), { ...O, layout: "polar" })
  const root = positions.get("owner")
  const admin = positions.get("admin")
  const emp = positions.get("empA")
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  assert.ok(dist(root, emp) > dist(root, admin), "deeper members are further out")
})

test("layout: an empty tree is empty, not a crash", () => {
  const out = computeLayout({ roots: [], childrenOf: new Map() }, new Set(), O)
  assert.equal(out.positions.size, 0)
  assert.equal(computeLayout({ roots: [], childrenOf: new Map() }, new Set(), { ...O, layout: "polar" }).positions.size, 0)
})

// ---- links -------------------------------------------------------------------------------------

const boxAt = (x, y) => ({ x, y, width: 100, height: 40 })

test("links: a child below leaves the bottom and arrives at the top; one beside leaves from the side", () => {
  assert.deepEqual(facingSides(boxAt(0, 0), boxAt(0, 200), "vertical"), { start: "bottom", end: "top" })
  assert.deepEqual(facingSides(boxAt(0, 0), boxAt(0, -200), "vertical"), { start: "top", end: "bottom" })
  assert.deepEqual(facingSides(boxAt(0, 0), boxAt(400, 5), "vertical"), { start: "right", end: "left" })
  assert.deepEqual(facingSides(boxAt(0, 0), boxAt(200, 0), "horizontal"), { start: "right", end: "left" })
})

test("links: every link type draws a path from the parent to the child", () => {
  for (const type of ["line", "diagonal", "step", "curve"]) {
    const d = linkPath(boxAt(0, 0), boxAt(300, 200), { orientation: "vertical", type, stepPercent: 0.5 })
    assert.match(d, /^M /)
    assert.ok(d.includes(`${300 + 50} ${200}`), `${type} ends at the child's top`)
  }
})

test("links: one line per member, and a packed team shares a single line into its frame", () => {
  const m = bigTeam(10)
  const layout = computeLayout(m, new Set(), O)
  const common = { model: m, positions: layout.positions, groups: layout.groups, nodeWidth: O.nodeWidth, nodeHeight: O.nodeHeight, orientation: "vertical", type: "curve", stepPercent: 0.5 }
  const links = buildLinks(common)
  assert.equal(links.length, 1)
  assert.equal(links[0].toId, null)
  const withMoved = buildLinks({ ...common, movedIds: new Set(["e3"]) })
  assert.equal(withMoved.length, 2, "a card dragged out of its team keeps a line of its own")
  const plain = model()
  const l2 = computeLayout(plain, new Set(), O)
  assert.equal(buildLinks({ ...common, model: plain, positions: l2.positions, groups: l2.groups }).length, 6)
})

// ---- reassignment rules ------------------------------------------------------------------------

test("rules: a valid move, a no-op, and the refusals", () => {
  const m = model()
  assert.deepEqual(canReassign(m, "empA", "mgrB"), { ok: true, noop: false })
  assert.deepEqual(canReassign(m, "empA", "mgrA"), { ok: true, noop: true })
  assert.equal(canReassign(m, "empA", "empA").ok, false)
  assert.equal(canReassign(m, "owner", "admin").ok, false, "the Owner cannot move")
  assert.equal(canReassign(m, "client", "mgrA").ok, false)
  assert.equal(canReassign(m, "empA", "client").ok, false)
  assert.equal(canReassign(m, "mgrA", "empA").ok, false, "an Employee cannot manage a Manager")
  assert.equal(canReassign(m, "ghost", "mgrA").ok, false)
})

test("rules: Super Admins and Admins can only report to the Owner", () => {
  const m = buildTreeModel({
    nodes: [node("o", "Owner"), node("sa", "Super Admin"), node("ad", "Admin"), node("mg", "Manager")],
    edges: [edge("o", "sa"), edge("o", "ad"), edge("sa", "mg")],
  })
  const verdict = canReassign(m, "ad", "sa")
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /reports directly to the Owner/)
  assert.equal(canReassign(m, "mg", "o").ok, true, "a Manager may report to the Owner")
  assert.equal(canReassign(m, "ad", "o").ok, true, "already there: a no-op")
  assert.equal(canReassign(m, "ad", "o").noop, true)
  // Nobody offers an Admin a Super Admin as a manager.
  assert.deepEqual(validManagersFor(m, "ad"), [])
})

test("rules: a manager cannot be put under their own team", () => {
  const chain = buildTreeModel({
    nodes: [node("a", "Manager"), node("b", "Manager"), node("c", "Manager")],
    edges: [edge("a", "b"), edge("b", "c")],
  })
  const verdict = canReassign(chain, "a", "c")
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /own team/)
})

test("rules: validManagersFor lists real options only", () => {
  const m = model()
  const options = validManagersFor(m, "empA")
  assert.ok(options.includes("mgrB") && options.includes("admin"))
  assert.equal(options.includes("mgrA"), false, "already their manager")
  assert.equal(options.includes("client"), false)
  assert.equal(options.includes("empA"), false)
  // Members who already lead a team come first, most senior first.
  assert.deepEqual(options.slice(0, 3), ["owner", "admin", "mgrB"])
})

// ---- offsets, search, export -------------------------------------------------------------------

test("offsets: round-trip, drop junk, forget members who left", () => {
  const offsets = new Map([["a", { x: 12.4, y: -30 }], ["b", { x: 0, y: 0 }]])
  const raw = serializeOffsets(offsets)
  assert.deepEqual(JSON.parse(raw), { a: { x: 12, y: -30 } }, "zero offsets are not stored")
  assert.deepEqual([...parseOffsets(raw)], [["a", { x: 12, y: -30 }]])
  assert.equal(parseOffsets("not json").size, 0)
  assert.equal(parseOffsets(JSON.stringify({ a: { x: "1", y: 2 }, b: [1, 2], c: null })).size, 0)
  assert.equal(parseOffsets(null).size, 0)
  assert.equal(pruneOffsets(parseOffsets(raw), new Set(["z"])).size, 0)
})

test("search: names beat emails beat roles, word starts beat the middle, all terms must match", () => {
  const people = [
    node("1", "Employee", { name: "Samira Hassan", email: "sam@x.com" }),
    node("2", "Manager", { name: "Rasam Ali", email: "ali@x.com" }),
    node("3", "Employee", { name: "Omar Zaki", email: "samir@x.com" }),
  ]
  const hits = searchMembers(people, "sam")
  assert.deepEqual(hits.map((h) => h.id), ["1", "2", "3"])
  assert.deepEqual(searchMembers(people, "sam hassan").map((h) => h.id), ["1"])
  assert.deepEqual(searchMembers(people, "manager").map((h) => h.id), ["2"])
  assert.deepEqual(searchMembers(people, "   "), [])
  assert.deepEqual(searchMembers(people, "zzz"), [])
})

test("export: a standalone SVG with every card, escaped text and the right size", () => {
  const nodes = [node("a", "Owner", { name: "Ann <Boss> & Co" }), node("b", "Employee", { name: "Bo" })]
  const m = buildTreeModel({ nodes, edges: [edge("a", "b")] })
  const layout = computeLayout(m, new Set(), O)
  const svg = buildTreeSvg({ model: m, positions: layout.positions, groups: layout.groups, nodeWidth: O.nodeWidth, nodeHeight: O.nodeHeight, orientation: "vertical", linkType: "curve", stepPercent: 0.5, isDark: true, title: "Members tree" })
  assert.match(svg, /^<svg xmlns=/)
  assert.ok(svg.includes("Ann &lt;Boss&gt; &amp; Co"))
  assert.equal((svg.match(/<path /g) ?? []).length, 1)
  assert.equal((svg.match(/<circle /g) ?? []).length, 2)
  assert.equal(escapeXml(`"'<>&`), "&quot;'&lt;&gt;&amp;")
  assert.equal(initialsOf("Mohammed Hesham"), "MH")
  assert.equal(initialsOf("  "), "?")
  assert.match(buildTreeSvg({ model: buildTreeModel({ nodes: [], edges: [] }), positions: new Map(), groups: [], nodeWidth: 1, nodeHeight: 1, orientation: "vertical", linkType: "line", stepPercent: 0, isDark: false, title: "" }), /width="10"/)
})

// ---- wiring ------------------------------------------------------------------------------------

import { readFileSync } from "node:fs"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replaceAll("\r\n", "\n")

test("wiring: the page uses the new view, only Owner/Super Admin can reassign, and the old view is gone", () => {
  const page = read("features/members/pages/member-tree-page.tsx")
  assert.match(page, /from "@\/features\/members\/tree-connections\/connections-view"/)
  assert.match(page, /const canReassign = viewScope === "organization" && \(isOwner \|\| isSuperAdmin\)/)
  assert.match(page, /onReassign=\{canReassign \? handleReassign : undefined\}/)
  assert.match(page, /onAddHere=\{canManageMembers \? setAddUnder : undefined\}/)
  assert.equal(existsSync(join(ROOT, "features/members/pages/member-tree-connections-view.tsx")), false)
  assert.match(read("features/members/services/member-tree.ts"), /\/api\/member-relationships\/move/)
})

test("wiring: the view keeps its promises - Shift moves a team, drops are checked, nothing is saved until confirmed", () => {
  const view = read("features/members/tree-connections/connections-view.tsx")
  assert.match(view, /event\.shiftKey \? \[id, \.\.\.descendantsOf/)
  assert.match(view, /canReassign\(modelRef\.current, id, target\)/)
  assert.match(view, /useReassignFlow\(/)
  assert.match(read("features/members/tree-connections/use-reassign.ts"), /await onReassign\(pending\.memberId, pending\.newParentId\)/)
  assert.match(view, /overflow-clip/)
})

// ---- avatar style and the list ------------------------------------------------------------------

import { layoutOptionsFor } from "../features/members/tree-connections/layout.ts"
import { flattenForList, isFiltering, matchingIds } from "../features/members/tree-connections/list-rows.ts"

test("avatar style: smaller square cards, no overlaps, and a far smaller chart for the same tree", () => {
  const avatar = layoutOptionsFor("avatar", { layout: "cartesian", orientation: "vertical" })
  const card = layoutOptionsFor("card", { layout: "cartesian", orientation: "vertical" })
  assert.equal(avatar.nodeWidth, avatar.nodeHeight)
  const big = bigTeam(70)
  const a = computeLayout(big, new Set(), avatar)
  const c = computeLayout(big, new Set(), card)
  assert.ok(a.bounds.maxX < c.bounds.maxX && a.bounds.maxY < c.bounds.maxY)
  const points = [...a.positions.values()]
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    assert.equal(Math.abs(points[i].x - points[j].x) < avatar.nodeWidth && Math.abs(points[i].y - points[j].y) < avatar.nodeHeight, false)
  }
  assert.equal(layoutOptionsFor("avatar", { layout: "polar", orientation: "horizontal" }).layout, "polar")
})

const none = { query: "", role: null }

test("list: rows follow the tree with depth, and a collapsed team hides its members", () => {
  const m = model()
  const rows = flattenForList(m, new Set(), none)
  assert.deepEqual(rows.map((r) => [r.id, r.depth]).slice(0, 4), [["owner", 0], ["admin", 1], ["mgrA", 2], ["empA", 3]])
  const folded = flattenForList(m, new Set(["mgrA"]), none)
  assert.equal(folded.some((r) => r.id === "empA"), false)
  assert.equal(folded.find((r) => r.id === "mgrA").open, false)
  assert.equal(folded.find((r) => r.id === "mgrA").hasTeam, true)
  assert.equal(folded.find((r) => r.id === "empA"), undefined)
})

test("list: searching keeps the matches and the managers above them, open, even inside a folded team", () => {
  const m = model()
  const rows = flattenForList(m, new Set(["mgrA", "admin"]), { query: "empb", role: null })
  assert.deepEqual(rows.map((r) => r.id), ["owner", "admin", "mgrA", "empB"])
  assert.deepEqual(rows.map((r) => r.match), [false, false, false, true])
  assert.ok(rows.every((r) => r.id === "empB" || r.open))
})

test("list: a role filter and a search combine, and nothing matching gives no rows", () => {
  const m = model()
  assert.deepEqual([...matchingIds(m, { query: "", role: "Manager" })].sort(), ["mgrA", "mgrB"])
  assert.deepEqual([...matchingIds(m, { query: "mgra", role: "Manager" })], ["mgrA"])
  assert.equal(matchingIds(m, { query: "mgra", role: "Employee" }).size, 0)
  assert.deepEqual(flattenForList(m, new Set(), { query: "zzzz", role: null }), [])
  assert.equal(matchingIds(m, none), null)
  assert.equal(isFiltering({ query: " ", role: null }), false)
  assert.equal(isFiltering({ query: "", role: "Admin" }), true)
})

test("wiring: one slim bar - refresh and the view switch left, the counts in the middle - and the chart carries the layout controls", () => {
  const page = read("features/members/pages/member-tree-page.tsx")
  assert.equal(/<h2[^>]*>\s*Members tree/.test(page), false, "the title card is gone")
  assert.equal(page.includes("TreeChartControls"), false, "the three dropdowns no longer live in the page header")
  assert.ok(page.indexOf("<TableRefreshButton") < page.indexOf("<TreeViewModeToggle"), "refresh comes before the List / Connections switch")
  assert.ok(page.indexOf("<TreeViewModeToggle") < page.indexOf("level{treeDepth === 1"), "the counts sit after the controls on the left")
  assert.match(page, /lg:grid-cols-\[1fr_auto_1fr\]/, "the counts are centred between the two sides")
  assert.match(page, /onSettingsChange=\{updateChartSettings\}/)
  assert.match(page, /<MemberTreeListView/)
  assert.match(page, /onShowInChart=\{showInChart\}/)
  const view = read("features/members/tree-connections/connections-view.tsx")
  assert.match(view, /<TreeChartControls settings=\{settings\} onChange=\{props\.onSettingsChange\}/)
  assert.match(view, /changeCardStyle\("avatar"\)/)
})

test("wiring: the list offers search, role filter, fold controls and the same guarded reassign flow", () => {
  const list = read("features/members/tree-connections/list-view.tsx")
  assert.match(list, /flattenForList\(/)
  assert.match(list, /useReassignFlow\(/)
  assert.match(list, /Show in the chart/)
  assert.match(list, /reassignAllowed && !isSelfOwner/)
})

// ---- moving a packed team's frame ----------------------------------------------------------------

import { applyOffsets, frameKey, presentOffsetKeys } from "../features/members/tree-connections/offsets.ts"

test("frame: dragging a packed team's frame moves the frame and every card in it, and nothing else", () => {
  const m = bigTeam(10)
  const layout = computeLayout(m, new Set(), O)
  const base = applyOffsets(layout.positions, layout.groups, new Map())
  const moved = applyOffsets(layout.positions, layout.groups, new Map([[frameKey("boss"), { x: 100, y: -40 }]]))
  assert.equal(moved.groups[0].x, base.groups[0].x + 100)
  assert.equal(moved.groups[0].y, base.groups[0].y - 40)
  for (const id of layout.groups[0].memberIds) {
    assert.equal(moved.positions.get(id).x, base.positions.get(id).x + 100)
    assert.equal(moved.positions.get(id).y, base.positions.get(id).y - 40)
  }
  assert.deepEqual(moved.positions.get("boss"), base.positions.get("boss"), "the manager stays")
  assert.equal(moved.movedIds.size, 0, "a frame move does not make its members 'moved out'")
})

test("frame: a card dragged on its own adds to its frame's move and keeps a line of its own", () => {
  const m = bigTeam(10)
  const layout = computeLayout(m, new Set(), O)
  const base = applyOffsets(layout.positions, layout.groups, new Map())
  const out = applyOffsets(layout.positions, layout.groups, new Map([[frameKey("boss"), { x: 50, y: 0 }], ["e3", { x: 0, y: 200 }]]))
  assert.equal(out.positions.get("e3").x, base.positions.get("e3").x + 50)
  assert.equal(out.positions.get("e3").y, base.positions.get("e3").y + 200)
  assert.deepEqual([...out.movedIds], ["e3"])
})

test("frame: offsets for managers who left are dropped, frames of present managers are kept", () => {
  const keep = presentOffsetKeys(["boss", "e1"])
  assert.ok(keep.has("boss") && keep.has(frameKey("boss")) && keep.has("e1"))
  assert.equal(keep.has(frameKey("gone")), false)
  const stored = pruneOffsets(parseOffsets(serializeOffsets(new Map([[frameKey("boss"), { x: 5, y: 5 }], [frameKey("gone"), { x: 5, y: 5 }]]))), keep)
  assert.deepEqual([...stored.keys()], [frameKey("boss")])
})

test("wiring: the frame has a drag handle that only works in Arrange mode", () => {
  const view = read("features/members/tree-connections/connections-view.tsx")
  assert.match(view, /onPointerDown=\{\(event\) => beginFrameDrag\(event, g\.parentId\)\}/)
  assert.match(view, /if \(modeRef\.current === "reassign" && canReassignRef\.current\) return/)
  assert.match(view, /Drag to move this whole team/)
})
