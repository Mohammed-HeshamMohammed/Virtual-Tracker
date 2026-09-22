// buildMemberTreeBranches drives BOTH the list and the chart view of the
// members tree (PLAN-bug-fixes-round-1.md item 17). Behavioural, not
// source-level: the function is pure, and Node strips its TypeScript
// natively. Its one runtime import sits behind the "@/" path alias, which
// is mocked here.
import test from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

// Resolve the one aliased runtime import to a stub. registerHooks (not
// mock.module) so this runs under the project's plain `node --test` script,
// with no experimental flag.
const AUTH_STUB =
  "data:text/javascript," +
  encodeURIComponent("export const isOwnerRoleName = (r) => String(r || '').trim().toLowerCase() === 'owner'")
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/features/auth") return { url: AUTH_STUB, shortCircuit: true }
    return next(specifier, context)
  },
})

const { buildMemberTreeBranches, countTreeMembers } = await import("../features/members/utils/build-tree.ts")

const node = (id, role = "Employee", extra = {}) => ({ id, name: id, email: "", role, hierarchy_status: "", ...extra })
const edge = (parent, child) => ({ id: `${parent}>${child}`, parent_member_id: parent, child_member_id: child, relationship_type: "" })

function idsOf(branches) {
  const out = []
  const walk = (items) => {
    for (const b of items) {
      out.push(b.node.id)
      walk(b.children)
    }
  }
  walk(branches)
  return out
}

test("a member with two parent edges is drawn once, not under both parents", () => {
  const nodes = [node("owner", "Owner"), node("m1", "Manager"), node("m2", "Manager"), node("e1")]
  const edges = [edge("owner", "m1"), edge("owner", "m2"), edge("m1", "e1"), edge("m2", "e1")]

  const ids = idsOf(buildMemberTreeBranches(nodes, edges, null, null))

  assert.equal(ids.filter((id) => id === "e1").length, 1, "e1 used to appear under m1 AND m2")
})

test("the last edge wins, matching the backend's own one-parent rule", () => {
  const nodes = [node("owner", "Owner"), node("m1", "Manager"), node("m2", "Manager"), node("e1")]
  const edges = [edge("owner", "m1"), edge("owner", "m2"), edge("m1", "e1"), edge("m2", "e1")]

  const [root] = buildMemberTreeBranches(nodes, edges, null, null)
  const m2 = root.children.find((c) => c.node.id === "m2")
  assert.deepEqual(m2.children.map((c) => c.node.id), ["e1"])
})

test("reports of an orphaned member are still drawn, not silently dropped", () => {
  const nodes = [
    node("owner", "Owner"),
    node("lost", "Manager", { hierarchy_status: "hierarchy_assignment_required" }),
    node("r1"),
    node("r2"),
  ]
  const edges = [edge("lost", "r1"), edge("r1", "r2")]

  // Organization scope: only the valid roots are passed in.
  const branches = buildMemberTreeBranches(nodes, edges, null, ["owner"])
  const ids = idsOf(branches)

  assert.ok(ids.includes("r1"), "r1 used to vanish from both views")
  assert.ok(ids.includes("r2"), "and its own reports with it")
  assert.ok(!ids.includes("lost"), "the orphan itself is still listed separately, not in the tree")
  // r2 stays under r1 - the subtree keeps its shape.
  const r1 = branches.find((b) => b.node.id === "r1")
  assert.deepEqual(r1.children.map((c) => c.node.id), ["r2"])
})

test("an explicit root asks for that branch only - nothing else is appended", () => {
  const nodes = [node("owner", "Owner"), node("m1", "Manager"), node("elsewhere")]
  const edges = [edge("owner", "m1")]

  const branches = buildMemberTreeBranches(nodes, edges, "m1", null)
  assert.deepEqual(idsOf(branches), ["m1"])
})

test("a pure cycle still renders every member exactly once and terminates", () => {
  const nodes = [node("a"), node("b"), node("c")]
  const edges = [edge("a", "b"), edge("b", "c"), edge("c", "a")]

  const ids = idsOf(buildMemberTreeBranches(nodes, edges, null, null))
  assert.deepEqual([...ids].sort(), ["a", "b", "c"])
})

test("a normal tree is unchanged", () => {
  const nodes = [node("owner", "Owner"), node("m1", "Manager"), node("e1"), node("e2")]
  const edges = [edge("owner", "m1"), edge("m1", "e1"), edge("m1", "e2")]

  const branches = buildMemberTreeBranches(nodes, edges, null, ["owner"])
  assert.equal(branches.length, 1)
  assert.equal(countTreeMembers(branches), 4)
})
