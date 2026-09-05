"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");
const { prepareWeb } = require("./prepare-web.cjs");

function assertMacHost(platform = process.platform, arch = process.arch, version) {
  if (platform !== "darwin" || arch !== "arm64") {
    throw new Error("Scratchpad requires an Apple Silicon Mac and arm64 Node.js. Build and launch on macOS Tahoe 26 or later.");
  }
  const productVersion = version || execFileSync("/usr/bin/sw_vers", ["-productVersion"], { encoding: "utf8" }).trim();
  if (Number(productVersion.split(".")[0]) < 26) throw new Error("Scratchpad requires macOS Tahoe 26 or later.");
}

function assertReleaseCredentials(env = process.env) {
  if (!/^Developer ID Application: .+/.test(env.APPLE_SIGNING_IDENTITY || "")) {
    throw new Error("Set APPLE_SIGNING_IDENTITY to the complete Developer ID Application identity for public builds.");
  }
  const appleId = env.APPLE_ID && env.APPLE_PASSWORD && env.APPLE_TEAM_ID;
  const apiKey = env.APPLE_API_KEY && env.APPLE_API_KEY_PATH && env.APPLE_API_ISSUER;
  if (!appleId && !apiKey) throw new Error("Public builds require complete Tauri notarization credentials. See desktop/README.md.");
  require("./notarize-dmg.cjs").authenticationArguments(env);
}

function validateOfflineEntitlements(entitlements) {
  const required = ["com.apple.security.app-sandbox", "com.apple.security.files.user-selected.read-write"];
  const identifiers = ["application-identifier", "com.apple.application-identifier", "com.apple.developer.team-identifier"];
  if (required.some(key => entitlements[key] !== true)
      || Object.keys(entitlements).some(key => !required.includes(key) && !identifiers.includes(key))
      || identifiers.some(key => key in entitlements && typeof entitlements[key] !== "string")) {
    throw new Error("Offline sandbox verification failed: only app sandbox, user-selected file access, and signing identifiers are allowed.");
  }
}

function verifyOfflineBundle(appPath) {
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  const executable = path.join(appPath, "Contents", "MacOS", "scratchpad");
  const architectures = execFileSync("/usr/bin/lipo", ["-archs", executable], { encoding: "utf8" }).trim();
  if (architectures !== "arm64") throw new Error("The packaged application is not arm64-only.");
  const minimum = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :LSMinimumSystemVersion", path.join(appPath, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
  if (minimum !== "26.0") throw new Error("The packaged application must require macOS 26.0.");
  const xml = execFileSync("/usr/bin/codesign", ["--display", "--entitlements", ":-", appPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const entitlementJson = execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], { encoding: "utf8", input: xml });
  const entitlements = JSON.parse(entitlementJson);
  validateOfflineEntitlements(entitlements);
  console.log("Verified arm64, macOS 26 minimum, signature, and sandbox without network entitlements.");
}

function nativeIconConfiguration(desktopRoot) {
  const document = path.join(desktopRoot, "build", "Scratchpad.icon");
  if (!fs.existsSync(document) || !fs.lstatSync(document).isDirectory()) {
    throw new Error("Save a genuine Icon Composer document directory at desktop/build/Scratchpad.icon before enabling the native icon.");
  }
  return ["../build/icon.icns", "../build/icon.png", "../build/Scratchpad.icon"];
}

function verifyNativeIcon(appPath) {
  const assets = path.join(appPath, "Contents", "Resources", "Assets.car");
  if (!fs.existsSync(assets) || !fs.statSync(assets).isFile() || fs.statSync(assets).size === 0) {
    throw new Error("Native icon requested, but Assets.car was not built. Select Xcode 26+ command-line tools and rebuild.");
  }
  const name = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIconName", path.join(appPath, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
  if (!name) throw new Error("Native icon requested, but CFBundleIconName was not set.");
  console.log(`Verified compiled native icon asset: ${name}`);
}

function runMac(mode) {
  if (!["start", "local", "release"].includes(mode)) throw new Error("Use npm start, npm run dist:mac, or npm run dist:mac:release.");
  assertMacHost();
  const desktopRoot = path.resolve(__dirname, "..");
  if (mode === "release") assertReleaseCredentials();
  const nativeIcon = process.env.SCRATCHPAD_NATIVE_ICON === "1" ? nativeIconConfiguration(desktopRoot) : undefined;
  if (!fs.existsSync(path.join(desktopRoot, "src-tauri", "Cargo.lock"))) throw new Error("Cargo.lock is missing. Generate and review it before building.");
  prepareWeb();
  const environment = { ...process.env, MACOSX_DEPLOYMENT_TARGET: "26.0" };
  const targetDirectory = path.join(desktopRoot, "src-tauri", "target", mode);
  environment.CARGO_TARGET_DIR = targetDirectory;
  if (mode !== "release") {
    for (const key of Object.keys(environment)) {
      if (key.startsWith("APPLE_")) delete environment[key];
    }
    environment.APPLE_SIGNING_IDENTITY = "-";
  }
  const configuration = { bundle: { macOS: { signingIdentity: environment.APPLE_SIGNING_IDENTITY } } };
  if (nativeIcon) configuration.bundle.icon = nativeIcon;
  const args = [require.resolve("@tauri-apps/cli/tauri.js"), "build", "--target", "aarch64-apple-darwin",
    "--bundles", mode === "start" ? "app" : "dmg", "--config", JSON.stringify(configuration),
    ...(mode === "start" ? ["--debug"] : []), "--", "--locked", "--bin", "scratchpad"];
  const result = spawnSync(process.execPath, args, { cwd: desktopRoot, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; return; }
  const bundleDirectory = path.join(targetDirectory, "aarch64-apple-darwin", mode === "start" ? "debug" : "release", "bundle");
  const appPath = path.join(bundleDirectory, "macos", "Scratchpad.app");
  verifyOfflineBundle(appPath);
  if (nativeIcon) verifyNativeIcon(appPath);
  if (mode === "start") {
    // Launch the signed sandboxed bundle; no development HTTP server is needed.
    execFileSync("/usr/bin/open", [appPath], { stdio: "inherit" });
    return;
  }
  const version = require("../package.json").version;
  const sourceDmg = path.join(bundleDirectory, "dmg", `Scratchpad_${version}_aarch64.dmg`);
  if (!fs.existsSync(sourceDmg)) throw new Error("Expected arm64 DMG was not produced by Tauri.");
  const outputDirectory = path.join(desktopRoot, "dist", mode);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputDmg = path.join(outputDirectory, "Scratchpad-arm64.dmg");
  fs.copyFileSync(sourceDmg, outputDmg);
  if (mode === "release") require("./notarize-dmg.cjs").notarizeDmg(appPath, outputDmg, environment);
  console.log(`Scratchpad DMG: ${outputDmg}`);
}

if (require.main === module) {
  try { runMac(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { assertMacHost, assertReleaseCredentials, verifyOfflineBundle, validateOfflineEntitlements, nativeIconConfiguration };
