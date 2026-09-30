// team_members has no `role` column (leads are is_lead). A query that selected
// it 500'd the agent workspace and silently emptied the member list's teams.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

test("no query reads a role column from team_members", () => {
  const offenders = [];
  for (const file of walk("src")) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/["'`](SELECT[^"'`]*?FROM team_members[^"'`]*)["'`]/gi)) {
      if (/\brole\b/i.test(m[1])) offenders.push(`${file}: ${m[1].slice(0, 100)}`);
    }
  }
  assert.deepEqual(offenders, []);
});
