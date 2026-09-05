const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ waitForListeners = Promise.resolve(), failLoad = false } = {}) {
  const listeners = new Map(), calls = [];
  const native = {
    core: { async invoke(name, args) {
      calls.push({ name, args });
      if (name === 'desktop_load') {
        if (failLoad) throw new Error('The saved workspace could not be recovered.');
        return { workspace: null, window: { id: 'one', name: 'Notes', alwaysOnTop: false } };
      }
      if (name === 'desktop_rename') return args.name;
      if (name === 'desktop_save_file') return true;
    } },
    webviewWindow: { getCurrentWebviewWindow() { return {
      async listen(name, callback) { listeners.set(name, callback); await waitForListeners; return () => listeners.delete(name); },
    }; } },
  };
  const context = vm.createContext({ __TAURI__: native });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'bridge.js'), 'utf8'), context);
  return { bridge: context.ScratchpadDesktop, listeners, calls };
}

test('Tauri load waits for all scoped event listeners before loading saved content', async () => {
  let release;
  const { bridge, calls, listeners } = harness({ waitForListeners: new Promise(resolve => { release = resolve; }) });
  const loading = bridge.load();
  assert.equal(listeners.size, 3);
  assert.equal(calls.length, 0);
  release();
  assert.equal((await loading).window.name, 'Notes');
  assert.equal(calls[0].name, 'desktop_load');
  assert.equal(Object.isFrozen(bridge), true);
});

test('ready and flush acknowledgements capture the latest state through native IPC', async () => {
  const { bridge, calls, listeners } = harness();
  await bridge.load();
  const unsubscribe = bridge.onFlushRequested(async () => ({ version: 1, text: 'latest synthetic edit' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.at(-1).name, 'desktop_ready');
  await listeners.get('desktop:flush')({ payload: { requestId: 'request-one' } });
  assert.equal(calls.at(-1).name, 'desktop_flushed');
  assert.equal(calls.at(-1).args.workspace.text, 'latest synthetic edit');
  assert.equal(calls.at(-1).args.requestId, 'request-one');
  assert.equal(calls.at(-1).args.error, null);
  unsubscribe();
  await listeners.get('desktop:flush')({ payload: { requestId: 'request-two' } });
  assert.equal(calls.at(-1).args.workspace, null);
  assert.match(calls.at(-1).args.error, /could not capture/);
});

test('desktop action subscriptions and local file operations have a narrow command contract', async () => {
  const { bridge, calls, listeners } = harness();
  await bridge.load();
  const actions = [], stop = bridge.onAction(value => actions.push(value.type));
  listeners.get('desktop:action')({ payload: { type: 'undo' } });
  stop();
  listeners.get('desktop:action')({ payload: { type: 'redo' } });
  assert.deepEqual(actions, ['undo']);
  assert.equal(await bridge.renameWindow('Window name'), 'Window name');
  await bridge.copyText('clipboard fixture');
  assert.equal(calls.at(-1).name, 'desktop_copy_text');
  assert.equal(calls.at(-1).args.text, 'clipboard fixture');
  assert.equal(await bridge.saveFile('1,2', 'sheet'), true);
  assert.equal(calls.at(-1).name, 'desktop_save_file');
  assert.equal(calls.at(-1).args.kind, 'sheet');
  assert.equal('path' in calls.at(-1).args, false);
});

test('native load errors propagate to the renderer recovery UI', async () => {
  await assert.rejects(harness({ failLoad: true }).bridge.load(), /could not be recovered/);
});

test('a missing native runtime cannot silently boot as a temporary browser workspace', async () => {
  const context = vm.createContext({});
  assert.throws(() => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'bridge.js'), 'utf8'), context));
  assert.equal(typeof context.ScratchpadDesktop.load, 'function');
  await assert.rejects(context.ScratchpadDesktop.load(), /bridge is unavailable/);
});
