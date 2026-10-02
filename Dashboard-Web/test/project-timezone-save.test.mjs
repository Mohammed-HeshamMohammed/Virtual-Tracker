// The project time zone is chosen in the modal but used to be left out of the save request, so it
// never reached the server and changing it did nothing for anyone tracking on the project.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replaceAll("\r\n", "\n")

test("creating and updating a project both send the chosen time zone", () => {
  const src = read("features/projects/api/project-details-api.ts")
  const update = src.slice(src.indexOf("updateProject(projectId, {"), src.indexOf("syncClientLinks(projectId"))
  const create = src.slice(src.indexOf("const projectInput: CreateProjectInput"), src.indexOf("const created = await createProject"))
  assert.match(update, /timezone: payload\.timezone/)
  assert.match(create, /timezone: payload\.timezone/)
})

test("the API layer maps it, and clearing it sends null rather than leaving it alone", () => {
  const src = read("features/projects/api/project-api.ts")
  assert.match(src, /if \(input\.timezone !== undefined\) out\.timezone = input\.timezone \|\| null/)
})

test("a viewer who may not set a time zone does not send one (the server would reject the whole save)", () => {
  const src = read("features/projects/components/modals/project-modal.tsx")
  assert.match(src, /canSetTimezone \? \{\} : \{ timezone: undefined \}/)
})
