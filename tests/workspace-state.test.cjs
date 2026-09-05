const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../core/history.js");
require("../core/documents.js");
require("../core/workspace.js");
const State = require("../core/workspace-state.js");
const { Workspace } = globalThis.ScratchpadDomain;

function sample() { return State.serialize(new Workspace("first")); }
function copy(value) { return JSON.parse(JSON.stringify(value)); }

test("desktop workspace round trips every tab, active tab, counters, selection and scroll", () => {
  const workspace = new Workspace("first\nsecond");
  const text = workspace.active;
  text.title = "Investigation";
  text.setText("first\nsecond\nthird");
  text.setSelection(2, 10, "backward");
  text.scroll = { top: 43.5, left: 60 };
  const sheet = workspace.add("sheet");
  sheet.title = "Inventory";
  sheet.setCell(2, 2, "123", "command");
  sheet.selectRows(2);
  sheet.selectRows(4, { toggle: true });
  sheet.scroll = { top: 300, left: 125.5 };
  sheet.result = { name: "Sum", value: "42" };
  const closed = workspace.add("text");
  workspace.close(closed.id);
  workspace.select(sheet.id);

  const snapshot = State.serialize(workspace);
  assert.equal(snapshot.version, 1);
  const restored = State.restore(copy(snapshot));
  assert.deepEqual(State.serialize(restored), snapshot);
  assert.equal(restored.activeId, sheet.id);
  assert.equal(restored.active.activeValue, sheet.activeValue);
  assert.deepEqual(restored.active.selectedCoordinates(), sheet.selectedCoordinates());
  const next = restored.add("text");
  assert.equal(next.id, workspace.nextId);
  assert.equal(next.title, "Scratchpad 3");
});

test("text undo and redo remain available after restoring without grouping across launches", () => {
  const workspace = new Workspace("original");
  workspace.active.setText("edited");
  workspace.active.setText("last");
  workspace.active.undo();
  const restored = State.restore(State.serialize(workspace));
  assert.equal(restored.active.text, "edited");
  assert.equal(restored.active.canUndo, true);
  assert.equal(restored.active.canRedo, true);
  restored.active.redo();
  assert.equal(restored.active.text, "last");
  restored.active.undo();
  restored.active.undo();
  assert.equal(restored.active.text, "original");
  restored.active.setText("new launch", "typing");
  restored.active.undo();
  assert.equal(restored.active.text, "original");
});

test("sheet cell edits, resized dimensions and structural history survive restore", () => {
  const workspace = new Workspace("");
  const sheet = workspace.add("sheet");
  sheet.setCell(1, 1, "seven", "command");
  sheet.resize("column", 1, 240);
  sheet.resize("row", 1, 72);
  sheet.addRow();
  sheet.undo();
  const restored = State.restore(State.serialize(workspace)).active;
  assert.equal(restored.grid[1][1], "seven");
  assert.equal(restored.columnWidths[1], 240);
  assert.equal(restored.rowHeights[1], 72);
  restored.redo();
  assert.equal(restored.rowCount, 25);
  restored.undo();
  restored.undo();
  assert.equal(restored.rowHeights[1], null);
  restored.undo();
  assert.equal(restored.columnWidths[1], null);
  restored.undo();
  assert.equal(restored.grid[1][1], "2");
});

test("restored windows and serialized snapshots never share mutable grid or history arrays", () => {
  const workspace = new Workspace("first");
  const sheet = workspace.add("sheet");
  sheet.setCell(0, 0, "updated", "command");
  const snapshot = State.serialize(workspace);
  const first = State.restore(snapshot), second = State.restore(snapshot);
  first.active.history.present.grid[0][0] = "other window";
  first.active.history.past[0].grid[0][0] = "other history";
  first.active.selection.rows.push(3);
  assert.equal(second.active.grid[0][0], "updated");
  assert.equal(snapshot.tabs[1].history.present.grid[0][0], "updated");
  assert.equal(workspace.active.history.past[0].grid[0][0], "Item");
  assert.deepEqual(second.active.selection.rows, []);
});

test("rejects unsupported, truncated, malformed and unsafe workspace records", () => {
  const invalid = [null, [], {}, { version: 2 }, "not json"];
  const mutations = [
    (state) => { state.version = 0; },
    (state) => { state.tabs = []; },
    (state) => { state.activeId = 99; },
    (state) => { state.tabs.push(copy(state.tabs[0])); },
    (state) => { state.tabs[0].kind = "script"; },
    (state) => { state.tabs[0].history.present = {}; },
    (state) => { state.tabs[0].history.past = [false]; },
    (state) => { state.tabs[0].id = "1"; },
    (state) => { state.counts.text = -1; },
    (state) => { state.nextId = Infinity; },
    (state) => { state.tabs[0].selection.direction = "sideways"; },
    (state) => { state.tabs[0].scroll.top = -1; },
    (state) => { state.tabs[0].scroll.left = NaN; },
    (state) => { state.tabs[0].title = "x".repeat(State.limits.titleLength + 1); },
  ];
  for (const mutate of mutations) { const state = sample(); mutate(state); invalid.push(state); }
  for (const snapshot of invalid) {
    assert.equal(State.validate(snapshot), null);
    assert.equal(State.restore(snapshot), null);
  }
  let invoked = false;
  const accessor = sample();
  Object.defineProperty(accessor.tabs[0], "title", { get() { invoked = true; throw new Error("getter"); } });
  assert.equal(State.validate(accessor), null);
  assert.equal(invoked, false);
  const inherited = Object.create(sample());
  assert.equal(State.validate(inherited), null);
});

test("unknown fields cannot overwrite document behavior or introduce prototypes", () => {
  const snapshot = sample();
  snapshot.tabs[0].undo = "overwrite";
  snapshot.tabs[0].constructor = { prototype: { polluted: true } };
  Object.defineProperty(snapshot.tabs[0], "__proto__", { value: { polluted: true }, enumerable: true });
  const normalized = State.validate(snapshot);
  assert.equal(Object.hasOwn(normalized.tabs[0], "__proto__"), false);
  assert.equal(Object.hasOwn(normalized.tabs[0], "constructor"), false);
  assert.equal(typeof State.restore(snapshot).active.undo, "function");
  assert.equal({}.polluted, undefined);
});

test("bad sheet grids, dimensions, selections and size limits are rejected", () => {
  const workspace = new Workspace("");
  workspace.add("sheet");
  const original = State.serialize(workspace);
  const mutations = [
    (tab) => { tab.history.present.grid = []; },
    (tab) => { tab.history.present.grid = [["a"], ["a", "b"]]; },
    (tab) => { tab.history.present.grid[0][0] = 42; },
    (tab) => { tab.history.present.columnWidths[0] = -1; },
    (tab) => { tab.history.present.rowHeights[0] = 300; },
    (tab) => { tab.history.present.columnWidths.pop(); },
    (tab) => { tab.selection.rows = [-1]; },
    (tab) => { tab.selection.kind = "unknown"; },
    (tab) => { tab.activeCell = null; },
    (tab) => { tab.history.present.grid = Array.from({ length: 250 }, () => Array(250).fill("")); },
    (tab) => { tab.history.present.grid = Array.from({ length: State.limits.rows + 1 }, () => [""]); },
  ];
  for (const mutate of mutations) {
    const snapshot = copy(original);
    mutate(snapshot.tabs[1]);
    assert.equal(State.validate(snapshot), null);
  }
});

test("clamps stale cursor positions and repairs counters without changing valid content", () => {
  const snapshot = sample();
  snapshot.nextId = 1;
  snapshot.counts.text = 0;
  snapshot.tabs[0].selection = { start: 1, end: 100, direction: "backward" };
  const restored = State.restore(snapshot);
  assert.deepEqual(restored.active.selection, { start: 1, end: 5, direction: "backward" });
  assert.equal(restored.add("text").id, 2);
  assert.equal(restored.active.title, "Scratchpad 2");
});

test("bounds input and trims old history before sacrificing any present document", () => {
  const snapshot = sample();
  snapshot.tabs[0].history.present = "x".repeat(State.limits.textLength + 1);
  assert.equal(State.validate(snapshot), null);
  const tooManyTabs = sample();
  tooManyTabs.tabs = Array(State.limits.tabs + 1).fill(tooManyTabs.tabs[0]);
  assert.equal(State.validate(tooManyTabs), null);
  const tooMuchHistory = sample();
  tooMuchHistory.tabs[0].history.past = Array(State.limits.history + 1).fill("");
  assert.equal(State.validate(tooMuchHistory), null);

  const text = "x".repeat(3 * 1024 * 1024);
  const workspace = new Workspace(text);
  workspace.active.setText("y" + text.slice(1));
  workspace.active.setText("z" + text.slice(1));
  workspace.add("text").setText("also retained");
  const saved = State.serialize(workspace);
  assert.equal(saved.tabs[0].history.present[0], "z");
  assert.equal(saved.tabs[0].history.past.length, 1);
  assert.equal(saved.tabs[0].history.past[0][0], "y");
  assert.equal(saved.tabs[1].history.present, "also retained");
  assert.ok(State.restore(saved));
  workspace.active.setText("too big".repeat(State.limits.textLength));
  assert.throws(() => State.serialize(workspace), /limits/);
});
