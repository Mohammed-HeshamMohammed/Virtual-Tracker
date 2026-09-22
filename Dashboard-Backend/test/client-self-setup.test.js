// Client self-setup (client-self-setup.js): a Client with no linked client
// record fills in their own details - unless an admin already made that
// record, which is then linked by email instead of asking twice.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let state;
let calls;

function reset(overrides = {}) {
  calls = [];
  state = {
    linkedClient: null,
    member: { first_name: "Cara", last_name: "Client", work_email: "cara@acme.com", phone_number: "+1555" },
    candidates: [],
    updateWins: true,
    ...overrides,
  };
}

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT id FROM clients WHERE member_id = \$1/.test(sql)) return state.linkedClient ? [{ id: state.linkedClient }] : [];
      if (/FROM members WHERE id = \$1/.test(sql)) return [state.member];
      if (/WHERE member_id IS NULL\s+AND status = 'active'/.test(sql)) return state.candidates.map((id) => ({ id }));
      if (/^\s*UPDATE clients SET member_id/.test(sql)) return state.updateWins ? [{ id: params[1] }] : [];
      return [];
    },
  },
});
mock.module("../src/lib/postgres/ensure-tenancy-schema.js", {
  namedExports: { MAIN_TENANT_ID: "main" },
});
let created = null;
mock.module("../src/modules/clients/services/client-service.js", {
  namedExports: {
    createClientWithDetails: async (_db, body, actorId) => {
      created = { body, actorId };
      return { id: "new-client" };
    },
  },
});

const { getClientSelfSetupStatus, completeClientSelfSetup, ClientSelfSetupError } = await import(
  "../src/modules/clients/services/client-self-setup.js"
);

const client = { memberId: "m1", roleName: "Client", tenantId: "t1" };

test("non-clients are never asked", async () => {
  reset();
  assert.deepEqual(await getClientSelfSetupStatus({ memberId: "m1", roleName: "Manager" }), { required: false });
  assert.equal(calls.length, 0);
});

test("a client already linked to a record is not asked", async () => {
  reset({ linkedClient: "c1" });
  assert.deepEqual(await getClientSelfSetupStatus(client), { required: false, clientId: "c1" });
});

test("an admin-made record is linked by email instead of asking again", async () => {
  reset({ candidates: ["c9"] });
  assert.deepEqual(await getClientSelfSetupStatus(client), { required: false, clientId: "c9", autoLinked: true });
  const lookup = calls.find((c) => /WHERE member_id IS NULL/.test(c.sql));
  assert.deepEqual(lookup.params, ["cara@acme.com", "t1"], "matched by the member's email, inside their own tenant only");
});

test("two possible records: no guessing, the client is asked", async () => {
  reset({ candidates: ["c1", "c2"] });
  const status = await getClientSelfSetupStatus(client);
  assert.equal(status.required, true);
  assert.ok(!calls.some((c) => /^\s*UPDATE clients/.test(c.sql)), "nothing is linked");
});

test("losing the link race to an admin falls through to asking", async () => {
  reset({ candidates: ["c9"], updateWins: false });
  assert.equal((await getClientSelfSetupStatus(client)).required, true);
});

test("an unlinked client is asked, with their own contact details prefilled", async () => {
  reset();
  assert.deepEqual(await getClientSelfSetupStatus(client), {
    required: true,
    prefill: { name: "Cara Client", email: "cara@acme.com", phone: "+1555" },
  });
});

test("submitting creates a record linked to the caller - admin-only fields are dropped", async () => {
  reset();
  created = null;
  await completeClientSelfSetup(null, client, {
    name: "Acme Ltd",
    email: "billing@acme.com",
    phone: "+1555",
    clientMember: "someone-else",
    projects: ["p1"],
    budget: { type: "fixed", cost: 1 },
    invoicing: { custom: true },
  });
  assert.equal(created.body.clientMember, "m1", "always the caller, never a body field");
  assert.deepEqual(created.body.projects, []);
  assert.equal(created.body.budget, null);
  assert.deepEqual(created.body.invoicing, {});
  assert.equal(created.actorId, "m1");
});

test("submit is refused for non-clients, repeats, and bad input", async () => {
  reset();
  await assert.rejects(completeClientSelfSetup(null, { memberId: "m1", roleName: "User" }, { name: "x", email: "a@b.co" }), (e) => e instanceof ClientSelfSetupError && e.status === 403);
  reset({ linkedClient: "c1" });
  await assert.rejects(completeClientSelfSetup(null, client, { name: "x", email: "a@b.co" }), (e) => e.status === 409);
  reset();
  await assert.rejects(completeClientSelfSetup(null, client, { name: " ", email: "a@b.co" }), (e) => e.status === 400);
  await assert.rejects(completeClientSelfSetup(null, client, { name: "Acme", email: "nope" }), (e) => e.status === 400);
});
