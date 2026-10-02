// `SELECT .. LIMIT n UNION SELECT .. LIMIT n` is a Postgres syntax error. removeMemberHierarchyRelationships
// was written that way, so cleaning a Client's tree edges threw - and every organization Members tree
// load, which cleans every Client's edges first, answered 500. (Checked against real Postgres: the old
// statement fails with `syntax error at or near "UNION"`, the parenthesized one deletes the right rows.)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(new URL("../src/modules/member-relationships/service.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const routes = readFileSync(new URL("../src/modules/member-relationships/routes.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");

test("each SELECT of the edge-removal union is parenthesized", () => {
  assert.match(
    service,
    /\(SELECT id FROM member_relationships WHERE child_member_id = \$1 LIMIT 50\)\s*UNION\s*\(SELECT id FROM member_relationships WHERE parent_member_id = \$1 LIMIT 50\)/,
  );
});

test("no SELECT ... LIMIT is left directly in front of a UNION anywhere in the relationship service", () => {
  assert.equal(/LIMIT \d+\s*\n\s*UNION/.test(service), false);
});

test("the organization tree survives a failing housekeeping step", () => {
  assert.match(routes, /external-entity cleanup/);
  assert.match(routes, /try \{\s*await repair\(\);\s*\} catch \(repairError\)/);
});
