"use strict";

const path = require("node:path");
const { assertMacHost, verifyOfflineBundle } = require("./mac.cjs");

try {
  assertMacHost();
  if (!process.argv[2] || process.argv.length !== 3) throw new Error('Pass the .app bundle path: npm run audit:mac -- "/Applications/Scratchpad.app"');
  const appPath = path.resolve(process.argv[2]);
  if (!appPath.endsWith(".app")) throw new Error("Expected a .app bundle path.");
  verifyOfflineBundle(appPath);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
