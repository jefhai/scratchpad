"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { prepareWeb, localizeIndex, verifyLocalAssets, SOURCE_FILES, SOURCE_DIRECTORIES } = require("../scripts/prepare-web.cjs");
const { assertMacHost, assertReleaseCredentials, validateOfflineEntitlements, nativeIconConfiguration } = require("../scripts/mac.cjs");
const { authenticationArguments } = require("../scripts/notarize-dmg.cjs");

const desktopRoot = path.resolve(__dirname, "..");
const { platformConfig } = require("../scripts/config.cjs");
const index = '<html lang="en"><link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n' +
  '<script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script>\n' +
  '<script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"></script>\n' +
  '<link rel="stylesheet" href="./app.css?v=1"><script src="./app.js"></script>';

function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "scratchpad-packaging-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const sourceRoot = path.join(temporary, "source");
  const desktop = path.join(temporary, "desktop");
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(desktop);
  fs.writeFileSync(path.join(desktop, "bridge.js"), "// native bridge fixture");
  for (const file of SOURCE_FILES) fs.writeFileSync(path.join(sourceRoot, file), file === "index.html" ? index : `source ${file}`);
  for (const directory of SOURCE_DIRECTORIES) {
    fs.mkdirSync(path.join(sourceRoot, directory));
    fs.writeFileSync(path.join(sourceRoot, directory, "example.js"), `source ${directory}`);
  }
  fs.mkdirSync(path.join(sourceRoot, "commands", "cells"));
  fs.writeFileSync(path.join(sourceRoot, "commands", "cells", "sum.js"), "lazy command");
  fs.writeFileSync(path.join(sourceRoot, "LICENSE"), "MIT");
  fs.writeFileSync(path.join(sourceRoot, "ui", "download-app.js"), "fetch remote release");
  fs.writeFileSync(path.join(sourceRoot, "ui", "download-app.css"), "download styles");
  for (const name of ["react", "react-dom"]) {
    const vendor = path.join(desktop, "node_modules", name);
    fs.mkdirSync(path.join(vendor, "umd"), { recursive: true });
    fs.writeFileSync(path.join(vendor, "package.json"), JSON.stringify({ name, version: "18.3.1" }));
    fs.writeFileSync(path.join(vendor, "umd", `${name}.production.min.js`), `pinned ${name}`);
    fs.writeFileSync(path.join(vendor, "LICENSE"), "vendor license");
  }
  return { sourceRoot, desktopRoot: desktop };
}

test("staging copies source and lazy commands, vendors React, and leaves authoritative files untouched", t => {
  const roots = fixture(t);
  fs.writeFileSync(path.join(roots.sourceRoot, "secret.txt"), "do not package");
  const web = prepareWeb(roots);
  assert.equal(fs.readFileSync(path.join(roots.sourceRoot, "index.html"), "utf8"), index);
  const stagedIndex = fs.readFileSync(path.join(web, "index.html"), "utf8");
  assert(!stagedIndex.includes("https://"));
  assert(stagedIndex.includes("./vendor/react.production.min.js"));
  assert(stagedIndex.includes('<html data-desktop-runtime="tauri" lang="en">'));
  assert.equal(fs.readFileSync(path.join(web, "commands", "cells", "sum.js"), "utf8"), "lazy command");
  assert.equal(fs.readFileSync(path.join(web, "vendor", "react-dom.production.min.js"), "utf8"), "pinned react-dom");
  assert(fs.existsSync(path.join(web, "vendor", "react.LICENSE")));
  assert(!fs.existsSync(path.join(web, "secret.txt")));
  assert(!fs.existsSync(path.join(web, "ui", "download-app.js")));
  assert(!fs.existsSync(path.join(web, "ui", "download-app.css")));
  assert(fs.existsSync(path.join(web, "desktop-bridge.js")));
  assert(stagedIndex.indexOf("./desktop-bridge.js") < stagedIndex.indexOf("./vendor/react.production.min.js"));
  fs.writeFileSync(path.join(web, "stale.js"), "old output");
  prepareWeb(roots);
  assert(!fs.existsSync(path.join(web, "stale.js")));
});

test("staging rejects unpinned dependencies and unresolved or remote index assets", t => {
  const roots = fixture(t);
  const web = prepareWeb(roots);
  assert.throws(() => verifyLocalAssets('<script src="https://example.com/runtime.js"></script>', web), /offline/);
  assert.throws(() => verifyLocalAssets('<script src="./missing.js"></script>', web), /not staged/);
  assert.throws(() => verifyLocalAssets('<script src="../outside.js"></script>', web), /outside/);
  fs.writeFileSync(path.join(roots.desktopRoot, "node_modules", "react", "package.json"), '{"version":"19.0.0"}');
  assert.throws(() => prepareWeb(roots), /must be 18.3.1/);
  assert.throws(() => localizeIndex(index.replace("react@18.3.1", "react@19.0.0")), /pinned react/);
});

test("Mac execution requires Apple Silicon, native arm64 Node, and macOS 26", () => {
  assert.throws(() => assertMacHost("win32", "arm64", "26.0"), /Apple Silicon Mac/);
  assert.throws(() => assertMacHost("darwin", "x64", "26.0"), /arm64 Node/);
  assert.throws(() => assertMacHost("darwin", "arm64", "15.7"), /Tahoe 26/);
  assert.doesNotThrow(() => assertMacHost("darwin", "arm64", "26.0"));
});

test("public build refuses incomplete signing and notarization credentials", () => {
  const signing = { APPLE_SIGNING_IDENTITY: "Developer ID Application: Example (TEAMID)" };
  assert.throws(() => assertReleaseCredentials({}), /Developer ID Application/);
  assert.throws(() => assertReleaseCredentials({ APPLE_SIGNING_IDENTITY: "-" }), /Developer ID Application/);
  assert.throws(() => assertReleaseCredentials(signing), /notarization credentials/);
  assert.doesNotThrow(() => assertReleaseCredentials({ ...signing, APPLE_ID: "test", APPLE_PASSWORD: "test", APPLE_TEAM_ID: "test" }));
  assert.doesNotThrow(() => assertReleaseCredentials({ ...signing, APPLE_API_KEY: "key-id", APPLE_API_KEY_PATH: "/private/key.p8", APPLE_API_ISSUER: "issuer" }));
});

test("DMG notarization accepts complete credential methods and rejects partial credentials", () => {
  assert.deepEqual(authenticationArguments({ APPLE_API_KEY_PATH: "/private/key.p8", APPLE_API_KEY: "key-id", APPLE_API_ISSUER: "issuer" }), ["--key", "/private/key.p8", "--key-id", "key-id", "--issuer", "issuer"]);
  assert.deepEqual(authenticationArguments({ APPLE_ID: "account", APPLE_PASSWORD: "secret", APPLE_TEAM_ID: "team" }), ["--apple-id", "account", "--password", "secret", "--team-id", "team"]);
  assert.throws(() => authenticationArguments({ APPLE_API_KEY: "key-id" }), /Incomplete API key/);
  assert.throws(() => authenticationArguments({ APPLE_ID: "account" }), /Incomplete Apple ID/);
  assert.throws(() => authenticationArguments({}), /missing/);
});

test("Tauri embeds local assets with a macOS sandbox and no network permissions", () => {
  const config = platformConfig("macos");
  assert.deepEqual(config.bundle.targets, ["dmg"]);
  assert.equal(config.bundle.macOS.minimumSystemVersion, "26.0");
  assert.equal(config.bundle.macOS.signingIdentity, "-");
  assert.equal(config.bundle.macOS.hardenedRuntime, true);
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  assert.equal(config.build.frontendDist, "../.web");
  assert.equal(config.build.devUrl, undefined);
  assert.equal(config.app.withGlobalTauri, true);
  assert.deepEqual(config.app.windows, []);
  assert.match(config.app.security.csp, /connect-src ipc:/);
  assert(!/https?:|wss?:/.test(config.app.security.csp));
  const entitlements = fs.readFileSync(path.join(desktopRoot, "src-tauri", config.bundle.macOS.entitlements), "utf8");
  assert.match(entitlements, /<key>com.apple.security.app-sandbox<\/key>\s*<true\/>/);
  assert.match(entitlements, /<key>com.apple.security.files.user-selected.read-write<\/key>\s*<true\/>/);
  assert(!entitlements.includes("com.apple.security.network."));
  const capabilities = require("../src-tauri/capabilities/workspaces.json");
  assert.deepEqual(capabilities.windows, ["scratchpad-*"]);
  assert.deepEqual(capabilities.platforms, ["macOS", "windows"]);
  assert.equal(capabilities.remote, undefined);
  assert(capabilities.permissions.every(permission => permission.startsWith("allow-desktop-")
    || ["core:event:allow-listen", "core:event:allow-unlisten"].includes(permission)));
  const cargo = fs.readFileSync(path.join(desktopRoot, "src-tauri", "Cargo.toml"), "utf8");
  assert(!/tauri-plugin-(http|shell|updater|opener|localhost|websocket)/.test(cargo));
});

test("web-only release lookup is removed from the staged index", () => {
  const withDownload = index + '<script defer src="./ui/download-app.js"></script><link rel="stylesheet" href="./ui/download-app.css">';
  const localized = localizeIndex(withDownload);
  assert(!localized.includes("download-app"));
  assert(!localized.includes("preconnect"));
});

test("signed-bundle audit rejects network grants, temporary exceptions, and unexpected capabilities", () => {
  const entitlements = { "com.apple.security.app-sandbox": true, "com.apple.security.files.user-selected.read-write": true };
  assert.doesNotThrow(() => validateOfflineEntitlements(entitlements));
  assert.doesNotThrow(() => validateOfflineEntitlements({ ...entitlements, "com.apple.developer.team-identifier": "TEAMID" }));
  for (const key of ["com.apple.security.network.client", "com.apple.security.network.server", "com.apple.security.temporary-exception.mach-lookup.global-name", "com.apple.security.files.all"]) {
    assert.throws(() => validateOfflineEntitlements({ ...entitlements, [key]: true }), /Offline sandbox verification failed/);
  }
  assert.throws(() => validateOfflineEntitlements({ ...entitlements, "com.apple.security.app-sandbox": false }), /Offline sandbox/);
});

test("checked-in ICNS contains valid PNG frames including 1024px", () => {
  const bytes = fs.readFileSync(path.join(desktopRoot, "build", "icon.icns"));
  assert.equal(bytes.toString("ascii", 0, 4), "icns");
  assert.equal(bytes.readUInt32BE(4), bytes.length);
  const sizes = new Set();
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset + 4);
    assert(length >= 8 && offset + length <= bytes.length);
    const png = bytes.subarray(offset + 8, offset + length);
    if (png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      const width = png.readUInt32BE(16);
      assert.equal(width, png.readUInt32BE(20));
      sizes.add(width);
    }
    offset += length;
  }
  assert.equal(offset, bytes.length);
  for (const size of [32, 64, 128, 256, 512, 1024]) assert(sizes.has(size), `missing ${size}px icon`);
});

test("optional native icon requires a real document directory and retains fallback icons", t => {
  const roots = fixture(t);
  assert.throws(() => nativeIconConfiguration(roots.desktopRoot), /genuine Icon Composer/);
  fs.mkdirSync(path.join(roots.desktopRoot, "build"));
  fs.writeFileSync(path.join(roots.desktopRoot, "build", "Scratchpad.icon"), "not a document directory");
  assert.throws(() => nativeIconConfiguration(roots.desktopRoot), /genuine Icon Composer/);
  fs.unlinkSync(path.join(roots.desktopRoot, "build", "Scratchpad.icon"));
  fs.mkdirSync(path.join(roots.desktopRoot, "build", "Scratchpad.icon"));
  assert.deepEqual(nativeIconConfiguration(roots.desktopRoot), ["../build/icon.icns", "../build/icon.png", "../build/Scratchpad.icon"]);
});

test("lockfile agrees with exact direct dependencies and includes registry integrity", () => {
  const metadata = require("../package.json");
  const lock = require("../package-lock.json");
  assert.deepEqual(lock.packages[""].devDependencies, metadata.devDependencies);
  for (const [name, version] of Object.entries(metadata.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
    const entry = lock.packages[`node_modules/${name}`];
    assert.equal(entry.version, version);
    assert(entry.resolved.startsWith("https://registry.npmjs.org/"));
    assert.match(entry.integrity, /^sha512-/);
  }
});
