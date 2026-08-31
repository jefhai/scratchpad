(() => {
  const UI = globalThis.ScratchpadUI;
  const Domain = globalThis.ScratchpadDomain;
  const { useEffect, useMemo, useRef, useState } = React;
  const h = React.createElement;
  const { columnLabel, coordinate, isNumeric } = Domain;

  const DEFAULT_SETTINGS = {
    lineHeight: 30,
    caretSpacing: 1,
    lineNumberSize: 15,
  };

  const SETTING_DEFINITIONS = [
    { label: "Line spacing", key: "lineHeight", min: 24, max: 84, step: 1, unit: "px" },
    { label: "Caret spacing", key: "caretSpacing", min: 0, max: 8, step: 0.25, unit: "px" },
    { label: "Line number size", key: "lineNumberSize", min: 11, max: 40, step: 1, unit: "px" },
  ];

  function loadSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("workbench-cell-settings") || "{}") };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function CellPad({ pad, notify, onChange, onOpenCommands, shortcut }) {
    const viewportRef = useRef(null);
    const [settings, setSettings] = useState(loadSettings);
    const selected = pad.selectedCoordinates();
    const selectedKeys = useMemo(
      () => new Set(selected.map(({ row, column }) => `${row}:${column}`)),
      [pad, pad.grid, pad.selection],
    );
    const numericCount = pad.selectedEntries().filter((entry) => isNumeric(entry.value)).length;

    useEffect(() => {
      localStorage.setItem("workbench-cell-settings", JSON.stringify(settings));
      const shell = document.querySelector(".app-shell");
      shell?.style.setProperty("--cell-height", `${settings.lineHeight}px`);
      shell?.style.setProperty("--cell-letter-spacing", `${settings.caretSpacing}px`);
      shell?.style.setProperty("--cell-header-size", `${settings.lineNumberSize}px`);
    }, [settings]);

    useEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      viewport.scrollTop = pad.scroll.top;
      viewport.scrollLeft = pad.scroll.left;
      requestAnimationFrame(() => focusInputAtEnd(0, 0));
    }, [pad.id]);

    function refresh() { onChange(); }

    function moveCaretToEnd(input) {
      if (!input) return;
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }

    function focusInputAtEnd(row, column) {
      moveCaretToEnd(document.querySelector(`[data-cell="${row}:${column}"]`));
    }

    function focusCell(row, column) {
      const next = pad.focusCell(row, column);
      refresh();
      requestAnimationFrame(() => focusInputAtEnd(next.row, next.column));
    }

    function undo() {
      if (pad.undo()) refresh();
      requestAnimationFrame(() => focusInputAtEnd(pad.activeCell.row, pad.activeCell.column));
    }

    function redo() {
      if (pad.redo()) refresh();
      requestAnimationFrame(() => focusInputAtEnd(pad.activeCell.row, pad.activeCell.column));
    }

    async function copySelection() {
      const text = pad.selectionMatrix().map((row) => row.join("\t")).join("\n");
      await navigator.clipboard.writeText(text);
      notify(`${selected.length} cell${selected.length === 1 ? "" : "s"} copied`);
    }

    function saveCsv() {
      const csv = pad.grid.map((row) => row.map(csvEscape).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "cellpad.csv";
      link.click();
      URL.revokeObjectURL(url);
      notify("Downloaded cellpad.csv");
    }

    function handleCellKeyDown(event, row, column) {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "a") {
        event.preventDefault();
        pad.selectAll();
        refresh();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        const changed = pad.clearSelection();
        refresh();
        notify(changed ? "Selection cleared" : "Selection is already empty");
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        focusCell(row + (event.shiftKey ? -1 : 1), column);
      } else if (event.key === "Tab") {
        event.preventDefault();
        const direction = event.shiftKey ? -1 : 1;
        let nextColumn = column + direction;
        let nextRow = row;
        if (nextColumn >= pad.columnCount) {
          nextColumn = 0;
          nextRow += 1;
        } else if (nextColumn < 0) {
          nextColumn = pad.columnCount - 1;
          nextRow -= 1;
        }
        focusCell(nextRow, nextColumn);
      }
    }

    const gridChildren = [
      h("button", {
        className: "corner",
        key: "corner",
        type: "button",
        onClick: () => { pad.selectAll(); refresh(); },
        title: "Select all cells",
        "aria-label": "Select all cells",
      }, "▧"),
      ...Array.from({ length: pad.columnCount }, (_, column) => h("button", {
        className: `column-header ${pad.selection.kind === "columns" && pad.selection.columns.includes(column) ? "selected" : ""}`,
        key: `column-${column}`,
        type: "button",
        role: "columnheader",
        onMouseDown: (event) => {
          pad.selectColumns(column, { extend: event.shiftKey, toggle: event.ctrlKey || event.metaKey });
          refresh();
        },
        "aria-label": `Select column ${columnLabel(column)}`,
      }, columnLabel(column))),
    ];

    pad.grid.forEach((row, rowIndex) => {
      gridChildren.push(h("button", {
        className: `row-header ${pad.selection.kind === "rows" && pad.selection.rows.includes(rowIndex) ? "selected" : ""}`,
        key: `row-${rowIndex}`,
        type: "button",
        role: "rowheader",
        onMouseDown: (event) => {
          pad.selectRows(rowIndex, { extend: event.shiftKey, toggle: event.ctrlKey || event.metaKey });
          refresh();
        },
        "aria-label": `Select row ${rowIndex + 1}`,
      }, rowIndex + 1));

      row.forEach((value, columnIndex) => {
        const key = `${rowIndex}:${columnIndex}`;
        const active = pad.activeCell.row === rowIndex && pad.activeCell.column === columnIndex;
        gridChildren.push(h("div", {
          className: `cell-wrap ${selectedKeys.has(key) ? "selected" : ""} ${active ? "active" : ""}`,
          key,
          role: "gridcell",
          "aria-selected": selectedKeys.has(key),
        }, h("input", {
          className: `cell-input ${isNumeric(value) ? "numeric" : ""}`,
          value,
          "data-cell": key,
          "aria-label": `${coordinate(rowIndex, columnIndex)} value`,
          onMouseDown: (event) => {
            pad.selectCell(rowIndex, columnIndex, event.shiftKey);
            refresh();
          },
          onClick: (event) => moveCaretToEnd(event.currentTarget),
          onChange: (event) => {
            pad.setCell(rowIndex, columnIndex, event.target.value, "typing");
            refresh();
          },
          onKeyDown: (event) => handleCellKeyDown(event, rowIndex, columnIndex),
          onPaste: (event) => {
            const text = event.clipboardData.getData("text");
            if (!text) return;
            event.preventDefault();
            const size = pad.paste(text, rowIndex, columnIndex);
            refresh();
            if (size) notify(`Pasted ${size.rows} × ${size.columns} cells`);
          },
          autoComplete: "off",
          spellCheck: false,
        })));
      });
    });

    return h(React.Fragment, null,
      h("div", { className: "sheet-toolbar" },
        h("div", { className: "editor-meta" },
          h("span", null, "CELLPAD"),
          h("span", null,
            `${pad.columnCount} columns × ${pad.rowCount} rows · ${coordinate(pad.activeCell.row, pad.activeCell.column)} · ${pad.selectionLabel} selected · ${numericCount} numeric`,
          ),
        ),
        h("div", { className: "sheet-controls" },
          h("div", { className: "sheet-actions" },
            h("button", { onClick: () => { pad.addRow(); refresh(); notify("Row added"); } }, "+ Row"),
            h("button", { onClick: () => { pad.addColumn(); refresh(); notify("Column added"); } }, "+ Column"),
            pad.selection.kind === "rows" && h("button", { onClick: () => {
              const count = pad.removeSelectedRows();
              refresh();
              notify(`${count} row${count === 1 ? "" : "s"} removed`);
            } }, "Remove rows"),
            pad.selection.kind === "columns" && h("button", { onClick: () => {
              const count = pad.removeSelectedColumns();
              refresh();
              notify(`${count} column${count === 1 ? "" : "s"} removed`);
            } }, "Remove columns"),
            h("button", { onClick: copySelection }, "Copy"),
            h("button", { onClick: saveCsv }, "Save CSV"),
            h("button", { onClick: () => {
              const changed = pad.clearSelection();
              refresh();
              notify(changed ? "Selection cleared" : "Selection is already empty");
            } }, "Clear selection"),
            h("button", { onClick: () => { pad.clear(); refresh(); notify("Sheet cleared · Undo is available"); } }, "Clear sheet"),
          ),
          h("div", { className: "sheet-fixed-actions" },
            h("button", { className: "theme-button", type: "button", "aria-label": "Choose color theme" }),
            h(UI.DisplaySettings, {
              definitions: SETTING_DEFINITIONS,
              editorKind: "cells",
              id: "cell-display-settings",
              settings,
              onChange: (key, value) => setSettings((current) => ({ ...current, [key]: value })),
              onReset: () => setSettings(DEFAULT_SETTINGS),
            }),
          ),
        ),
      ),
      h("section", {
        className: "sheet-viewport",
        ref: viewportRef,
        "aria-label": `${pad.title} spreadsheet`,
        onScroll: (event) => {
          pad.scroll = { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft };
        },
      }, h("div", {
        className: "sheet-grid",
        role: "grid",
        "aria-rowcount": pad.rowCount,
        "aria-colcount": pad.columnCount,
        style: { "--column-count": pad.columnCount },
      }, gridChildren)),
      h("footer", { className: "sheet-statusbar" },
        h(UI.PadControls, {
          document: pad,
          onOpenCommands,
          onUndo: undo,
          onRedo: redo,
          shortcut,
        }),
        pad.result && h("div", { className: "sheet-result" },
          h("span", null, pad.result.name),
          h("strong", null, pad.result.value),
          h("button", { type: "button", onClick: () => {
            pad.setCell(pad.activeCell.row, pad.activeCell.column, pad.result.value, "command");
            refresh();
            notify(`${pad.result.name} inserted into ${coordinate(pad.activeCell.row, pad.activeCell.column)}`);
          } }, `Insert in ${coordinate(pad.activeCell.row, pad.activeCell.column)}`),
        ),
      ),
    );
  }

  UI.CellPad = CellPad;
})();
