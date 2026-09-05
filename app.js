(() => {
  const { useEffect, useRef, useState } = React;
  const h = React.createElement;
  const Domain = globalThis.ScratchpadDomain;
  const UI = globalThis.ScratchpadUI;

  function App() {
    const workspaceRef = useRef(null);
    if (!workspaceRef.current) {
      workspaceRef.current = new Domain.Workspace(ScratchpadCommandUtils.sampleJson);
    }
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
    const active = workspace.active;
    const shortcut = /mac|iphone|ipad|ipod/i.test(`${navigator.platform} ${navigator.userAgent}`)
      ? "⌘"
      : "Ctrl";
    const commands = ScratchpadCommandCatalog[active.kind];

    function refresh() {
      setRevision((revision) => revision + 1);
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

    useEffect(() => {
      function handleKeyDown(event) {
        if (event.defaultPrevented || event.isComposing || event.altKey) return;
        const modifier = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
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

    return h("main", { className: "app-shell" },
      h("section", { className: `editor-panel ${active.kind === "sheet" ? "cell-mode" : "text-mode"}` },
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

  ReactDOM.createRoot(document.getElementById("root")).render(h(App));
})();
