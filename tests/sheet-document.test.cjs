const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../core/history.js");
require("../core/documents.js");
require("../core/workspace.js");
const { SheetDocument, Workspace } = globalThis.ScratchpadDomain;

function sheet() {
  return new SheetDocument({ id: 1, title: "Test", grid: [["A", "B", "C"], ["1", "2", "3"], ["4", "5", "6"]] });
}

test("dimensions are clamped and a resize participates in undo alongside cell edits", () => {
  const pad = sheet();
  pad.resize("column", 0, 200);
  pad.setCell(0, 0, "changed");
  pad.resize("row", 1, 65);
  pad.undo();
  assert.equal(pad.rowHeights[1], null);
  assert.equal(pad.grid[0][0], "changed");
  pad.undo();
  assert.equal(pad.grid[0][0], "A");
  assert.equal(pad.columnWidths[0], 200);
  pad.undo();
  assert.equal(pad.columnWidths[0], null);
  pad.redo();
  assert.equal(pad.columnWidths[0], 200);
  pad.resize("column", 1, -100);
  pad.resize("row", 1, 10000);
  assert.equal(pad.columnWidths[1], 56);
  assert.equal(pad.rowHeights[1], 240);
  assert.equal(pad.resize("row", 1, Infinity), false);
  assert.equal(pad.resize("column", -1, 200), false);
  assert.equal(pad.resize("unknown", 0, 200), false);
});

test("deleting dimensions follows their row or column and undo restores them", () => {
  const pad = sheet();
  pad.resize("column", 0, 180);
  pad.resize("column", 2, 260);
  pad.resize("row", 0, 50);
  pad.resize("row", 2, 70);
  pad.selectRows(0);
  pad.removeSelectedRows();
  assert.deepEqual(pad.rowHeights, [null, 70]);
  assert.deepEqual(pad.grid[0], ["1", "2", "3"]);
  pad.undo();
  assert.deepEqual(pad.rowHeights, [50, null, 70]);
  pad.selectColumns(1);
  pad.removeSelectedColumns();
  assert.deepEqual(pad.columnWidths, [180, 260]);
  assert.deepEqual(pad.grid[0], ["A", "C"]);
  pad.undo();
  assert.deepEqual(pad.columnWidths, [180, null, 260]);
  assert.deepEqual(pad.grid[0], ["A", "B", "C"]);
});

test("adding and pasting create default dimensions and preserve existing custom sizes", () => {
  const pad = sheet();
  pad.resize("column", 0, 180);
  pad.resize("row", 0, 50);
  pad.addColumn();
  pad.addRow();
  assert.deepEqual(pad.columnWidths, [180, null, null, null]);
  assert.deepEqual(pad.rowHeights, [50, null, null, null]);
  pad.paste("x\ty\nz\tw", 3, 3);
  assert.deepEqual(pad.columnWidths, [180, null, null, null, null]);
  assert.deepEqual(pad.rowHeights, [50, null, null, null, null]);
  pad.focusCell(4, 4);
  pad.undo();
  assert.equal(pad.rowCount, 4);
  assert.equal(pad.columnCount, 4);
  assert.deepEqual(pad.activeCell, { row: 3, column: 3 });
  assert.doesNotThrow(() => pad.selectedEntries());
});

test("removing every row or column keeps a valid blank dimension and can be undone", () => {
  const pad = sheet();
  pad.resize("row", 2, 100);
  pad.selectRows(0);
  pad.selectRows(2, { extend: true });
  pad.removeSelectedRows();
  assert.deepEqual(pad.rowHeights, [null]);
  assert.equal(pad.rowCount, 1);
  pad.undo();
  assert.deepEqual(pad.rowHeights, [null, null, 100]);
  pad.selectColumns(0);
  pad.selectColumns(2, { extend: true });
  pad.removeSelectedColumns();
  assert.deepEqual(pad.columnWidths, [null]);
  assert.equal(pad.columnCount, 1);
  pad.undo();
  assert.equal(pad.columnCount, 3);
});

test("selection clearing remains one undoable operation and leaves custom dimensions intact", () => {
  const pad = sheet();
  pad.resize("column", 1, 211);
  pad.selectCell(0, 0);
  pad.selectCell(1, 1, true);
  pad.clearSelection();
  assert.deepEqual(pad.grid.slice(0, 2), [["", "", "C"], ["", "", "3"]]);
  pad.undo();
  assert.deepEqual(pad.grid.slice(0, 2), [["A", "B", "C"], ["1", "2", "3"]]);
  assert.equal(pad.columnWidths[1], 211);
  pad.redo();
  assert.deepEqual(pad.grid.slice(0, 2), [["", "", "C"], ["", "", "3"]]);
  assert.equal(pad.clearSelection(), false);
  pad.undo();
  assert.deepEqual(pad.grid.slice(0, 2), [["A", "B", "C"], ["1", "2", "3"]]);
  assert.equal(pad.columnWidths[1], 211);
});

test("resetting uses the current default, and dimensions stay isolated across tabs", () => {
  const workspace = new Workspace("");
  const first = workspace.add("sheet");
  first.resize("row", 0, 60);
  first.resize("column", 1, 211);
  const second = workspace.add("sheet");
  assert.equal(second.dimension("row", 0, 38), 38);
  workspace.select(first.id);
  assert.equal(workspace.active.dimension("row", 0, 38), 60);
  workspace.active.resize("row", 0, null);
  assert.equal(workspace.active.dimension("row", 0, 38), 38);
  workspace.active.undo();
  assert.equal(workspace.active.dimension("row", 0, 38), 60);
});
