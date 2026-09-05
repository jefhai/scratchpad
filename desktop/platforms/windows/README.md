# Scratchpad for Windows 11

The Windows target is a Tauri/Win32 desktop app, not UWP. It uses the same
static React sources and Rust session runtime as the Mac build. The NSIS
`.exe` installer targets Windows 11 x64 (Intel/AMD), build 22000 or later.
Windows ARM and Windows 10 are intentionally rejected. No separate web server
or online bootstrap installer runs on the user's machine.

This is a native candidate. A successful build alone does not clear the
installation, restoration, offline-policy, and clean-machine checks below.
Never publish an untested candidate as a verified offline release.

## Build a local installer

Use Windows 11 x64, native x64 Node.js 22.12+ and npm, stable Rust 1.89+ with
the `x86_64-pc-windows-msvc` target, and Microsoft C++ Build Tools with the
Windows 11 SDK. Install prerequisites with the machine owner's approval;
see [Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/).

From the repository root, in Developer PowerShell for x64:

```powershell
node --test tests/*.test.cjs
cd desktop
npm ci
npm run prepare:web
npm run prepare:windows-runtime
npm test
cargo test --locked --features windows-policy --manifest-path src-tauri/Cargo.toml
npm run dist:windows
```

`prepare:windows-runtime` downloads Microsoft's pinned, fixed-version x64
WebView2 CAB for the build, verifies its SHA-256, and expands only that verified
archive. The version, official URL, and checksums live in `webview2.json` beside
this document. The generated `desktop/src-tauri/webview2/` tree is checked
against its complete file inventory before every build and embedded under
`$INSTDIR\webview2`. Keep this direct relative path: Tauri uses the same path
for bundling and for locating the runtime. Never substitute a shared Evergreen
runtime, add a downloader, or remove Microsoft license/notice files.

The build enables the `windows-policy` Cargo feature, compiles the app and
`scratchpad-policy.exe`, then bundles both into NSIS output. This feature is not
enabled on Mac, so no Windows helper is included in a Mac bundle. Static Visual C++
runtime linkage avoids downloading a VC redistributable at installation time.
The private WebView2 payload makes this installer larger than a usual Tauri app.
Build tools, cached SDKs, runtime files, and installers are ignored by Git.

Local output is unsigned, for testing only:

```text
desktop/dist/windows/local/Scratchpad-windows-x64-setup.exe
desktop/dist/windows/local/Scratchpad-windows-x64-setup.exe.sha256
```

The build neither installs nor launches the app. Running a loose executable
from a build folder is deliberately unsupported: it lacks the protected
installation and offline policy. After normal installation, `npm start` audits
the installed policy before launching the app.

### Optional project-local LLVM toolchain

For machines without an installed compiler, LLVM plus locally extracted
Microsoft SDK/CRT files can build the same MSVC Rust target without modifying
system PATH or registry. Obtain the tools from their official sources, verify
downloads, accept the applicable Microsoft license before extraction, and
retain build-tool license files. Do not ship SDK/CRT build directories.

In the child build process only, set `SCRATCHPAD_WINDOWS_PORTABLE=1`, absolute
executable paths for `CARGO`, `RUSTC`, `CC` (clang-cl), `RC` (llvm-rc), and
`CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER` (lld-link). Set `LIB` to the x64
CRT/SDK library directories, `INCLUDE` to their header directories, and prepend
the compiler/Cargo directories to that process's PATH. Set `CARGO_HOME` to the
chosen local cache. `windows.cjs` validates these inputs and skips Visual Studio
discovery; it does not download or install a compiler implicitly. With llvm-rc,
use UTF-8 resource input (`/C 65001`) so the original copyright renders correctly.
The regular Microsoft Build Tools route is the default documented workflow.

## Installation and offline enforcement

Install through the normal NSIS wizard and Windows administrator approval.
The only accepted destination is native `Program Files\Scratchpad`, with
protected ACLs. The app runs unelevated after installation. Setup does not
change shared Edge settings, disable Windows security, or kill processes.

The elevated policy helper installs persistent Windows Filtering Platform
(WFP) filters under app-owned provider/sublayer IDs. They block inbound and
outbound IPv4/IPv6 traffic for the exact installed app/helper/uninstaller and
every executable in the private WebView2 tree. These are kernel filtering
objects, not rules that rely solely on a local Windows Firewall profile's
enabled state. BFE and the expected filters must be present and valid before
the host creates the Tauri runtime or a webview. Missing policy, an altered
installation, an unexpected runtime override, or an unavailable lock fails
closed; do not repair a launch failure by granting network access.

A machine-wide setup mutex serializes installers. A protected lifetime file
lock and `.scratchpad-installing` marker prevent the host launching while
files/policy are replaced. Setup/removal refuses while the app or any private
runtime process remains alive, including orphaned browser children; it never
terminates them. Quit normally and wait for their exit. The lock currently
permits one Scratchpad process per PC, containing multiple native windows.
Two concurrent Windows users cannot run separate instances of this installation.

Interrupted installs remain marked and cannot launch; rerun the same installer
to repair. Standard NSIS uninstall removes only Scratchpad's policy after the
protected processes have stopped, then removes its installed files. Do not use
nonstandard in-place uninstaller switches. Session data is retained unless the
user explicitly chooses its removal in the uninstall UI.

From `desktop/`, audit an installed copy without changing it:

```powershell
npm run audit:windows -- 'C:\Program Files\Scratchpad'
```

The host also rejects WebView2 environment/registry overrides rather than
silently using a different engine. It creates a private WebView2 environment
with automatic crash uploads/extensions disabled and local request filtering.
Runtime signature verification is cache-only: it does not retrieve certificates
or revocation data over the network. WFP remains the network boundary; browser
flags or CSP alone would not cover engine background activity.

This boundary does not disconnect Windows services, cloud clipboard, cloud
file providers, or an external administrator. There is no universal "100%"
guarantee against OS compromise or policy changes. The build, code-signing
timestamps, and publication can use the network. No updater or release lookup
is included in the installed app. The fixed runtime will not update itself;
maintainers must review/pin a patched version and ship a newly verified app.

## Native verification before publication

Use disposable test data on supported Windows 11 hardware/VM. Do not alter a
user's notes, system policy, or shared runtime to simulate failures.

1. Install with networking disconnected on a clean Windows 11 x64 machine.
   Verify no WebView2 or VC runtime download is needed. Check the app icon,
   normal unelevated startup, and the installed helper's `audit` output.
2. Create/rename multiple windows, check native titles and the Window menu,
   and verify per-window Always on Top. Use Ctrl+N, Ctrl+Shift+R, and Ctrl+J.
3. Mix text/grid tabs; exercise editing, commands, clipboard, local file
   import/export, selection, cell resizing, keyboard shortcuts, and undo/redo.
4. Move/resize windows and quit during an edit. Relaunch and verify content,
   names, bounds, pin settings, active tabs, and history. Closing the final
   Windows window must preserve that last workspace for relaunch. A closed
   non-final window must not return.
5. Test failed-save and backup recovery without discarding test data. A failed
   save must keep the affected window open. Confirm a second process, unsafe
   runtime override, unprotected path, and missing installation marker/lock
   state cannot bypass startup validation.
6. In an isolated test machine, verify missing WFP filters/BFE and interrupted
   setup fail closed. Exercise repair, concurrent setup, and uninstall with
   running/orphaned private runtime processes. Uninstall must remove only the
   app-owned filters and leave unrelated network behavior intact.
7. Trace actual app and all private runtime network activity, including IPv4,
   IPv6, DNS, startup/idle, invalid remote navigation, and error/crash paths.
   Verify no successful external connection. Disconnect/restart and invoke an
   unused lazy command. Passing source tests is not a substitute for this check.

## Signed public EXE

Keep local unsigned testing separate from public releases. Configure a Windows
code-signing certificate in the build user's certificate store and use the
provider's HTTPS RFC3161 timestamp service:

```powershell
$env:SCRATCHPAD_WINDOWS_CERTIFICATE_THUMBPRINT = '<40-hex-character thumbprint>'
$env:SCRATCHPAD_WINDOWS_TIMESTAMP_URL = 'https://<your-signing-provider>/...'
npm run dist:windows:release
```

This compiles before signing the helper, app, and installer; the separate bundle
step cannot rebuild and erase the helper's signature. The pinned Tauri bundler also signs
its uninstaller. Signature verification must pass. Do not commit private keys,
passwords, or certificates. `TAURI_WINDOWS_SIGNTOOL_PATH` may point to an explicit
SignTool executable; the wrapper and bundler use the same resolved tool. The output is
`desktop/dist/windows/release/Scratchpad-windows-x64-setup.exe` and its SHA-256
sidecar. Check the intended publisher, not just the presence of a signature,
then test a freshly downloaded installer through normal Windows security.
Do not instruct users to disable SmartScreen or other protection.

After the native checks pass and publication is authorized, commit reviewed
source, create a matching immutable tag, and attach the signed EXE plus checksum
to a draft GitHub release in `jefhai/scratchpad`. Publish a stable latest release
only after reviewing the downloaded attachment. Keep the asset name exact:
`Scratchpad-windows-x64-setup.exe`. The website popup automatically discovers
it; no installer is copied into the website repository. Mac can remain
unavailable until its separate native gate and signing/notarization pass.
