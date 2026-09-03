import { getAuthAdmin } from "../config/firebase.js";
import { requiresEmailVerification } from "../modules/auth/session-authorization.js";
import { assertDeviceNotBanned, assertMemberNotBanned } from "../modules/members/services/member-ban-service.js";
import { enforcePrivilegedRoleGovernanceForMember } from "../modules/members/services/privileged-role-governance.js";
import { getRequestIp } from "./request-ip.js";
import { checkHierarchyAccess } from "../modules/hierarchy/hierarchy-access-guard.js";
import { readIdToken } from "./auth-token.js";
import { setAuthContext } from "./auth-context.js";
import { resolveMemberRoleNameCached } from "./role-cache.js";
import { getMemberByFirebaseUidPg, getMemberByIdPg, getMemberAuthContextPg } from "../lib/postgres/members-postgres.service.js";

const PUBLIC_API_ROUTES = [
  { method: "POST", pattern: /^\/api\/auth\/session-bootstrap$/ },
  { method: "GET", pattern: /^\/api\/auth\/sign-in-client-extras$/ },
  { method: "POST", pattern: /^\/api\/auth\/send-verification-email$/ },
  { method: "POST", pattern: /^\/api\/auth\/access-request$/ },
  { method: "POST", pattern: /^\/api\/auth\/promote-pending-member$/ },
  { method: "POST", pattern: /^\/api\/auth\/complete-first-login$/ },
  { method: "POST", pattern: /^\/api\/auth\/notify-password-reset$/ },
  { method: "POST", pattern: /^\/api\/auth\/notify-email-verified$/ },
  { method: "GET", pattern: /^\/api\/public\/invites\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/public\/invites\/[^/]+\/register$/ },
  { method: "GET", pattern: /^\/api\/public\/member-transfer-requests\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/activity\/agent\/link\/init$/ },
  { method: "POST", pattern: /^\/api\/activity\/agent\/link\/exchange$/ },
  { method: "POST", pattern: /^\/api\/activity\/agent\/reauth$/ },
];

export function isPublicApiRoute(method, pathname) {
  const normalized = pathname.replace(/^\/api\/v1/, "/api");
  return PUBLIC_API_ROUTES.some((route) => route.method === method && route.pattern.test(normalized));
}

const MUST_CHANGE_PASSWORD_ALLOWED = [
  { method: "POST", pattern: /^\/api\/auth\/session-bootstrap$/ },
  { method: "POST", pattern: /^\/api\/auth\/complete-first-login$/ },
  { method: "POST", pattern: /^\/api\/auth\/promote-pending-member$/ },
  { method: "GET", pattern: /^\/api\/auth\/password-policy$/ },
  { method: "GET", pattern: /^\/api\/auth\/firebase-config$/ },
  { method: "GET", pattern: /^\/api\/auth\/readiness$/ },
];

function isMustChangePasswordAllowedRoute(method, pathname) {
  const normalized = pathname.replace(/^\/api\/v1/, "/api");
  return MUST_CHANGE_PASSWORD_ALLOWED.some(
    (route) => route.method === method && route.pattern.test(normalized),
  );
}

export async function authenticateRequest(req, url, db) {
  const auth = getAuthAdmin();
  if (!auth) {
    return { ok: false, status: 503, error: "Authentication service is not configured." };
  }

  const idToken = readIdToken(req, url);
  if (!idToken) {
    return { ok: false, status: 401, error: "Authorization Bearer token is required." };
  }

  try {
    const decoded = await auth.verifyIdToken(idToken);
    const userRecord = await auth.getUser(decoded.uid);
    if (userRecord.disabled) {
      return { ok: false, status: 403, error: "This account has been disabled.", code: "ACCOUNT_DISABLED" };
    }

    if (userRecord.tokensValidAfterTime) {
      const tokensValidAfter = new Date(userRecord.tokensValidAfterTime).getTime();
      const issuedAt = decoded.iat * 1000;
      if (Number.isFinite(tokensValidAfter) && issuedAt < tokensValidAfter) {
        return {
          ok: false,
          status: 401,
          error: "Your session was ended from another page. Please sign in again.",
          code: "SESSION_REVOKED",
        };
      }
    }

    const memberData = await getMemberAuthContextPg(decoded.uid);
    const mustChangePassword = memberData?.must_change_password === true;

    if (mustChangePassword && !isMustChangePasswordAllowedRoute(req.method ?? "GET", url.pathname)) {
      return {
        ok: false,
        status: 403,
        error: "Password change is required before accessing this resource.",
        code: "MUST_CHANGE_PASSWORD",
      };
    }

    if (requiresEmailVerification(userRecord, { mustChangePassword, memberData })) {
      return {
        ok: false,
        status: 403,
        error: "Email verification is required.",
        code: "EMAIL_NOT_VERIFIED",
      };
    }

    if (!memberData) {
      if (mustChangePassword) {
        const context = {
          uid: decoded.uid,
          memberId: "",
          roleName: "Viewer",
          email: typeof decoded.email === "string" ? decoded.email : undefined,
        };
        setAuthContext(req, context);
        return { ok: true, context, mustChangePassword: true };
      }
      return { ok: false, status: 404, error: "Member profile not found for this account." };
    }

    const memberId = String(memberData.id || memberData.member_id);
    const roleName = String(memberData.role_name || "Viewer");
    const gov = await enforcePrivilegedRoleGovernanceForMember(db, memberId, {
      requestIp: getRequestIp(req),
    });
    if (!gov.ok) {
      return {
        ok: false,
        status: gov.status,
        error: gov.error,
        code: gov.code,
      };
    }
    const context = {
      uid: decoded.uid,
      memberId,
      roleName,
      roleId: typeof memberData.role_id === "string" ? memberData.role_id : "",
      hierarchyLevel: typeof memberData.hierarchy_level === "number" ? memberData.hierarchy_level : 10,
      isManagement: Boolean(memberData.is_management),
      securityStamp: typeof memberData.security_stamp === "string" ? memberData.security_stamp : undefined,
      email: typeof decoded.email === "string" ? decoded.email : undefined,
    };
    setAuthContext(req, context);
    return { ok: true, context };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired authentication token." };
  }
}

export async function enforceApiAuthentication(req, url, db) {
  const requestIp = getRequestIp(req);
  const deviceGate = await assertDeviceNotBanned(db, requestIp);
  if (!deviceGate.ok) {
    return {
      allowed: false,
      status: deviceGate.status,
      error: deviceGate.error,
      code: deviceGate.code,
    };
  }

  if (isPublicApiRoute(req.method ?? "GET", url.pathname)) {
    return { allowed: true };
  }
  const result = await authenticateRequest(req, url, db);
  if (!result.ok) {
    return {
      allowed: false,
      status: result.status,
      error: result.error,
      code: result.code,
    };
  }

  if (result.context?.memberId) {
    const memberData = await getMemberByIdPg(result.context.memberId);
    const banGate = await assertMemberNotBanned(db, {
      email: result.context.email || "",
      memberId: result.context.memberId,
    });
    if (!banGate.ok) {
      return {
        allowed: false,
        status: banGate.status,
        error: banGate.error,
        code: banGate.code,
      };
    }
    const hierarchyGate = checkHierarchyAccess(memberData, url.pathname, req.method ?? "GET");
    if (hierarchyGate.blocked) {
      return {
        allowed: false,
        status: 403,
        error: hierarchyGate.error || "Hierarchy assignment required.",
        code: hierarchyGate.code,
      };
    }
  }

  return { allowed: true };
}
