# Scratchpad

A focused, fully static browser workspace built with React. Scratchpad text editors
and Cellpad grids live together in one tabbed application.

## What is included

- 48 text transformations for JSON, CSV, encoding, cleanup, hashes, and timestamps
- Cellpad grids with multi-cell selection, CSV import/export, and eight arithmetic commands
- One tab bar for any mix of text and grid pads; the first tab is always a Scratchpad
- A searchable command palette opened with `Ctrl+J` or `Command+J`
- Selection-aware editing, line numbers, undo/redo, Tab/Shift+Tab indentation, open/save, and clipboard support
- Seven persistent contrast themes shared by both pad types

## Architecture

The code is a small browser monolith: domain objects own behavior, React components
render those objects, and `app.js` coordinates the workspace. There is no bundler or
compile step.

- `core/` contains history, document, and workspace domain objects
- `ui/` contains the shared tab bar and the two pad views
- `commands/` contains one readable file per text command
- `commands/cells/` contains one readable file per grid command

## Serve it

No build or package installation is required. Serve this folder with any static
file server, or publish it directly with GitHub Pages.

The site consists of:

- `index.html`
- `app.js` (the readable React application coordinator)
- `core/` and `ui/` modules
- `cellpad.css`
- `app.css`
- `mobile.css`
- `keyboard-shortcuts.js`
- `themes.js`
- `commands/registry.js`, `commands/cells/registry.js`, and one readable file per command
- `public/` image assets

All references are relative, so it also works when GitHub Pages serves the
repository from a project subdirectory.
