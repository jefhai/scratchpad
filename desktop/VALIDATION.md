# Native candidate validation — September 5, 2026

This records what was actually checked, not a certification of offline behavior.
Update this record when the native code or packaging changes.

## Passed

- Windows 11 x64 native Cargo check and linking with Rust 1.98.1, project-local
  LLVM 23.1.0, Microsoft CRT 14.51, and SDK 10.0.28000.
- 13 native library tests and 4 Windows policy-helper tests, including Windows
  atomic replacement, previous-good backups, and interprocess file locking.
  WFP unit tests do not change live system policy.
- 83 JavaScript tests and metadata agreement for all 56 lazy commands.
- Embedded frontend staging with local React and no web release-lookup code.
- Final x64 NSIS installer build using the `windows-policy` feature, private
  WebView2 152.0.4191.62, static VC runtime linkage, and both native binaries.
- All 548 runtime files still match the verified extraction inventory after
  packaging. Main application and helper import Windows system DLLs, not a
  separate downloadable VC runtime.
- Website download popup, independent platform availability, X/Escape dismissal,
  and fit at 320×568 without horizontal page overflow. Browser viewport restored.

Unsigned local candidate:

```text
desktop/dist/windows/local/Scratchpad-windows-x64-setup.exe
287725469 bytes
SHA-256 c8522f897cd8906ce2401a0fcac562d66b446a80e98401df01d27a2ec3dab4b3
```

The artifact and checksum sidecar are generated locally and not committed.
Compiler warnings about unavailable Microsoft CRT PDBs concern debug symbols;
the executable and installer link successfully.

## Not yet verified / not published

- Windows installation, unelevated GUI startup, effective WFP enforcement,
  clean-machine operation, multiwindow restoration, repair/uninstall, reboot
  persistence, and network traffic inspection.
- Administrator installation testing was blocked by automatic safety review
  pending explicit user approval for the unsigned installer and its persistent
  app-specific policy. No installation or live WFP change was performed.
- No Windows code-signing identity was supplied. No public Windows release asset
  was uploaded. The download popup correctly reports no published installer.
- macOS arm64 native compilation, strict no-network WKWebView startup, sandbox
  enforcement, native window/Dock behavior, DMG signing, and notarization.
  The Mac compatibility gate remains open; see the Mac instructions.

Do not weaken either platform's offline policy or present this candidate as a
verified public release to clear these outstanding checks.
