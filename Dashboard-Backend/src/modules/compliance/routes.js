import { requireAuthContext, isManagementRole } from "../../http/auth-context.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { sendJson } from "../../http/response.js";
import { logSafeError } from "../../http/sanitize-error.js";
import {
  getMonitoringPolicy,
  setMonitoringCapability,
  getMonitoringPolicyAudit,
  getMemberMonitoringConsent,
  recordMemberDisclosure,
  recordMemberConsent,
  composeMonitoringNotice,
  hasCurrentConsent,
  getOfferableCapabilities,
  JURISDICTION_PROFILES,
} from "./monitoring-policy.js";
import {
  getCaptureExclusions,
  addCaptureExclusion,
  removeCaptureExclusion,
  getCaptureMinimizationSettings,
  setCaptureMinimizationSettings,
} from "./capture-minimization.js";
import {
  getRetentionSettings,
  setRetentionDays,
  buildDsarExport,
  eraseMemberMonitoringData,
  getScreenshotAccessLog,
} from "./data-retention.js";
import {
  listAgentDevicesForMember,
  setAgentDeviceOwnership,
  getAgentDevice,
} from "../activity/agent-devices.service.js";

const ERROR_STATUS = {
  UNKNOWN_CAPABILITY: 400,
  UNKNOWN_JURISDICTION_PROFILE: 400,
  LAWFUL_BASIS_REQUIRED: 400,
  INVALID_MATCH_TYPE: 400,
  PATTERN_REQUIRED: 400,
  FORBIDDEN: 403,
  CAPABILITY_NOT_OFFERABLE_IN_JURISDICTION: 403,
  UNKNOWN_DATA_TYPE: 400,
  INVALID_RETENTION_DAYS: 400,
};

export async function routeCompliance(req, res, url, origin) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");
  if (!pn.startsWith("/api/compliance")) return false;

  if (pn === "/api/compliance/jurisdiction-offerable" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    const profile = url.searchParams.get("profile") ?? "strictest";
    if (!JURISDICTION_PROFILES.includes(profile)) {
      sendJson(res, origin, 400, { success: false, error: `Unknown jurisdiction profile: ${profile}` });
      return true;
    }
    sendJson(res, origin, 200, { success: true, data: { profile, offerable: getOfferableCapabilities(profile) } });
    return true;
  }

  if (pn === "/api/compliance/monitoring-policy" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    try {
      sendJson(res, origin, 200, { success: true, data: await getMonitoringPolicy() });
    } catch (e) {
      logSafeError("[compliance/monitoring-policy GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load monitoring policy." });
    }
    return true;
  }

  if (pn === "/api/compliance/monitoring-policy" && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only management may change monitoring capabilities." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const updated = await setMonitoringCapability(
        {
          capability: String(body.capability ?? ""),
          enabled: body.enabled === true,
          jurisdictionProfile: typeof body.jurisdictionProfile === "string" ? body.jurisdictionProfile : undefined,
          lawfulBasis: typeof body.lawfulBasis === "string" ? body.lawfulBasis : null,
        },
        { memberId: viewer.memberId, roleName: viewer.roleName },
      );
      sendJson(res, origin, 200, { success: true, data: updated });
    } catch (e) {
      const status = (e && ERROR_STATUS[/** @type {{code?:string}} */ (e).code]) || 500;
      if (status === 500) logSafeError("[compliance/monitoring-policy POST]", e);
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to update monitoring policy.",
      });
    }
    return true;
  }

  if (pn === "/api/compliance/monitoring-policy/audit" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only management may view the compliance audit trail." });
      return true;
    }
    const capability = url.searchParams.get("capability") ?? "";
    try {
      sendJson(res, origin, 200, { success: true, data: await getMonitoringPolicyAudit(capability) });
    } catch (e) {
      logSafeError("[compliance/monitoring-policy audit GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load audit trail." });
    }
    return true;
  }

  if (pn === "/api/compliance/notice" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    try {
      const notice = await composeMonitoringNotice();
      const consented = await hasCurrentConsent(viewer.memberId, notice.version);
      sendJson(res, origin, 200, {
        success: true,
        data: { ...notice, requiresAcknowledgement: !consented },
      });
    } catch (e) {
      logSafeError("[compliance/notice GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load monitoring notice." });
    }
    return true;
  }

  if (pn === "/api/compliance/consent" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    try {
      sendJson(res, origin, 200, { success: true, data: await getMemberMonitoringConsent(viewer.memberId) });
    } catch (e) {
      logSafeError("[compliance/consent GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load consent record." });
    }
    return true;
  }

  if (pn === "/api/compliance/consent/disclose" && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const noticeVersion = String(body.noticeVersion ?? "").trim();
    if (!noticeVersion) {
      sendJson(res, origin, 400, { success: false, error: "noticeVersion is required." });
      return true;
    }
    try {
      sendJson(res, origin, 200, {
        success: true,
        data: await recordMemberDisclosure(viewer.memberId, noticeVersion),
      });
    } catch (e) {
      logSafeError("[compliance/consent/disclose POST]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to record disclosure." });
    }
    return true;
  }

  if (pn === "/api/compliance/consent/accept" && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const noticeVersion = String(body.noticeVersion ?? "").trim();
    if (!noticeVersion) {
      sendJson(res, origin, 400, { success: false, error: "noticeVersion is required." });
      return true;
    }
    try {
      sendJson(res, origin, 200, {
        success: true,
        data: await recordMemberConsent(viewer.memberId, noticeVersion),
      });
    } catch (e) {
      logSafeError("[compliance/consent/accept POST]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to record consent." });
    }
    return true;
  }

  if (pn === "/api/compliance/capture-exclusions" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only management may view capture exclusions." });
      return true;
    }
    try {
      sendJson(res, origin, 200, { success: true, data: await getCaptureExclusions() });
    } catch (e) {
      logSafeError("[compliance/capture-exclusions GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load capture exclusions." });
    }
    return true;
  }

  if (pn === "/api/compliance/capture-exclusions" && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only management may change capture exclusions." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const created = await addCaptureExclusion(
        { matchType: body.matchType, pattern: body.pattern, note: typeof body.note === "string" ? body.note : undefined },
        { memberId: viewer.memberId, roleName: viewer.roleName },
      );
      sendJson(res, origin, 200, { success: true, data: created });
    } catch (e) {
      const status = (e && ERROR_STATUS[/** @type {{code?:string}} */ (e).code]) || 500;
      if (status === 500) logSafeError("[compliance/capture-exclusions POST]", e);
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to add capture exclusion.",
      });
    }
    return true;
  }

  if (pn.startsWith("/api/compliance/capture-exclusions/") && req.method === "DELETE") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only management may change capture exclusions." });
      return true;
    }
    const id = pn.slice("/api/compliance/capture-exclusions/".length).split("/")[0];
    try {
      await removeCaptureExclusion(id, { memberId: viewer.memberId, roleName: viewer.roleName });
      sendJson(res, origin, 200, { success: true, data: null });
    } catch (e) {
      const status = (e && ERROR_STATUS[/** @type {{code?:string}} */ (e).code]) || 500;
      if (status === 500) logSafeError("[compliance/capture-exclusions DELETE]", e);
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to remove capture exclusion.",
      });
    }
    return true;
  }

  if (pn === "/api/compliance/capture-settings" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    try {
      sendJson(res, origin, 200, { success: true, data: await getCaptureMinimizationSettings() });
    } catch (e) {
      logSafeError("[compliance/capture-settings GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load capture settings." });
    }
    return true;
  }

  if (pn === "/api/compliance/capture-settings" && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only management may change capture settings." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const updated = await setCaptureMinimizationSettings(
        { urlDomainOnly: body.urlDomainOnly, screenshotBlurDefault: body.screenshotBlurDefault },
        { memberId: viewer.memberId, roleName: viewer.roleName },
      );
      sendJson(res, origin, 200, { success: true, data: updated });
    } catch (e) {
      const status = (e && ERROR_STATUS[/** @type {{code?:string}} */ (e).code]) || 500;
      if (status === 500) logSafeError("[compliance/capture-settings POST]", e);
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to update capture settings.",
      });
    }
    return true;
  }

  if (pn === "/api/compliance/retention-settings" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    try {
      sendJson(res, origin, 200, { success: true, data: await getRetentionSettings() });
    } catch (e) {
      logSafeError("[compliance/retention-settings GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load retention settings." });
    }
    return true;
  }

  if (pn === "/api/compliance/retention-settings" && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only management may change retention settings." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const updated = await setRetentionDays(
        String(body.dataType ?? ""),
        body.retentionDays,
        { memberId: viewer.memberId, roleName: viewer.roleName },
      );
      sendJson(res, origin, 200, { success: true, data: updated });
    } catch (e) {
      const status = (e && ERROR_STATUS[/** @type {{code?:string}} */ (e).code]) || 500;
      if (status === 500) logSafeError("[compliance/retention-settings POST]", e);
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to update retention settings.",
      });
    }
    return true;
  }

  if (pn === "/api/compliance/dsar" || pn.startsWith("/api/compliance/dsar/")) {
    if (req.method !== "GET") return false;
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    const requestedId = pn === "/api/compliance/dsar" ? viewer.memberId : pn.slice("/api/compliance/dsar/".length).split("/")[0];
    if (requestedId !== viewer.memberId && !isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only management may export another member's data." });
      return true;
    }
    try {
      sendJson(res, origin, 200, { success: true, data: await buildDsarExport(requestedId) });
    } catch (e) {
      logSafeError("[compliance/dsar GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to build data export." });
    }
    return true;
  }

  if (pn.startsWith("/api/compliance/erasure/") && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    const targetId = pn.slice("/api/compliance/erasure/".length).split("/")[0];
    if (!targetId) {
      sendJson(res, origin, 400, { success: false, error: "A member id is required." });
      return true;
    }
    try {
      const result = await eraseMemberMonitoringData(targetId, {
        memberId: viewer.memberId,
        roleName: viewer.roleName,
      });
      sendJson(res, origin, 200, { success: true, data: result });
    } catch (e) {
      const status = (e && ERROR_STATUS[/** @type {{code?:string}} */ (e).code]) || 500;
      if (status === 500) logSafeError("[compliance/erasure POST]", e);
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to erase monitoring data.",
      });
    }
    return true;
  }

  if (pn === "/api/compliance/screenshot-access-log" || pn.startsWith("/api/compliance/screenshot-access-log/")) {
    if (req.method !== "GET") return false;
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    const requestedId =
      pn === "/api/compliance/screenshot-access-log"
        ? viewer.memberId
        : pn.slice("/api/compliance/screenshot-access-log/".length).split("/")[0];
    if (requestedId !== viewer.memberId && !isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only management may view another member's access log." });
      return true;
    }
    try {
      sendJson(res, origin, 200, { success: true, data: await getScreenshotAccessLog(requestedId) });
    } catch (e) {
      logSafeError("[compliance/screenshot-access-log GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load screenshot access log." });
    }
    return true;
  }

  const isOwnershipPath = pn.startsWith("/api/compliance/devices/") && pn.endsWith("/ownership");

  if ((pn === "/api/compliance/devices" || pn.startsWith("/api/compliance/devices/")) &&
      !isOwnershipPath && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    const requestedId =
      pn === "/api/compliance/devices" ? viewer.memberId : pn.slice("/api/compliance/devices/".length).split("/")[0];
    if (requestedId !== viewer.memberId && !isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only management may view another member's devices." });
      return true;
    }
    try {
      sendJson(res, origin, 200, { success: true, data: await listAgentDevicesForMember(requestedId) });
    } catch (e) {
      logSafeError("[compliance/devices GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load devices." });
    }
    return true;
  }

  if (isOwnershipPath && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    const deviceId = pn.slice("/api/compliance/devices/".length, -"/ownership".length);
    if (!deviceId) {
      sendJson(res, origin, 400, { success: false, error: "A device id is required." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    try {
      const device = await getAgentDevice(deviceId);
      if (!device || device.revoked_at) {
        sendJson(res, origin, 404, { success: false, error: "Device not found." });
        return true;
      }
      const isOwnDevice = String(device.member_id) === viewer.memberId;
      if (!isOwnDevice && !isManagementRole(viewer.roleName)) {
        sendJson(res, origin, 403, {
          success: false,
          error: "Only the device's owner or management may classify it.",
        });
        return true;
      }
      const updated = await setAgentDeviceOwnership(deviceId, String(body.ownership ?? ""), viewer.memberId);
      sendJson(res, origin, 200, { success: true, data: updated });
    } catch (e) {
      const status = e && (e).code === "UNKNOWN_OWNERSHIP" ? 400 : 500;
      if (status === 500) logSafeError("[compliance/devices ownership POST]", e);
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to update device ownership.",
      });
    }
    return true;
  }

  return false;
}
