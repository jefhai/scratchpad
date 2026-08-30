(() => {
  const { useEffect, useMemo, useRef, useState } = React;
  const h = React.createElement;
  const Domain = globalThis.ScratchpadDomain;
  const UI = globalThis.ScratchpadUI;

  function App() {
    const workspaceRef = useRef(null);
    if (!workspaceRef.current) {
      workspaceRef.current = new Domain.Workspace(ScratchpadCommandUtils.sampleJson);
    }
    const workspace = workspaceRef.current;
    const [, setRevision] = useState(0);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [working, setWorking] = useState(false);
    const [toast, setToast] = useState(null);
    const active = workspace.active;
    const shortcut = /mac|iphone|ipad|ipod/i.test(`${navigator.platform} ${navigator.userAgent}`)
      ? "⌘"
      : "Ctrl";
    const textCommands = useMemo(() => ScratchpadCommands.all(), []);
    const cellCommands = useMemo(() => ScratchpadCellCommands.all(), []);
    const commands = active.kind === "text" ? textCommands : cellCommands;

    function refresh() {
      setRevision((revision) => revision + 1);
    }

    function notify(message, tone = "info") {
      setToast({ message, tone });
    }

    function focusActive() {
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
      setPaletteOpen(false);
      setQuery("");
      focusActive();
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
      const pad = workspace.active;
      setWorking(true);
      try {
        if (pad.kind === "text") {
          const { start, end } = pad.selection;
          const hasSelection = end > start;
          const input = hasSelection ? pad.text.slice(start, end) : pad.text;
          const replacement = await command.run(input, { setNotice: notify });
          const next = hasSelection
            ? pad.text.slice(0, start) + replacement + pad.text.slice(end)
            : replacement;
          if (next === pad.text) {
            if (command.id !== "count") notify(`${command.name} · No change`);
          } else {
            pad.setText(next);
            if (hasSelection) pad.setSelection(start, start + replacement.length);
            else pad.setSelection(0, 0);
            notify(`${command.name} · ${hasSelection ? "selection" : "full text"}`);
            refresh();
          }
        } else {
          const value = command.run(pad.selectedEntries(), {
            selection: pad.selection,
            grid: pad.grid,
          });
          pad.result = { name: command.name, value: String(value) };
          notify(`${command.name} · ${value}`);
          refresh();
        }
        closePalette();
      } catch (error) {
        notify(error instanceof Error ? error.message : `Could not run ${command.name}`, "error");
      } finally {
        setWorking(false);
      }
    }

    useEffect(() => {
      if (!toast) return undefined;
      const timer = window.setTimeout(() => setToast(null), 2800);
      return () => window.clearTimeout(timer);
    }, [toast]);

    useEffect(() => {
      function handleKeyDown(event) {
        const modifier = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        if (modifier && key === "j") {
          event.preventDefault();
          if (event.repeat) return;
          if (paletteOpen) closePalette();
          else {
            setPaletteOpen(true);
            setQuery("");
          }
          return;
        }
        if (event.key === "Escape" && paletteOpen) {
          event.preventDefault();
          closePalette();
          return;
        }
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
        if (
          !paletteOpen
          && event.key === "Delete"
          && workspace.active.kind === "sheet"
          && document.activeElement?.classList.contains("cell-input")
        ) {
          event.preventDefault();
          const changed = workspace.active.clearSelection();
          refresh();
          notify(changed ? "Selection cleared" : "Selection is already empty");
        }
      }

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    });

    useEffect(() => {
      setPaletteOpen(false);
      setQuery("");
      focusActive();
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
            onOpenCommands: () => setPaletteOpen(true),
            shortcut,
          })
          : h(UI.CellPad, {
            key: active.id,
            pad: active,
            notify,
            onChange: refresh,
            onOpenCommands: () => setPaletteOpen(true),
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
