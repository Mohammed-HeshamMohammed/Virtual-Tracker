// The dashboard must never start, pause or stop the agent's timer - see
// PLAN-timer-stop-resilience.md. Every way it used to do that came from a few
// specific pieces of code: the top-bar button switching the timer runtime on,
// a guard that paused on every page load, and sign-out posting "stop". These
// tests read the source and fail if any of it comes back.
//
// Source-level on purpose. This app has no component-test setup, and these are
// structural rules ("nothing calls X", "this file does not exist") that a
// render test would only check indirectly.
import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8")
}

/** Comments removed, so an explanation that names a function is not a call. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function sourceFiles(dir) {
  const out = []
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const rel = join(dir, name)
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel))
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel)
  }
  return out
}

const TIMER_CONTROL = [
  "postActivitySession",
  "requestActivityRuntime",
  "useActivityTracking",
  "setIdle",
  "stopTracking",
]

test("the top-bar Start button only navigates to Tools", () => {
  const src = code(read("shared/ui/layout/components/topbar/timer-button.tsx"))
  assert.match(src, /onNavigate\("activity-tools"\)/)
  for (const forbidden of [
    ...TIMER_CONTROL,
    "useActivityRuntime",
    "useAgentStatus",
    "fetchActivitySession",
    "NotifyToastHost",
    "setInterval",
  ]) {
    assert.ok(!src.includes(forbidden), `timer-button.tsx must not use ${forbidden}`)
  }
})

// requestActivityRuntime switches on the dashboard's timer runtime, which is
// what used to pause the agent's timer. It must have no callers.
test("nothing switches the dashboard's timer runtime on", () => {
  const callers = [...sourceFiles("features"), ...sourceFiles("shared"), ...sourceFiles("app")]
    .filter((file) => !file.replace(/\\/g, "/").endsWith("activity-runtime-context.tsx"))
    .filter((file) => code(read(file)).includes("requestActivityRuntime("))
  assert.deepEqual(callers, [])
})

test("the pause-on-every-page-load guard is gone", () => {
  assert.ok(!existsSync(join(ROOT, "features/activity/components/activity-session-guard.tsx")))
  const runtime = code(read("features/activity/components/activity-runtime-context.tsx"))
  assert.ok(!runtime.includes("ActivitySessionGuard"))
})

test("signing out of the dashboard never stops the timer", () => {
  const auth = code(read("shared/providers/auth/auth-context.tsx"))
  const start = auth.indexOf("const logout = () =>")
  const end = auth.indexOf("const clearVerificationGate", start)
  assert.ok(start >= 0 && end > start, "could not find logout() to check")
  assert.ok(!auth.slice(start, end).includes("postActivitySession("), "logout() must not post a session action")
})

// The reported "Refresh stopped my timer". These pages reload lists and must
// never reach the timer, directly or through the tracking context.
test("refreshing Screenshots, Tasks or Projects cannot touch the timer", () => {
  for (const page of [
    "features/activity/components/screenshots.tsx",
    "features/tasks/pages/tasks-page.tsx",
    "features/projects/pages/projects-page.tsx",
  ]) {
    const src = code(read(page))
    for (const forbidden of TIMER_CONTROL) {
      assert.ok(!src.includes(forbidden), `${page} must not use ${forbidden}`)
    }
  }
})
