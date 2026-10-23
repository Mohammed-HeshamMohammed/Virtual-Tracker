import test from "node:test";
import assert from "node:assert/strict";
import { collectEnvValidationErrors as dashboard } from "../src/config/env-schema.js";

for (const [name, validate] of Object.entries({ dashboard })) {
  test(`${name}: environment validation accepts a development port and rejects invalid ports after the Zod upgrade`, () => {
    assert.deepEqual(validate({ NODE_ENV: "development", PORT: "5713" }), []);
    for (const port of ["0", "65536", "not-a-port"]) {
      assert.ok(validate({ NODE_ENV: "development", PORT: port }).some(message => message.includes("PORT")));
    }
    assert.ok(validate({ NODE_ENV: "production" }).length > 0, "production must still require its credentials");
  });
}

