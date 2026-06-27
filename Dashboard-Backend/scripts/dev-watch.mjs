import { spawn } from "node:child_process";
import { readdirSync, statSync, watch } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const nodeArgs = ["--use-system-ca", "--env-file-if-exists=.env", "index.js"];
const watchedRoots = [
  join(root, "src"),
  join(root, "index.js"),
  join(root, "server.js"),
  join(root, ".env"),
];
const sourcePattern = /\.(js|mjs|cjs)$/i;

let child = null;
let restartTimer = null;
let lastSnapshot = "";

function listSourceFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(fullPath, files);
      continue;
    }
    if (sourcePattern.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function snapshotWatchTargets() {
  const files = [];
  for (const target of watchedRoots) {
    const stats = statSync(target);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(target));
      continue;
    }
    files.push(target);
  }

  return files
    .map((file) => {
      const { mtimeMs, size } = statSync(file);
      return `${file}|${mtimeMs}|${size}`;
    })
    .sort()
    .join("\n");
}

function startServer() {
  if (child) {
    child.kill("SIGTERM");
    child = null;
  }

  child = spawn(process.execPath, nodeArgs, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (signal === "SIGTERM" || signal === "SIGINT") {
      return;
    }
    process.exit(code ?? 1);
  });
}

function scheduleRestart(reason) {
  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    const nextSnapshot = snapshotWatchTargets();
    if (nextSnapshot === lastSnapshot) {
      return;
    }
    lastSnapshot = nextSnapshot;
    console.log(`\nRestarting (${reason})...`);
    startServer();
  }, 400);
}

function watchTarget(target) {
  if (!statSync(target, { throwIfNoEntry: false })) {
    return;
  }
  watch(target, { recursive: statSync(target).isDirectory() }, (_event, filename) => {
    if (filename && !sourcePattern.test(filename)) {
      return;
    }
    scheduleRestart(filename || target);
  });
}

function shutdown(signal) {
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  if (child) {
    child.kill(signal);
  }
  process.exit(0);
}

lastSnapshot = snapshotWatchTargets();
startServer();

for (const target of watchedRoots) {
  watchTarget(target);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
