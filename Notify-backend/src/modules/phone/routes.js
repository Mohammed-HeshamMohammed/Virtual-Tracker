import { sendJson } from "../../http/response.js";
import { requireInternalAuth } from "../../http/internal-auth.js";
import { validatePhoneNumber } from "./phone-validation.service.js";

export async function routePhone(req, res, url, origin) {
  if (!url.pathname.startsWith("/api/notify/phone")) return false;

  if (!requireInternalAuth(req, res, origin)) return true;

  if (url.pathname === "/api/notify/phone/validate" && req.method === "POST") {
    const body = await readBody(req);
    try {
      const result = validatePhoneNumber({
        phone: typeof body.phone === "string" ? body.phone : "",
        defaultCountry: typeof body.defaultCountry === "string" ? body.defaultCountry : undefined,
        required: body.required === true,
        label: typeof body.label === "string" ? body.label : undefined,
      });
      sendJson(res, origin, 200, { success: true, data: result });
    } catch (err) {
      sendJson(res, origin, 400, {
        success: false,
        error: err instanceof Error ? err.message : "Invalid phone number.",
      });
    }
    return true;
  }

  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}
