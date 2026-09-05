"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const pin = require("../platforms/windows/webview2.json");

function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function inventory(directory) {
  const files = {};
  function walk(current) {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error("Runtime links and junctions are forbidden.");
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) files[path.relative(directory, file).split(path.sep).join("/")] = sha256(file);
      else throw new Error("Unsupported runtime file type");
    }
  }
  walk(directory);
  return files;
}

async function prepareRuntime() {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Prepare the Windows runtime on Windows x64.");
  const desktopRoot = path.resolve(__dirname, "..");
  const tools = path.join(desktopRoot, ".tools");
  fs.mkdirSync(tools, { recursive: true });
  const archive = path.join(tools, `Microsoft.WebView2.FixedVersionRuntime.${pin.version}.x64.cab`);
  if (!fs.existsSync(archive)) {
    console.log(`Downloading the pinned Microsoft WebView2 runtime (${pin.version}) for the build only…`);
    const response = await fetch(pin.url, { redirect: "error", signal: AbortSignal.timeout(600000) });
    if (!response.ok || !response.body) throw new Error(`Runtime download failed (${response.status}).`);
    const partial = `${archive}.download-${crypto.randomUUID()}`;
    try {
      const { pipeline } = require("node:stream/promises");
      await pipeline(require("node:stream").Readable.fromWeb(response.body), fs.createWriteStream(partial, { flags: "wx" }));
      if (sha256(partial) !== pin.sha256) throw new Error("The Microsoft runtime archive failed its pinned SHA-256 check.");
      fs.renameSync(partial, archive);
    } finally { if (fs.existsSync(partial)) fs.unlinkSync(partial); }
  }
  if (sha256(archive) !== pin.sha256) throw new Error("The cached runtime archive does not match its pinned SHA-256.");
  // Only a verified archive is expanded. Extraction never targets the authoritative source tree.
  const temporary = fs.mkdtempSync(path.join(tools, "webview2-stage-"));
  try {
    execFileSync(path.join(process.env.SystemRoot, "System32", "expand.exe"), [archive, "-F:*", temporary], { windowsHide: true, stdio: "ignore" });
    const children = fs.readdirSync(temporary, { withFileTypes: true });
    const extracted = fs.existsSync(path.join(temporary, "msedgewebview2.exe")) ? temporary
      : children.length === 1 && children[0].isDirectory() ? path.join(temporary, children[0].name) : null;
    if (!extracted || !fs.existsSync(path.join(extracted, "msedgewebview2.exe"))) throw new Error("The archive has an unexpected runtime layout.");
    const files = inventory(extracted);
    if (files["msedgewebview2.exe"] !== pin.mainExecutableSha256) throw new Error("The extracted WebView2 executable is not the pinned binary.");
    // Tauri uses the fixed-runtime path both as a source resource and at runtime.
    // Keep it directly under src-tauri so the installed path is exactly webview2/.
    const vendor = path.join(desktopRoot, "src-tauri");
    const target = path.join(vendor, "webview2");
    fs.mkdirSync(vendor, { recursive: true });
    if (fs.lstatSync(vendor).isSymbolicLink()) throw new Error("The runtime vendor directory must not be a link.");
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isSymbolicLink()) throw new Error("The generated runtime must not be a link.");
      // Exact generated subtree, not the source/workspace or user data.
      fs.rmSync(target, { recursive: true });
    }
    fs.cpSync(extracted, target, { recursive: true, errorOnExist: true });
    fs.writeFileSync(path.join(vendor, "webview2-inventory.json"), `${JSON.stringify({ version: pin.version, archiveSha256: pin.sha256, files }, null, 2)}\n`);
    console.log(`Prepared ${Object.keys(files).length} verified local runtime files. No installer or app was launched.`);
  } finally {
    if (!path.resolve(temporary).startsWith(`${path.resolve(tools)}${path.sep}webview2-stage-`)) throw new Error("Invalid temporary runtime directory");
    fs.rmSync(temporary, { recursive: true });
  }
}

if (require.main === module) prepareRuntime().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { inventory, prepareRuntime };
