// On an empty database the schema used to stop at the first statement that
// read a table a later one creates, leaving everything after it uncreated.
import test from "node:test";
import assert from "node:assert/strict";
import { applyStatementsWithRetry, describeFailures } from "../src/lib/postgres/apply-statements.js";

/** A client that only lets a statement through once the tables it names exist. */
function fakeClient(dependsOn = {}) {
  const created = new Set();
  const ran = [];
  return {
    ran,
    created,
    async query(statement) {
      ran.push(statement);
      const needs = dependsOn[statement] ?? [];
      const missing = needs.find((n) => !created.has(n));
      if (missing) throw new Error(`relation "${missing}" does not exist`);
      const made = /^CREATE (\w+)/.exec(statement)?.[1];
      if (made) created.add(made);
    },
  };
}

test("a statement that needs a later table succeeds on the next pass", async () => {
  const client = fakeClient({ "VIEW over pay_rates": ["pay_rates"] });
  const failures = await applyStatementsWithRetry(client, ["VIEW over pay_rates", "CREATE pay_rates"]);
  assert.deepEqual(failures, []);
  assert.equal(client.created.has("pay_rates"), true);
});

test("statements after a failing one still run, instead of being skipped", async () => {
  const client = fakeClient({ "VIEW over nothing": ["nothing"] });
  const failures = await applyStatementsWithRetry(client, ["VIEW over nothing", "CREATE later_table"]);
  assert.equal(client.created.has("later_table"), true, "one bad statement must not block the rest");
  assert.equal(failures.length, 1);
});

test("a statement that is genuinely wrong is reported, not swallowed", async () => {
  const client = fakeClient({ "BROKEN": ["never_created"] });
  const failures = await applyStatementsWithRetry(client, ["BROKEN", "CREATE ok_table"]);
  assert.equal(failures.length, 1);
  assert.match(describeFailures(failures), /never_created/);
  assert.match(describeFailures(failures), /BROKEN/);
});

test("a chain of dependencies resolves across several passes", async () => {
  const client = fakeClient({ "CREATE c": ["b"], "CREATE b": ["a"] });
  const failures = await applyStatementsWithRetry(client, ["CREATE c", "CREATE b", "CREATE a"]);
  assert.deepEqual(failures, []);
  assert.deepEqual([...client.created].sort(), ["a", "b", "c"]);
});

test("a permanently failing list terminates rather than looping forever", async () => {
  const client = fakeClient({ X: ["nope"], Y: ["nope"] });
  const failures = await applyStatementsWithRetry(client, ["X", "Y"]);
  assert.equal(failures.length, 2);
  assert.equal(client.ran.length, 2, "no progress means no retry");
});

test("a statement that already succeeded is never run again", async () => {
  const client = fakeClient({ "VIEW v": ["t"] });
  await applyStatementsWithRetry(client, ["CREATE first", "VIEW v", "CREATE t"]);
  assert.equal(client.ran.filter((s) => s === "CREATE first").length, 1);
});

test("nothing to run is a clean no-op", async () => {
  assert.deepEqual(await applyStatementsWithRetry(fakeClient(), []), []);
  assert.equal(describeFailures([]), "");
});
