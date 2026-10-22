// Every navigable page has to resolve to the chunk that renders it. A page id missing from the
// chunk table silently falls back to the Dashboard chunk, so "Customer accounts" (added to the nav,
// the People button and PeopleSectionContent, but not to the route tables) opened the Dashboard
// instead of the page. These run the real navigation, resolver and router.
import test, { after } from "node:test"
import assert from "node:assert/strict"
import { installDom, createLoader, framerMotionStub, mount, React } from "./helpers/render.mjs"

const env = installDom()
after(() => env.restore())

const opened = []
const record = (name) => (props) => {
  opened.push({ name, ...props })
  return null
}
const loader = createLoader({
  stubs: {
    "framer-motion": framerMotionStub,
    "@/app/routes/chunk-loaders": { CHUNK_COMPONENTS: new Proxy({}, { get: (_, chunk) => record(`chunk:${String(chunk)}`) }) },
    "@/features/members/pages/people-section-content": { PeopleSectionContent: record("PeopleSectionContent") },
    "@/features/members": { MembersPage: record("MembersPage"), MemberTreePage: record("MemberTreePage") },
    "@/features/members/pages/member-bans-page": { MemberBansPage: record("MemberBansPage") },
    "@/features/teams": { TeamsPage: record("TeamsPage") },
  },
})
const { NAV_SECTIONS } = loader.load("shared/ui/layout/config/nav-sections.ts")
const { resolveChunkId } = loader.load("app/routes/resolve-chunk.ts")
const { PageContent } = loader.load("app/page-content.tsx")
const { default: PeopleChunk } = loader.load("app/routes/chunks/people-chunk.tsx")
const { isFullBleedPage } = loader.load("app/page-layout.ts")

const pagesBySection = NAV_SECTIONS.map((section) => ({
  section: section.id,
  pages: [
    ...(section.pages ?? []).map((p) => p.id),
    ...(section.subsections ?? []).flatMap((sub) => sub.items.map((item) => item.id)),
  ],
}))
const allPages = pagesBySection.flatMap((s) => s.pages)

test("the nav has pages to check", () => {
  assert.ok(allPages.length > 30, `found ${allPages.length}`)
  assert.ok(allPages.includes("people-customer-accounts"))
})

test("no page outside the Dashboard section falls back to the Dashboard chunk", () => {
  const strays = pagesBySection
    .filter((s) => s.section !== "dashboard" && s.section !== "favorites")
    .flatMap((s) => s.pages)
    .filter((id) => resolveChunkId(id) === "dashboard")
  assert.deepEqual(strays, [])
})

test("Customer accounts opens the People section's own page, wherever it is reached from", async () => {
  assert.equal(resolveChunkId("people-customer-accounts"), "people")
  assert.equal(isFullBleedPage("people-customer-accounts"), true)

  opened.length = 0
  const view = await mount(React.createElement(PageContent, { activeItem: "people-customer-accounts", onNavigate: () => {} }))
  assert.deepEqual(opened.map((o) => [o.name, o.activeItem]), [["PeopleSectionContent", "people-customer-accounts"]])
  await view.unmount()

  opened.length = 0
  const chunk = await mount(React.createElement(PeopleChunk, { pageId: "people-customer-accounts", onNavigate: () => {} }))
  assert.deepEqual(opened.map((o) => [o.name, o.activeItem]), [["PeopleSectionContent", "people-customer-accounts"]])
  await chunk.unmount()
})
