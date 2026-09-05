# Scratchpad for Mac

The desktop app uses Tauri 2, Rust, macOS WKWebView, and the website's existing
HTML, React, commands, and workspace code. It targets Apple Silicon (arm64)
with macOS Tahoe 26 or later. This page covers the arm64 Mac build; see
[Windows instructions](../windows/README.md) for the Windows 11 x64 installer.
No Swift implementation or second editor source tree is required. All commands
below run from `desktop/` unless explicitly introduced from the repository root.

## Compatibility gate: not release-ready

This is an unverified native candidate, not a release-ready offline Mac app.
Strict no-network App Sandbox compatibility with macOS 26 WKWebView has not
been established. WebKit's
[XPC startup entitlement check](https://github.com/WebKit/WebKit/blob/safari-7624.1.16-branch/Source/WebKit/Shared/EntryPointUtilities/Cocoa/XPCService/XPCServiceEntryPoint.mm)
accepts a sandboxed client with `com.apple.security.network.client` or permitted
Mach lookup of `com.apple.nsurlsessiond`; otherwise it rejects initialization.
Its source explicitly notes that this can be too strict even for local files.
This indicates a potential launch failure, not just blocked remote requests.
The exact behavior of the installed macOS 26 WebKit and sandbox profile still
requires a real signed-bundle launch test on supported hardware.

Do not fix a blank or failed app by adding networking, Mach-lookup temporary
exceptions, or disabling App Sandbox. First demonstrate successful startup and
local editing with the existing exact entitlement policy, then complete all
native tests below. A signature/entitlement audit or passing source tests alone
does not clear this gate. If macOS 26 WebKit rejects this policy, stop: a user
decision and potentially a framework change are required before proceeding.
Do not publish or describe the candidate as a verified offline desktop release.

## Build and run

Use an Apple Silicon Mac with macOS 26+, native arm64 Node.js 22.12+ and npm,
the current stable Rust toolchain (at least 1.89), and Xcode command-line tools. Install the
Rust target with `rustup target add aarch64-apple-darwin`. See the official
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

From the repository root:

```sh
cd desktop
npm ci
npm run prepare:web
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm start
```

`npm start` builds, ad-hoc signs, audits, and attempts to open a debug `.app`
bundle. It does not use a development HTTP server: it configures the same offline
sandbox policy as a distribution build. The host guard rejects non-macOS,
Intel/Rosetta Node, and macOS versions before 26.

Build a local testing DMG:

```sh
npm run dist:mac
```

The stable output is `desktop/dist/local/Scratchpad-arm64.dmg`. The application
is at `desktop/src-tauri/target/local/aarch64-apple-darwin/release/bundle/macos/Scratchpad.app`.
Local builds are explicitly ad-hoc signed and retain the hardened runtime and
App Sandbox. They are for testing on the build Mac, not public distribution.
Neither build command uploads anything.

Exact direct versions were checked against the official registries on September
5, 2026: Tauri CLI 2.11.4, Tauri Rust crate 2.11.5, tauri-build 2.6.3, and
React/react-dom 18.3.1. The npm API package is unnecessary because Tauri injects
its bundled core API. Commit both `package-lock.json` and `src-tauri/Cargo.lock`;
the Mac build passes `--locked` to Cargo. Update dependency manifests and locks
together. Release versions must agree across `package.json`, `Cargo.toml`,
`Cargo.lock`, and `tauri.conf.json`.

Cross-platform source checks do not launch the application:

```sh
cd desktop
npm ci --ignore-scripts
npm run prepare:web
npm test
cargo metadata --locked --no-deps --format-version 1 --manifest-path src-tauri/Cargo.toml
```

Do not attempt to build or launch the Mac app on Windows. Source tests and
manifest resolution do not establish native compilation or macOS behavior.
Run the Rust test command above on the supported Mac after preparing assets;
Node tests and formatter checks do not execute native session/recovery tests.

## Shared sources and installed-app offline policy

`npm run prepare:web` replaces only generated `desktop/.web/`. It copies the
root runtime allowlist plus `core/`, `ui/`, `commands/`, and `public/`, including
lazy commands. It copies pinned React production UMD files and their licenses
into `.web/vendor/`, and inserts `desktop/bridge.js` as the first deferred
script. The generated HTML is marked as Tauri so a missing native bridge fails
closed instead of opening an unsaved browser workspace. The root website is
unchanged. Extend `scripts/prepare-web.cjs` when adding root runtime files.

The desktop staging step removes the website's release-download component,
styles, and preconnect links. A missing local script/style or remote index
asset fails preparation. Tauri embeds `.web/` into the application; the editor
assets and lazy commands require no CDN, localhost server, browser extension,
or network request. This does not establish WKWebView startup compatibility;
see the gate above. The renderer CSP permits only local content and Tauri IPC.
There are no updater, HTTP, shell, opener, or networking plugins and no automatic
update check. Clipboard and file-save commands are narrowly validated Rust
operations, not general-purpose renderer plugin access.

`platforms/macos/entitlements.plist` enables macOS App Sandbox and user-selected file
read/write access only. It grants neither incoming nor outgoing networking.
Every Mac build audits the actual signed app, requiring both expected boolean
entitlements and rejecting all other entitlement keys except signing-added
application/team identifiers. In particular, network and temporary-exception
entitlements are forbidden. The audit also checks the signature, arm64-only
executable, and macOS 26 minimum. Recheck a built or installed app with:

```sh
npm run audit:mac -- /Applications/Scratchpad.app
```

This is an OS-enforced restriction on the app's own network access, not a claim
that the entire Mac is offline. macOS may perform security/notarization checks,
Universal Clipboard may sync copied text, and selecting a cloud-backed file
location may cause its provider to transfer that file. Those OS/provider
features are outside this app's sandbox. Choose local files and disable those
system features if that broader boundary matters. Dependency installation,
building with uncached dependencies, signing/notarization, and release
publication can use the network; they do not run inside the installed app.

## Icon

`build/icon.svg` is original note-and-grid artwork with translucent highlights.
The checked-in `build/icon.icns` and `build/icon.png` are flattened,
glass-inspired fallbacks. Regenerate them after editing the vector:

```sh
npm run icons:build
```

The pinned [Tauri icon command](https://v2.tauri.app/develop/icons/) converts the
SVG and writes disposable intermediates under `build/generated/`. Inspect the
PNG and native Finder/Dock rendering after artwork changes. Normal app builds
use the checked-in icons without a conversion download.

For native Liquid Glass artwork, Apple's
[Icon Composer](https://developer.apple.com/icon-composer/) can import
`build/icon-layers/note.svg` and `grid.svg` as separate layers on a shared
1024px canvas. Save the genuine document at `desktop/build/Scratchpad.icon`.
Current Icon Composer requires macOS 26.4+; select Xcode 26+ command-line tools.
With the genuine document saved at that exact path, use:

```sh
SCRATCHPAD_NATIVE_ICON=1 npm run dist:mac
# Or, with release credentials already configured:
SCRATCHPAD_NATIVE_ICON=1 npm run dist:mac:release
```

The [pinned Tauri icon pipeline](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/macos/icon.rs)
compiles `.icon` with `actool` into `Assets.car`; the bundler uses `assetutil` to
set `CFBundleIconName`. The wrapper requires a real document directory and
verifies both the compiled asset and Info.plist name after packaging. Missing
tools or skipped compilation fail the opt-in build instead of silently claiming
a native icon. The ICNS remains the fallback and DMG icon. This optional path
still requires visual validation on a Mac; no native document or compiled
Liquid Glass asset is supplied by the flattened SVG. No Swift code is needed.

## Local data and recovery

Each native window has its own workspace, name, bounds, and Always on Top
setting. The Dock and Window menu list named open windows. `Command+N` creates
a window; `Command+Shift+R` renames it. Closing a window removes it from the
next-launch restore list but retains its last snapshot for recovery. Quitting
with `Command+Q` saves and restores the windows still open.

Sessions are ordinary, unencrypted JSON under Tauri's
`app.path().app_data_dir()/sessions`, inside the macOS sandbox container for
`com.jeffreyhaines.scratchpad`. The exact platform-resolved directory should be
confirmed on the Mac; do not substitute the old non-sandboxed app-data path.
Files are named `session.json` and `scratchpad-<uuid>.json`, with `.json.bak`
previous-good backups and retained recovery copies where needed. Theme and
settings preferences are local WKWebView storage. Never upload session files,
attach them to issues, or commit them. Browser pad contents remain temporary;
the browser does not acquire desktop persistence.

Both sides of the bridge validate saved workspaces. Damaged or unsupported
snapshots fail closed and preserve recovery data instead of replacing them
with blank editable pads. Writes use atomic replacement and previous-good
backups. Close/quit first flushes pending edits; a failed save automatically
keeps the affected windows open rather than requiring a Cancel choice. Safety
limits bound window/tab counts, sheets, text, and
history; oversized current content reports a save error instead of silently
truncating it. Split or export content when a limit is reached.

## Signed and notarized public DMG

These release instructions apply only after the compatibility gate above and
all required native tests pass. The current candidate is not ready to publish.

Public distribution requires a Developer ID Application certificate, Apple's
notarization credentials, and `notarytool`/`stapler` from Xcode's command-line
tools. Keep all credentials in a secret manager or the build machine's secure
configuration, never source control. Configure the exact signing identity:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
```

The identity must be available in the Mac keychain. For CI, Tauri also supports
`APPLE_CERTIFICATE` (base64 `.p12`) and `APPLE_CERTIFICATE_PASSWORD`. Supply one
complete notarization method through your secret manager:

- Apple ID: `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), and
  `APPLE_TEAM_ID`.
- App Store Connect API: `APPLE_API_KEY` (key ID), `APPLE_API_KEY_PATH` (private
  `.p8` path), and `APPLE_API_ISSUER` (issuer ID).

See [Tauri's macOS signing variables](https://v2.tauri.app/distribute/sign/macos/).
Then run:

```sh
npm run dist:mac:release
```

The command requires Developer ID signing and complete notarization credentials.
Tauri signs/notarizes/staples the app and signs the DMG; the wrapper audits the
signed app, checks its notarization and Gatekeeper assessment, then submits and
staples the signed DMG too. Missing credentials, rejected submissions, or failed
validation stop the command. Its public artifact is
`desktop/dist/release/Scratchpad-arm64.dmg`, separate from local builds.

Before uploading, run from `desktop/`:

```sh
APP="src-tauri/target/release/aarch64-apple-darwin/release/bundle/macos/Scratchpad.app"
npm run audit:mac -- "$APP"
codesign --display --verbose=4 "$APP"
spctl --assess --type exec --verbose=2 "$APP"
xcrun stapler validate "$APP"
codesign --verify --strict --verbose=2 dist/release/Scratchpad-arm64.dmg
xcrun stapler validate dist/release/Scratchpad-arm64.dmg
shasum -a 256 dist/release/Scratchpad-arm64.dmg
```

The assessment must identify a Notarized Developer ID and the signature must
identify the intended developer/team. Install by opening the DMG and dragging
Scratchpad to Applications. Test a freshly downloaded release on another
supported Mac through the normal macOS security flow. Fix signing/notarization
failures in the build; do not publish local test DMGs or bypass Gatekeeper.

## Required Mac smoke checks

Native compilation, launch, signing, sandbox behavior, and these checks have
not been verified on the Windows development host. Before each release, use
real Apple Silicon hardware running current macOS 26+:

1. Install and start the app. Check its name and icon in Finder, the Dock, and
   the app switcher. Run `audit:mac` on the installed bundle.
2. Open two windows with `Command+N`, rename them with `Command+Shift+R`, and
   check distinct names in native titles, Window menu, and Dock window list.
3. Mix Scratchpad/Cellpad tabs in both windows. Type, select, resize rows and
   columns, use `Command+J` commands, and undo/redo. Check independent current
   tabs, contents, and histories, including clipboard and file import/export.
4. Toggle Always on Top in one window and put another application in front.
   Confirm only that window stays above it, and normal stacking returns when
   unpinned.
5. Move/resize and rename windows, change pin settings, then quit with
   `Command+Q`. Relaunch and verify window names/bounds/pin states and workspace
   tabs/content/history restore. Closed windows must not return. With all
   windows closed, clicking the Dock must open a usable window.
6. Exercise close/quit during edits and after a simulated save failure using
   disposable test data. Save failure must automatically keep the windows open.
   Test backup recovery
   without putting real user notes in diagnostics.
7. Disconnect networking, restart, and invoke a previously unused lazy command.
   Verify editing, clipboard, local file dialogs, and themes. Inspect network
   activity under controlled conditions as well as checking the signed
   entitlements, including WKWebView's WebKit/network helper processes; there
   must be no app-initiated external connections or update check.

## GitHub release handoff

Publish only the validated public DMG to `jefhai/scratchpad`, and only when
publication is separately authorized. Align the version in both manifests and
the Tauri config/locks, commit reviewed source, and create/push a matching
immutable release tag through the approved process. Never replace a tag/asset.

For version `1.0.0`, with `v1.0.0` already on GitHub, from the repository root:

```sh
gh release create v1.0.0 desktop/dist/release/Scratchpad-arm64.dmg --repo jefhai/scratchpad --verify-tag --draft --title "Scratchpad 1.0.0" --notes "Offline Scratchpad for Apple Silicon, requiring macOS Tahoe 26 or later."
```

Inspect the draft and smoke-test its downloaded attachment. After approval,
publish the stable release and mark it latest:

```sh
gh release edit v1.0.0 --repo jefhai/scratchpad --draft=false --latest
```

Keep the exact filename `Scratchpad-arm64.dmg`. The website checks the public
latest release only when its download popup opens; that lookup code is not
packaged in the desktop app. Its stable address is the
[latest Mac DMG](https://github.com/jefhai/scratchpad/releases/latest/download/Scratchpad-arm64.dmg).
A local build does not make this link downloadable; the release and asset must
actually be public.
