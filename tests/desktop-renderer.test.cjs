const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
require("../core/history.js");
require("../core/documents.js");
require("../core/workspace.js");
require("../core/workspace-state.js");
const Domain = globalThis.ScratchpadDomain;
const uiSource = readFileSync(require.resolve("../ui/desktop-window.js"), "utf8");
const appSource = readFileSync(require.resolve("../app.js"), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(beforeFlush = () => {}) {
  const timers = new Map(), listeners = new Map(), saves = [], errors = [];
  const editor = { scrollTop: 30, scrollLeft: 15, selectionStart: 1, selectionEnd: 4, selectionDirection: "backward" };
  const panel = { getAttribute: () => "pad-tab-1", querySelector: () => editor };
  const document = {
    getElementById: () => panel,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };
  const window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };
  const bridge = {
    save: async (state) => { saves.push(state); },
    onFlushRequested(callback) { this.flush = callback; return () => { this.flush = null; }; },
  };
  let nextTimer = 0;
  const context = vm.createContext({
    ScratchpadUI: {}, React: {}, document, window,
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  for (const file of ["history", "documents", "workspace", "workspace-state"]) {
    vm.runInContext(readFileSync(require.resolve(`../core/${file}.js`), "utf8"), context);
  }
  vm.runInContext(uiSource, context);
  const workspace = new context.ScratchpadDomain.Workspace("original");
  const session = context.ScratchpadUI.createDesktopSession(bridge, workspace, (error) => errors.push(error), beforeFlush);
  return { workspace, session, bridge, timers, saves, errors, editor, listeners, document, UI: context.ScratchpadUI,
    fire() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((callback) => callback()); } };
}

test("desktop saves debounce edits and scrolling and collect the latest DOM view", async () => {
  const app = harness();
  app.workspace.active.setText("changed value");
  app.session.schedule();
  app.session.schedule();
  assert.equal(app.timers.size, 1);
  app.editor.scrollTop = 123;
  app.listeners.get("scroll")({ target: { matches: () => true } });
  assert.equal(app.timers.size, 1);
  app.fire();
  await tick();
  assert.equal(app.saves.length, 1);
  assert.equal(app.saves[0].tabs[0].history.present, "changed value");
  assert.equal(app.saves[0].tabs[0].scroll.top, 123);
  assert.deepEqual(JSON.parse(JSON.stringify(app.saves[0].tabs[0].selection)), { start: 1, end: 4, direction: "backward" });
  app.session.dispose();
});

test("close flush waits older queued saves and returns the newest workspace snapshot", async () => {
  let cancellations = 0;
  const app = harness(() => { cancellations += 1; });
  const first = deferred(), second = deferred();
  app.bridge.save = (state) => {
    app.saves.push(state);
    return app.saves.length === 1 ? first.promise : second.promise;
  };
  app.workspace.active.setText("first edit");
  app.session.schedule(); app.fire(); await tick();
  app.workspace.active.setText("second edit");
  app.session.schedule(); app.fire();
  let finished = false;
  const flushing = app.bridge.flush().then((snapshot) => { finished = true; return snapshot; });
  assert.equal(cancellations, 1, "Pending command work is cancelled before waiting for older saves");
  app.workspace.active.setText("third edit during save");
  app.editor.selectionStart = 2;
  app.editor.selectionEnd = 6;
  app.editor.scrollTop = 222;
  await tick();
  assert.equal(finished, false);
  first.resolve(); await tick();
  assert.equal(app.saves.length, 2);
  assert.equal(finished, false);
  second.resolve();
  const snapshot = await flushing;
  assert.equal(snapshot.tabs[0].history.present, "third edit during save");
  assert.equal(snapshot.tabs[0].selection.end, 6);
  assert.equal(snapshot.tabs[0].scroll.top, 222);
  assert.equal(app.timers.size, 0);
  app.session.dispose();
});

test("a view from a closing tab never replaces the new active tab selection", async () => {
  const app = harness();
  app.workspace.add("text").setText("new tab");
  const snapshot = await app.bridge.flush();
  assert.equal(snapshot.activeId, 2);
  assert.equal(snapshot.tabs[0].selection.start, 1);
  assert.equal(snapshot.tabs[1].selection.start, 0);
  assert.equal(snapshot.tabs[1].scroll.top, 0);
  app.session.dispose();
});

test("save failures are surfaced and later saves recover; cleanup cancels pending writes", async () => {
  const app = harness();
  app.bridge.save = async () => { throw new Error("disk full"); };
  app.session.schedule(); app.fire(); await tick();
  assert.match(app.errors.at(-1).message, /disk full/);
  app.bridge.save = async (state) => { app.saves.push(state); };
  app.session.schedule(); app.fire(); await tick();
  assert.equal(app.errors.at(-1), null);
  app.session.schedule();
  app.session.dispose();
  assert.equal(app.timers.size, 0);
  assert.equal(app.listeners.size, 0);
  assert.equal(app.bridge.flush, null);
  app.session.schedule(); app.fire(); await tick();
  assert.equal(app.saves.length, 1);
});

test("desktop bootstrap cannot mount or save defaults before load succeeds", async () => {
  const loaded = deferred(), renders = [];
  const savedWorkspace = new Domain.Workspace("restored contents");
  const context = vm.createContext({
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    ReactDOM: { createRoot: () => ({ render: (element) => renders.push(element) }) },
    ScratchpadDomain: Domain, ScratchpadUI: {}, ScratchpadCommandUtils: { sampleJson: "sample" },
    ScratchpadDesktop: { load: () => loaded.promise }, document: { getElementById: () => ({}) },
  });
  vm.runInContext(appSource, context);
  await tick();
  assert.equal(renders.length, 1);
  assert.equal(renders[0].type, "p");
  loaded.resolve({ workspace: Domain.WorkspaceState.serialize(savedWorkspace), window: { id: "window-1", name: "Research", alwaysOnTop: false } });
  await tick();
  assert.equal(renders.length, 2);
  assert.equal(typeof renders[1].type, "function");
  assert.equal(renders[1].props.initialWorkspace.active.text, "restored contents");
});

test("failed desktop load renders a recovery message instead of an editable empty workspace", async () => {
  const renders = [];
  const context = vm.createContext({
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    ReactDOM: { createRoot: () => ({ render: (element) => renders.push(element) }) },
    ScratchpadDomain: Domain, ScratchpadUI: {},
    ScratchpadDesktop: { load: async () => { throw new Error("session unavailable"); } },
    document: { getElementById: () => ({}) },
  });
  vm.runInContext(appSource, context);
  await tick();
  assert.equal(renders.length, 2);
  assert.equal(renders.at(-1).type, "main");
  assert.equal(renders.at(-1).props.role, "alert");
});

test("a packaged page without its bridge stops before creating an unsaved workspace", () => {
  const renders = [];
  const context = vm.createContext({
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    ReactDOM: { createRoot: () => ({ render: (element) => renders.push(element) }) },
    ScratchpadDomain: Domain, ScratchpadUI: {},
    document: { getElementById: () => ({}), documentElement: { dataset: { desktopRuntime: "tauri" } } },
  });
  vm.runInContext(appSource, context);
  assert.equal(renders.length, 1);
  assert.equal(renders[0].type, "main");
  assert.equal(renders[0].props.role, "alert");
});

test("native menu undo and redo use auxiliary input history without mutating a pad", () => {
  const app = harness(), actions = [], nativeActions = [];
  const handlers = Object.fromEntries(["undo", "redo", "rename", "commands"].map((type) => [type, () => actions.push(type)]));
  app.document.execCommand = (type) => nativeActions.push(type);
  app.document.activeElement = { closest: (selector) => selector.startsWith("input,") ? {} : null };
  app.UI.routeDesktopAction({ type: "undo" }, handlers, { paletteOpen: true });
  app.UI.routeDesktopAction({ type: "redo" }, handlers, { modalOpen: true });
  assert.deepEqual(nativeActions, ["undo", "redo"]);
  assert.deepEqual(actions, []);
  app.session.dispose();
});

test("native menu history respects dialogs while commands and pad history remain available", () => {
  const app = harness(), actions = [];
  const handlers = Object.fromEntries(["undo", "redo", "rename", "commands"].map((type) => [type, () => actions.push(type)]));
  app.document.activeElement = { closest: () => null };
  app.UI.routeDesktopAction({ type: "undo" }, handlers, { paletteOpen: true });
  app.UI.routeDesktopAction({ type: "redo" }, handlers, { modalOpen: true });
  app.UI.routeDesktopAction({ type: "commands" }, handlers, { modalOpen: true });
  assert.deepEqual(actions, []);
  app.UI.routeDesktopAction({ type: "undo" }, handlers);
  app.UI.routeDesktopAction({ type: "redo" }, handlers);
  app.UI.routeDesktopAction({ type: "commands" }, handlers, { paletteOpen: true });
  app.UI.routeDesktopAction({ type: "rename-window" }, handlers);
  assert.deepEqual(actions, ["undo", "redo", "commands", "rename"]);
  app.session.dispose();
});
