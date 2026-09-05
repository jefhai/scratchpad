const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../core/history.js");
require("../core/documents.js");
const { TextDocument } = globalThis.ScratchpadDomain;

test("text statistics stay current across selection, edits, undo and redo", () => {
  const pad = new TextDocument({ id: 1, title: "Text", text: "one two\nthree" });
  assert.deepEqual(pad.stats, { characters: 13, words: 3, lines: 2, selected: 0 });
  pad.setSelection(2, 9);
  assert.deepEqual(pad.stats, { characters: 13, words: 3, lines: 2, selected: 7 });
  pad.setText("short");
  pad.setSelection(0, 0);
  assert.deepEqual(pad.stats, { characters: 5, words: 1, lines: 1, selected: 0 });
  pad.undo();
  assert.deepEqual(pad.stats, { characters: 13, words: 3, lines: 2, selected: 0 });
  pad.redo();
  assert.deepEqual(pad.stats, { characters: 5, words: 1, lines: 1, selected: 0 });
  pad.setText("");
  assert.deepEqual(pad.stats, { characters: 0, words: 0, lines: 1, selected: 0 });
});

test("statistics retain line endings and track a backward selection independently", () => {
  const pad = new TextDocument({ id: 1, title: "Text", text: "  first\r\nsecond\r\n" });
  assert.deepEqual(pad.stats, { characters: 17, words: 2, lines: 3, selected: 0 });
  pad.setSelection(1, 12, "backward");
  assert.deepEqual(pad.stats, { characters: 17, words: 2, lines: 3, selected: 11 });
});
