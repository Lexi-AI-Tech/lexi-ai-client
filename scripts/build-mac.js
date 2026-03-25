const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function parseDotenv(contents) {
  const env = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const contents = fs.readFileSync(filePath, "utf8");
  return parseDotenv(contents);
}

function redactKey(key) {
  // Never print secrets. Keep logs minimal.
  return key;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    console.log(
      [
        "Lexi AI macOS build helper",
        "",
        "Usage:",
        "  npm run build:mac",
        "",
        "Env loading order (does not override already-set env):",
        "  1) .env.build.mac (preferred)",
        "  2) .env",
      ].join("\n"),
    );
    process.exit(0);
  }

  const root = path.resolve(__dirname, "..");

  // Prefer a mac-specific env file if present; fall back to .env.
  const envFromFile = {
    ...loadEnvFile(path.join(root, ".env.build.mac")),
    ...loadEnvFile(path.join(root, ".env")),
  };

  // Merge into process.env without overriding already-set values (CI / shell wins).
  for (const [k, v] of Object.entries(envFromFile)) {
    if (process.env[k] == null || process.env[k] === "") {
      process.env[k] = v;
    }
  }

  // Some environments set CI=1/0, but Tauri expects boolean strings.
  if (process.env.CI === "1") process.env.CI = "true";
  if (process.env.CI === "0") process.env.CI = "false";

  const required = [
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
  ];

  const missing = required.filter(
    (k) => !process.env[k] || String(process.env[k]).trim() === "",
  );
  if (missing.length > 0) {
    console.error(
      [
        "Missing required env vars for mac build:",
        ...missing.map((k) => `- ${redactKey(k)}`),
        "",
        "Set them in your shell or add them to `.env.build.mac` (preferred) or `.env`.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const child = spawn("npm", ["run", "build"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code) => process.exit(code ?? 1));
  child.on("error", () => process.exit(1));
}

main();
