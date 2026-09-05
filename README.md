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
- Shared responsive toolbars, display presets, and accessible popup controls
- Draggable, undoable column widths and row heights, plus touch-friendly range selection

## Architecture

The code is a small browser monolith: domain objects own behavior, React components
render those objects, and `app.js` coordinates the workspace. There is no bundler or
compile step.

- `core/` contains history, document, and workspace domain objects
- `ui/` contains shared tabs, toolbars, footer controls, settings, command search, and the two pad views
- `ui/workspace.css` owns shared desktop/mobile chrome; editor-specific styles stay separate
- `commands/` contains one readable file per text command
- `commands/cells/` contains one readable file per grid command

## Command loading

The palette searches a small, checked-in metadata catalog immediately. Individual
command implementations load only when run, then stay cached for the page session.
Concurrent requests share one download; failed loads can be retried. A pending
command cannot overwrite newer edits or a different pad after switching tabs.

Each command still lives in its own file with its metadata and `run` function.
After adding, removing, or renaming a command or changing its searchable metadata,
refresh the catalog with `node scripts/update-command-catalog.cjs`. Commit the
generated `commands/catalog.js` alongside the command file. This is an optional
authoring tool; serving or deploying the checked-in site requires no build.

Run all dependency-free domain and command checks with
`node --test tests/*.test.cjs`. Check that catalog metadata is current with
`node scripts/update-command-catalog.cjs --check`.

## Cellpad sizing and selection

Drag the divider at the right edge of a column header or the bottom edge of a row
header. Widths and heights belong to each sheet and share its Undo/Redo history.
Double-click a divider (or press Enter while it is focused) to reset it. Arrow keys
adjust a focused divider by 4px; hold Shift for 20px. Escape cancels an active drag.

Use Shift-click to select a range, or turn on **Select range** and tap its other
corner. This also works with row/column headers and does not open the touch keyboard.
Turn the toggle off to edit again. Delete clears a multi-cell selection; in a single
cell, Backspace/Delete edit the text normally.

The action list scrolls horizontally when needed, keeping theme/settings controls
available. Counts move below the actions when space is tight. Touch-sized controls,
keyboard-aware viewport sizing, and scrollable popups keep smaller screens usable.
Statistics and line-number rendering are cached so selection does not rebuild a
large document's gutter or recount all its words.

## Serve it

No build or package installation is required. Serve this folder with any static
file server, or publish it directly with GitHub Pages.

For local development with Node, run `node tests/serve.cjs` and open
`http://127.0.0.1:4260/`. Refresh after edits; there is no hot-reload dependency.

The site consists of:

- `index.html`
- `app.js` (the readable React application coordinator)
- `core/` and `ui/` modules
- `cellpad.css`
- `app.css`
- `mobile.css`
- `keyboard-shortcuts.js`
- `themes.js`
- `commands/` registries, metadata catalog, lazy loader, and one readable file per command
- `public/` image assets

All references are relative, so it also works when GitHub Pages serves the
repository from a project subdirectory.
