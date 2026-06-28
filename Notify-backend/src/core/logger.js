import { getEnv } from "../config/env.js";

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function padBoxLine(content, width) {
  const pad = Math.max(0, width - stripAnsi(content).length);
  return content + " ".repeat(pad);
}

export function logStartup({ version, port, nodeEnv, routes }) {
  const reset = "\x1b[0m";
  const cyan = "\x1b[36m";
  const green = "\x1b[32m";
  const yellow = "\x1b[33m";
  const boxWidth = 54;
  const border = "═".repeat(boxWidth);
  const row = (content) => `${cyan}║${reset}${padBoxLine(content, boxWidth)}${cyan}║${reset}`;

  const lines = [
    "",
    `${cyan}╔${border}╗${reset}`,
    row(`  ${green}Notify-Backend API${reset}`),
    `${cyan}╠${border}╣${reset}`,
    row(`  Version : ${yellow}${version}${reset}`),
    row(`  Port    : ${yellow}${port}${reset}`),
    row(`  Node    : ${yellow}${process.version}${reset}`),
    row(`  Env     : ${yellow}${nodeEnv}${reset}`),
    `${cyan}╠${border}╣${reset}`,
    row("  Registered routes:"),
    ...routes.map((route) => {
      const label = route.padEnd(42, " ").substring(0, 42);
      return row(`    ${green}✓${reset} ${label}`);
    }),
    `${cyan}╚${border}╝${reset}`,
    `${green}Server ready at http://localhost:${port}${reset}`,
    "",
  ];

  console.log(lines.join("\n"));
}

export function logError(err, context = "") {
  const timestamp = new Date().toISOString();
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[${timestamp}] \x1b[31mERROR\x1b[0m ${context}: ${msg}`);
  if (err instanceof Error && err.stack && !getEnv().isProduction) {
    console.error(err.stack.split("\n").slice(0, 3).join("\n"));
  }
}

export function logRequest(req, url) {
  const timestamp = new Date().toISOString();
  const safeUrl = url?.pathname || req.url || "/";
  console.log(`[${timestamp}] → ${req.method} ${safeUrl}`);
}

export function logResponse(req, res, url, ms) {
  const timestamp = new Date().toISOString();
  const path = url?.pathname || req.url || "/";
  const status = res.statusCode || 200;
  const color =
    status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : "\x1b[32m";
  const reset = "\x1b[0m";
  console.log(`[${timestamp}] ← ${color}${status}${reset} ${req.method} ${path} (${ms}ms)`);
}
