"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function buildIcon() {
  const desktopRoot = path.resolve(__dirname, "..");
  const buildDirectory = path.join(desktopRoot, "build");
  const generatedDirectory = path.join(buildDirectory, "generated");
  const cli = require.resolve("@tauri-apps/cli/tauri.js");
  execFileSync(process.execPath, [cli, "icon", path.join(buildDirectory, "icon.svg"), "--output", generatedDirectory], { cwd: desktopRoot, stdio: "inherit" });
  const bytes = fs.readFileSync(path.join(generatedDirectory, "icon.icns"));
  if (bytes.toString("ascii", 0, 4) !== "icns" || bytes.readUInt32BE(4) !== bytes.length) {
    throw new Error("Icon conversion produced an invalid ICNS container.");
  }
  for (const file of ["icon.icns", "icon.ico", "icon.png"]) fs.copyFileSync(path.join(generatedDirectory, file), path.join(buildDirectory, file));
  console.log("Generated desktop/build/icon.icns, icon.ico and icon.png from the original SVG.");
}

if (require.main === module) {
  try { buildIcon(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildIcon };
