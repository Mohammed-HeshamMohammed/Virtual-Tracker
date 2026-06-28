const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = __dirname;
const serverJs = path.join(root, ".next", "standalone", "server.js");

if (!existsSync(serverJs)) {
  console.error("No production build found. Run: npm run build");
  process.exit(1);
}

const port = (process.env.PORT ?? "3001").trim() || "3001";
const nodeVersion = process.version;
const version = require("./package.json").version || "0.1.0";

const box = `
╔══════════════════════════════════════════════════════╗
║  Landing-Web App                                     ║
╠══════════════════════════════════════════════════════╣
║  Version : ${version.padEnd(42)}║
║  Port    : ${port.padEnd(42)}║
║  Node    : ${nodeVersion.padEnd(42)}║
║  Env     : production                                ║
╚══════════════════════════════════════════════════════╝
Landing-Web listening on http://localhost:${port}
`;

console.log(box.trim());

const result = spawnSync(process.execPath, [serverJs], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: port,
    HOSTNAME: process.env.HOSTNAME ?? "0.0.0.0",
  },
});

process.exit(result.status ?? 1);
