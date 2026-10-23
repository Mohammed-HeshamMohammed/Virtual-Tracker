// Task Approvals: the employee and project filters take several picks each and narrow the rows on
// the page (the server takes only one of each, so neither is sent). Rendered in jsdom with the real
// API client talking to a stand-in backend. Replaces a source-text check in
// time-activity-pdf-documents.test.mjs.
import test, { after } from "node:test"
import assert from "node:assert/strict"
import { installDom, createLoader, framerMotionStub, mount, click, waitFor, React, signedInStubs, fakeBackend, selectStub } from "./helpers/render.mjs"

const env = installDom()
after(() => env.restore())

const loader = createLoader({
  stubs: {
    ...signedInStubs,
    "framer-motion": framerMotionStub,
    "@/shared/ui/select": selectStub,
    "@/shared/providers/app": { useAuth: () => ({ memberRole: "Owner", memberId: "boss" }), useTheme: () => ({ isDark: false }) },
  },
})
const { ReviewQueueTable } = loader.load("features/timesheets/components/view-edit/components/ReviewQueueTable.tsx")

const row = (assignmentId, userId, employeeName, projectId, projectName) => ({
  assignmentId, taskId: `t-${assignmentId}`, userId, employeeName, projectId, projectName, taskTitle: `Task ${assignmentId}`,
  priority: "normal", assignmentStatus: "in_review", taskStatus: "in_review", expectedSeconds: null, loggedSeconds: 600,
  progressPercent: null, enteredReviewAt: null, lastActivityAt: null, startedAt: null, reviewNotes: "", isPriorityMonitor: false, needsReview: true,
})
const rows = [
  row("a1", "ann", "Ann Lee", "p-web", "Website"),
  row("b1", "bob", "Bob Ray", "p-shop", "Shop"),
  row("c1", "cy", "Cy Fox", "p-web", "Website"),
  row("d1", "dee", "Dee Kim", null, ""),
]
const calls = fakeBackend((call) => {
  if (call.path === "/api/task-assignments/review-queue") return { body: { success: true, data: { needsReview: rows, priorityMonitor: [] } } }
  return { body: { success: true, data: [] } }
})

const memberOptions = [{ id: "ann", name: "Ann Lee" }, { id: "bob", name: "Bob Ray" }, { id: "cy", name: "Cy Fox" }, { id: "dee", name: "Dee Kim" }]
const projectOptions = [{ id: "p-web", name: "Website" }, { id: "p-shop", name: "Shop" }]

test("several employees and projects can be picked, the rows are narrowed here, and neither is sent", async () => {
  const view = await mount(React.createElement(ReviewQueueTable, { memberOptions, projectOptions, variant: "needs-review", canReviewAssignments: true }))
  const shown = () => ["Task a1", "Task b1", "Task c1", "Task d1"].filter((t) => view.container.textContent.includes(t))
  await waitFor(() => shown().length === 4)
  const pick = async (empty, names) => {
    const trigger = [...view.container.querySelectorAll('button[aria-haspopup="listbox"]')].find((b) => b.textContent.includes(empty))
    await click(trigger)
    for (const name of names) {
      await click([...view.container.querySelectorAll("button")].find((b) => !b.hasAttribute("aria-haspopup") && b.textContent.trim().endsWith(name)))
    }
    await click(trigger)
  }
  await pick("All projects", ["Website", "Shop"])
  assert.deepEqual(shown(), ["Task a1", "Task b1", "Task c1"], "a row with no project is left out once projects are picked")
  await pick("All employees", ["Ann Lee", "Bob Ray"])
  assert.deepEqual(shown(), ["Task a1", "Task b1"])
  for (const c of calls.filter((x) => x.path === "/api/task-assignments/review-queue")) {
    assert.equal("memberId" in c.query || "projectId" in c.query, false, "filters stay on the page")
  }
  await view.unmount()
})
