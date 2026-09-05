"use strict";

const path = require("node:path");
function merge(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === null) delete result[key];
    else if (typeof value === "object" && !Array.isArray(value)) result[key] = merge(result[key] || {}, value);
    else result[key] = value;
  }
  return result;
}
function platformConfig(platform) {
  if (!["macos", "windows"].includes(platform)) throw new Error("Unsupported desktop platform");
  return merge(require("../src-tauri/tauri.conf.json"), require(path.join("../src-tauri", `tauri.${platform}.conf.json`)));
}
module.exports = { merge, platformConfig };
