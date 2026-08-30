(() => {
  const UI = globalThis.ScratchpadUI;
  const { useEffect, useRef, useState } = React;
  const h = React.createElement;

  const DEFAULT_SETTINGS = {
    lineHeight: 30,
    caretSpacing: 1,
    tabSize: 2,
    lineNumberSize: 15,
    underlineGap: 5,
  };

  function loadSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("workbench-editor-settings") || "{}") };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  function TextPad({ pad, notify, onChange, onOpenCommands, shortcut }) {
    const editorRef = useRef(null);
    const lineNumbersRef = useRef(null);
    const fileInputRef = useRef(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settings, setSettings] = useState(loadSettings);
    const lines = Math.max(1, pad.text.split(/\r?\n/).length);
    const focusPosition = pad.selection.direction === "backward"
      ? pad.selection.start
      : pad.selection.end;
    const activeLine = pad.text.slice(0, focusPosition).split(/\r?\n/).length - 1;

    useEffect(() => {
      localStorage.setItem("workbench-editor-settings", JSON.stringify(settings));
      const shell = document.querySelector(".app-shell");
      shell?.style.setProperty("--editor-line-height", `${settings.lineHeight}px`);
      shell?.style.setProperty("--caret-spacing", `${settings.caretSpacing}px`);
      shell?.style.setProperty("--editor-tab-size", settings.tabSize);
      shell?.style.setProperty("--editor-left-spacing", `${settings.tabSize}ch`);
      shell?.style.setProperty("--line-number-size", `${settings.lineNumberSize}px`);
    }, [settings]);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.scrollTop = pad.scroll.top;
      editor.scrollLeft = pad.scroll.left;
      editor.setSelectionRange(pad.selection.start, pad.selection.end, pad.selection.direction);
      editor.focus();
    }, [pad.id]);

    function syncSelection(event) {
      const editor = event.currentTarget;
      pad.setSelection(editor.selectionStart, editor.selectionEnd, editor.selectionDirection);
      onChange();
    }

  function changeText(event) {
      const historyKind = event.nativeEvent?.scratchpadHistoryKind ?? "typing";
      pad.setText(event.target.value, historyKind);
      pad.setSelection(event.target.selectionStart, event.target.selectionEnd, event.target.selectionDirection);
      onChange();
    }

    function focusEditor() {
      requestAnimationFrame(() => editorRef.current?.focus());
    }

    function undo() {
      if (pad.undo()) onChange();
      focusEditor();
    }

    function redo() {
      if (pad.redo()) onChange();
      focusEditor();
    }

    async function copyText() {
      await navigator.clipboard.writeText(pad.text);
      notify("Copied to clipboard");
    }

    function saveText() {
      const url = URL.createObjectURL(new Blob([pad.text], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "scratchpad.txt";
      link.click();
      URL.revokeObjectURL(url);
      notify("Downloaded scratchpad.txt");
    }

    function openText(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        pad.setText(String(reader.result ?? ""));
        pad.setSelection(0, 0);
        onChange();
        focusEditor();
      };
      reader.onerror = () => notify("That file could not be read", "error");
      reader.readAsText(file);
      event.target.value = "";
    }

    function setting(label, key, min, max, step, unit) {
      return h("label", { className: "setting-row", key },
        h("span", null,
          h("strong", null, label),
          h("small", null, `${settings[key]}${unit}`),
        ),
        h("input", {
          type: "range",
          min,
          max,
          step,
          value: settings[key],
          onChange: (event) => setSettings((current) => ({
            ...current,
            [key]: Number(event.target.value),
          })),
        }),
      );
    }

    const stats = pad.stats;
    return h(React.Fragment, null,
      h("div", { className: "editor-toolbar" },
        h("div", { className: "editor-meta" },
          h("span", null, "SCRATCHPAD"),
          h("span", null,
            `${stats.characters.toLocaleString()} chars · ${stats.words.toLocaleString()} words · ${stats.lines.toLocaleString()} lines`,
            stats.selected > 0 ? ` · ${stats.selected.toLocaleString()} selected` : "",
          ),
        ),
        h("div", { className: "editor-actions" },
          h("button", { onClick: () => fileInputRef.current?.click() }, "Open"),
          h("input", {
            ref: fileInputRef,
            type: "file",
            accept: "text/*,.json,.csv,.xml,.md",
            onChange: openText,
            hidden: true,
          }),
          h("button", { onClick: copyText }, "Copy"),
          h("button", { onClick: saveText }, "Save"),
          h("button", {
            onClick: () => {
              pad.setText("");
              pad.setSelection(0, 0);
              onChange();
              focusEditor();
            },
          }, "Clear"),
          h("button", { className: "theme-button", type: "button", "aria-label": "Choose color theme" }),
          h("div", { className: "settings-wrap" },
            h("button", {
              className: "settings-button",
              onClick: () => setSettingsOpen((open) => !open),
              "aria-expanded": settingsOpen,
              "aria-controls": "editor-settings",
              "aria-label": "Editor settings",
            }, "⚙"),
            settingsOpen && h("section", {
              className: "settings-menu",
              id: "editor-settings",
              "aria-label": "Editor settings",
            },
              h("div", { className: "settings-heading" },
                h("div", null, h("span", null, "EDITOR"), h("strong", null, "Display settings")),
                h("button", { onClick: () => setSettingsOpen(false), "aria-label": "Close settings" }, "×"),
              ),
              setting("Line spacing", "lineHeight", 24, 84, 1, "px"),
              setting("Caret spacing", "caretSpacing", 0, 8, 0.25, "px"),
              setting("Tab spacing size", "tabSize", 1, 16, 1, " spaces"),
              setting("Line number size", "lineNumberSize", 11, 40, 1, "px"),
              setting("Underline gap", "underlineGap", 0, 12, 1, "px"),
              h("button", { className: "reset-settings", onClick: () => setSettings(DEFAULT_SETTINGS) }, "Reset defaults"),
            ),
          ),
        ),
      ),
      h("div", { className: "editor-wrap" },
        h("span", { className: "active-line-underline", "aria-hidden": "true" }),
        h("div", { className: "line-numbers", ref: lineNumbersRef, "aria-hidden": "true" },
          h("div", null, Array.from({ length: lines }, (_, index) => h("span", {
            className: index === activeLine ? "active" : "",
            key: index,
          }, index + 1))),
        ),
        h("textarea", {
          ref: editorRef,
          className: "editor",
          value: pad.text,
          onChange: changeText,
          onSelect: syncSelection,
          onMouseDown: (event) => {
            const editor = event.currentTarget;
            requestAnimationFrame(() => syncSelection({ currentTarget: editor }));
          },
          onKeyUp: syncSelection,
          onScroll: (event) => {
            pad.scroll = { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft };
            if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
          },
          onBlur: (event) => {
            const underline = event.currentTarget.parentElement.querySelector(".active-line-underline");
            if (underline) underline.style.opacity = "0";
          },
          "aria-label": `${pad.title} text`,
          placeholder: `Paste text here, then press ${shortcut}+J…`,
          spellCheck: false,
          wrap: "off",
        }),
      ),
      h("footer", { className: "editor-footer" },
        h("button", {
          className: "command-trigger",
          onClick: onOpenCommands,
          "aria-keyshortcuts": shortcut === "⌘" ? "Meta+J" : "Control+J",
        }, h("kbd", null, shortcut), h("kbd", null, "J"), " Commands"),
        h(UI.HistoryControls, { document: pad, onUndo: undo, onRedo: redo, shortcut }),
        h("span", { className: "footer-prompt" }, "Select a portion to transform only that text."),
      ),
    );
  }

  UI.TextPad = TextPad;
})();
