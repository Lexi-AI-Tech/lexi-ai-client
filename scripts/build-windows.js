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

function main() {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    console.log(
      [
        "Lexi AI Windows build helper",
        "",
        "Usage:",
        "  npm run build:windows",
        "",
        "Runs `tauri build` for the default Windows target (x86_64-pc-windows-msvc)",
        "with the `custom-protocol` feature (same as production CI).",
        "",
        "Env loading order (does not override already-set env):",
        "  1) .env.build.windows (preferred)",
        "  2) .env",
        "",
        "Required for signed updater artifacts (same as CI):",
        "  TAURI_SIGNING_PRIVATE_KEY",
        "  TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
      ].join("\n"),
    );
    process.exit(0);
  }

  const root = path.resolve(__dirname, "..");

  const envFromFile = {
    ...loadEnvFile(path.join(root, ".env.build.windows")),
    ...loadEnvFile(path.join(root, ".env")),
  };

  for (const [k, v] of Object.entries(envFromFile)) {
    if (process.env[k] == null || process.env[k] === "") {
      process.env[k] = v;
    }
  }

  if (process.env.CI === "1") process.env.CI = "true";
  if (process.env.CI === "0") process.env.CI = "false";

  const required = [
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  ];

  const missing = required.filter(
    (k) => !process.env[k] || String(process.env[k]).trim() === "",
  );
  if (missing.length > 0) {
    console.error(
      [
        "Missing required env vars for Windows build:",
        ...missing.map((k) => `- ${k}`),
        "",
        "Set them in your shell or add them to `.env.build.windows` (preferred) or `.env`.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const tauriArgs = ["tauri", "build", "--", "--features", "custom-protocol"];
  const child = spawn("npx", tauriArgs, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    // Windows: `npx` is `npx.cmd`; spawn without a shell often fails with ENOENT.
    shell: process.platform === "win32",
  });

  child.on("exit", (code) => process.exit(code ?? 1));
  child.on("error", (err) => {
    console.error("Failed to start Tauri build:", err.message);
    process.exit(1);
  });
}

main();
