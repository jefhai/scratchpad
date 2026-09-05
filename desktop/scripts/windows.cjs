"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync, execFileSync } = require("node:child_process");
const { prepareWeb } = require("./prepare-web.cjs");
const runtimePin = require("../platforms/windows/webview2.json");

function assertWindowsHost(platform = process.platform, arch = process.arch, release = os.release()) {
  const version = release.split(".").map(Number);
  if (platform !== "win32" || arch !== "x64" || version[0] !== 10 || !(version[2] >= 22000)) {
    throw new Error("Build Scratchpad on Windows 11 x64 with native x64 Node.js.");
  }
}

function assertReleaseSigning(environment) {
  if (!/^[a-f\d]{40}$/i.test(environment.SCRATCHPAD_WINDOWS_CERTIFICATE_THUMBPRINT || "")) {
    throw new Error("Public Windows builds require SCRATCHPAD_WINDOWS_CERTIFICATE_THUMBPRINT for a code-signing certificate in your certificate store.");
  }
  const timestamp = new URL(environment.SCRATCHPAD_WINDOWS_TIMESTAMP_URL || "");
  if (timestamp.protocol !== "https:" || timestamp.username || timestamp.password) {
    throw new Error("Set SCRATCHPAD_WINDOWS_TIMESTAMP_URL to your signing provider's HTTPS RFC3161 timestamp service.");
  }
}

function peMachine(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("Not a Windows executable");
  const offset = bytes.readUInt32LE(60);
  if (offset + 6 > bytes.length || bytes.toString("ascii", offset, offset + 4) !== "PE\0\0") throw new Error("Invalid Windows executable header");
  return bytes.readUInt16LE(offset + 4);
}

function inspectRuntime(desktopRoot) {
  const directory = path.join(desktopRoot, "src-tauri", "webview2");
  const main = path.join(directory, "msedgewebview2.exe");
  if (!fs.existsSync(main)) throw new Error("The pinned private WebView2 runtime is missing. Run npm run prepare:windows-runtime.");
  if (crypto.createHash("sha256").update(fs.readFileSync(main)).digest("hex") !== runtimePin.mainExecutableSha256) {
    throw new Error("The WebView2 executable does not match the pinned Microsoft runtime.");
  }
  if (peMachine(main) !== 0x8664) throw new Error("The private WebView2 runtime must be x64.");
  let executables = 0;
  function inspect(directory) {
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error("Runtime symlinks and junctions are forbidden.");
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error("Runtime symlinks and junctions are forbidden.");
      if (stat.isDirectory()) inspect(file);
      else if (/\.exe$/i.test(name)) executables++;
    }
  }
  inspect(directory);
  if (!executables || executables > 128) throw new Error("Unexpected private WebView2 executable inventory.");
  const manifest = path.join(desktopRoot, "src-tauri", "webview2-inventory.json");
  if (!fs.existsSync(manifest)) throw new Error("Runtime checksums are missing. Run npm run prepare:windows-runtime.");
  const expected = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const actual = require("./prepare-windows-runtime.cjs").inventory(directory);
  if (expected.version !== runtimePin.version || expected.archiveSha256 !== runtimePin.sha256
    || JSON.stringify(actual) !== JSON.stringify(expected.files)) {
    throw new Error("The private runtime has changed since verified extraction. Run npm run prepare:windows-runtime.");
  }
  return { directory, executables };
}

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed with exit code ${result.status ?? "unknown"}.`);
}

function signingTool(environment) {
  const supplied = environment.TAURI_WINDOWS_SIGNTOOL_PATH;
  const tool = supplied || execFileSync("where.exe", ["signtool.exe"], {
    env: environment, encoding: "utf8", windowsHide: true,
  }).trim().split(/\r?\n/)[0];
  if (!tool || !path.isAbsolute(tool) || !fs.existsSync(tool)) {
    throw new Error("Set TAURI_WINDOWS_SIGNTOOL_PATH to an installed signtool.exe or use the Microsoft SDK developer shell.");
  }
  return tool;
}

function buildEnvironment(desktopRoot, mode, inherited = process.env) {
  const environment = { ...inherited, STATIC_VCRUNTIME: "true", CARGO_TARGET_DIR: path.join(desktopRoot, "src-tauri", "target", "windows", mode) };
  if (environment.SCRATCHPAD_WINDOWS_PORTABLE === "1") {
    // An explicitly prepared LLVM/SDK toolchain is an alternative to installed
    // MSVC. This opt-in consumes only child environment values, never registry edits.
    for (const key of ["CARGO", "RUSTC", "CC", "RC", "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER"]) {
      if (!environment[key] || !path.isAbsolute(environment[key]) || !fs.existsSync(environment[key])) {
        throw new Error(`The portable Windows toolchain requires an existing absolute ${key} executable path.`);
      }
    }
    for (const key of ["LIB", "INCLUDE"]) {
      if (!environment[key] || environment[key].split(";").some(entry => !path.isAbsolute(entry) || !fs.existsSync(entry))) {
        throw new Error(`The portable Windows toolchain requires valid ${key} directories.`);
      }
    }
    return environment;
  }
  // Prefer an existing Developer PowerShell. Otherwise load Microsoft's installed x64 tools
  // into this child environment only; never change the user's machine or session PATH.
  if (!environment.VCToolsInstallDir) {
    const vswhere = path.join(environment["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
    if (!fs.existsSync(vswhere)) throw new Error("Microsoft C++ Build Tools and the Windows 11 SDK are required. See desktop/README.md.");
    const installation = execFileSync(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { encoding: "utf8", windowsHide: true }).trim();
    const vcvars = path.join(installation, "VC", "Auxiliary", "Build", "vcvars64.bat");
    if (!installation || !fs.existsSync(vcvars)) throw new Error("Install the Microsoft x64 C++ Build Tools and Windows 11 SDK first.");
    const output = execFileSync(environment.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"call "${vcvars}" >nul && set"`], { encoding: "utf8", windowsHide: true });
    for (const line of output.split(/\r?\n/)) {
      const split = line.indexOf("=");
      if (split > 0) environment[line.slice(0, split)] = line.slice(split + 1);
    }
  }
  return environment;
}

function runWindows(mode) {
  if (!["start", "local", "release"].includes(mode)) throw new Error("Use npm start, npm run dist:windows, or npm run dist:windows:release.");
  assertWindowsHost();
  if (mode === "start") {
    const directory = path.join(process.env.ProgramW6432 || process.env.ProgramFiles, "Scratchpad");
    require("./audit-windows.cjs").auditWindows(directory);
    // Starting is intentionally separate from building/installing: a loose executable has no kernel policy.
    const child = require("node:child_process").spawn(path.join(directory, "scratchpad.exe"), [], { detached: true, stdio: "ignore", windowsHide: false });
    child.on("error", error => { console.error(error.message); process.exitCode = 1; });
    child.unref();
    return;
  }
  const desktopRoot = path.resolve(__dirname, "..");
  if (mode === "release") assertReleaseSigning(process.env);
  const environment = buildEnvironment(desktopRoot, mode);
  const signer = mode === "release" ? signingTool(environment) : null;
  if (signer) environment.TAURI_WINDOWS_SIGNTOOL_PATH = signer;
  const runtime = inspectRuntime(desktopRoot);
  console.log(`Using pinned WebView2 ${runtimePin.version}; all ${runtime.executables} private executables require network blocks.`);
  prepareWeb();
  const cargo = environment.CARGO || "cargo";
  const outputDirectory = path.join(environment.CARGO_TARGET_DIR, "x86_64-pc-windows-msvc", "release");
  const helper = path.join(outputDirectory, "scratchpad-policy.exe");
  environment.SCRATCHPAD_POLICY_BINARY = helper;
  const configuration = { bundle: {
    windows: { certificateThumbprint: null, timestampUrl: null, signCommand: null },
  } };
  if (mode === "release") {
    configuration.bundle.windows = {
      certificateThumbprint: environment.SCRATCHPAD_WINDOWS_CERTIFICATE_THUMBPRINT,
      digestAlgorithm: "sha256", timestampUrl: environment.SCRATCHPAD_WINDOWS_TIMESTAMP_URL, tsp: true,
    };
  }
  const cli = require.resolve("@tauri-apps/cli/tauri.js");
  const common = ["--target", "x86_64-pc-windows-msvc", "--features", "windows-policy", "--config", JSON.stringify(configuration)];
  // Compile both binaries once, THEN sign the helper. Bundling must not rebuild
  // and overwrite that signature. Tauri includes the feature-gated Cargo helper
  // automatically; listing it again as a resource would duplicate it.
  run(process.execPath, [cli, "build", "--runner", cargo, "--no-bundle", ...common, "--", "--locked"], { cwd: desktopRoot, env: environment });
  if (peMachine(helper) !== 0x8664) throw new Error("The offline policy helper must be native x64.");
  if (signer) {
    run(signer, ["sign", "/sha1", environment.SCRATCHPAD_WINDOWS_CERTIFICATE_THUMBPRINT, "/fd", "SHA256", "/tr", environment.SCRATCHPAD_WINDOWS_TIMESTAMP_URL, "/td", "SHA256", helper], { env: environment });
  }
  run(process.execPath, [cli, "bundle", "--bundles", "nsis", ...common], { cwd: desktopRoot, env: environment });
  inspectRuntime(desktopRoot); // Bundling/signing must not modify Microsoft's runtime.
  if (peMachine(path.join(outputDirectory, "scratchpad.exe")) !== 0x8664) throw new Error("Scratchpad must be native x64.");
  const version = require("../package.json").version;
  const source = path.join(outputDirectory, "bundle", "nsis", `Scratchpad_${version}_x64-setup.exe`);
  if (!fs.existsSync(source)) throw new Error("Tauri did not produce the expected Windows installer.");
  if (mode === "release") {
    for (const file of [helper, path.join(outputDirectory, "scratchpad.exe"), source]) {
      run(signer, ["verify", "/pa", "/all", "/v", file], { env: environment });
    }
  }
  const destination = path.join(desktopRoot, "dist", "windows", mode);
  fs.mkdirSync(destination, { recursive: true });
  const installer = path.join(destination, "Scratchpad-windows-x64-setup.exe");
  fs.copyFileSync(source, installer);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(installer)).digest("hex");
  fs.writeFileSync(`${installer}.sha256`, `${digest}  ${path.basename(installer)}\n`);
  console.log(`${mode === "release" ? "Signed" : "Unsigned testing"} Windows installer: ${installer}`);
  console.log("Build only: installation, effective offline-policy checks, native smoke tests, and publication are separate.");
}

if (require.main === module) {
  try { runWindows(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { assertWindowsHost, assertReleaseSigning, inspectRuntime, peMachine, buildEnvironment };
