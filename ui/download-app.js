(() => {
  const API_URL = "https://api.github.com/repos/jefhai/scratchpad/releases/latest";
  const RELEASE_URL = "https://github.com/jefhai/scratchpad/releases";
  const PLATFORMS = Object.freeze([
    Object.freeze({ id: "windows", name: "Windows", assetName: "Scratchpad-windows-x64-setup.exe",
      requirements: "Windows 11 · Intel or AMD 64-bit", extension: ".exe" }),
    Object.freeze({ id: "mac", name: "Mac", assetName: "Scratchpad-arm64.dmg",
      requirements: "Apple silicon (M1 or newer) · macOS Tahoe 26+", extension: ".dmg" }),
  ]);

  function isWebApp(environment = globalThis) {
    return !environment.ScratchpadDesktop && ["https:", "http:"].includes(environment.location?.protocol);
  }

  // Only known, uploaded installers in this repository's public stable release are downloads.
  function selectDownload(release, platformId) {
    const platform = PLATFORMS.find(candidate => candidate.id === platformId);
    if (!platform) return null;
    if (!release || release.draft !== false || release.prerelease !== false
      || typeof release.tag_name !== "string" || !release.tag_name || release.tag_name.length > 128
      || !Array.isArray(release.assets)) return null;
    const asset = release.assets.find((candidate) => candidate?.name === platform.assetName
      && candidate.state === "uploaded" && Number.isSafeInteger(candidate.size) && candidate.size > 0);
    if (!asset || typeof asset.browser_download_url !== "string") return null;
    let expected;
    try {
      expected = `https://github.com/jefhai/scratchpad/releases/download/${encodeURIComponent(release.tag_name)}/${platform.assetName}`;
      if (new URL(expected).href !== expected) return null;
    } catch { return null; }
    // Exact matching also rejects credentials, foreign repositories, queries, and executable schemes.
    if (asset.browser_download_url !== expected) return null;
    return { url: expected, version: release.tag_name, name: platform.assetName };
  }

  async function checkDesktopDownloads(fetchRelease = globalThis.fetch, { signal, timeoutMs = 10000 } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, timeoutMs);
    try {
      const response = await fetchRelease(API_URL, {
        method: "GET", headers: { Accept: "application/vnd.github+json" },
        credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: controller.signal,
      });
      if (response.status === 404) return { status: "unavailable", downloads: {} };
      if (!response.ok) throw new Error("Could not check the public desktop release.");
      const release = await response.json();
      if (!release || typeof release !== "object" || !Array.isArray(release.assets)) {
        throw new Error("The public release response was incomplete.");
      }
      const downloads = {};
      for (const platform of PLATFORMS) {
        const download = selectDownload(release, platform.id);
        if (download) downloads[platform.id] = download;
      }
      return { status: Object.keys(downloads).length ? "available" : "unavailable", downloads };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }

  const api = { PLATFORMS, API_URL, RELEASE_URL, isWebApp, selectDownload, checkDesktopDownloads };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof React === "undefined") return;
  const UI = globalThis.ScratchpadUI ??= {};
  const { useEffect, useRef, useState } = React;
  const h = React.createElement;

  function DesktopDownload() {
    const [open, setOpen] = useState(false), [attempt, setAttempt] = useState(0);
    const [release, setRelease] = useState({ status: "checking", downloads: {} });
    const buttonRef = useRef(null), panelRef = useRef(null);
    const visible = isWebApp();
    UI.usePopover("desktop-download-menu", open, setOpen, buttonRef, panelRef);

    useEffect(() => {
      if (!visible || !open) return;
      const controller = new AbortController();
      let active = true;
      setRelease({ status: "checking", downloads: {} });
      checkDesktopDownloads(globalThis.fetch, { signal: controller.signal }).then(
        (result) => { if (active) setRelease(result); },
        () => { if (active) setRelease({ status: "error", downloads: {} }); },
      );
      return () => { active = false; controller.abort(); };
    }, [visible, open, attempt]);

    if (!visible) return null;
    const close = () => { setOpen(false); buttonRef.current?.focus({ preventScroll: true }); };
    return h("div", { className: "desktop-download-wrap" },
      h("button", {
        className: "desktop-download-button", type: "button", ref: buttonRef,
        onClick: () => { setRelease({ status: "checking", downloads: {} }); setOpen(!open); },
        "aria-haspopup": "dialog", "aria-expanded": open, "aria-controls": "desktop-download-menu",
        "aria-label": "Download Scratchpad for Windows or Mac", title: "Download Scratchpad for Windows or Mac",
      }, h("span", { className: "desktop-download-label" }, "Download app"),
      h("span", { className: "desktop-download-short-label", "aria-hidden": "true" }, "Get app")),
      open && h("section", {
        className: "desktop-download-menu", id: "desktop-download-menu", ref: panelRef,
        role: "dialog", "aria-labelledby": "desktop-download-title",
      },
        h("div", { className: "settings-heading" },
          h("div", null, h("span", null, "DESKTOP APP"), h("strong", { id: "desktop-download-title" }, "Scratchpad for desktop")),
          h("button", { type: "button", onClick: close, "aria-label": "Close app downloads" }, "×"),
        ),
        h("div", { className: "desktop-download-status", role: "status", "aria-live": "polite" },
          release.status === "checking" && h("p", null, "Checking for desktop downloads…"),
          release.status === "unavailable" && h("p", null, "Installers will appear here when they are published."),
          release.status === "error" && h("p", null, "Couldn’t check downloads. Try again or view releases on GitHub."),
          release.status === "available" && h("p", null, "Available installers are listed below."),
        ),
        ...PLATFORMS.map(platform => {
          const download = release.downloads[platform.id];
          return h("section", { key: platform.id, className: "desktop-download-option", "aria-label": `${platform.name} app` },
            h("strong", null, platform.name),
            h("p", { className: "desktop-download-platform" }, platform.requirements),
            download ? h("a", {
              className: "desktop-download-link", href: download.url, target: "_blank", rel: "noopener noreferrer",
            }, `Download for ${platform.name} (${platform.extension})`,
            h("span", { className: "desktop-download-version" }, download.version))
              : h("small", { className: "desktop-download-platform" },
                release.status === "checking" ? "Checking…" : release.status === "error" ? "Download status unavailable" : "Not published yet"),
          );
        }),
        h("div", { className: "desktop-download-links" },
          release.status !== "checking" && h("button", {
            type: "button", onClick: () => setAttempt(attempt + 1),
          }, release.status === "error" ? "Try again" : "Check again"),
          h("a", { href: RELEASE_URL, target: "_blank", rel: "noopener noreferrer" }, "View GitHub releases ↗"),
        ),
        h("small", { className: "desktop-download-privacy" }, "Checks public release details on GitHub. No pad contents are sent."),
      ),
    );
  }

  UI.DesktopDownload = DesktopDownload;
})();
