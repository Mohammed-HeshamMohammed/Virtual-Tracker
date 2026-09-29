import assert from "node:assert/strict";
import test from "node:test";

import { resolveAllowedOrigin } from "../src/app/handle-request.js";
import { initConfig } from "../src/config/env.js";

test("an unconfigured development server fails closed instead of reflecting an origin", () => {
  initConfig({ NODE_ENV: "development" });
  assert.equal(resolveAllowedOrigin("https://attacker.example"), "");
});

test("only an explicitly configured origin is reflected", () => {
  initConfig({
    NODE_ENV: "development",
    CORS_ORIGINS: "https://app.example,https://admin.example",
  });
  assert.equal(resolveAllowedOrigin("https://admin.example"), "https://admin.example");
  assert.equal(resolveAllowedOrigin("https://attacker.example"), "");
});
