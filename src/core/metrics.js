/**
 * Metrics collector — in-memory ring buffers for the monitoring dashboard.
 * Zero external dependencies; sampled on every request.
 */

const RING_SIZE = 600; // 10 minutes at 1s resolution

/** @type {{ ts: number, method: string, path: string, status: number, ms: number, ip: string, ua: string }[]} */
const requestLog = [];

/** @type {{ ts: number, event: string, ip: string, detail: string }[]} */
const securityLog = [];

const counters = {
  total: 0,
  ok: 0,
  client_error: 0,
  server_error: 0,
  auth_fail: 0,
  auth_ok: 0,
};

/** @type {{ ts: number, rps: number, p50: number, p95: number, err_rate: number }[]} */
const timeSeries = [];

/** @type {number[]} – rolling window of response times (last 1000 requests) */
const _rtWindow = [];

let _lastTsFlush = Date.now();
let _rtInWindow = 0;
let _errInWindow = 0;

/** Record a completed request. */
export function recordRequest({ method, path, status, ms, ip = "-", ua = "-" }) {
  const ts = Date.now();

  counters.total++;
  if (status < 400) counters.ok++;
  else if (status < 500) counters.client_error++;
  else counters.server_error++;

  if (status === 401 || status === 403) counters.auth_fail++;

  _rtWindow.push(ms);
  if (_rtWindow.length > 1000) _rtWindow.shift();
  _rtInWindow++;
  if (status >= 500) _errInWindow++;

  requestLog.push({ ts, method, path, status, ms, ip, ua: (ua || "-").slice(0, 120) });
  if (requestLog.length > RING_SIZE) requestLog.shift();

  // Flush a time-series sample every second
  if (ts - _lastTsFlush >= 1000) {
    const elapsed = (ts - _lastTsFlush) / 1000;
    const rps = _rtInWindow / elapsed;
    const sorted = [..._rtWindow].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const err_rate = _rtInWindow > 0 ? (_errInWindow / _rtInWindow) * 100 : 0;
    timeSeries.push({ ts, rps: parseFloat(rps.toFixed(2)), p50, p95, err_rate: parseFloat(err_rate.toFixed(1)) });
    if (timeSeries.length > RING_SIZE) timeSeries.shift();
    _rtInWindow = 0;
    _errInWindow = 0;
    _lastTsFlush = ts;
  }
}

/** Record a security event (auth failure, suspicious request, etc.). */
export function recordSecurityEvent({ event, ip = "-", detail = "" }) {
  securityLog.push({ ts: Date.now(), event, ip, detail: detail.slice(0, 200) });
  if (securityLog.length > 500) securityLog.shift();
}

/** Record a successful auth. */
export function recordAuthOk() {
  counters.auth_ok++;
}

/** Snapshot all metrics for the dashboard. */
export function getMetricsSnapshot() {
  const mem = process.memoryUsage();
  const uptime = process.uptime();

  // Percentiles from full window
  const sorted = [..._rtWindow].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;

  return {
    uptime,
    counters: { ...counters },
    latency: { p50, p95, p99 },
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
    },
    timeSeries: timeSeries.slice(-120), // last 2 minutes
    recentRequests: requestLog.slice(-50).reverse(),
    securityEvents: securityLog.slice(-100).reverse(),
  };
}
