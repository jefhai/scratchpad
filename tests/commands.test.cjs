const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
function source(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

function environment({ automatic = true, timeoutMs = 1000 } = {}) {
  const requests = [];
  const document = {
    currentScript: { src: "https://example.test/nested/scratchpad/commands/loader.js" },
    createElement: () => ({ dataset: {}, remove() { this.removed = true; } }),
    head: {
      appendChild(script) {
        requests.push(script);
        if (automatic) queueMicrotask(() => complete(script));
      },
    },
  };
  const context = vm.createContext({ document, URL, setTimeout, clearTimeout, TextEncoder, TextDecoder, btoa, atob });
  const evaluate = (file) => vm.runInContext(source(file), context, { filename: file });
  ["commands/registry.js", "commands/cells/registry.js", "commands/catalog.js", "commands/loader.js"].forEach(evaluate);
  function complete(script) {
    const file = new URL(script.src).pathname.replace("/nested/scratchpad/", "");
    const previous = document.currentScript;
    document.currentScript = script;
    try { evaluate(file); } finally { document.currentScript = previous; }
    script.onload?.();
  }
  const library = new context.ScratchpadCommandLoader({
    catalog: context.ScratchpadCommandCatalog,
    registries: { text: context.ScratchpadCommands, sheet: context.ScratchpadCellCommands },
    document,
    timeoutMs,
  });
  return { context, evaluate, requests, complete, library };
}

function execution(library) {
  const env = environment();
  ["core/history.js", "core/documents.js", "core/workspace.js", "core/command-execution.js"].forEach(env.evaluate);
  const { Workspace, CommandExecution } = env.context.ScratchpadDomain;
  const workspace = new Workspace("hello world");
  return { ...env, workspace, runner: new CommandExecution(workspace, library ?? env.library) };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("catalog contains every official command and index defers their implementation scripts", () => {
  execFileSync(process.execPath, [path.join(root, "scripts/update-command-catalog.cjs"), "--check"]);
  const env = environment();
  const scripts = [...source("index.html").matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  const entries = Object.values(env.context.ScratchpadCommandCatalog).flat();
  assert.equal(entries.length, 56);
  assert.equal(env.context.ScratchpadCommands.all().length, 0);
  assert.equal(env.context.ScratchpadCellCommands.all().length, 0);
  for (const entry of entries) assert.ok(!scripts.includes(`./commands/${entry.file}`));
});

test("every command lazily registers from its separate file in a project subdirectory", async () => {
  const env = environment();
  for (const [kind, entries] of Object.entries(env.context.ScratchpadCommandCatalog)) {
    for (const entry of entries) {
      const command = await env.library.load(kind, entry.id);
      assert.equal(command.id, entry.id);
      assert.equal(command.name, entry.name);
      assert.equal(typeof command.run, "function");
    }
  }
  assert.equal(env.requests.length, 56);
  assert.ok(env.requests.every((script) => script.removed));
});

test("parallel and repeated requests share a single loaded command", async () => {
  const env = environment({ automatic: false });
  const first = env.library.load("text", "uppercase");
  const second = env.library.load("text", "uppercase");
  assert.equal(first, second);
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].src, "https://example.test/nested/scratchpad/commands/uppercase.js");
  env.complete(env.requests[0]);
  const command = await first;
  assert.equal(await env.library.load("text", "uppercase"), command);
  assert.equal(env.requests.length, 1);
});

test("a failed or empty script can be retried without a poisoned cache", async () => {
  const env = environment({ automatic: false });
  const failed = env.library.load("text", "uppercase");
  env.requests[0].onerror();
  await assert.rejects(failed, /Check your connection and try again/);
  const empty = env.library.load("text", "uppercase");
  env.requests[1].onload();
  await assert.rejects(empty, /Could not load UPPERCASE/);
  const retry = env.library.load("text", "uppercase");
  env.complete(env.requests[2]);
  assert.equal((await retry).run("hello"), "HELLO");
});

test("an unresponsive load times out and unknown command paths never load", async () => {
  const env = environment({ automatic: false, timeoutMs: 5 });
  await assert.rejects(env.library.load("text", "uppercase"), /try again/);
  assert.equal(env.library.pending.size, 0);
  assert.ok(env.requests[0].removed);
  await assert.rejects(env.library.load("text", "../injected.js"), /not available/);
  assert.equal(env.requests.length, 1);
});

test("a timed-out script arriving late cannot duplicate a retried registration", async () => {
  const env = environment({ automatic: false, timeoutMs: 5 });
  await assert.rejects(env.library.load("text", "uppercase"), /try again/);
  const retry = env.library.load("text", "uppercase");
  env.complete(env.requests[0]);
  assert.equal(env.context.ScratchpadCommands.get("uppercase"), undefined);
  env.complete(env.requests[1]);
  assert.equal((await retry).run("hello"), "HELLO");
});

test("text commands preserve selection boundaries and create one undo step", async () => {
  const { runner, workspace } = execution();
  const pad = workspace.active;
  pad.setSelection(6, 11);
  assert.equal((await runner.run({ id: "uppercase" })).status, "changed");
  assert.equal(pad.text, "hello WORLD");
  assert.equal(pad.selection.start, 6);
  assert.equal(pad.selection.end, 11);
  assert.equal(pad.history.past.length, 1);
  pad.undo();
  assert.equal(pad.text, "hello world");
});

test("no-change commands and Count text retain notices without adding undo steps", async () => {
  const { runner, workspace } = execution();
  const unchanged = await runner.run({ id: "lowercase" });
  assert.equal(unchanged.status, "unchanged");
  assert.match(unchanged.notice, /No change/);
  const count = await runner.run({ id: "count" });
  assert.match(count.notice, /11 characters · 2 words · 1 lines/);
  assert.equal(workspace.active.canUndo, false);
});

test("format JSON uses the captured tab spacing, including selected text", async () => {
  const { runner, workspace } = execution();
  const pad = workspace.active;
  pad.setText('before {"a":1} after');
  pad.setSelection(7, 14);
  await runner.run({ id: "format-json" }, { tabSize: 4 });
  assert.equal(pad.text, 'before {\n    "a": 1\n} after');
});

test("cell calculations use the selected entries and leave their values intact", async () => {
  const { runner, workspace } = execution();
  const pad = workspace.add("sheet");
  pad.selectCell(1, 1);
  pad.selectCell(3, 1, true);
  const result = await runner.run({ id: "sum" });
  assert.equal(result.status, "changed");
  assert.equal(pad.result.value, "6");
  assert.equal(pad.canUndo, false);
});

test("repeated activation does not duplicate a pending run", async () => {
  const pending = deferred();
  let loads = 0;
  const { runner, workspace } = execution({ load: () => { loads += 1; return pending.promise; } });
  const first = runner.run({ id: "uppercase" });
  assert.equal((await runner.run({ id: "uppercase" })).status, "busy");
  pending.resolve({ name: "Uppercase", run: (text) => text.toUpperCase() });
  await first;
  assert.equal(loads, 1);
  assert.equal(workspace.active.history.past.length, 1);
});

test("loading never applies to a switched, edited, reselected, or closed pad", async (t) => {
  for (const action of [
    (workspace) => workspace.add("text"),
    (workspace) => workspace.active.setText("new typing"),
    (workspace) => workspace.active.setSelection(0, 5),
    (workspace) => workspace.close(workspace.active.id),
  ]) {
    await t.test(action.toString(), async () => {
      const pending = deferred();
      const { runner, workspace } = execution({ load: () => pending.promise });
      const original = workspace.active;
      const first = runner.run({ id: "uppercase" });
      action(workspace);
      const expected = original.text;
      let runs = 0;
      pending.resolve({ name: "Uppercase", run: (text) => { runs += 1; return text.toUpperCase(); } });
      assert.equal((await first).status, "cancelled");
      assert.equal(original.text, expected);
      assert.equal(runs, 0);
    });
  }
});

test("edits made while an async command runs cannot be overwritten", async () => {
  const pending = deferred();
  const started = deferred();
  const { runner, workspace } = execution({ load: async () => ({
    name: "Async",
    run: () => { started.resolve(); return pending.promise; },
  }) });
  const running = runner.run({ id: "async" });
  await started.promise;
  workspace.active.setText("new typing");
  pending.resolve("old result");
  assert.equal((await running).status, "cancelled");
  assert.equal(workspace.active.text, "new typing");
});

test("closing commands cancels a run without unlocking a newer pending run", async () => {
  const firstLoad = deferred();
  const secondLoad = deferred();
  let loads = 0;
  const { runner, workspace } = execution({ load: () => (++loads === 1 ? firstLoad : secondLoad).promise });
  const first = runner.run({ id: "uppercase" });
  runner.cancel();
  const second = runner.run({ id: "uppercase" });
  firstLoad.resolve({ name: "Old", run: () => "old" });
  assert.equal((await first).status, "cancelled");
  assert.equal(runner.working, true);
  secondLoad.resolve({ name: "New", run: () => "new" });
  await second;
  assert.equal(workspace.active.text, "new");
  assert.equal(runner.working, false);
});

test("load failures preserve the pad and allow another command attempt", async () => {
  let fail = true;
  const { runner, workspace } = execution({ load: async () => {
    if (fail) throw new Error("Offline");
    return { name: "Uppercase", run: (text) => text.toUpperCase() };
  } });
  await assert.rejects(runner.run({ id: "uppercase" }), /Offline/);
  assert.equal(workspace.active.text, "hello world");
  assert.equal(workspace.active.canUndo, false);
  assert.equal(runner.working, false);
  fail = false;
  await runner.run({ id: "uppercase" });
  assert.equal(workspace.active.text, "HELLO WORLD");
});
