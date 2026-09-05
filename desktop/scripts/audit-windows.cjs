"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function auditWindows(installRoot) {
  if (process.platform !== "win32") throw new Error("Run the installed-app audit on Windows 11.");
  const directory = path.resolve(installRoot || path.join(process.env.ProgramW6432 || process.env.ProgramFiles, "Scratchpad"));
  const helper = path.join(directory, "scratchpad-policy.exe");
  if (!fs.existsSync(helper)) throw new Error("Install Scratchpad before auditing its offline network policy.");
  execFileSync(helper, ["audit", directory], { stdio: "inherit", windowsHide: true });
}
if (require.main === module) {
  try { auditWindows(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { auditWindows };
