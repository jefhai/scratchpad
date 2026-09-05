# Local desktop renderer fixture

Test only. This page uses the real root `index.html` script order, app code and styles, replacing the CDN React scripts with local copies from `desktop/.web/vendor`. It supplies a mock desktop bridge with three synthetic restored tabs. It has no native API or real session-file access.

Prepare the desktop web assets, run the repository's `tests/serve.cjs` local server, then open:

`http://127.0.0.1:4260/desktop/tests/fixtures/renderer-preview.html`

Verify the named desktop window bar, text and sheet tabs, preserved selection/scroll, resized sheet dimensions, calculation result, undo/redo, and the absence of the website download button. Click the window name to open the real rename dialog. Expand “TEST ONLY · mock desktop” for mock native menu actions, an on-top state toggle, a DOM check, flush/reload, and reset controls.

The synthetic session uses only the tab-scoped `sessionStorage` key `scratchpad:test-only:desktop-renderer-preview:v1`. Editor/theme preferences are replaced with an empty in-memory store, leaving ordinary browser preferences untouched. Reset removes only the named test key. Closing the browser tab removes its test session. The fixture refuses to run outside a loopback HTTP origin or over an existing desktop bridge.

These files live beneath `desktop/tests/fixtures`, outside Tauri's packaged frontend directory. This browser fixture does not validate native macOS/Windows runtime or offline enforcement.
