// A.4 step 4 / F.2. The updater only trusts a signature made by the private
// half of the pubkey compiled into the app. Getting this wrong publishes a
// latest.json every installed agent rejects - a hard stop (§5.2), unrecoverable
// without touching each machine - so this must fail before the paid matrix build.
//
// A minisign public key blob is 2 bytes algorithm ("Ed") + 8 bytes keynum (key
// id) + 32 bytes public key, base64-encoded as line 2 of the 2-line key file,
// which is itself base64-encoded once more as the single-line value tauri.conf.json
// and this whole file store. A signature blob has the same 2+8-byte prefix
// (algorithm + keynum) before the 64-byte signature. Comparing the raw 8
// keynum bytes at that fixed offset - not a hex string pulled from a comment,
// which minisign does not zero-pad and which the SIGNATURE's own comment does
// not even contain - is the only reliable way to tell whether a signature was
// made by the key a given pubkey expects.
import { readFileSync } from "node:fs";

function keynumFromWholeKeyBlob(wholeBase64) {
  const whole = Buffer.from(wholeBase64.trim(), "base64").toString("utf8");
  const line2 = whole.trim().split("\n")[1];
  const bytes = Buffer.from(line2, "base64");
  return bytes.subarray(2, 10);
}

const conf = JSON.parse(readFileSync("Tauri-App-Extension/src-tauri/tauri.conf.json", "utf8"));
const shippedPubkey = conf.plugins.updater.pubkey;
if (!shippedPubkey) {
  console.error("::error::tauri.conf.json has no plugins.updater.pubkey - nothing to verify against.");
  process.exit(1);
}

const sigFileWhole = readFileSync(process.argv[2], "utf8");

const pubKeynum = keynumFromWholeKeyBlob(shippedPubkey);
const sigKeynum = keynumFromWholeKeyBlob(sigFileWhole);

const fmt = (b) => b.toString("hex").toUpperCase();
console.log(`shipped pubkey keynum : ${fmt(pubKeynum)}`);
console.log(`signing key keynum    : ${fmt(sigKeynum)}`);

if (!pubKeynum.equals(sigKeynum)) {
  console.error(
    `::error::Signing key (${fmt(sigKeynum)}) does not match the pubkey shipped in tauri.conf.json (${fmt(pubKeynum)}). Every installed agent would reject this release.`,
  );
  process.exit(1);
}
console.log("✅ signing key matches the shipped pubkey");
