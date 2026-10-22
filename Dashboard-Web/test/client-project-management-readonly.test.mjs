// A Clients login gets the Project Management pages except Clients, and every
// one of them opens read-only. The first test runs the real role rules; the
// rest render the pages and components in jsdom and check what is offered.
import test, { after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { installDom, createLoader, framerMotionStub, mount, settle, waitFor, React, signedInStubs, fakeBackend } from "./helpers/render.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replaceAll("\r\n", "\n")

const nodeRequire = createRequire(import.meta.url)
function loadTs(rel, requireModule = nodeRequire) {
  const module = { exports: {} }
  const code = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { module, exports: module.exports, require: requireModule })
  return module.exports
}
const nav = loadTs("shared/ui/layout/config/nav-sections.ts")
const access = loadTs("features/auth/permissions/member-role-access.ts", (name) => {
  assert.equal(name, "@/shared/ui/layout")
  return nav
})

test("Client navigation, route guard and task visibility agree without granting writes", () => {
  for (const role of ["Client", " client "]) {
    assert.equal(access.canSeePmTasksSection(role), true)
    assert.equal(access.isReadOnlyRole(role), true)
    assert.equal(access.canManageProjects(role), false)
    assert.equal(access.canCreateTasks(role), false)
    const pm = access.visibleNavSections(role).find((s) => s.id === "project-management")
    assert.ok(pm)
    assert.deepEqual(Array.from(pm.pages, (p) => p.id).sort(), ["calendar-timeoff", "pm-overview", "pm-projects", "pm-tasks"])
    for (const page of pm.pages) assert.equal(access.isPageAllowedForRole(page.id, role), true)
    for (const page of ["pm-clients", "pm-new", "people-members"]) {
      assert.equal(access.isPageAllowedForRole(page, role), false)
    }
  }
  assert.equal(access.canSeePmTasksSection("Viewer"), false)
})

// ── rendered: what a read-only role is offered ─────────────────────────────

const env = installDom()
after(() => env.restore())

let auth = { memberId: "client-1", memberRole: "Client" }
const providers = { useAuth: () => auth, useTheme: () => ({ isDark: false }) }
const views = []
const calendarProps = []
const recordView = (name) => (props) => {
  views.push({ name, readOnly: props.readOnly, canAddTask: props.canAddTask })
  if (name === "TasksTimelineCalendar") calendarProps.push(props)
  if (name === "TasksToolbar") toolbar = props
  return null
}
let toolbar = null
const projects = [
  { id: "p-view", name: "Website", status: "active", type: "normal", clientCanManage: false, restrictTaskCreation: true },
  { id: "p-manage", name: "Shop", status: "active", type: "normal", clientCanManage: true, restrictTaskCreation: false },
]
const pageLoader = createLoader({
  stubs: {
    ...signedInStubs,
    "framer-motion": framerMotionStub,
    "@/shared/providers/app": providers,
    "@/features/tasks/api/api-helpers": { fetchProjectsList: async () => projects, fetchTasksList: async () => [] },
    "@/features/tasks/components/list-view": { ListView: recordView("ListView") },
    "@/features/tasks/components/board-view": { BoardView: recordView("BoardView") },
    "@/features/tasks/components/tasks-timeline-calendar": { TasksTimelineCalendar: recordView("TasksTimelineCalendar") },
    "@/features/tasks/components/tasks-toolbar": { TasksToolbar: recordView("TasksToolbar") },
  },
})
fakeBackend(() => ({ body: { success: true, data: [] } }))
const { TasksPage } = pageLoader.load("features/tasks/pages/tasks-page.tsx")

const latest = (name) => views.filter((v) => v.name === name).at(-1)

test("the tasks page is read-only for a Client in every view that can change a task, unless the project lets the client manage it", async () => {
  const view = await mount(React.createElement(TasksPage))
  try {
    await waitFor(() => latest("TasksToolbar") && toolbar.selectedProjectId === "p-view" && latest("ListView"))
    assert.equal(latest("ListView").readOnly, true)
    assert.equal(latest("TasksToolbar").readOnly, true)
    assert.equal(latest("TasksToolbar").canAddTask, false)
    await settle(() => toolbar.setView("board"))
    await waitFor(() => latest("BoardView"))
    assert.equal(latest("BoardView").readOnly, true)
    // The calendar only shows tasks: it is handed nothing that could change one.
    await settle(() => toolbar.setView("timeline"))
    await waitFor(() => latest("TasksTimelineCalendar"))
    const calendar = calendarProps.at(-1)
    for (const key of ["onUpdate", "onEdit", "onDelete", "onAddTask", "onDuplicate"]) assert.equal(calendar[key], undefined, key)
    await settle(() => toolbar.setView("list"))
    await settle(() => toolbar.setSelectedProjectId("p-manage"))
    await waitFor(() => latest("ListView")?.readOnly === false)
    assert.equal(latest("TasksToolbar").readOnly, false, "client_can_manage hands the client task editing")
  } finally {
    await view.unmount()
  }
})

const tvLoader = createLoader({ stubs: { ...signedInStubs, "framer-motion": framerMotionStub, "@/shared/providers/app": providers } })
const { ListView } = tvLoader.load("features/tasks/components/list-view.tsx")
const { BoardView } = tvLoader.load("features/tasks/components/board-view.tsx")
const { TasksToolbar } = tvLoader.load("features/tasks/components/tasks-toolbar.tsx")
const { TimeOffRequestsPage } = tvLoader.load("features/time-off/pages/time-off-page.tsx")

const task = { id: "t-1", title: "Fix the header", status: "todo", completed: false, priority: "medium", assignedTo: [], assignees: [], projectId: "p-view", dueDate: null, startDate: null, description: "" }
const viewProps = (readOnly) => ({
  tasks: [task], members: [], teamNamesById: {}, selectedTaskId: null, onSelectTask: () => {}, onTaskPreview: () => {},
  selectedTaskIds: new Set(), onToggleTaskSelected: () => {}, onDelete: () => {}, onUpdate: () => {}, onEdit: () => {},
  onDuplicate: () => {}, showCompleted: true, search: "", isDark: false, onAddTask: () => {}, readOnly,
})
const writeControls = (root) => ({
  drag: root.querySelectorAll('[aria-label="Drag task"]').length,
  checkboxes: root.querySelectorAll('input[type="checkbox"], [role="checkbox"]').length,
  menus: root.querySelectorAll('[aria-haspopup="menu"]').length,
})

test("the list and the board drop dragging, selection and the row menu when read-only", async () => {
  for (const View of [ListView, BoardView]) {
    const editable = await mount(React.createElement(View, viewProps(false)))
    const live = writeControls(editable.container)
    assert.ok(live.drag > 0 && live.checkboxes > 0 && live.menus > 0, `${View.name} has write controls when editable: ${JSON.stringify(live)}`)
    await editable.unmount()
    const readonly = await mount(React.createElement(View, viewProps(true)))
    assert.deepEqual(writeControls(readonly.container), { drag: 0, checkboxes: 0, menus: 0 }, View.name)
    assert.ok(readonly.container.textContent.includes("Fix the header"), "the task itself still shows")
    await readonly.unmount()
  }
})

test("the toolbar drops edit, duplicate and add when read-only", async () => {
  const props = (readOnly) => ({
    projectList: projects, selectedProjectId: "p-view", setSelectedProjectId: () => {}, search: "", setSearch: () => {},
    view: "list", setView: () => {}, showCompleted: false, setShowCompleted: () => {}, selectedTask: task, projectTeams: [],
    memberLookups: [], projectMembers: [], isDark: false,
    t: { searchWrap: "", searchIcon: "", searchInput: "", tabActive: "", tabInactive: "", btnSecondary: "", btnPrimary: "" },
    updateTask: () => {}, openEditTaskModal: () => {}, duplicateSelectedTask: () => {}, canAddTask: true, addTask: () => {},
    syncPulse: false, handleSync: () => {}, readOnly,
  })
  const labels = async (readOnly) => {
    const view = await mount(React.createElement(TasksToolbar, props(readOnly)))
    const found = ["Edit task", "Duplicate task"].filter((l) => view.container.querySelector(`[aria-label="${l}"]`))
    if ([...view.container.querySelectorAll("button")].some((b) => b.textContent.includes("Add task"))) found.push("Add task")
    await view.unmount()
    return found
  }
  assert.deepEqual(await labels(false), ["Edit task", "Duplicate task", "Add task"])
  assert.deepEqual(await labels(true), [])
})

test("time off gives a read-only role no request form and no cancel, and still shows their requests", async () => {
  fakeBackend((call) => {
    if (call.path === "/api/time-off/policies") return { body: { success: true, data: [{ id: "pol-1", name: "Vacation", description: "", days_per_year: 20, paid: true, requires_approval: true, active: true }] } }
    if (call.path === "/api/time-off/requests") {
      return { body: { success: true, data: [{ id: "r-1", member_id: auth.memberId, member_name: "Me", policy_id: "pol-1", policy_name: "Vacation", start_date: "2026-11-02", end_date: "2026-11-03", days: 2, note: "", status: "pending", review_note: "" }] } }
    }
    return { body: { success: true, data: [] } }
  })
  const offered = async (role) => {
    auth = { memberId: "m-1", memberRole: role }
    const view = await mount(React.createElement(TimeOffRequestsPage))
    await waitFor(() => view.container.textContent.includes("Vacation"))
    const buttons = [...view.container.querySelectorAll("button")].map((b) => b.textContent.trim())
    const out = { request: buttons.some((b) => b.includes("Request time off")), cancel: buttons.includes("Cancel") }
    await view.unmount()
    return out
  }
  assert.deepEqual(await offered("Employee"), { request: true, cancel: true })
  assert.deepEqual(await offered("Client"), { request: false, cancel: false })
  assert.deepEqual(await offered("Viewer"), { request: false, cancel: false })
})
