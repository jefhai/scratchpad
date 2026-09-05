const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function shared(desktop) {
  const copied = [], downloads = [];
  const context = vm.createContext({
    React: {}, ScratchpadDesktop: desktop, Blob,
    navigator: { clipboard: { async writeText(text) { copied.push(text); } } },
    URL: { createObjectURL: () => 'blob:test-only', revokeObjectURL() {} },
    document: { createElement: () => ({ click() { downloads.push({ name: this.download, url: this.href }); } }) },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../ui/shared.js'), 'utf8'), context);
  return { ui: context.ScratchpadUI, copied, downloads };
}

test('browser text and sheet file actions retain native clipboard and Blob downloads', async () => {
  const { ui, copied, downloads } = shared();
  await ui.copyText('browser test');
  assert.deepEqual(copied, ['browser test']);
  assert.equal(await ui.saveTextFile('plain', 'text'), true);
  await ui.saveTextFile('1,2', 'sheet');
  assert.deepEqual(downloads.map(item => item.name), ['scratchpad.txt', 'cellpad.csv']);
  await assert.rejects(ui.saveTextFile('invalid', 'other'));
});

test('desktop actions use local native commands and preserve save cancellation', async () => {
  const calls = [];
  const { ui, copied, downloads } = shared({
    async copyText(text) { calls.push(text); },
    async saveFile(text, kind) { calls.push({ text, kind }); return false; },
  });
  await ui.copyText('desktop test');
  assert.equal(await ui.saveTextFile('synthetic content', 'text'), false);
  assert.equal(calls[0], 'desktop test');
  assert.deepEqual(calls[1], { text: 'synthetic content', kind: 'text' });
  assert.deepEqual(copied, []);
  assert.deepEqual(downloads, []);
});
