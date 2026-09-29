const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const tag = process.env.RELEASE_TAG;
const version = process.env.RELEASE_VERSION;
const updateBase = (process.env.UPDATE_BASE_URL || "https://api.myvirtualtracker.com").replace(/\/$/, "");
const requiredPlatforms = (process.env.REQUIRED_UPDATE_PLATFORMS || "windows-x86_64,linux-x86_64,darwin-aarch64,darwin-x86_64")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!token || !repository || !tag || !version) {
  throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, RELEASE_TAG and RELEASE_VERSION are required");
}

const githubHeaders = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "virtual-tracker-release-verifier",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function githubJson(url, accept = "application/vnd.github+json") {
  const response = await fetch(url, { headers: { ...githubHeaders, Accept: accept } });
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${await response.text()}`);
  return response.json();
}

function selectEntry(platforms, key) {
  if (key === "windows-x86_64") return platforms["windows-x86_64-nsis"] ?? platforms[key];
  return platforms[key];
}

async function verifyPublishedManifest() {
  const release = await githubJson(`https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`);
  if (release.draft || release.prerelease) throw new Error(`${tag} is not a published stable release`);
  const latest = release.assets?.find((asset) => String(asset.name).toLowerCase() === "latest.json");
  if (!latest) throw new Error(`${tag} has no latest.json asset`);
  const manifest = await githubJson(latest.url, "application/octet-stream");
  if (manifest.version !== version) throw new Error(`latest.json version ${manifest.version} does not match ${version}`);
  const assetNames = new Set((release.assets || []).map((asset) => asset.name));
  for (const key of requiredPlatforms) {
    const entry = selectEntry(manifest.platforms || {}, key);
    if (!entry?.url || !entry?.signature) throw new Error(`latest.json is missing signed platform ${key}`);
    const fileName = decodeURIComponent(new URL(entry.url).pathname.split("/").pop() || "");
    if (!assetNames.has(fileName)) throw new Error(`${key} points to missing release asset ${fileName}`);
  }
  console.log(`GitHub release ${tag} contains signed updater entries for ${requiredPlatforms.join(", ")}.`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function verifyLiveEndpoint() {
  let lastError = null;
  for (let attempt = 1; attempt <= 14; attempt += 1) {
    try {
      const latestResponse = await fetch(`${updateBase}/api/agent/update/latest`, { headers: { "User-Agent": "virtual-tracker-release-verifier" } });
      if (!latestResponse.ok) throw new Error(`latest endpoint returned ${latestResponse.status}`);
      const latest = await latestResponse.json();
      if (latest.version !== version) throw new Error(`live endpoint still serves ${latest.version || "no version"}`);

      const healthResponse = await fetch(`${updateBase}/api/agent/update/health`, { headers: { "User-Agent": "virtual-tracker-release-verifier" } });
      if (!healthResponse.ok) throw new Error(`health endpoint returned ${healthResponse.status}: ${await healthResponse.text()}`);
      const health = await healthResponse.json();
      if (!health.ok || health.version !== version) throw new Error(`health endpoint did not confirm ${version}`);
      for (const key of requiredPlatforms) {
        if (!health.platforms?.includes(key)) throw new Error(`live endpoint did not verify ${key}`);
      }
      console.log(`Live update endpoint serves ${version} with every required platform.`);
      return;
    } catch (error) {
      lastError = error;
      console.log(`Endpoint verification attempt ${attempt}/14: ${error.message}`);
      if (attempt < 14) await sleep(30_000);
    }
  }
  throw lastError;
}

await verifyPublishedManifest();
await verifyLiveEndpoint();
