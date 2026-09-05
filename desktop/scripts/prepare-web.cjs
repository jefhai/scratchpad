"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SOURCE_FILES = Object.freeze([
  "index.html", "app.css", "cellpad.css", "mobile.css",
  "app.js", "editor-defaults.js", "themes.js", "keyboard-shortcuts.js", "responsive-layout.js",
]);
const SOURCE_DIRECTORIES = Object.freeze(["core", "ui", "commands", "public"]);
const WEB_ONLY_FILES = Object.freeze(["ui/download-app.js", "ui/download-app.css"]);
const VENDORS = Object.freeze([
  { name: "react", version: "18.3.1", file: "react.production.min.js" },
  { name: "react-dom", version: "18.3.1", file: "react-dom.production.min.js" },
]);

function inside(root, relative) {
  const target = path.resolve(root, relative);
  if (target === path.resolve(root) || !target.startsWith(path.resolve(root) + path.sep)) {
    throw new Error(`Asset path is outside its directory: ${relative}`);
  }
  return target;
}

function copySource(source, destination, sourceRoot) {
  if (WEB_ONLY_FILES.includes(path.relative(sourceRoot, source).split(path.sep).join("/"))) return;
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Source assets cannot be symlinks: ${source}`);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source).sort()) {
      if (name.startsWith(".")) continue;
      copySource(path.join(source, name), path.join(destination, name), sourceRoot);
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  } else {
    throw new Error(`Unsupported source asset: ${source}`);
  }
}

function localizeIndex(index) {
  let result = index.replace(/\s*<link\b[^>]*\brel=["']preconnect["'][^>]*>/gi, "");
  result = result.replace(/<html\b/i, '<html data-desktop-runtime="tauri"');
  result = result.replace(/\s*<script\b[^>]*\bsrc=["']\.\/ui\/download-app\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi, "")
    .replace(/\s*<link\b[^>]*\bhref=["']\.\/ui\/download-app\.css(?:\?[^"']*)?["'][^>]*>/gi, "");
  for (const vendor of VENDORS) {
    const remote = `https://cdn.jsdelivr.net/npm/${vendor.name}@${vendor.version}/umd/${vendor.file}`;
    if (!result.includes(remote)) throw new Error(`Expected pinned ${vendor.name} script in root index.html.`);
    result = result.replaceAll(remote, `./vendor/${vendor.file}`);
  }
  result = result.replace(/<script\b/i, '<script defer src="./desktop-bridge.js"></script>\n    <script');
  return result;
}

function verifyLocalAssets(index, webDirectory) {
  for (const match of index.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/gi)) {
    const reference = match[1];
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) {
      throw new Error(`Desktop assets must work offline: ${reference}`);
    }
    const relative = decodeURIComponent(reference.split(/[?#]/)[0]);
    const asset = inside(webDirectory, relative);
    if (!fs.existsSync(asset) || !fs.statSync(asset).isFile()) {
      throw new Error(`Referenced desktop asset was not staged: ${relative}`);
    }
  }
}

function prepareWeb({ sourceRoot = path.resolve(__dirname, "../.."), desktopRoot = path.resolve(__dirname, "..") } = {}) {
  // The only replaceable output is this exact, generated subdirectory.
  const webDirectory = inside(desktopRoot, ".web");
  if (fs.existsSync(webDirectory) && fs.lstatSync(webDirectory).isSymbolicLink()) {
    throw new Error("Refusing to replace a symlink at desktop/.web.");
  }
  for (const vendor of VENDORS) {
    const packageRoot = inside(desktopRoot, `node_modules/${vendor.name}`);
    const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    if (metadata.version !== vendor.version) throw new Error(`Run npm ci: ${vendor.name} must be ${vendor.version}.`);
    if (!fs.existsSync(path.join(packageRoot, "umd", vendor.file))) throw new Error(`Missing ${vendor.name} UMD runtime. Run npm ci.`);
  }
  const localized = localizeIndex(fs.readFileSync(inside(sourceRoot, "index.html"), "utf8"));
  fs.rmSync(webDirectory, { recursive: true, force: true });
  fs.mkdirSync(webDirectory, { recursive: true });
  for (const file of [...SOURCE_FILES, ...SOURCE_DIRECTORIES]) {
    copySource(inside(sourceRoot, file), inside(webDirectory, file), sourceRoot);
  }
  fs.writeFileSync(path.join(webDirectory, "index.html"), localized);
  copySource(inside(desktopRoot, "bridge.js"), inside(webDirectory, "desktop-bridge.js"), desktopRoot);
  const vendorDirectory = inside(webDirectory, "vendor");
  fs.mkdirSync(vendorDirectory);
  for (const vendor of VENDORS) {
    const packageRoot = inside(desktopRoot, `node_modules/${vendor.name}`);
    fs.copyFileSync(path.join(packageRoot, "umd", vendor.file), path.join(vendorDirectory, vendor.file));
    fs.copyFileSync(path.join(packageRoot, "LICENSE"), path.join(vendorDirectory, `${vendor.name}.LICENSE`));
  }
  fs.copyFileSync(inside(sourceRoot, "LICENSE"), path.join(webDirectory, "LICENSE"));
  verifyLocalAssets(localized, webDirectory);
  return webDirectory;
}

if (require.main === module) {
  try { console.log(`Prepared offline desktop assets in ${prepareWeb()}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { prepareWeb, localizeIndex, verifyLocalAssets, SOURCE_FILES, SOURCE_DIRECTORIES, WEB_ONLY_FILES };
