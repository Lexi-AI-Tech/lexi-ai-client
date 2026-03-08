const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CLIENT_DIR = path.join(__dirname, "..");
const TAURI_DIR = path.join(CLIENT_DIR, "src-tauri");
require("dotenv").config({ path: path.join(CLIENT_DIR, ".env") });

const TARGET = "darwin"; // Match Tauri's default target name

// Config (Read from Environment)
const API_URL = process.env.API_URL || "http://localhost:3000/api/v1/updates";
const API_KEY = process.env.APP_RELEASES_API_KEY;
const TAURI_SIGNING_PRIVATE_KEY = process.env.TAURI_SIGNING_PRIVATE_KEY;

const APPLE_ID = process.env.APPLE_ID;
const APPLE_PASSWORD = process.env.APPLE_PASSWORD;
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;

if (
  !API_KEY ||
  !TAURI_SIGNING_PRIVATE_KEY ||
  !APPLE_ID ||
  !APPLE_PASSWORD ||
  !APPLE_TEAM_ID
) {
  console.error("❌ Error: Missing required environment variables in .env");
  console.error(
    "Ensure APP_RELEASES_API_KEY, TAURI_SIGNING_PRIVATE_KEY, APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID are set.",
  );
  process.exit(1);
}

// 1. Get Version & Validate
const packageJson = JSON.parse(
  fs.readFileSync(path.join(CLIENT_DIR, "package.json"), "utf-8"),
);
const tauriConf = JSON.parse(
  fs.readFileSync(path.join(TAURI_DIR, "tauri.conf.json"), "utf-8"),
);
const cargoToml = fs.readFileSync(path.join(TAURI_DIR, "Cargo.toml"), "utf-8");

const version = packageJson.version;
const tauriVersion = tauriConf.version;

// Extract version from Cargo.toml using regex
const cargoMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
const cargoVersion = cargoMatch ? cargoMatch[1] : null;

if (version !== tauriVersion || version !== cargoVersion) {
  console.error("❌ Version mismatch detected!");
  console.error(`   package.json version:    ${version}`);
  console.error(`   tauri.conf.json version: ${tauriVersion}`);
  console.error(`   Cargo.toml version:      ${cargoVersion || "Not found"}`);
  console.error("");
  console.error(
    "All three files must have the same version before publishing.",
  );
  console.error("Please update them to match and try again.");
  process.exit(1);
}

console.log(`📦 Preparing release for version: ${version}`);

// 2. Build Tauri App
console.log("🚀 Building Tauri app...");
// Create a clean environment object, set the private key, and prevent interactive prompts
const buildEnv = { ...process.env };
buildEnv.TAURI_SIGNING_PRIVATE_KEY = TAURI_SIGNING_PRIVATE_KEY;
buildEnv.CI = "true";
buildEnv.TAURI_SIGNING_PRIVATE_KEY_PASSWORD =
  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;

try {
  const buildCmd = `APPLE_ID="${APPLE_ID}" APPLE_PASSWORD="${APPLE_PASSWORD}" APPLE_TEAM_ID="${APPLE_TEAM_ID}" npm run tauri build -- --target aarch64-apple-darwin --bundles app,updater`;
  execSync(buildCmd, {
    cwd: CLIENT_DIR,
    stdio: "inherit", // Outputs build logs to console
    env: buildEnv,
  });
} catch (error) {
  console.error("❌ Tauri build failed.");
  process.exit(1);
}

// 3. Locate Artifacts
const bundleDir = path.join(
  TAURI_DIR,
  "target/aarch64-apple-darwin/release/bundle",
);
const macosDir = path.join(bundleDir, "macos");
const dmgDir = path.join(bundleDir, "dmg");

const tarGzFilename = `Lexi AI.app.tar.gz`;
const tarGzPath = path.join(macosDir, tarGzFilename);
const sigPath = `${tarGzPath}.sig`;

const dmgFilename = `Lexi AI_${version}_aarch64.dmg`;
const dmgPath = path.join(dmgDir, dmgFilename);

if (
  !fs.existsSync(tarGzPath) ||
  !fs.existsSync(sigPath) ||
  !fs.existsSync(dmgPath)
) {
  console.error(`❌ Cannot find build artifacts.`);
  console.error(`Expected: ${tarGzPath}`);
  console.error(`Expected: ${sigPath}`);
  console.error(`Expected: ${dmgPath}`);
  process.exit(1);
}

// 4. Read Signature
const signatureText = fs.readFileSync(sigPath, "utf-8").trim();
console.log(`✅ Loaded Minisign signature.`);

// 5. Create FormData payload
console.log(`🌐 Uploading bundle to Lexi AI Server: ${API_URL}`);

// Read changelog (Required)
let notes = "";
const changelogPath = path.join(CLIENT_DIR, "changelog", `${version}.md`);
if (fs.existsSync(changelogPath)) {
  notes = fs.readFileSync(changelogPath, "utf-8").trim();
  console.log(`📝 Found changelog for version ${version}.`);
} else {
  console.error(
    `❌ Error: No changelog found for version ${version} at changelog/${version}.md`,
  );
  console.error("Please create a changelog file before publishing a release.");
  process.exit(1);
}

const formData = new FormData();
formData.append("version", version);
formData.append("target", TARGET);
formData.append("notes", notes);
formData.append("updater_signature", signatureText);

const tarGzBuffer = fs.readFileSync(tarGzPath);
formData.append(
  "updater_file",
  new Blob([tarGzBuffer], { type: "application/gzip" }),
  tarGzFilename,
);

const dmgBuffer = fs.readFileSync(dmgPath);
formData.append(
  "installer_file",
  new Blob([dmgBuffer], { type: "application/octet-stream" }),
  dmgFilename,
);

// 6. Push to Server
async function uploadRelease() {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "X-API-Key": API_KEY,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log("🎉 Successfully published release!");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("❌ Failed to upload release:", error.message);
    process.exit(1);
  }
}

uploadRelease();
