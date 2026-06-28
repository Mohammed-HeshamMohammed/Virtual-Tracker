const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = __dirname;
const serverJs = path.join(root, ".next", "standalone", "server.js");

if (!existsSync(serverJs)) {
  console.error("No production build found. Run: npm run build");
  process.exit(1);
}

const port = (process.env.PORT ?? "3000").trim() || "3000";

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
