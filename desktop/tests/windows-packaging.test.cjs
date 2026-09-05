"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { assertWindowsHost, assertReleaseSigning, buildEnvironment } = require("../scripts/windows.cjs");
const { platformConfig } = require("../scripts/config.cjs");
const fs = require("node:fs");
const path = require("node:path");

test("Windows builds require x64 Windows 11, not Windows 10 or another platform", () => {
  assert.doesNotThrow(() => assertWindowsHost("win32", "x64", "10.0.22000"));
  assert.doesNotThrow(() => assertWindowsHost("win32", "x64", "10.0.26200"));
  for (const args of [["win32", "x64", "10.0.19045"], ["darwin", "arm64", "26.0"],
    ["win32", "arm64", "10.0.26200"], ["win32", "ia32", "10.0.26200"], ["win32", "x64", "unknown"]]) {
    assert.throws(() => assertWindowsHost(...args), /Windows 11 x64/);
  }
});

test("public Windows packaging requires explicit certificate and secure timestamp configuration", () => {
  assert.throws(() => assertReleaseSigning({}), /code-signing certificate/);
  const environment = { SCRATCHPAD_WINDOWS_CERTIFICATE_THUMBPRINT: "a".repeat(40), SCRATCHPAD_WINDOWS_TIMESTAMP_URL: "https://timestamp.example.test/" };
  assert.doesNotThrow(() => assertReleaseSigning(environment));
  for (const url of ["http://example.test", "https://user:password@example.test", "file:///timestamp"]) {
    assert.throws(() => assertReleaseSigning({ ...environment, SCRATCHPAD_WINDOWS_TIMESTAMP_URL: url }), /HTTPS/);
  }
});

test("platform configuration separates Mac entitlements from Windows installer policy", () => {
  const mac = platformConfig("macos"), windows = platformConfig("windows");
  assert.equal(mac.bundle.windows, undefined);
  assert.equal(windows.bundle.macOS, undefined);
  assert.equal(mac.bundle.macOS.minimumSystemVersion, "26.0");
  assert.equal(windows.bundle.windows.webviewInstallMode.type, "fixedRuntime");
  assert.equal(mac.build.frontendDist, windows.build.frontendDist);
  assert.throws(() => platformConfig("linux"), /Unsupported/);
});

test("Windows ICO contains multiple correctly bounded image frames", () => {
  const bytes = fs.readFileSync(path.join(__dirname, "../build/icon.ico"));
  assert.equal(bytes.readUInt16LE(0), 0);
  assert.equal(bytes.readUInt16LE(2), 1);
  const count = bytes.readUInt16LE(4);
  assert(count >= 3);
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    const size = bytes.readUInt32LE(entry + 8), offset = bytes.readUInt32LE(entry + 12);
    assert(size > 0 && offset >= 6 + count * 16 && offset + size <= bytes.length);
  }
});

test("portable builds validate local compiler inputs without mutating the parent environment", () => {
  const environment = { SCRATCHPAD_WINDOWS_PORTABLE: "1" };
  assert.throws(() => buildEnvironment(__dirname, "local", environment), /absolute CARGO/);
  for (const key of ["CARGO", "RUSTC", "CC", "RC", "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER"]) environment[key] = process.execPath;
  environment.LIB = environment.INCLUDE = __dirname;
  const original = { ...environment };
  const built = buildEnvironment(__dirname, "local", environment);
  assert.deepEqual(environment, original);
  assert.equal(built.STATIC_VCRUNTIME, "true");
  assert.equal(built.CARGO_TARGET_DIR, path.join(__dirname, "src-tauri", "target", "windows", "local"));
  assert.throws(() => buildEnvironment(__dirname, "local", { ...environment, INCLUDE: "relative" }), /valid INCLUDE/);
});

test("the Windows-only helper is feature gated and signed after compilation before bundling", () => {
  const cargo = fs.readFileSync(path.join(__dirname, "../src-tauri/Cargo.toml"), "utf8");
  assert.match(cargo, /windows-policy\s*=\s*\[\]/);
  assert.match(cargo, /required-features\s*=\s*\["windows-policy"\]/);
  const build = fs.readFileSync(path.join(__dirname, "../scripts/windows.cjs"), "utf8");
  assert(build.includes('"--features", "windows-policy"'));
  assert(build.includes('"--no-bundle"'));
  assert(build.indexOf('[cli, "build"') < build.indexOf('run(signer, ["sign"'));
  assert(build.indexOf('run(signer, ["sign"') < build.indexOf('[cli, "bundle"'));
  assert.doesNotMatch(build, /resources:\s*\{\s*\[helper\]/);
  assert(build.includes("TAURI_WINDOWS_SIGNTOOL_PATH"));
});
