# Scratchpad desktop

Tauri 2 wraps the existing static React application in native windows. There is
one editor source tree, no Vite, no application server, and no Swift bridge.

| Target | Installer | Build instructions |
| --- | --- | --- |
| Windows 11, Intel/AMD x64 | `.exe` (NSIS) | [Windows](platforms/windows/README.md) |
| macOS Tahoe 26+, Apple Silicon | `.dmg` | [Mac](platforms/macos/README.md) |

These are native candidates, not verified public releases. Building an installer
is not proof that installation, window restoration, or offline enforcement works.
Mac additionally has an unresolved strict-sandbox WKWebView startup compatibility
gate described in its instructions. Do not weaken either platform's security
policy to make startup succeed. No Linux, Intel Mac, or Windows ARM build is
currently supported.

## Source organization

```text
repository root/              shared HTML, React, core/, ui/, commands/
desktop/
  bridge.js                  narrow renderer/native adapter
  scripts/                   staging, builds, audits, icon conversion
  platforms/
    macos/                   Mac entitlements and DMG instructions
    windows/                 NSIS hooks, pinned WebView2, EXE instructions
  src-tauri/
    tauri.conf.json          common identity, assets, permissions
    tauri.macos.conf.json    Mac-only bundle configuration
    tauri.windows.conf.json  Windows-only bundle configuration
    src/runtime.rs          windows, menus, commands, save/quit lifecycle
    src/session.rs          validated local storage and recovery
    src/platform/           platform-specific native integration
    webview2/               generated private Windows runtime (ignored)
  build/                     original shared icon, ICNS, ICO, PNG
  .web/                      generated embedded frontend (ignored)
  dist/                      generated installers (ignored)
```

Tauri automatically combines common configuration with the matching platform
configuration. Scripts select the architecture explicitly and separate local
and signed release output. Keep exact dependency versions and both lockfiles
in source control. Do not include the Windows runtime in the Mac bundle.

## Shared checks

From the repository root:

```sh
node --test tests/*.test.cjs
node scripts/update-command-catalog.cjs --check
cd desktop
npm ci --ignore-scripts
npm run prepare:web
npm test
```

On each supported build platform, also compile and execute the Rust tests with
its native compiler/SDK installed:

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

`prepare:web` replaces only generated `.web/`, copies an explicit root runtime
allowlist and pinned React UMD assets/licenses, then injects the native bridge.
All commands are embedded, even though they load lazily. It strips the website
download component, remote preconnects, and CDN assets. Missing native bridge
initialization fails closed instead of exposing an unsaved browser workspace.
Extend the allowlist when adding a root runtime source. `npm start` dispatches
to the current platform; Windows starts an already installed, audited app.

## Offline boundary

The desktop application has no updater, release lookup, telemetry, remote
assets, server, HTTP/shell/opener plugin, or generic filesystem bridge. CSP,
navigation filtering, and narrowly validated local IPC reduce renderer access.
Mac uses App Sandbox without network entitlements. Windows uses persistent,
executable-scoped Windows Filtering Platform blocks and a private fixed
WebView2 runtime; normal per-user firewall settings alone are not the boundary.
The Windows host checks the policy before creating any webview and fails closed.

This is an application boundary, not a promise that the entire operating system
is disconnected. Security checks, cloud clipboard, cloud-backed file providers,
and external administrator changes are outside it. Build dependency downloads,
signing/notarization, timestamps, and publishing may use the network. Never
claim a universal or untested "100%" guarantee. Test the exact installed app
and its private web-engine processes before publishing.

## Windows, tabs, and local data

Each native window has independent pad tabs, history, name, bounds, and Always
on Top setting. Use the Window menu or the visible window-name control. Mac's
Dock also lists named windows; Windows uses native window titles/taskbar and the
Window menu. Quitting saves open windows and restores them on relaunch. Closing
the last Windows window quits while retaining that last workspace; on Mac the
app stays available in the Dock after its windows close.

Validated snapshots and previous-good backups are unencrypted local JSON under
Tauri's resolved `app.path().app_data_dir()/sessions` on Mac, inside its sandbox.
Windows uses `app_local_data_dir()/sessions` under LocalAppData and rejects
network/reparse paths for automatic state and private webview storage. Confirm the platform-resolved
directory rather than assuming the browser's storage or an old Electron path.
Do not upload, commit, print, or inspect real user notes as diagnostics.
Failed saves keep windows open; damaged data is preserved for recovery instead
of silently overwritten. Browser pads remain temporary.

## Icon and public downloads

`build/icon.svg` is original, flattened glass-inspired note/grid artwork, not a
native Apple Liquid Glass asset. `npm run icons:build` regenerates ICNS, ICO,
and PNG using the pinned Tauri CLI. The optional real Icon Composer workflow is
documented in the Mac instructions.

The website-only download popup checks one public GitHub release when opened
and independently offers only the attached installer(s). Exact filenames are
`Scratchpad-windows-x64-setup.exe` and `Scratchpad-arm64.dmg`. A missing asset
shows "Not published yet"; never create a link pretending a build is available.
Publication requires reviewed source, a matching immutable tag, and native
verification. Signed Windows releases and signed/notarized Mac releases have
separate procedures in their instructions; never publish local candidates as
verified releases.
