(() => {
  const { useEffect, useRef, useState } = React;
  const h = React.createElement;
  const Domain = globalThis.ScratchpadDomain;
  const UI = globalThis.ScratchpadUI;

  function App({ initialWorkspace, desktop }) {
    const workspaceRef = useRef(initialWorkspace);
    const workspace = workspaceRef.current;
    const executionRef = useRef(null);
    if (!executionRef.current) {
      executionRef.current = new Domain.CommandExecution(workspace, ScratchpadCommandLibrary);
    }
    const execution = executionRef.current;
    const [, setRevision] = useState(0);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [working, setWorking] = useState(false);
    const [toast, setToast] = useState(null);
    const [windowInfo, setWindowInfo] = useState(desktop?.window ?? null);
    const [renameOpen, setRenameOpen] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const sessionRef = useRef(null);
    const actionsRef = useRef(null);
    const active = workspace.active;
    const shortcut = /mac|iphone|ipad|ipod/i.test(`${navigator.platform} ${navigator.userAgent}`)
      ? "⌘"
      : "Ctrl";
    const commands = ScratchpadCommandCatalog[active.kind];

    function refresh() {
      setRevision((revision) => revision + 1);
      sessionRef.current?.schedule();
    }

    function notify(message, tone = "info") {
      setToast({ message, tone });
    }

    function focusActive() {
      if (window.matchMedia("(pointer: coarse)").matches) return;
      requestAnimationFrame(() => {
        if (workspace.active.kind === "text") {
          const editor = document.querySelector("textarea.editor");
          editor?.focus();
          editor?.setSelectionRange(
            workspace.active.selection.start,
            workspace.active.selection.end,
            workspace.active.selection.direction,
          );
        } else {
          const { row, column } = workspace.active.activeCell;
          document.querySelector(`[data-cell="${row}:${column}"]`)?.focus();
        }
      });
    }

    function closePalette() {
      execution.cancel();
      setWorking(false);
      setPaletteOpen(false);
      setQuery("");
      focusActive();
    }

    function openPalette() {
      document.dispatchEvent(new CustomEvent("scratchpad:popover-open", {
        detail: { id: "command-palette" },
      }));
      setPaletteOpen(true);
      setQuery("");
    }

    function openRename() {
      if (!desktop) return;
      execution.cancel();
      setWorking(false);
      setPaletteOpen(false);
      document.dispatchEvent(new CustomEvent("scratchpad:popover-open", { detail: { id: "rename-window" } }));
      setRenameOpen(true);
    }

    async function renameWindow(name) {
      const savedName = await desktop.bridge.renameWindow(name);
      setWindowInfo((info) => ({ ...info, name: savedName }));
    }

    function undo() {
      if (workspace.active.undo()) refresh();
      focusActive();
    }

    function redo() {
      if (workspace.active.redo()) refresh();
      focusActive();
    }

    async function runCommand(command) {
      if (execution.working) return;
      setWorking(true);
      try {
        const editor = document.querySelector("textarea.editor");
        const tabSize = Number.parseInt(editor ? getComputedStyle(editor).tabSize : "2", 10);
        const result = await execution.run(command, { tabSize });
        if (result.status === "cancelled" || result.status === "busy") return;
        if (result.notice) notify(result.notice);
        if (result.status === "changed") refresh();
        closePalette();
      } catch (error) {
        notify(error instanceof Error ? error.message : `Could not run ${command.name}`, "error");
      } finally {
        setWorking(execution.working);
      }
    }

    useEffect(() => {
      if (!toast) return undefined;
      const timer = window.setTimeout(() => setToast(null), 2800);
      return () => window.clearTimeout(timer);
    }, [toast]);

    actionsRef.current = (action) => {
      UI.routeDesktopAction(action, {
        undo, redo, rename: openRename,
        commands: () => { if (paletteOpen) closePalette(); else openPalette(); },
      }, { modalOpen: renameOpen, paletteOpen });
    };

    useEffect(() => {
      if (!desktop) return undefined;
      const session = UI.createDesktopSession(desktop.bridge, workspace, (error) => {
        setSaveError(error ? "Changes could not be saved on this device. "
          + (error.message || "Try again before closing this window.") : null);
      }, () => {
        execution.cancel();
        setWorking(false);
      });
      sessionRef.current = session;
      const stopActions = desktop.bridge.onAction((action) => actionsRef.current(action));
      const stopWindowInfo = desktop.bridge.onWindowInfo(setWindowInfo);
      session.schedule();
      return () => {
        sessionRef.current = null;
        stopActions();
        stopWindowInfo();
        session.dispose();
      };
    }, []);

    useEffect(() => {
      if (!desktop) return undefined;
      // Child editors focus on mount. Restore the exact saved viewport after that focus.
      const savedScroll = { ...active.scroll };
      const frame = requestAnimationFrame(() => {
        const viewport = document.querySelector(active.kind === "text" ? "textarea.editor" : ".sheet-viewport");
        if (!viewport) return;
        viewport.scrollTop = savedScroll.top;
        viewport.scrollLeft = savedScroll.left;
        active.scroll = savedScroll;
      });
      return () => cancelAnimationFrame(frame);
    }, [active.id]);

    useEffect(() => {
      function handleKeyDown(event) {
        if (event.defaultPrevented || event.isComposing || event.altKey) return;
        const modifier = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        if (renameOpen) return;
        if (modifier && key === "j") {
          event.preventDefault();
          if (event.repeat) return;
          if (paletteOpen) closePalette();
          else openPalette();
          return;
        }
        if (event.key === "Escape" && paletteOpen) {
          event.preventDefault();
          closePalette();
          return;
        }
        const target = event.target;
        const editor = target.closest?.("textarea.editor, input.cell-input");
        const otherInput = target.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
        const popup = target.closest?.("[role='dialog'], [role='menu']");
        if (popup || (otherInput && !editor)) return;
        if (!paletteOpen && modifier && key === "z") {
          event.preventDefault();
          if (!event.repeat) event.shiftKey ? redo() : undo();
          return;
        }
        if (!paletteOpen && modifier && key === "y") {
          event.preventDefault();
          if (!event.repeat) redo();
          return;
        }
      }

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    });

    useEffect(() => {
      execution.cancel();
      setWorking(false);
      setPaletteOpen(false);
      setQuery("");
    }, [active.id]);

    const paletteMeta = active.kind === "text"
      ? active.selection.end > active.selection.start
        ? `${active.selection.end - active.selection.start} selected`
        : "Full text"
      : `${active.selectionLabel} · ${active.selectedEntries().filter((entry) => Domain.isNumeric(entry.value)).length} numeric`;

    return h("main", { className: `app-shell${desktop ? " desktop" : ""}` },
      h("section", { className: `editor-panel ${active.kind === "sheet" ? "cell-mode" : "text-mode"}` },
        desktop && h(UI.DesktopWindowBar, { windowInfo, onRename: openRename, saveError }),
        h(UI.TabBar, { workspace, onChange: refresh }),
        active.kind === "text"
          ? h(UI.TextPad, {
            key: active.id,
            pad: active,
            notify,
            onChange: refresh,
            onOpenCommands: openPalette,
            shortcut,
          })
          : h(UI.CellPad, {
            key: active.id,
            pad: active,
            notify,
            onChange: refresh,
            onOpenCommands: openPalette,
            shortcut,
          }),
      ),
      renameOpen && h(UI.RenameWindowDialog, {
        name: windowInfo.name,
        onClose: () => setRenameOpen(false),
        onRename: renameWindow,
      }),
      paletteOpen && h(UI.CommandPalette, {
        commands,
        meta: paletteMeta,
        onClose: closePalette,
        onRun: runCommand,
        query,
        setQuery,
        title: active.kind === "text" ? "Choose a transformation" : "Calculate the selection",
        working,
      }),
      toast && h("div", { className: `toast ${toast.tone}`, role: "status" },
        h("span", null, toast.tone === "error" ? "!" : "✓"),
        toast.message,
      ),
    );
  }

  const root = ReactDOM.createRoot(document.getElementById("root"));
  const bridge = globalThis.ScratchpadDesktop;
  if (!bridge && document.documentElement?.dataset?.desktopRuntime === "tauri") {
    root.render(h("main", { className: "desktop-startup-error", role: "alert" },
      h("h1", null, "The desktop app could not open"),
      h("p", null, "Its local bridge is unavailable. Your saved workspaces remain on this device. Rebuild or reinstall the app before editing."),
    ));
    return;
  }
  if (!bridge) {
    root.render(h(App, { initialWorkspace: new Domain.Workspace(ScratchpadCommandUtils.sampleJson) }));
    return;
  }
  root.render(h("p", { className: "desktop-loading", role: "status" }, "Opening your workspace…"));
  // Never mount an editable default workspace until the desktop load has succeeded.
  // Failed or unsupported snapshots remain untouched on disk for recovery.
  Promise.resolve().then(() => bridge.load()).then((loaded) => {
    if (!loaded || !loaded.window || typeof loaded.window.name !== "string") throw new Error("Invalid desktop session response");
    const workspace = loaded.workspace === null
      ? new Domain.Workspace(ScratchpadCommandUtils.sampleJson)
      : Domain.WorkspaceState.restore(loaded.workspace);
    if (!workspace) throw new Error("This saved workspace is damaged or uses an unsupported format");
    root.render(h(App, { initialWorkspace: workspace, desktop: { bridge, window: loaded.window } }));
  }).catch(() => {
    root.render(h("main", { className: "desktop-startup-error", role: "alert" },
      h("h1", null, "Your workspace could not be opened"),
      h("p", null, "The saved session has been kept on this device. Reopen this window to retry, or use the desktop session backup to recover it."),
      h("button", { type: "button", onClick: () => location.reload() }, "Retry opening workspace"),
    ));
  });
})();
