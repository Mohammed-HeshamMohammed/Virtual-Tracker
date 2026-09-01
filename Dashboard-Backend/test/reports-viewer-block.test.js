// Guards the Viewer-role hard block at the top of routeReports - Viewer is
// read-only access to whatever the org chose to show it directly (dashboards,
// People directory), not a reporting seat, so it must 403 on every
// /api/reports/* path before any individual route's own scoping runs.
import test from "node:test";
import assert from "node:assert/strict";
import { setAuthContext } from "../src/http/auth-context.js";
import { routeReports } from "../src/modules/reports/routes.js";

/** Minimal fake res that captures what sendJson wrote, nothing more. */
function fakeRes() {
  const res = {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      res.statusCode = status;
      res.headers = headers;
    },
    end(body) {
      res.body = body ? JSON.parse(body) : null;
    },
  };
  return res;
}

function fakeReq(roleName) {
  const req = { headers: {} };
  setAuthContext(req, { memberId: "m1", roleName });
  return req;
}

test("a Viewer-role request to any /api/reports/* path is blocked with 403, before any report-specific logic runs", async () => {
  const paths = [
    "/api/reports/filter-options",
    "/api/reports/time-and-activity",
    "/api/reports/work-sessions",
    "/api/reports/audit-log",
  ];
  for (const path of paths) {
    const req = fakeReq("Viewer");
    const res = fakeRes();
    const url = new URL(`http://localhost${path}`);
    const handled = await routeReports(req, res, url, undefined);
    assert.equal(handled, true, `${path} should be handled (not fall through)`);
    assert.equal(res.statusCode, 403, `${path} should 403 for Viewer`);
    assert.equal(res.body.success, false);
  }
});

test("a request with no auth context still gets the existing 401, not the Viewer 403", async () => {
  const req = { headers: {} };
  const res = fakeRes();
  const url = new URL("http://localhost/api/reports/filter-options");
  const handled = await routeReports(req, res, url, undefined);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 401);
});

test("routeReports ignores paths outside /api/reports/", async () => {
  const req = fakeReq("Viewer");
  const res = fakeRes();
  const url = new URL("http://localhost/api/members");
  const handled = await routeReports(req, res, url, undefined);
  assert.equal(handled, false);
  assert.equal(res.statusCode, null);
});
