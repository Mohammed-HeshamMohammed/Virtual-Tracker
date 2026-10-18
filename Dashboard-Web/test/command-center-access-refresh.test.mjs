import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { JSDOM } from "jsdom"
import ts from "typescript"

test("Command Center discards cached data and reloads when project access changes", async () => {
  const dom = new JSDOM("<div id='root'></div>")
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const calls = []
  let invalidations = 0
  const module = { exports: {} }
  const src = readFileSync(new URL("../features/dashboard/hooks/use-command-center-data.ts", import.meta.url), "utf8")
  const code = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, {
    module, exports: module.exports, window: dom.window, AbortController,
    require: (name) => {
      if (name === "react") return React
      if (name.endsWith("/command-center-api")) return {
        invalidateCommandCenterCache: () => { invalidations++ },
        fetchCommandCenterData: async (options) => {
          calls.push(options)
          return { projects: [], globalActivityFeed: [], canSeeAllProjects: false, isPersonalView: false, roleName: "Client" }
        },
      }
      if (name.endsWith("/command-center-mapper")) return { mapCommandCenterPayload: (raw) => raw }
      if (name.endsWith("/change-events")) return { changedEvent: (resource) => `vt-changed:${resource}`, SCOPE_CHANGED_EVENT: "vt-scope-changed" }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  })
  function Harness() {
    module.exports.useCommandCenterData()
    return null
  }
  const root = createRoot(dom.window.document.getElementById("root"))
  try {
    await act(async () => root.render(React.createElement(Harness)))
    assert.equal(calls.length, 1)
    for (const event of ["vt-scope-changed", "vt-changed:projects", "vt-changed:clients"]) {
      await act(async () => dom.window.dispatchEvent(new dom.window.Event(event)))
      assert.equal(calls.at(-1).force, true)
    }
    assert.equal(calls.length, 4)
    assert.equal(invalidations, 3)
    await act(async () => root.unmount())
    dom.window.dispatchEvent(new dom.window.Event("vt-scope-changed"))
    assert.equal(calls.length, 4, "the event listeners are removed on unmount")
  } finally {
    dom.window.close()
    globalThis.window = previous.window
    globalThis.document = previous.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act
  }
})
