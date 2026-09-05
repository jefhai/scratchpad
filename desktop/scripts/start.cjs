"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const platform = { darwin: "mac.cjs", win32: "windows.cjs" }[process.platform];
if (!platform) {
  console.error("Scratchpad desktop supports Apple Silicon macOS and Windows 11 x64.");
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, [path.join(__dirname, platform), "start"], { stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
