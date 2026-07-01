import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const child = spawn(
  process.execPath,
  ["--use-system-ca", "--env-file-if-exists=.env", "--watch", "index.js"],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development" },
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.exit(0);
  process.exit(code ?? 1);
});
