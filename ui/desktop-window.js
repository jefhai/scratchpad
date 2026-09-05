(() => {
  const UI = globalThis.ScratchpadUI;
  const { useEffect, useRef, useState } = React;
  const h = React.createElement;

  function captureWorkspaceView(workspace) {
    const panel = document.getElementById("active-pad-content");
    // During a tab change the DOM can still belong to the previous pad.
    const id = Number(panel?.getAttribute("aria-labelledby")?.replace("pad-tab-", ""));
    const pad = workspace.tabs.find((tab) => tab.id === id);
    if (!pad) return;
    const viewport = pad.kind === "text" ? panel.querySelector("textarea.editor") : panel;
    if (!viewport) return;
    pad.scroll = { top: Math.max(0, viewport.scrollTop), left: Math.max(0, viewport.scrollLeft) };
    if (pad.kind === "text") {
      pad.setSelection(Math.min(viewport.selectionStart, pad.text.length),
        Math.min(viewport.selectionEnd, pad.text.length), viewport.selectionDirection);
    }
  }

  function createDesktopSession(bridge, workspace, onError, beforeFlush = () => {}) {
    let timer = null;
    let pending = Promise.resolve();
    let disposed = false;
    let flushing = false;
    function snapshot() {
      captureWorkspaceView(workspace);
      return globalThis.ScratchpadDomain.WorkspaceState.serialize(workspace);
    }
    function cancel() { clearTimeout(timer); timer = null; }
    function persist() {
      cancel();
      if (disposed || flushing) return;
      let state;
      try { state = snapshot(); } catch (error) { onError(error); return; }
      pending = pending.then(() => bridge.save(state)).then(
        () => { if (!disposed) onError(null); },
        (error) => { if (!disposed) onError(error); },
      );
    }
    function schedule() {
      if (disposed || flushing) return;
      cancel();
      timer = setTimeout(persist, 250);
    }
    async function flush() {
      cancel();
      flushing = true;
      try {
        beforeFlush();
        await pending;
        return snapshot();
      } catch (error) {
        onError(error);
        throw error;
      } finally { flushing = false; }
    }
    const stopFlush = bridge.onFlushRequested(flush);
    const onScroll = (event) => {
      if (event.target.matches?.("textarea.editor, .sheet-viewport")) schedule();
    };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("pagehide", persist);
    return {
      schedule,
      flush,
      dispose() {
        disposed = true;
        cancel();
        stopFlush();
        document.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("pagehide", persist);
      },
    };
  }

  function routeDesktopAction(action, handlers, { modalOpen = false, paletteOpen = false } = {}) {
    const type = action?.type;
    if (type === "rename-window") { handlers.rename(); return; }
    if (type === "undo" || type === "redo") {
      const target = document.activeElement;
      const editor = target?.closest?.("textarea.editor, input.cell-input");
      const editable = target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
      if (editable && !editor) {
        // Menu clicks have no keyboard default action. Keep auxiliary input history local.
        document.execCommand(type);
        return;
      }
      if (modalOpen || paletteOpen || target?.closest?.("dialog, [role='dialog'], [role='menu']")) return;
      handlers[type]();
      return;
    }
    if (type === "commands" && !modalOpen) handlers.commands();
  }

  function DesktopWindowBar({ windowInfo, onRename, saveError }) {
    return h("header", { className: "desktop-window-bar" },
      h("button", { type: "button", className: "desktop-window-name", onClick: onRename,
        "aria-label": `Rename window: ${windowInfo.name}`, title: "Rename this window" },
      h("span", { className: "desktop-window-label" }, "WINDOW"),
      h("strong", null, windowInfo.name)),
      h("span", { className: `desktop-session-status${saveError ? " has-error" : ""}`,
        role: "status", title: saveError || undefined },
      saveError ? "Session not saved" : windowInfo.alwaysOnTop ? "Always on top" : "Local workspace"),
    );
  }

  function RenameWindowDialog({ name, onClose, onRename }) {
    const dialogRef = useRef(null), inputRef = useRef(null);
    const [value, setValue] = useState(name);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
      const previous = document.activeElement;
      dialogRef.current.showModal();
      inputRef.current.focus();
      inputRef.current.select();
      return () => {
        if (previous?.isConnected) previous.focus({ preventScroll: true });
      };
    }, []);
    async function submit(event) {
      event.preventDefault();
      if (!value.trim() || working) return;
      setWorking(true);
      setError(null);
      try { await onRename(value.trim()); onClose(); }
      catch { setError("The window could not be renamed. Please try again."); setWorking(false); }
    }
    return h("dialog", {
      className: "desktop-rename-dialog", ref: dialogRef, "aria-labelledby": "rename-window-heading",
      onCancel: (event) => { event.preventDefault(); if (!working) onClose(); },
    },
    h("form", { onSubmit: submit },
      h("h2", { id: "rename-window-heading" }, "Rename window"),
      h("label", { htmlFor: "desktop-window-name" }, "Window name"),
      h("input", { id: "desktop-window-name", ref: inputRef, value, maxLength: 80, required: true,
        autoComplete: "off", disabled: working, onChange: (event) => setValue(event.target.value) }),
      error && h("p", { className: "desktop-dialog-error", role: "alert" }, error),
      h("div", { className: "desktop-dialog-actions" },
        h("button", { type: "button", onClick: onClose, disabled: working }, "Cancel"),
        h("button", { type: "submit", disabled: !value.trim() || working }, working ? "Saving…" : "Rename")),
    ));
  }

  Object.assign(UI, { captureWorkspaceView, createDesktopSession, routeDesktopAction, DesktopWindowBar, RenameWindowDialog });
})();
