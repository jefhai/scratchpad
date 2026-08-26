# Scratchpad

A focused, fully static browser-based text transformation utility built with React.

## What is included

- 48 transformations for JSON, CSV, encoding, case conversion, text cleanup, numbers, JWTs, hashes, and Unix timestamps
- A searchable command palette opened with `Ctrl+J` or `Command+J`
- Selection-aware editing, line numbers, undo/redo, Tab/Shift+Tab indentation, open/save, and clipboard support
- Seven persistent contrast themes with configurable editor and tab spacing

## Serve it

No build or package installation is required. Serve this folder with any static
file server, or publish it directly with GitHub Pages.

The site consists of:

- `index.html`
- `app.js` (the React UI bundle; command definitions are external)
- `app.css`
- `mobile.css`
- `keyboard-shortcuts.js`
- `themes.js`
- `commands/registry.js` and one readable file per built-in command
- `public/` image assets

All references are relative, so it also works when GitHub Pages serves the
repository from a project subdirectory.
