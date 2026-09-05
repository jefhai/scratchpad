# Scratchpad repository guidance

The root is the authoritative static website: `core/` owns domain behavior,
`ui/` renders it, `commands/` contains lazy command implementations, and `app.js`
coordinates workspaces. Preserve this readable structure. The browser must
remain usable without a bundler or native runtime dependency.

## Release blocker: strict-offline WKWebView compatibility

The Tauri desktop app is an unverified native candidate, not release-ready.
WebKit's [XPC startup check](https://github.com/WebKit/WebKit/blob/safari-7624.1.16-branch/Source/WebKit/Shared/EntryPointUtilities/Cocoa/XPCService/XPCServiceEntryPoint.mm)
can reject sandboxed clients lacking both `com.apple.security.network.client`
and permitted Mach lookup of `com.apple.nsurlsessiond`, even for local content.
Compatibility of the exact no-network policy with installed macOS 26 WKWebView
must first be demonstrated by launching the signed app on supported hardware.
Node tests, Rust formatting, signatures, and entitlement audits do not prove it.
Never fix blank/failed startup by granting network access, adding Mach-lookup
temporary exceptions, or disabling App Sandbox. If this check blocks the app,
stop for a user decision and potentially a framework change. Do not publish or
claim a working verified-offline release until this gate and native tests pass.

## Desktop development

Read `desktop/README.md` for packaging, privacy, icon, and release details.
The desktop shell is Tauri 2 for macOS arm64 and Windows 11 x64. Shared Rust
is under `desktop/src-tauri/src/`, platform integration under `src/platform/`,
and installer inputs/instructions under `desktop/platforms/macos/` and
`desktop/platforms/windows/`. Common Tauri configuration has separate standard
macOS/Windows overrides. The narrow
renderer adapter is `desktop/bridge.js`. Do not maintain a second editor copy.
`desktop/.web/` is disposable staging from an explicit root allowlist. It vendors
pinned React production UMD assets, injects the bridge and fail-closed Tauri HTML
marker, and removes web-only release-download code/styles/preconnects. Update
`desktop/scripts/prepare-web.cjs` when adding a root runtime source.

Cross-platform source checks from the repository root:

```sh
node --test tests/*.test.cjs
node scripts/update-command-catalog.cjs --check
cd desktop
npm ci --ignore-scripts
npm run prepare:web
npm test
cargo metadata --locked --no-deps --format-version 1 --manifest-path src-tauri/Cargo.toml
```

On Apple Silicon with macOS Tahoe 26+, native arm64 Node.js 22.12+, stable Rust 1.89+,
and Xcode command-line tools, run `npm ci` in `desktop/`, then `npm start`.
Before launch, run `npm run prepare:web` and
`cargo test --locked --manifest-path src-tauri/Cargo.toml` on that Mac to execute
the Rust session/recovery/runtime tests. Node tests and rustfmt do not run them.
This builds/opens a signed, sandboxed debug app with embedded assets, not a
localhost dev server. `npm run dist:mac` makes a local ad-hoc signed DMG at
`desktop/dist/local/Scratchpad-arm64.dmg`. Preserve arm64-only packaging and
the macOS 26 minimum. Do not launch/build Mac installers on Windows or Intel.
Commit exact npm/Rust dependency pins with both lockfiles; build with Cargo
`--locked`. Package version, Cargo version/lock, and Tauri config must agree.

### Windows EXE builds

Read `desktop/platforms/windows/README.md` before Windows packaging. On Windows
11 x64 with x64 Node.js and Rust/MSVC plus the Windows 11 SDK, run from `desktop/`:

```powershell
npm ci
npm run prepare:web
npm run prepare:windows-runtime
npm test
cargo test --locked --features windows-policy --manifest-path src-tauri/Cargo.toml
npm run dist:windows
```

The unsigned candidate is
`desktop/dist/windows/local/Scratchpad-windows-x64-setup.exe`. It includes a
checksum-verified private WebView2 runtime and an app-scoped WFP policy helper.
It is not a portable EXE: normal elevated installation in Program Files is
required; runtime launch is unelevated and rejects missing policy before even
creating Tauri's runtime. Never use shared Edge/evergreen processes, weaken
network policy, kill a running app, or change system-wide browser/security
settings. Preserve setup mutex, installation marker, process quiescence checks,
protected ACLs, and lifetime lock. Runtime/code-signature validation is offline.
Windows sessions use `app_local_data_dir()/sessions`; reject network/reparse
paths for automatic state and private webview profiles. Multiple native windows
share one process; the last Windows window closing saves and quits.

For public signed output, configure
`SCRATCHPAD_WINDOWS_CERTIFICATE_THUMBPRINT` and
`SCRATCHPAD_WINDOWS_TIMESTAMP_URL`, then run `npm run dist:windows:release`.
The separate output is `desktop/dist/windows/release/Scratchpad-windows-x64-setup.exe`.
Audit the installed policy with `npm run audit:windows`, verify the intended
publisher, and complete the Windows README native checklist on a clean Windows
11 machine before publishing. No public installer claim until the verified
asset is actually attached to a public stable GitHub release. Keep the exact
asset name; the website discovers Windows and Mac independently. Do not publish
local unsigned candidates as verified releases. Build-time SDK/runtimes and
signing timestamps may use the network; installed-app code must not.

## Offline security and local data

Treat renderer content as untrusted. Keep a local-only capability scoped to
`scratchpad-*` windows and a small validated custom-command allowlist. Do not
grant generic plugin APIs, remote capabilities, arbitrary navigation, shells,
networking, or updater access. CSP permits local assets and Tauri IPC only.
All editor assets and lazy commands must be embedded and work offline.

Keep macOS App Sandbox enabled with only user-selected file read/write access.
Never add network entitlements, temporary exceptions, or other capabilities to
make a failure disappear. Every Mac build audits the signed app's exact
entitlement allowlist, architecture, minimum OS, and signature. Re-audit an
installed bundle with `npm run audit:mac -- /Applications/Scratchpad.app` from
`desktop/`. Signing-added application/team string identifiers are the only
additional permitted entitlement keys. Offline policy applies to the app,
not macOS security checks, Universal Clipboard, cloud file providers, or the
dependency/build/notarization process; document that boundary honestly.

Sessions are private, unencrypted local JSON in Tauri's resolved
`app.path().app_data_dir()/sessions` inside the Mac sandbox container for
`com.jeffreyhaines.scratchpad`; Windows uses `app_local_data_dir()/sessions`
under LocalAppData. Names are `session.json`,
`scratchpad-<uuid>.json`, `.json.bak` backups, and retained recovery files.
Confirm the actual container-resolved directory on a Mac rather than assuming
an old unsandboxed path. WKWebView preferences stay local. Never upload, commit,
print, or inspect actual pad content unless that data is explicitly in scope.
Keep contents out of diagnostics; add no telemetry or cloud synchronization.
Browser pads remain temporary. Closing a window removes it from restoration
but retains its last snapshot. Failed loads must preserve data and fail closed;
close/quit must flush pending edits and automatically keep windows open after
a save failure, without relying on an explicit Cancel dialog.

## Icon

`desktop/build/icon.svg` is original flattened, glass-inspired note/grid artwork.
From `desktop/`, `npm run icons:build` uses the pinned Tauri CLI to regenerate
checked-in `build/icon.icns`, `build/icon.ico`, and `build/icon.png`. Inspect the PNG and native Dock
rendering after changes; `build/generated/` is disposable.

A real Icon Composer document belongs at exactly
`desktop/build/Scratchpad.icon`, assembled from `build/icon-layers/` on current
macOS/Xcode 26+ tools (Icon Composer currently requires macOS 26.4+). In
`desktop/`, run `SCRATCHPAD_NATIVE_ICON=1 npm run dist:mac` or the release
equivalent. The pinned Tauri bundler compiles `.icon` with `actool` and extracts
the icon name with `assetutil`; the build must find both `Assets.car` and
`CFBundleIconName` afterward. Do not silently fall back if native compilation
was requested but failed. Visually validate the optional result on a Mac.
Do not claim the supplied flattened SVG/ICNS is native Liquid Glass. No Swift
bridge is required.

## Required native checks

Use actual supported Mac hardware before a release. Verify independent windows,
`Command+N` creation, `Command+Shift+R` names, native titles, named Dock/Window
menus, and per-window Always on Top above another application. Test
Scratchpad/Cellpad editing, commands, grid dimensions, clipboard, file dialogs,
and undo/redo. Quit with `Command+Q`, then verify names/bounds/pin states,
active tabs, contents, and histories restore; closed windows must remain closed.
Check Dock reactivation with no windows and save-failure/backup recovery using
disposable data. Disconnect networking and test an unused lazy command; also
audit actual signed entitlements and verify no app-initiated external
connections, including activity from WebKit/network helper processes.
Follow the complete desktop README checklist. Windows source tests do not prove
native compilation, launch, signing, sandbox enforcement, or these smoke checks.

## Public release

Local ad-hoc builds are not public artifacts. On the build Mac, configure
`APPLE_SIGNING_IDENTITY` as a full Developer ID Application identity and one
complete set of Tauri notarization credentials described in the desktop README.
Run `npm run dist:mac:release` in `desktop/`. The pipeline requires hardened
runtime signing, App Sandbox, app notarization/stapling, and signed DMG
notarization/stapling. Its output is
`desktop/dist/release/Scratchpad-arm64.dmg`. Keep it separate from local output.
Never commit certificates, keys, passwords, or credential files, and never
instruct users to bypass macOS security.

Before upload, run the bundle audit, verify the intended signing team with
`codesign`, require Notarized Developer ID from `spctl`, and validate app/DMG
stapling with `xcrun stapler validate`. Calculate the DMG SHA-256 and test a fresh
download on another supported Mac. Exact paths/commands are in the README.

Publication is a separate authorized action. Align versions, commit reviewed
source, and use a matching immutable tag. Attach the validated asset with
`gh release create <tag> desktop/dist/release/Scratchpad-arm64.dmg --repo
jefhai/scratchpad --verify-tag --draft ...`. After review and smoke testing,
publish a stable latest release with `gh release edit <tag> --repo
jefhai/scratchpad --draft=false --latest`. Never silently replace tags/assets.
Keep `Scratchpad-arm64.dmg` exact; the website's popup checks the latest public
GitHub release when opened, while the installed app contains no release lookup.
Do not claim the download exists until the release and asset are public.
