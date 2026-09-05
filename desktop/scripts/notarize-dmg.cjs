"use strict";

const { execFileSync } = require("node:child_process");

function authenticationArguments(env) {
  // Tauri's environment names differ from other desktop packagers.
  if (env.APPLE_ID || env.APPLE_PASSWORD) {
    if (!env.APPLE_ID || !env.APPLE_PASSWORD || !env.APPLE_TEAM_ID) throw new Error("Incomplete Apple ID notarization credentials.");
    return ["--apple-id", env.APPLE_ID, "--password", env.APPLE_PASSWORD, "--team-id", env.APPLE_TEAM_ID];
  }
  if (env.APPLE_API_KEY || env.APPLE_API_KEY_PATH || env.APPLE_API_ISSUER) {
    if (!env.APPLE_API_KEY || !env.APPLE_API_KEY_PATH || !env.APPLE_API_ISSUER) throw new Error("Incomplete API key notarization credentials.");
    return ["--key", env.APPLE_API_KEY_PATH, "--key-id", env.APPLE_API_KEY, "--issuer", env.APPLE_API_ISSUER];
  }
  throw new Error("Notarization credentials are missing.");
}

function notarizeDmg(appPath, dmgPath, env = process.env) {
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  execFileSync("/usr/bin/xcrun", ["stapler", "validate", appPath], { stdio: "inherit" });
  execFileSync("/usr/sbin/spctl", ["--assess", "--type", "exec", "--verbose=2", appPath], { stdio: "inherit" });
  execFileSync("/usr/bin/codesign", ["--verify", "--strict", dmgPath], { stdio: "inherit" });
  console.log("Submitting the signed DMG to Apple for notarization…");
  let submission;
  try {
    const output = execFileSync("/usr/bin/xcrun", ["notarytool", "submit", dmgPath, ...authenticationArguments(env), "--wait", "--output-format", "json"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env,
    });
    submission = JSON.parse(output);
  } catch {
    // Child-process errors can embed credential arguments. Keep them out of logs.
    throw new Error("DMG notarization did not complete. Check your Apple credentials and notarization history; do not publish this artifact.");
  }
  if (submission.status !== "Accepted") throw new Error(`DMG notarization was not accepted (submission ${submission.id || "unknown"}). Review the Apple log before publishing.`);
  execFileSync("/usr/bin/xcrun", ["stapler", "staple", dmgPath], { stdio: "inherit" });
  execFileSync("/usr/bin/xcrun", ["stapler", "validate", dmgPath], { stdio: "inherit" });
  console.log("Public DMG is signed and notarized; perform the Mac smoke checks before upload.");
}

module.exports = { authenticationArguments, notarizeDmg };
