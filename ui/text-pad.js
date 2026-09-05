(() => {
  const UI = globalThis.ScratchpadUI;
  const { useEffect, useMemo, useRef, useState } = React;
  const h = React.createElement;

  const DEFAULT_SETTINGS = {
    lineHeight: 30,
    caretSpacing: 1,
    tabSize: 2,
    lineNumberSize: 15,
    underlineGap: 5,
  };

  const SETTING_DEFINITIONS = [
    { label: "Line spacing", key: "lineHeight", min: 24, max: 84, step: 1, unit: "px" },
    { label: "Caret spacing", key: "caretSpacing", min: 0, max: 8, step: 0.25, unit: "px" },
    { label: "Tab spacing size", key: "tabSize", min: 1, max: 16, step: 1, unit: " spaces" },
    { label: "Line number size", key: "lineNumberSize", min: 11, max: 40, step: 1, unit: "px" },
    { label: "Underline gap", key: "underlineGap", min: 0, max: 12, step: 1, unit: "px" },
  ];

  function loadSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("workbench-editor-settings") || "{}") };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  // Selection changes update the gutter highlight directly; only line count changes rebuild its rows.
  const LineNumbers = React.memo(function LineNumbers({ count, gutterRef }) {
    return h("div", { className: "line-numbers", ref: gutterRef, "aria-hidden": "true" },
      h("div", null, Array.from({ length: count }, (_, index) => h("span", { key: index }, index + 1))),
    );
  });

  function TextPad({ pad, notify, onChange, onOpenCommands, shortcut }) {
    const editorRef = useRef(null);
    const lineNumbersRef = useRef(null);
    const fileInputRef = useRef(null);
    const [settings, setSettings] = useState(loadSettings);
    const lines = useMemo(() => Math.max(1, pad.text.split(/\r?\n/).length), [pad.text]);

    useEffect(() => {
      try { localStorage.setItem("workbench-editor-settings", JSON.stringify(settings)); } catch { /* Settings remain usable without storage. */ }
      const shell = document.querySelector(".app-shell");
      shell?.style.setProperty("--editor-line-height", `${settings.lineHeight}px`);
      shell?.style.setProperty("--caret-spacing", `${settings.caretSpacing}px`);
      shell?.style.setProperty("--editor-tab-size", settings.tabSize);
      shell?.style.setProperty("--line-number-size", `${settings.lineNumberSize}px`);
      shell?.style.setProperty("--underline-gap", `${settings.underlineGap}px`);
      document.dispatchEvent(new CustomEvent("scratchpad:display-settings-changed"));
    }, [settings]);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.scrollTop = pad.scroll.top;
      editor.scrollLeft = pad.scroll.left;
      editor.setSelectionRange(pad.selection.start, pad.selection.end, pad.selection.direction);
      if (document.activeElement === document.body && !window.matchMedia("(pointer: coarse)").matches) {
        editor.focus({ preventScroll: true });
      }
    }, [pad.id]);

    useEffect(() => {
      let frame = 0;
      const selectionChanged = () => {
        if (document.activeElement !== editorRef.current || frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (editorRef.current) syncSelection({ currentTarget: editorRef.current });
        });
      };
      document.addEventListener("selectionchange", selectionChanged);
      return () => {
        cancelAnimationFrame(frame);
        document.removeEventListener("selectionchange", selectionChanged);
      };
    }, [pad.id]);

    function syncSelection(event) {
      const editor = event.currentTarget;
      if (pad.selection.start === editor.selectionStart && pad.selection.end === editor.selectionEnd
        && pad.selection.direction === editor.selectionDirection) return;
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
      if (window.matchMedia("(pointer: coarse)").matches) return;
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
      try {
        await navigator.clipboard.writeText(pad.text);
        notify("Copied to clipboard");
      } catch { notify("Clipboard access is unavailable. Select the text and copy it manually.", "error"); }
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

    const stats = pad.stats;
    return h(React.Fragment, null,
      h(UI.PadToolbar, {
        label: "SCRATCHPAD",
        metrics: `${stats.characters.toLocaleString()} chars · ${stats.words.toLocaleString()} words · ${stats.lines.toLocaleString()} lines`
          + (stats.selected > 0 ? ` · ${stats.selected.toLocaleString()} selected` : ""),
        settings: h(UI.DisplaySettings, {
          definitions: SETTING_DEFINITIONS,
          editorKind: "text",
          id: "text-display-settings",
          settings,
          onChange: (key, value) => setSettings((current) => ({ ...current, [key]: value })),
          onReset: () => setSettings(DEFAULT_SETTINGS),
        }),
      },
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
      ),
      h("div", { className: "editor-wrap", id: "active-pad-content", role: "tabpanel", "aria-labelledby": `pad-tab-${pad.id}` },
        h("span", { className: "active-line-underline", "aria-hidden": "true" }),
        h(LineNumbers, { count: lines, gutterRef: lineNumbersRef }),
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
          autoCapitalize: "off",
          autoCorrect: "off",
          wrap: "off",
        }),
      ),
      h(UI.PadFooter, null,
        h(UI.PadControls, {
          document: pad,
          onOpenCommands,
          onUndo: undo,
          onRedo: redo,
          shortcut,
        }),
        h("span", { className: "footer-prompt" }, "Select a portion to transform only that text."),
      ),
    );
  }

  UI.TextPad = TextPad;
})();
