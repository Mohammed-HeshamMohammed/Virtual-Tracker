// Runs the app's own TypeScript and React components in tests, so a test can render a component
// (in jsdom) or call a function and check what it does - instead of matching its source text.
//
// loadModule("shared/ui/help/help-layer.tsx", { stubs }) transpiles the file with the project's
// TypeScript (JSX included), resolves its "@/..." and relative imports to the real files, and
// loads them the same way. `stubs` replaces chosen imports: keys are either the specifier exactly
// as written ("@/shared/providers/app", "next/navigation") or a project path without extension
// ("shared/ui/layout/components/topbar/notifications-bell"). npm packages load as themselves.
import { readFileSync, existsSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { JSDOM } from "jsdom"

export const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const nodeRequire = createRequire(join(ROOT, "package.json"))
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"]

function resolveFile(base) {
  for (const ext of EXTENSIONS) {
    const candidate = base + ext
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

const projectKey = (abs) => relative(ROOT, abs).replaceAll("\\", "/").replace(/\.(tsx?|m?js)$/, "").replace(/\/index$/, "")

/** A loader with its own module cache, so each test file can choose its own stubs. */
export function createLoader({ stubs = {} } = {}) {
  const cache = new Map()

  function requireFrom(fromDir, spec) {
    if (Object.hasOwn(stubs, spec)) return stubs[spec]
    if (/\.(css|scss|svg|png)$/.test(spec)) return {}
    let abs = null
    if (spec.startsWith("@/")) abs = resolveFile(join(ROOT, spec.slice(2)))
    else if (spec.startsWith(".")) abs = resolveFile(resolve(fromDir, spec))
    if (abs) {
      const key = projectKey(abs)
      if (Object.hasOwn(stubs, key)) return stubs[key]
      return loadFile(abs)
    }
    return nodeRequire(spec)
  }

  function loadFile(abs) {
    if (cache.has(abs)) return cache.get(abs).exports
    const source = readFileSync(abs, "utf8")
    const { outputText } = ts.transpileModule(source, {
      fileName: abs,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    })
    const module = { exports: {} }
    cache.set(abs, module)
    const run = new Function("module", "exports", "require", "__filename", "__dirname", outputText)
    run(module, module.exports, (spec) => requireFrom(dirname(abs), spec), abs, dirname(abs))
    return module.exports
  }

  return {
    load(rel) {
      const abs = resolveFile(join(ROOT, rel))
      if (!abs) throw new Error(`no such module: ${rel}`)
      return loadFile(abs)
    },
  }
}

export const loadModule = (rel, options) => createLoader(options).load(rel)

/** A component that renders nothing, standing in for a widget the test is not about. */
export const Nothing = () => null

/**
 * framer-motion without the animation: motion.div renders a div with the same non-animation
 * props, AnimatePresence just renders its children. jsdom has no layout to animate.
 */
const ANIMATION_PROPS = new Set([
  "initial", "animate", "exit", "transition", "variants", "layout", "layoutId", "layoutScroll",
  "whileHover", "whileTap", "whileFocus", "whileInView", "whileDrag", "drag", "dragConstraints",
  "dragElastic", "dragMomentum", "onAnimationStart", "onAnimationComplete", "viewport",
])
const motionTags = new Map()
const motionTag = (tag) => {
  if (!motionTags.has(tag)) {
    const Component = React.forwardRef((props, ref) => {
      const rest = Object.fromEntries(Object.entries(props).filter(([k]) => !ANIMATION_PROPS.has(k)))
      return React.createElement(tag, { ...rest, ref })
    })
    Component.displayName = `motion.${String(tag)}`
    motionTags.set(tag, Component)
  }
  return motionTags.get(tag)
}
export const framerMotionStub = {
  motion: new Proxy({}, { get: (_, tag) => motionTag(tag) }),
  AnimatePresence: ({ children }) => React.createElement(React.Fragment, null, children),
  LayoutGroup: ({ children }) => React.createElement(React.Fragment, null, children),
  useReducedMotion: () => true,
  useAnimation: () => ({ start: async () => {}, stop: () => {} }),
}

/**
 * A browser document for the test: window, document and friends on globalThis, with React's act()
 * environment on. Returns the JSDOM and a restore() that puts the previous globals back.
 */
export function installDom(html = "<!doctype html><html><body><div id='root'></div></body></html>") {
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: "http://localhost/" })
  const names = [
    "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "Event",
    "KeyboardEvent", "MouseEvent", "FocusEvent", "CustomEvent", "MutationObserver", "getComputedStyle",
    "requestAnimationFrame", "cancelAnimationFrame", "DOMRect", "localStorage", "sessionStorage",
  ]
  const previous = new Map(names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]))
  for (const name of names) {
    const value = name === "window" ? dom.window : dom.window[name]
    if (value === undefined) continue
    Object.defineProperty(globalThis, name, { value: typeof value === "function" && /^[a-z]/.test(name) ? value.bind(dom.window) : value, configurable: true, writable: true })
  }
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return {
    dom,
    restore() {
      dom.window.close()
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else delete globalThis[name]
      }
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct
    },
  }
}

/** Renders an element into a fresh container in the current document. */
export async function mount(element) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  return {
    container,
    rerender: (next) => act(async () => root.render(next)),
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

/** Runs something that changes state (a click, a key, a store update) and lets React settle. */
export const settle = (fn) => act(async () => {
  await fn?.()
})

/** Clicks an element the way a user would: a bubbling click event. */
export const click = (el) => settle(() => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })))

/** Presses a key on the document. */
export const press = (key, target = document) =>
  settle(() => target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })))

export { React, act }
