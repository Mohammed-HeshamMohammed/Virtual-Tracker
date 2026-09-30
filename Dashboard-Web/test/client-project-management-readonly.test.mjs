// A Clients login gets the Project Management pages except Clients, and every
// one of them opens read-only.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replaceAll("\r\n", "\n")

test("the client allowlist includes Project Management minus Clients", () => {
  const src = read("features/auth/permissions/member-role-access.ts")
  assert.match(src, /CLIENT_SECTION_IDS = new Set\(\[[^\]]*"project-management"/)
  const line = src.match(/"project-management": new Set\(\[([^\]]*)\]\)/)
  assert.ok(line, "project-management page allowlist present")
  const ids = [...line[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()
  assert.deepEqual(ids, ["calendar-timeoff", "pm-overview", "pm-projects", "pm-tasks"])
  assert.ok(!ids.includes("pm-clients"))
})

test("the tasks page is read-only for a read-only role and reaches every view", () => {
  const page = read("features/tasks/pages/tasks-page.tsx")
  assert.match(page, /const roleReadOnly = isReadOnlyRole\(/)
  // ...unless the project's owner switched client_can_manage on for it.
  assert.match(page, /roleReadOnly &&\s+!\(normalizedRole === "client" && Boolean\(rawProjectList\.find\(.*?\)\?\.clientCanManage\)\)/)
  assert.match(page, /!readOnly &&\s+canCreateTasksInProject/)
  assert.match(page, /function handleDragEnd\(event: any\) \{\s+if \(readOnly\) return/)
  assert.equal((page.match(/readOnly=\{readOnly\}/g) ?? []).length, 3)
})

test("list, board and toolbar drop their write controls when read-only", () => {
  const list = read("features/tasks/components/list-view.tsx")
  const board = read("features/tasks/components/board-view.tsx")
  const bar = read("features/tasks/components/tasks-toolbar.tsx")
  for (const src of [list, board]) {
    assert.match(src, /disabled: readOnly/)
    assert.match(src, /\{readOnly \? null : \(/)
  }
  assert.match(bar, /\{readOnly \? null : \(/)
  assert.match(bar, /canAddTask && !readOnly/)
})

test("time off gives a read-only role no request form and no cancel", () => {
  const src = read("features/time-off/pages/time-off-page.tsx")
  assert.match(src, /const readOnly = isReadOnlyRole\(/)
  assert.match(src, /showForm && !readOnly/)
  assert.match(src, /isOwn && !readOnly/)
})
