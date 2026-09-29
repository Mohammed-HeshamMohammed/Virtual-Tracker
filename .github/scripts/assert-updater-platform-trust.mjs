import fs from "node:fs";

const lockPath = process.argv[2] || "Tauri-App-Extension/src-tauri/Cargo.lock";
const text = fs.readFileSync(lockPath, "utf8");
const packages = text.split(/\r?\n\[\[package\]\]\r?\n/);
const updater = packages.find((block) => /^name = "tauri-plugin-updater"$/m.test(block));
if (!updater) throw new Error("Cargo.lock has no tauri-plugin-updater package");
const reqwestVersion = updater.match(/"reqwest ([0-9.]+)"/)?.[1];
if (!reqwestVersion) throw new Error("tauri-plugin-updater does not identify its reqwest package");
const reqwest = packages.find((block) =>
  /^name = "reqwest"$/m.test(block) && new RegExp(`^version = "${reqwestVersion.replaceAll(".", "\\.")}"$`, "m").test(block),
);
if (!reqwest) throw new Error(`Cargo.lock has no reqwest ${reqwestVersion} package`);
if (!/"rustls-platform-verifier"/.test(reqwest)) {
  throw new Error(`Updater reqwest ${reqwestVersion} does not use the OS trust store; corporate TLS interception would fail`);
}
console.log(`Updater TLS trust verified: reqwest ${reqwestVersion} uses rustls-platform-verifier.`);
