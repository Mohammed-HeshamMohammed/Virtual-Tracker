const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = __dirname;
const serverJs = path.join(root, ".next", "standalone", "server.js");

if (!existsSync(serverJs)) {
  console.error("No production build found. Run: npm run build");
  process.exit(1);
}

const port = (process.env.PORT || "").trim();
const nodeVersion = process.version;
const version = require("./package.json").version || "0.1.0";

const box = `
╔══════════════════════════════════════════════════════╗
║  Landing-Web App                                     ║
╠══════════════════════════════════════════════════════╣
║  Version : ${version.padEnd(42)}║
║  Port    : ${(port || "default").padEnd(42)}║
║  Node    : ${nodeVersion.padEnd(42)}║
║  Env     : production                                ║
╚══════════════════════════════════════════════════════╝
Landing-Web listening${port ? ` on http://localhost:${port}` : ""}
`;

console.log(box.trim());

// Docker sets HOSTNAME to the container ID — bind 0.0.0.0 unless HOST is set.
const spawnEnv = {
  ...process.env,
  NODE_ENV: "production",
  HOSTNAME: process.env.HOST || "0.0.0.0",
};
if (port) {
  spawnEnv.PORT = port;
}

const result = spawnSync(process.execPath, [serverJs], {
  cwd: root,
  stdio: "inherit",
  env: spawnEnv,
});

process.exit(result.status ?? 1);
