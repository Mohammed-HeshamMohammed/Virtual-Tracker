// The agent's legacy build (Windows 7, 8 and 8.1; Tauri-App-Extension/PLAN-windows-7-legacy-build.md)
// only works on the Tauri 2.11 line. Tauri 2.12 dropped Windows 7: wry 0.57 moved to
// windows-rs 0.62, which links combase.dll, and the result will not start there. Cargo.toml
// pins the versions; this catches a lockfile that moved anyway (a `cargo update`, a merge).
import fs from "node:fs";

const lockPath = process.argv[2] || "Tauri-App-Extension/src-tauri/Cargo.lock";
const text = fs.readFileSync(lockPath, "utf8");
const versions = (name) =>
  text
    .split(/\r?\n\[\[package\]\]\r?\n/)
    .filter((block) => new RegExp(`^name = "${name}"$`, "m").test(block))
    .map((block) => block.match(/^version = "([^"]+)"$/m)?.[1])
    .filter(Boolean);

// Each crate, and the version line it has to stay on.
const held = {
  tauri: "2.11.",
  "tauri-runtime-wry": "2.11.",
  wry: "0.55.",
  tao: "0.35.",
  "webview2-com": "0.38.",
};

const problems = [];
for (const [name, line] of Object.entries(held)) {
  const found = versions(name);
  if (!found.length) problems.push(`${name} is missing from ${lockPath}`);
  for (const version of found) {
    if (!version.startsWith(line)) problems.push(`${name} ${version} is off the ${line}x line the Windows 7 build needs`);
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`::error::${problem}`);
  console.error("Tauri past 2.11 cannot build for Windows 7. See Tauri-App-Extension/PLAN-windows-7-legacy-build.md, 'Dependency freeze'.");
  process.exit(1);
}
console.log(`Windows 7 stack held: ${Object.entries(held).map(([name]) => `${name} ${versions(name).join("/")}`).join(", ")}.`);
