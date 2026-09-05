/* Packaged desktop only. Tauri's native IPC never uses an Internet service. */
(() => {
  // A missing/blocked native API must show recovery UI, never an unsaved browser pad.
  globalThis.ScratchpadDesktop = Object.freeze({
    load: () => Promise.reject(new Error("The local desktop bridge is unavailable.")),
  });
  const { core, webviewWindow } = globalThis.__TAURI__;
  const currentWindow = webviewWindow.getCurrentWebviewWindow();
  const actions = new Set(), windowInfo = new Set();
  let snapshot = null;
  const invoke = (name, args) => core.invoke(name, args);
  const subscribe = (listeners, callback) => {
    if (typeof callback !== "function") throw new TypeError("A listener is required");
    listeners.add(callback);
    return () => listeners.delete(callback);
  };

  // Install native listeners before the editor loads or starts autosaving.
  const listening = Promise.all([
    currentWindow.listen("desktop:action", ({ payload }) => actions.forEach((listener) => listener(payload))),
    currentWindow.listen("desktop:window-info", ({ payload }) => windowInfo.forEach((listener) => listener(payload))),
    currentWindow.listen("desktop:flush", async ({ payload }) => {
      if (!payload || typeof payload.requestId !== "string") return;
      let workspace = null, error = null;
      try {
        if (!snapshot) throw new Error("The editor is not ready.");
        workspace = await snapshot();
      } catch { error = "The editor could not capture its latest state."; }
      // The native window owns this request; it validates and saves the snapshot.
      // Native save failures are surfaced by its close/quit barrier; a broken IPC
      // connection also times out there. Do not leak raw IPC errors into logs.
      try { await invoke("desktop_flushed", { requestId: payload.requestId, workspace, error }); } catch {}
    }),
  ]);
  // App bootstrap handles the same rejection with a visible recovery message.
  listening.catch(() => {});

  globalThis.ScratchpadDesktop = Object.freeze({
    load: () => listening.then(() => invoke("desktop_load")),
    save: (workspace) => invoke("desktop_save", { workspace }),
    renameWindow: (name) => invoke("desktop_rename", { name }),
    copyText: (text) => invoke("desktop_copy_text", { text }),
    saveFile: (text, kind) => invoke("desktop_save_file", { text, kind }),
    onAction: (callback) => subscribe(actions, callback),
    onWindowInfo: (callback) => subscribe(windowInfo, callback),
    onFlushRequested(callback) {
      if (typeof callback !== "function") throw new TypeError("A snapshot callback is required");
      snapshot = callback;
      listening.then(() => invoke("desktop_ready")).catch(() => {});
      return () => { if (snapshot === callback) snapshot = null; };
    },
  });
})();
