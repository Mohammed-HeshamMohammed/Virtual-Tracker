import test from "node:test";
import assert from "node:assert/strict";
import { rejectSensitiveQueryParams } from "../src/http/password-request-guard.js";
import { readBearerToken } from "../src/http/auth-token.js";

test("presence event streams reject credential query parameters", () => {
  const url = new URL("https://api.example.test/api/presence/events?token=secret");
  assert.match(rejectSensitiveQueryParams(url), /must not be sent in the URL/);
  assert.equal(rejectSensitiveQueryParams(new URL("https://api.example.test/api/presence/events")), null);
});

test("presence authentication reads a bearer token from the request header", () => {
  assert.equal(readBearerToken({ headers: { authorization: "Bearer id-token" } }), "id-token");
  assert.equal(readBearerToken({ headers: {} }), "");
});
