// Refresh page: the Owner or a Super Admin reloads someone's open dashboard tabs, so they pick
// up a new release. Live-only, own organization only, rate limited per person.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let members = [];
let pushed = [];
let pages = 1;

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      if (/SELECT id FROM members/.test(sql)) {
        return members.filter((m) => m.id === params[0] && params[1] === "tenant-a");
      }
      if (/SELECT first_name/.test(sql)) return [{ first_name: "Sam", last_name: "Admin", work_email: "s@x.test" }];
      return [];
    },
    withTransaction: async () => null,
  },
});
mock.module("../src/lib/postgres/audit-actor.js", { namedExports: { currentTenantId: () => "tenant-a" } });
mock.module("../src/lib/postgres/ensure-tenancy-schema.js", { namedExports: { MAIN_TENANT_ID: "main" } });
mock.module("../src/modules/presence/presence-gateway.js", {
  namedExports: {
    pushToDashboards: (memberId, message) => {
      pushed.push({ memberId, message });
      return pages;
    },
  },
});
mock.module("../src/modules/messages/service.js", {
  namedExports: {
    MessageError: class MessageError extends Error {
      constructor(status, message) {
        super(message);
        this.status = status;
      }
    },
  },
});

const { requestPageRefresh, resetRefreshCooldownsForTests, REFRESH_COOLDOWN_MS, REFRESH_DELAY_SEC } = await import(
  "../src/modules/messages/refresh-page.js"
);

const MEMBER = "22222222-2222-4222-8222-222222222222";

function reset() {
  members = [{ id: MEMBER }];
  pushed = [];
  pages = 1;
  resetRefreshCooldownsForTests();
}

test("a refresh reaches every open dashboard tab, says who asked, and gives a countdown", async () => {
  reset();
  pages = 2;
  const result = await requestPageRefresh("admin-1", { memberId: MEMBER }, 1_000);
  assert.deepEqual(result, { delivered: true, pages: 2 });
  assert.deepEqual(pushed, [
    {
      memberId: MEMBER,
      message: { type: "refresh-page", from: "Sam Admin", delaySeconds: REFRESH_DELAY_SEC, at: 1_000 },
    },
  ]);
});

test("no target, or someone outside the organization, is refused and nothing is sent", async () => {
  reset();
  await assert.rejects(() => requestPageRefresh("admin-1", {}), { status: 400 });
  await assert.rejects(
    () => requestPageRefresh("admin-1", { memberId: "33333333-3333-4333-8333-333333333333" }),
    { status: 404 },
  );
  assert.equal(pushed.length, 0);
});

test("no dashboard open is told to the sender and costs no cooldown", async () => {
  reset();
  pages = 0;
  await assert.rejects(() => requestPageRefresh("admin-1", { memberId: MEMBER }, 5_000), { status: 409 });
  pages = 1;
  await requestPageRefresh("admin-1", { memberId: MEMBER }, 5_001);
  assert.equal(pushed.length, 2);
});

test("the same person's page cannot be refreshed again inside the cooldown", async () => {
  reset();
  await requestPageRefresh("admin-1", { memberId: MEMBER }, 10_000);
  await assert.rejects(
    () => requestPageRefresh("admin-1", { memberId: MEMBER }, 10_000 + REFRESH_COOLDOWN_MS - 1),
    { status: 429 },
  );
  await requestPageRefresh("admin-1", { memberId: MEMBER }, 10_000 + REFRESH_COOLDOWN_MS);
  assert.equal(pushed.length, 2);
});

test("the refresh route lets the Owner and Super Admins through and nobody below", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/modules/messages/routes.js", import.meta.url), "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  const block = src.slice(src.indexOf('pn === "/api/messages/refresh-page"'), src.indexOf("const threadMatch"));
  assert.match(block, /!isOwnerOrSuperAdminRole\(/);
  assert.match(block, /rejectUnknownFields\(body, \["memberId"\]\)/);
});
