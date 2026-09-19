import { getEnv } from "../../config/env.js";
import { normalizeAgentVersion } from "./version.js";

const CACHE_MS = 5 * 60 * 1000;
let cached = null;

export async function getLatestAgentRelease() {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_MS) return cached.value;

  const base = getEnv().landing.backendUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/api/agent/update/latest`, {
    headers: { "User-Agent": "VirtualTracker-DashboardBackend" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Latest tracker release is unavailable (${response.status})`);
  const payload = await response.json();
  const version = normalizeAgentVersion(payload?.version);
  if (!version) throw new Error("Latest tracker release returned an invalid version");

  const value = {
    version,
    notes: typeof payload?.notes === "string" ? payload.notes.slice(0, 2000) : "",
    pubDate: typeof payload?.pub_date === "string" ? payload.pub_date : null,
  };
  cached = { fetchedAt: now, value };
  return value;
}

export function __resetLatestAgentReleaseForTests() {
  cached = null;
}
