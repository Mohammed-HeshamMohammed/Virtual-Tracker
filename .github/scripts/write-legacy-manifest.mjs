// Writes latest-legacy.json: the update manifest for the agent's legacy build (Windows 7, 8 and
// 8.1). It is a release asset of its own so the legacy job never touches latest.json, which the
// modern jobs write; Landing-Backend serves it to agents that ask the `windows-legacy` feed.
//
// Usage: node write-legacy-manifest.mjs <version> <arch> <asset-url> <signature-file> <out-file>
import fs from "node:fs";

const [version, arch, url, signatureFile, out] = process.argv.slice(2);
if (!version || !arch || !url || !signatureFile || !out) {
  console.error("Usage: node write-legacy-manifest.mjs <version> <arch> <asset-url> <signature-file> <out-file>");
  process.exit(2);
}
const signature = fs.readFileSync(signatureFile, "utf8").trim();
if (!signature) throw new Error(`${signatureFile} is empty: the installer was not signed for the updater`);

const manifest = {
  version,
  notes: `Agent v${version} for Windows 7, 8 and 8.1`,
  pub_date: new Date().toISOString(),
  platforms: { [`windows-legacy-${arch}`]: { url, signature } },
};
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${out} for windows-legacy-${arch} ${version}.`);
