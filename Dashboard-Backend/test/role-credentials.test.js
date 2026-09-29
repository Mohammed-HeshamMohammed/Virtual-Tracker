// The restricted roles log in with passwords derived from the superuser
// credential and stored in Postgres only as SCRAM verifiers computed here.
// A wrong verifier would not fail until the production cutover, as "nobody
// can log in", so this runs a full SCRAM-SHA-256 handshake: node-postgres's
// own client implementation on one side, and the verifier acting as the
// server on the other (the same check Postgres performs against pg_authid).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { deriveRolePassword, roleConnectionString, scramVerifier } from "../src/lib/postgres/role-credentials.js";

const require = createRequire(import.meta.url);
const sasl = require("pg/lib/crypto/sasl.js");

const SUPERUSER_URL = "postgres://postgres:s3cr%40t@db-host:5432/postgres";

function parseVerifier(verifier) {
  const m = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(verifier);
  assert.ok(m, `verifier has the pg_authid layout: ${verifier}`);
  return {
    iterations: Number(m[1]),
    salt: m[2],
    storedKey: Buffer.from(m[3], "base64"),
    serverKey: Buffer.from(m[4], "base64"),
  };
}

async function handshake(verifier, clientPassword) {
  const v = parseVerifier(verifier);
  const session = sasl.startSession(["SCRAM-SHA-256"]);
  const clientFirstBare = session.response.slice("n,,".length);
  const nonce = session.clientNonce + crypto.randomBytes(18).toString("base64");
  const serverFirst = `r=${nonce},s=${v.salt},i=${v.iterations}`;
  await sasl.continueSession(session, clientPassword, serverFirst);

  const [withoutProof, proofPart] = session.response.split(",p=");
  const authMessage = `${clientFirstBare},${serverFirst},${withoutProof}`;
  const clientSignature = crypto.createHmac("sha256", v.storedKey).update(authMessage).digest();
  const proof = Buffer.from(proofPart, "base64");
  const clientKey = Buffer.from(proof.map((b, i) => b ^ clientSignature[i]));
  const accepted = crypto.createHash("sha256").update(clientKey).digest().equals(v.storedKey);
  if (!accepted) return false;

  const serverSignature = crypto.createHmac("sha256", v.serverKey).update(authMessage).digest("base64");
  sasl.finalizeSession(session, `v=${serverSignature}`);
  return true;
}

test("the derived password authenticates against its verifier, as the pg driver speaks SCRAM", async () => {
  const password = deriveRolePassword(SUPERUSER_URL, "vt_app");
  assert.equal(await handshake(scramVerifier(password), password), true);
});

test("a wrong password is rejected by the verifier", async () => {
  const password = deriveRolePassword(SUPERUSER_URL, "vt_app");
  assert.equal(await handshake(scramVerifier(password), `${password}x`), false);
});

test("derivation is stable per role, differs across roles and superuser secrets", () => {
  const a = deriveRolePassword(SUPERUSER_URL, "vt_app");
  assert.equal(a, deriveRolePassword(SUPERUSER_URL, "vt_app"));
  assert.notEqual(a, deriveRolePassword(SUPERUSER_URL, "vt_readonly_crosstenant"));
  assert.notEqual(a, deriveRolePassword("postgres://postgres:other@db-host:5432/postgres", "vt_app"));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("the superuser password is URL-decoded before use", () => {
  const decoded = crypto.createHmac("sha256", "s3cr@t").update("vt-role:vt_app").digest("hex");
  assert.equal(deriveRolePassword(SUPERUSER_URL, "vt_app"), decoded);
});

test("the role connection string keeps host/port/db and swaps only the credentials", () => {
  const url = new URL(roleConnectionString(SUPERUSER_URL, "vt_app"));
  assert.equal(url.username, "vt_app");
  assert.equal(url.password, deriveRolePassword(SUPERUSER_URL, "vt_app"));
  assert.equal(url.host, "db-host:5432");
  assert.equal(url.pathname, "/postgres");
});

test("no superuser password means nothing can be derived", () => {
  assert.equal(deriveRolePassword("postgres://postgres@db-host/postgres", "vt_app"), null);
  assert.equal(roleConnectionString(undefined, "vt_app"), null);
});
