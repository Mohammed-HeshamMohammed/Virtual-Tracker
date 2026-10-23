// The Buzz row action is the Owner's and Super Admins' alone (they may buzz themselves, to see what
// the other person sees), and the modal says what it does. The server enforces the same rules;
// this only keeps the button from being offered. Rendered in jsdom, with the app's real API client
// talking to a stand-in backend.
import test, { after } from "node:test"
import assert from "node:assert/strict"
import { installDom, createLoader, framerMotionStub, mount, click, settle, type, waitFor, React, Nothing, signedInStubs, fakeBackend } from "./helpers/render.mjs"

const env = installDom()
after(() => env.restore())

let auth = { memberId: "owner-1", memberRole: "Owner", user: { uid: "uid-owner", email: "owner@example.test" } }
const Pass = ({ children }) => React.createElement(React.Fragment, null, children)
const loader = createLoader({
  stubs: {
    ...signedInStubs,
    "framer-motion": framerMotionStub,
    "@/shared/providers/app": { useAuth: () => auth, useTheme: () => ({ isDark: false }) },
    // The menu as plain buttons: what it offers is the point here, not the dropdown's own behaviour.
    "@/shared/ui/dropdown-menu": {
      DropdownMenu: Pass,
      DropdownMenuTrigger: Pass,
      DropdownMenuContent: ({ children }) => React.createElement("div", { role: "menu" }, children),
      DropdownMenuItem: ({ children, onClick }) => React.createElement("button", { role: "menuitem", onClick }, children),
    },
    "@/features/members/components/modals/member-manage": { MemberManageModal: Nothing },
    "@/features/members/components/modals/member-entry-modal": { MemberEntryModal: Nothing, isFocusedMemberEntryAction: () => false },
  },
})
const { MemberRowMenu } = loader.load("features/members/components/menus/member-row-menu.tsx")

const ann = { id: "ann-1", name: "Ann Lee", email: "ann@example.test" }
const self = { id: "owner-1", name: "Olive Owner", email: "owner@example.test" }
const menu = (member) =>
  mount(React.createElement(MemberRowMenu, { member, onPatchMember: async () => undefined, onRemoveMember: () => {} }))
const items = (view) => [...view.container.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim())
const byText = (root, text) => [...(root.container ?? root).querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text))

test("the Owner and Super Admins are offered Buzz, for others and for themselves; nobody else is", async () => {
  for (const [role, offered] of [["Owner", true], ["Super Admin", true], ["Admin", false], ["Manager", false], ["Employee", false]]) {
    auth = { ...auth, memberRole: role }
    for (const member of [ann, self]) {
      const view = await menu(member)
      assert.equal(items(view).includes("Buzz"), offered, `${role} / ${member.name}`)
      await view.unmount()
    }
  }
  auth = { ...auth, memberRole: "Owner" }
})

test("Buzz opens the modal for that member, or for yourself", async () => {
  for (const [member, title] of [[ann, "Buzz Ann Lee"], [self, "Buzz yourself"]]) {
    const view = await menu(member)
    await click(byText(view, "Buzz"))
    const dialog = view.container.querySelector('[role="dialog"]')
    assert.equal(dialog.getAttribute("aria-label"), title)
    await view.unmount()
  }
})

test("the modal offers a nudge and a blue screen, starts from the default message, and says it closes in one click", async () => {
  const view = await menu(ann)
  await click(byText(view, "Buzz"))
  const dialog = view.container.querySelector('[role="dialog"]')
  const styles = [...dialog.querySelectorAll('[role="radiogroup"][aria-label="Buzz style"] button')].map((b) => b.querySelector("span").textContent)
  assert.deepEqual(styles, ["Nudge", "Blue screen"])
  assert.equal(dialog.querySelector("input, textarea").value, "Dude. Focus on work.")
  assert.match(dialog.textContent, /close it with one click/)
  await view.unmount()
})

test("sending posts the member, the chosen style and corner, and the message to the buzz endpoint", async () => {
  const calls = fakeBackend(() => ({ body: { success: true, data: { delivered: true } } }))
  const view = await menu(ann)
  await click(byText(view, "Buzz"))
  const dialog = view.container.querySelector('[role="dialog"]')
  await click(byText(dialog, "Bottom left"))
  await type(dialog.querySelector("#buzz-message"), "  Back to the report, please.  ")
  await click([...dialog.querySelectorAll("button")].at(-1))
  await waitFor(() => calls.length === 1 && /close|done/i.test(dialog.textContent))
  // And a blue screen, from a fresh modal, with the default message.
  await click(byText(dialog, "Done") ?? byText(dialog, "Close") ?? dialog.querySelector('[aria-label="Close"]'))
  await click(byText(view, "Buzz"))
  const again = view.container.querySelector('[role="dialog"]')
  await click(byText(again, "Blue screen"))
  await click([...again.querySelectorAll("button")].at(-1))
  await waitFor(() => calls.length === 2)
  assert.deepEqual(calls.map((c) => [c.method, c.path, c.body]), [
    ["POST", "/api/messages/buzz", { memberId: "ann-1", style: "nudge", message: "Back to the report, please.", corner: "bottom-left" }],
    ["POST", "/api/messages/buzz", { memberId: "ann-1", style: "bluescreen", message: "Dude. Focus on work.", corner: "top-right" }],
  ])
  await view.unmount()
})
