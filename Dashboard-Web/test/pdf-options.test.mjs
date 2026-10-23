// How report PDFs look is kept on the server per member (so it follows them across devices), with
// this browser's copy as the fast start; and which documents the settings offer depends on what the
// viewer may see. Run as the real hook and form in jsdom, with the real API client talking to a
// stand-in backend. Replaces source-text checks in pdf-core.test.mjs.
import test, { after } from "node:test"
import assert from "node:assert/strict"
import { installDom, createLoader, framerMotionStub, mount, settle, waitFor, React, signedInStubs, fakeBackend, selectStub } from "./helpers/render.mjs"

const env = installDom()
after(() => env.restore())

const loader = createLoader({
  stubs: { ...signedInStubs, "framer-motion": framerMotionStub, "@/shared/ui/select": selectStub, "@/shared/providers/app": { useTheme: () => ({ isDark: false }) } },
})
const { usePdfOptions } = loader.load("features/reports/hooks/use-pdf-options.ts")
const { PdfSettingsForm } = loader.load("features/reports/components/time-activity-report/pdf-settings-form.tsx")
const { DEFAULT_PDF_OPTIONS } = loader.load("shared/pdf-core/options.ts")

const STORAGE_KEY = "reports:pdf-options:v1"
const puts = (calls) => calls.filter((c) => c.method === "PUT" && c.path === "/api/reports/pdf-settings")

/** Mounts a component using the hook; returns the latest [options, update]. */
async function useHook() {
  const state = {}
  function Probe() {
    const [options, update] = usePdfOptions()
    state.options = options
    state.update = update
    return null
  }
  const view = await mount(React.createElement(Probe))
  return { state, view }
}

test("the member's saved look is loaded from the server and remembered in this browser", async () => {
  window.localStorage.clear()
  fakeBackend(() => ({ body: { success: true, data: { template: "stripe", language: "ar" } } }))
  const { state, view } = await useHook()
  await waitFor(() => state.options.template === "stripe")
  assert.equal(state.options.language, "ar")
  assert.equal(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).template, "stripe")
  await view.unmount()
})

test("a change is saved to the server shortly after, with only how documents look", async () => {
  window.localStorage.clear()
  const calls = fakeBackend(() => ({ body: { success: true, data: null } }))
  const { state, view } = await useHook()
  await waitFor(() => calls.length >= 1)
  await settle(() => state.update({ ...state.options, template: "classic", document: "payslip", memberId: "someone", projectNames: ["Secret"] }))
  await waitFor(() => puts(calls).length === 1, 3000)
  const saved = puts(calls)[0].body
  assert.equal(saved.template, "classic")
  for (const key of ["document", "memberId", "projectNames", "currency", "includeAmounts"]) assert.equal(key in saved, false, key)
  await view.unmount()
})

test("a look kept only in this browser is uploaded once, when the server has none yet", async () => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ template: "stripe" }))
  const calls = fakeBackend(() => ({ body: { success: true, data: null } }))
  const { state, view } = await useHook()
  await waitFor(() => puts(calls).length === 1)
  assert.equal(puts(calls)[0].body.template, "stripe")
  assert.equal(state.options.template, "stripe")
  await view.unmount()
})

test("an edit made while the server's copy is loading is not overwritten by it", async () => {
  window.localStorage.clear()
  let release
  let served = false
  const gate = new Promise((r) => (release = r))
  fakeBackend(async (call) => {
    if (call.method === "GET") {
      await gate
      served = true
    }
    return { body: { success: true, data: call.method === "GET" ? { template: "stripe" } : null } }
  })
  const { state, view } = await useHook()
  await settle(() => state.update({ ...state.options, template: "classic" }))
  release()
  await waitFor(() => served)
  await settle(() => new Promise((r) => setTimeout(r, 150)))
  assert.equal(state.options.template, "classic")
  await view.unmount()
})

test("the documents on offer follow what the viewer may see", async () => {
  const offered = async (props) => {
    const view = await mount(
      React.createElement(PdfSettingsForm, {
        value: DEFAULT_PDF_OPTIONS, onChange: () => {}, resolvedCurrency: "USD", projectOptions: [], memberOptions: [{ id: "m1", name: "Ann" }],
        projectsWithoutRate: () => [], ...props,
      }),
    )
    const select = [...view.container.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "report"))
    const values = [...select.options].map((o) => o.value)
    await view.unmount()
    return values
  }
  assert.deepEqual(await offered({ moneyHidden: false, billingAvailable: true }), ["report", "client", "payslip"])
  assert.deepEqual(await offered({ moneyHidden: false, billingAvailable: false }), ["report", "payslip"], "no client statement without the right to see what clients are charged")
  assert.deepEqual(await offered({ moneyHidden: true, billingAvailable: true }), ["report"], "a viewer who may not see money gets the team report only")
})
