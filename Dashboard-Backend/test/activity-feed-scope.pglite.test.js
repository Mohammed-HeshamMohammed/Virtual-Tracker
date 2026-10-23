// Who sees what in the Activity feed, the single-screenshot fetch and the Time & Activity report,
// run through the real handlers against a real Postgres (PGlite) built from the boot schema.
//
// These replace regex checks on activity/routes.js, activity-scope.js and reports/routes.js
// (client-report-visibility and activity-feed-multi-member), which only proved the code said what
// it was written to say. Skips itself when PGlite is missing.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startPglite, seeder, srcUrl, request, loadPglite } from "./helpers/pglite.js";

if (!(await loadPglite())) {
  test("activity feed scope against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const pg = await startPglite();
  after(() => pg.close());
  const { insert, member } = seeder(pg);

  // Profile photos live in Firestore; a two-method fake is all the feed reads.
  const profiles = new Map();
  const firestore = {
    collection: () => ({ doc: (uid) => ({ uid }) }),
    getAll: async (...refs) => refs.map(({ uid }) => ({ id: uid, exists: profiles.has(uid), data: () => profiles.get(uid) })),
  };
  const { __setTestDb } = await import(srcUrl("config/firebase.js"));
  __setTestDb(firestore);

  const { routeActivity } = await import(srcUrl("modules/activity/routes.js"));
  const { loadTimeAndActivityReportPayloadForMemberIds } = await import(srcUrl("modules/reports/routes.js"));

  // An organisation: an owner, a manager over one worker, a second worker, and a client who owns
  // project OWN. Both workers have captures on OWN and on OTHER.
  const owner = await member("Owner", { first_name: "Olive" });
  const manager = await member("Manager", { first_name: "Mia" });
  const ann = await member("Employee", { first_name: "Ann", firebase_uid: "uid-ann", avatar_url: "https://stale.example/ann.png" });
  const bob = await member("Employee", { first_name: "Bob" });
  const clientLogin = await member("Client", { first_name: "Cleo" });
  const lonelyClient = await member("Client", { first_name: "Lone" });
  await insert("member_relationships", { parent_member_id: owner.id, child_member_id: manager.id });
  await insert("member_relationships", { parent_member_id: manager.id, child_member_id: ann.id });
  await insert("member_relationships", { parent_member_id: owner.id, child_member_id: bob.id });
  profiles.set("uid-ann", { photoURL: "https://cdn.example/ann-profile.png" });

  const client = await insert("clients", { name: "Acme", member_id: clientLogin.id });
  await insert("clients", { name: "Nobody", member_id: lonelyClient.id });
  // Linked the current way (client_projects). Older rows carry projects.client_id instead.
  const own = await insert("projects", { name: "Client project" });
  await insert("client_projects", { client_id: client.id, project_id: own.id });
  const other = await insert("projects", { name: "Internal project" });
  for (const m of [ann, bob]) {
    for (const p of [own, other]) await insert("project_members", { project_id: p.id, member_id: m.id });
  }

  const shots = {};
  const pays = [];
  for (const m of [ann, bob]) {
    for (const p of [own, other]) {
      const s = await insert("activity_sessions", {
        member_id: m.id, project_id: p.id, status: "stopped", active_seconds: 3600,
        started_at: "2026-09-28T09:00:00Z", ended_at: "2026-09-28T10:00:00Z",
      });
      const shot = await insert("activity_screenshots", {
        member_id: m.id, session_id: s.id, app_name: "Figma", captured_at: "2026-09-28T09:30:00Z", image_data: Buffer.from("img"),
      });
      shots[`${m.first_name}:${p.name}`] = shot.id;
    }
    pays.push(await insert("pay_rates", { member_id: m.id, type: "hourly", rate: 20, currency: "USD" }));
  }
  await insert("apps", { name: "Figma" });

  const viewer = (m) => ({ memberId: m.id, roleName: m.first_name === "Olive" ? "Owner" : m.first_name === "Mia" ? "Manager" : m.first_name === "Cleo" || m.first_name === "Lone" ? "Client" : "Employee", uid: `uid-${m.id}` });
  async function get(who, path) {
    const res = await request({ path, viewer: viewer(who) }, (req, res, url) => routeActivity(req, res, url, undefined));
    assert.equal(res.handled, true, path);
    return res;
  }
  const feed = (who, query) => get(who, `/api/activity/feed?day=all&${query}`);
  const ids = (res) => res.body.data.map((r) => r.id).sort();

  test("a client's feed shows screenshots on its own projects only", async () => {
    const res = await feed(clientLogin, "type=screenshots");
    assert.equal(res.statusCode, 200);
    assert.deepEqual(ids(res), [shots["Ann:Client project"], shots["Bob:Client project"]].sort());
  });

  test("a client gets no apps or sites tab at all", async () => {
    for (const type of ["apps", "urls"]) {
      const res = await feed(clientLogin, `type=${type}`);
      assert.equal(res.statusCode, 403, type);
    }
  });

  test("a client asking for a project that is not theirs gets nothing, not everything", async () => {
    const res = await feed(clientLogin, `type=screenshots&projectIds=${other.id}`);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, []);
  });

  test("a requested project list narrows the feed and cannot reach past what the viewer may see", async () => {
    const narrowed = await feed(owner, `type=screenshots&projectIds=${other.id}`);
    assert.deepEqual(ids(narrowed), [shots["Ann:Internal project"], shots["Bob:Internal project"]].sort());
    // The manager is on no project, so a project they cannot reach filters to nothing.
    const outside = await feed(manager, `type=screenshots&projectIds=${own.id}`);
    assert.deepEqual(outside.body.data, []);
  });

  test("every member asked for must be one the viewer may see, or the feed is refused", async () => {
    // The manager sees Ann (their report) but not Bob.
    const allowed = await feed(manager, `type=screenshots&memberId=${ann.id}`);
    assert.equal(allowed.statusCode, 200);
    assert.deepEqual(ids(allowed), [shots["Ann:Client project"], shots["Ann:Internal project"]].sort());
    const mixed = await feed(manager, `type=screenshots&memberId=${ann.id},${bob.id}`);
    assert.equal(mixed.statusCode, 403);
    const both = await feed(owner, `type=screenshots&memberId=${ann.id},${bob.id}`);
    assert.equal(both.statusCode, 200);
    assert.equal(both.body.data.length, 4);
  });

  test("feed rows and the member list take their photo from the profile, not members.avatar_url", async () => {
    const res = await feed(owner, `type=screenshots&memberId=${ann.id}`);
    for (const row of res.body.data) assert.equal(row.avatarUrl, "https://cdn.example/ann-profile.png");
    const option = res.body.members.find((m) => m.id === ann.id);
    assert.equal(option.avatarUrl, "https://cdn.example/ann-profile.png");
  });

  test("a single screenshot cannot be fetched by id outside the client's projects", async () => {
    const mine = await get(clientLogin, `/api/activity/screenshot/${shots["Ann:Client project"]}`);
    assert.equal(mine.statusCode, 200);
    assert.match(mine.body.data.imageData, /^data:image\/webp;base64,/);
    const theirs = await get(clientLogin, `/api/activity/screenshot/${shots["Ann:Internal project"]}`);
    assert.equal(theirs.statusCode, 403);
    // The owner, not being a client, is not held to projects.
    assert.equal((await get(owner, `/api/activity/screenshot/${shots["Ann:Internal project"]}`)).statusCode, 200);
  });

  const report = (who, projectIds = null) =>
    loadTimeAndActivityReportPayloadForMemberIds(firestore, [ann.id, bob.id], "2026-09-28", "2026-09-28", viewer(who), projectIds);
  const projectsIn = (payload) => [...new Set(payload.entries.map((e) => e.projectName))].sort();

  test("the report loader holds a client to its own projects and strips every amount", async () => {
    const payload = await report(clientLogin);
    assert.deepEqual(projectsIn(payload), ["Client project"]);
    assert.equal(payload.moneyHidden, true);
    assert.equal("billingIncluded" in payload, false);
    for (const e of payload.entries) {
      for (const f of ["spentAmount", "currency", "payRate", "billRate", "billAmount"]) assert.equal(f in e, false, f);
    }
    // Asking for the other project narrows to nothing rather than reaching it.
    assert.deepEqual((await report(clientLogin, [other.id])).entries, []);
  });

  test("a client with no projects matches no project instead of everything", async () => {
    const payload = await report(lonelyClient);
    assert.deepEqual(payload.entries, []);
    assert.deepEqual(payload.days.flatMap((d) => d.members), []);
  });

  test("only management is told what a client is charged", async () => {
    const forOwner = await report(owner);
    assert.equal(forOwner.billingIncluded, true);
    assert.deepEqual(projectsIn(forOwner), ["Client project", "Internal project"]);
    assert.ok(forOwner.entries.some((e) => typeof e.spentAmount === "number" && e.spentAmount > 0), "the owner sees amounts");
    for (const who of [ann]) assert.equal((await report(who)).billingIncluded, false);
  });
}
