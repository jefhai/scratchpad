const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const { API_URL, PLATFORMS, isWebApp, selectDownload, checkDesktopDownloads } = require("../ui/download-app.js");
const selectMacDownload = release => selectDownload(release, "mac");

function release(overrides = {}) {
  return {
    tag_name: "v1.0.0", draft: false, prerelease: false,
    assets: [{ name: "Scratchpad-arm64.dmg", state: "uploaded", size: 1234,
      browser_download_url: "https://github.com/jefhai/scratchpad/releases/download/v1.0.0/Scratchpad-arm64.dmg" }],
    ...overrides,
  };
}

test("only the HTTP(S) web app offers desktop downloads", () => {
  assert.equal(isWebApp({ location: { protocol: "https:" } }), true);
  assert.equal(isWebApp({ location: { protocol: "http:" } }), true);
  assert.equal(isWebApp({ location: { protocol: "https:" }, ScratchpadDesktop: {} }), false);
  assert.equal(isWebApp({ location: { protocol: "file:" } }), false);
  assert.equal(isWebApp({ location: { protocol: "scratchpad:" } }), false);
  assert.equal(isWebApp({ location: { protocol: "tauri:" } }), false);
  assert.equal(isWebApp({}), false);
});

test("rendering the web workspace makes no release lookup before the download is opened", () => {
  const effects = [];
  let requests = 0;
  const browser = vm.createContext({
    URL, location: { protocol: "https:" }, ScratchpadUI: { usePopover() {} },
    fetch() { requests++; },
    React: {
      useEffect(callback) { effects.push(callback); }, useRef() { return { current: null }; },
      useState(value) { return [value, () => {}]; },
      createElement(type, props, ...children) { return { type, props, children }; },
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve("../ui/download-app.js"), "utf8"), browser);
  browser.ScratchpadUI.DesktopDownload();
  effects.forEach((effect) => effect());
  assert.equal(requests, 0);
});

test("only an uploaded ARM DMG in a public stable release is selected", () => {
  assert.deepEqual(selectMacDownload(release()), {
    url: release().assets[0].browser_download_url, version: "v1.0.0", name: "Scratchpad-arm64.dmg",
  });
  for (const input of [null, {}, release({ draft: true }), release({ prerelease: true }),
    release({ assets: [] }), release({ tag_name: null }), release({ tag_name: "" }), release({ tag_name: "\ud800" })]) {
    assert.equal(selectMacDownload(input), null);
  }
  for (const changes of [{ name: "Scratchpad-x64.dmg" }, { state: "new" }, { size: 0 }, { size: "1234" }]) {
    assert.equal(selectMacDownload(release({ assets: [{ ...release().assets[0], ...changes }] })), null);
  }
});

test("untrusted asset links cannot redirect downloads to other code or repositories", () => {
  for (const url of [
    "javascript:alert(1)", "data:text/html,hello", "https://example.com/Scratchpad-arm64.dmg",
    "https://github.com/other/scratchpad/releases/download/v1.0.0/Scratchpad-arm64.dmg",
    "https://github.com/jefhai/scratchpad/releases/download/v2.0.0/Scratchpad-arm64.dmg",
    "https://github.com@evil.test/jefhai/scratchpad/releases/download/v1.0.0/Scratchpad-arm64.dmg",
    "https://github.com/jefhai/scratchpad/releases/download/v1.0.0/Scratchpad-arm64.dmg?redirect=bad",
    "https://github.com/jefhai/scratchpad/releases/download/v1.0.0/Scratchpad-arm64.dmg#bad",
  ]) {
    assert.equal(selectMacDownload(release({ assets: [{ ...release().assets[0], browser_download_url: url }] })), null);
  }
});

test("public lookup omits credentials, referrer and pad data", async () => {
  const result = await checkDesktopDownloads(async (url, options) => {
    assert.equal(url, API_URL);
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal(options.redirect, "error");
    assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, { Accept: "application/vnd.github+json" });
    return { ok: true, status: 200, json: async () => release() };
  });
  assert.equal(result.status, "available");
  assert.equal(result.downloads.mac.name, "Scratchpad-arm64.dmg");
  assert.equal(result.downloads.windows, undefined);
});

test("no release and releases without an installer stay unavailable", async () => {
  assert.deepEqual(await checkDesktopDownloads(async () => ({ status: 404 })), { status: "unavailable", downloads: {} });
  assert.deepEqual(await checkDesktopDownloads(async () => ({ ok: true, status: 200, json: async () => release({ assets: [] }) })),
    { status: "unavailable", downloads: {} });
});

test("network, API limits and invalid responses fail without poisoning a retry", async () => {
  let attempts = 0;
  const fetchRelease = async () => {
    if (++attempts === 1) throw new Error("Offline");
    return { ok: true, status: 200, json: async () => release() };
  };
  await assert.rejects(checkDesktopDownloads(fetchRelease), /Offline/);
  assert.equal((await checkDesktopDownloads(fetchRelease)).status, "available");
  await assert.rejects(checkDesktopDownloads(async () => ({ ok: false, status: 403 })), /Could not check/);
  await assert.rejects(checkDesktopDownloads(async () => ({ ok: true, status: 200, json: async () => ({}) })), /incomplete/);
});

test("closing the popup and timeouts can abort an outstanding lookup", async () => {
  const fetchRelease = async (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
  });
  const controller = new AbortController();
  const pending = checkDesktopDownloads(fetchRelease, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /Aborted/);
  await assert.rejects(checkDesktopDownloads(fetchRelease, { timeoutMs: 5 }), /Aborted/);
});

test("Windows and Mac downloads are independently available from one public release request", async () => {
  const windowsAsset = { name: "Scratchpad-windows-x64-setup.exe", state: "uploaded", size: 3210,
    browser_download_url: "https://github.com/jefhai/scratchpad/releases/download/v1.0.0/Scratchpad-windows-x64-setup.exe" };
  let requests = 0;
  const both = await checkDesktopDownloads(async () => {
    requests++;
    return { ok: true, status: 200, json: async () => release({ assets: [...release().assets, windowsAsset] }) };
  });
  assert.equal(requests, 1);
  assert.equal(both.status, "available");
  assert.deepEqual(Object.keys(both.downloads).sort(), ["mac", "windows"]);
  assert.equal(both.downloads.windows.name, windowsAsset.name);
  const windowsOnly = await checkDesktopDownloads(async () => ({ ok: true, status: 200,
    json: async () => release({ assets: [windowsAsset] }) }));
  assert.equal(windowsOnly.status, "available");
  assert.equal(windowsOnly.downloads.mac, undefined);
  assert.equal(windowsOnly.downloads.windows.url, windowsAsset.browser_download_url);
});

test("each platform accepts only its exact approved filename and repository URL", () => {
  for (const platform of PLATFORMS) {
    const asset = { name: platform.assetName, state: "uploaded", size: 1,
      browser_download_url: `https://github.com/jefhai/scratchpad/releases/download/v1.0.0/${platform.assetName}` };
    assert.equal(selectDownload(release({ assets: [asset] }), platform.id).name, platform.assetName);
    for (const change of [{ name: `other-${platform.assetName}` }, { state: "new" }, { size: 0 },
      { browser_download_url: `https://example.com/${platform.assetName}` },
      { browser_download_url: `${asset.browser_download_url}?download=1` }]) {
      assert.equal(selectDownload(release({ assets: [{ ...asset, ...change }] }), platform.id), null);
    }
  }
  assert.equal(selectDownload(release(), "unknown"), null);
  assert.equal(selectDownload(release(), "__proto__"), null);
});
