/* TEST ONLY. Local renderer preview; never copied into desktop/.web or packaged. */
(async () => {
  const STORAGE_KEY = "scratchpad:test-only:desktop-renderer-preview:v1";
  const rootURL = new URL("../../../", location.href);
  const actions = new Set(), windowListeners = new Set();
  let flushCallback = null, state = null, saves = 0, resetting = false;
  const clone = (value) => JSON.parse(JSON.stringify(value));

  try {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)
      || !["http:", "https:"].includes(location.protocol)) {
      throw new Error("This test fixture is available only through a local HTTP server.");
    }
    if (globalThis.ScratchpadDesktop) throw new Error("The fixture will not replace a real desktop bridge.");

    // Existing browser display preferences stay untouched. The app sees an empty,
    // in-memory preferences store; only this fixture's synthetic workspace persists.
    const preferences = new Map();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem: (key) => preferences.get(String(key)) ?? null,
      setItem: (key, value) => preferences.set(String(key), String(value)),
      removeItem: (key) => preferences.delete(String(key)),
      clear: () => preferences.clear(),
      key: (index) => [...preferences.keys()][index] ?? null,
      get length() { return preferences.size; },
    } });

    function freshState() {
      const Domain = globalThis.ScratchpadDomain;
      const notes = Array.from({ length: 80 }, (_, index) => `Fixture note ${index + 1}: synthetic preview content only.`).join("\n");
      const workspace = new Domain.Workspace(notes);
      workspace.active.title = "Fixture notes";
      workspace.active.setText(`${notes}\nAn edit with an undo step.`);
      workspace.active.setSelection(8, 23, "backward");
      workspace.active.scroll = { top: 180, left: 0 };
      const sheet = workspace.add("sheet");
      sheet.title = "Fixture costs";
      sheet.setCell(1, 1, "7", "command");
      sheet.resize("column", 1, 224);
      sheet.resize("row", 1, 62);
      sheet.selectRows(1);
      sheet.selectRows(3, { toggle: true });
      sheet.result = { name: "Sum", value: "42" };
      sheet.scroll = { top: 120, left: 70 };
      const archive = workspace.add("text");
      archive.title = "Fixture archive";
      archive.setText("Synthetic archive\nThis is the third restored tab.");
      workspace.select(1);
      return {
        workspace: Domain.WorkspaceState.serialize(workspace),
        window: { id: "test-only-preview-window", name: "Fixture research window", alwaysOnTop: false },
      };
    }
    function persist() {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      document.getElementById("fixture-save-count")?.replaceChildren(`Mock saves: ${saves}`);
    }
    function subscribe(set, listener) { set.add(listener); return () => set.delete(listener); }
    globalThis.ScratchpadDesktop = Object.freeze({
      async load() {
        if (!state) {
          try {
            const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
            const workspace = globalThis.ScratchpadDomain.WorkspaceState.validate(saved?.workspace);
            if (workspace && saved.window?.id === "test-only-preview-window" && typeof saved.window.name === "string") {
              state = { workspace, window: { id: saved.window.id, name: saved.window.name.slice(0, 80), alwaysOnTop: saved.window.alwaysOnTop === true } };
            }
          } catch { /* A malformed test snapshot resets to the known synthetic fixture. */ }
          state ??= freshState();
        }
        return clone(state);
      },
      async save(workspace) {
        if (resetting) return;
        const validated = globalThis.ScratchpadDomain.WorkspaceState.validate(workspace);
        if (!validated) throw new Error("The test snapshot is invalid.");
        state.workspace = validated;
        saves += 1;
        persist();
      },
      async renameWindow(name) {
        if (typeof name !== "string" || !name.trim() || name.length > 80) throw new Error("Invalid test window name.");
        state.window.name = name.replace(/[\u0000-\u001f\u007f]/g, "").trim();
        persist();
        windowListeners.forEach((listener) => listener(clone(state.window)));
        return state.window.name;
      },
      onAction: (listener) => subscribe(actions, listener),
      onWindowInfo: (listener) => subscribe(windowListeners, listener),
      onFlushRequested(callback) { flushCallback = callback; return () => { flushCallback = null; }; },
    });

    // Fetch the actual root index, retaining its source-of-truth script order.
    // Replace only the two CDN React URLs with the generated offline copies.
    const response = await fetch(new URL("index.html", rootURL));
    if (!response.ok) throw new Error("The real app index could not be loaded.");
    const source = new DOMParser().parseFromString(await response.text(), "text/html");
    for (const link of source.querySelectorAll('link[rel="stylesheet"], link[rel="icon"]')) {
      const copy = document.createElement("link");
      copy.rel = link.rel;
      copy.href = new URL(link.getAttribute("href"), rootURL).href;
      document.head.append(copy);
    }
    document.getElementById("fixture-loading").remove();
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    const base = document.createElement("base");
    base.href = rootURL.href;
    document.head.append(base);
    for (const element of source.querySelectorAll("script[src]")) {
      let url = new URL(element.getAttribute("src"), rootURL);
      if (url.origin !== rootURL.origin) {
        const vendor = url.href.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/(react(?:-dom)?)@18\.3\.1\/umd\/(react(?:-dom)?\.production\.min\.js)$/);
        if (!vendor) throw new Error(`Unexpected external runtime script: ${url.href}`);
        url = new URL(`desktop/.web/vendor/${vendor[2]}`, rootURL);
      }
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url.href;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Missing runtime asset: ${url.pathname}. Run the desktop prepare:web step first.`));
        document.body.append(script);
      });
    }

    const controls = document.createElement("details");
    controls.className = "fixture-controls";
    controls.setAttribute("aria-label", "Test-only desktop preview controls");
    controls.innerHTML = '<summary>TEST ONLY · mock desktop</summary><p>Synthetic data only. Reload restores this test tab’s snapshot.</p><p id="fixture-save-count">Mock saves: 0</p><p id="fixture-check-result" role="status"></p>';
    function button(label, action) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", action);
      controls.append(button);
    }
    for (const [label, type] of [["Menu: Rename", "rename-window"], ["Menu: Commands", "commands"], ["Menu: Undo", "undo"], ["Menu: Redo", "redo"]]) {
      button(label, () => actions.forEach((listener) => listener({ type })));
    }
    button("Toggle on top", () => {
      state.window.alwaysOnTop = !state.window.alwaysOnTop;
      persist();
      windowListeners.forEach((listener) => listener(clone(state.window)));
    });
    button("Flush + reload", async () => {
      if (!flushCallback) return;
      await globalThis.ScratchpadDesktop.save(await flushCallback());
      location.reload();
    });
    button("Reset synthetic data", () => {
      // The app attempts a pagehide save; do not let that restore the test key.
      resetting = true;
      sessionStorage.removeItem(STORAGE_KEY);
      location.reload();
    });
    button("Check DOM", () => {
      const checks = [
        ["Desktop window bar", !!document.querySelector(".desktop-window-bar")],
        ["Three restored tabs", document.querySelectorAll('[role="tab"]').length === 3],
        ["Download UI hidden", !document.querySelector(".desktop-download-button")],
      ];
      document.getElementById("fixture-check-result").textContent = checks.map(([name, passed]) => `${passed ? "PASS" : "FAIL"}: ${name}`).join(" · ");
    });
    document.body.append(controls);
  } catch (error) {
    const failure = document.createElement("pre");
    failure.className = "fixture-error";
    failure.setAttribute("role", "alert");
    failure.textContent = `Test fixture could not open: ${error.message}`;
    document.body.replaceChildren(failure);
  }
})();
