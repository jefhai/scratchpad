(() => {
  const UI = globalThis.ScratchpadUI;
  const Domain = globalThis.ScratchpadDomain;
  const { useEffect, useMemo, useRef, useState } = React;
  const h = React.createElement;
  const { columnLabel, coordinate, isNumeric, SHEET_DIMENSIONS } = Domain;

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
    const gridRef = useRef(null);
    const resizeRef = useRef(null);
    const initialCaretRef = useRef(null);
    const [settings, setSettings] = useState(loadSettings);
    const [rangeSelectionEnabled, setRangeSelectionEnabled] = useState(false);
    const selected = pad.selectedCoordinates();
    const selectedKeys = useMemo(
      () => new Set(selected.map(({ row, column }) => `${row}:${column}`)),
      [pad, pad.grid, pad.selection],
    );
    const numericCount = pad.selectedEntries().filter((entry) => isNumeric(entry.value)).length;

    useEffect(() => {
      try { localStorage.setItem("workbench-cell-settings", JSON.stringify(settings)); } catch { /* Settings remain usable without storage. */ }
      const shell = document.querySelector(".app-shell");
      shell?.style.setProperty("--cell-height", `${settings.lineHeight}px`);
      shell?.style.setProperty("--cell-letter-spacing", `${settings.caretSpacing}px`);
      shell?.style.setProperty("--cell-header-size", `${settings.lineNumberSize}px`);
      document.dispatchEvent(new CustomEvent("scratchpad:display-settings-changed"));
    }, [settings]);

    useEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      viewport.scrollTop = pad.scroll.top;
      viewport.scrollLeft = pad.scroll.left;
      const frame = requestAnimationFrame(() => {
        if (document.activeElement === document.body) focusInputAtEnd(pad.activeCell.row, pad.activeCell.column);
      });
      return () => cancelAnimationFrame(frame);
    }, [pad.id]);

    function refresh() { onChange(); }

    function moveCaretToEnd(input) {
      if (!input) return;
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }

    function focusInputAtEnd(row, column, fromKeyboard = false) {
      if (!fromKeyboard && window.matchMedia("(pointer: coarse)").matches) return;
      moveCaretToEnd(viewportRef.current?.querySelector(`[data-cell="${row}:${column}"]`));
    }

    function focusCell(row, column) {
      const next = {
        row: Math.max(0, Math.min(row, pad.rowCount - 1)),
        column: Math.max(0, Math.min(column, pad.columnCount - 1)),
      };
      if (rangeSelectionEnabled) pad.selectCell(next.row, next.column, true);
      else pad.focusCell(next.row, next.column);
      refresh();
      requestAnimationFrame(() => focusInputAtEnd(next.row, next.column, true));
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
      try {
        await navigator.clipboard.writeText(text);
        notify(`${selected.length} cell${selected.length === 1 ? "" : "s"} copied`);
      } catch {
        notify("Clipboard access is unavailable. You can save the sheet as CSV.", "error");
      }
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

    function clearSelectedCells(event) {
      event.preventDefault();
      const changed = pad.clearSelection();
      refresh();
      notify(changed ? "Selection cleared" : "Selection is already empty");
    }

    function handleCellKeyDown(event, row, column) {
      if (event.nativeEvent.isComposing) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "a") {
        event.preventDefault();
        pad.selectAll();
        refresh();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selected.length > 1) {
        clearSelectedCells(event);
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

    function resizeSize(axis, index) {
      const header = gridRef.current?.querySelector(`[data-size-axis="${axis}"][data-size-index="${index}"]`);
      const bounds = header?.parentElement.getBoundingClientRect();
      return bounds ? (axis === "column" ? bounds.width : bounds.height)
        : pad.dimension(axis, index, axis === "row" ? settings.lineHeight : SHEET_DIMENSIONS.column.default);
    }

    function startResize(event, axis, index) {
      if (!event.isPrimary || event.button !== 0 || resizeRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget;
      const size = resizeSize(axis, index);
      resizeRef.current = {
        axis, index, handle, size, startSize: size,
        start: axis === "column" ? event.clientX : event.clientY,
        pointerId: event.pointerId,
        property: `--resize-${axis}-${index}`,
      };
      handle.focus({ preventScroll: true });
      handle.setPointerCapture(event.pointerId);
      handle.dataset.resizing = "true";
      gridRef.current.dataset.resizing = axis;
    }

    function updateResize(event) {
      const resize = resizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      event.preventDefault();
      const limits = SHEET_DIMENSIONS[resize.axis];
      const position = resize.axis === "column" ? event.clientX : event.clientY;
      resize.size = Math.round(Math.max(limits.min, Math.min(limits.max, resize.startSize + position - resize.start)));
      gridRef.current.style.setProperty(resize.property, `${resize.size}px`);
      resize.handle.setAttribute("aria-valuenow", resize.size);
      resize.handle.setAttribute("aria-valuetext", `${resize.size} pixels`);
    }

    function endResize(event, commit = true) {
      const resize = resizeRef.current;
      if (!resize || (event.pointerId !== undefined && resize.pointerId !== event.pointerId)) return;
      event.preventDefault();
      event.stopPropagation();
      resizeRef.current = null;
      delete resize.handle.dataset.resizing;
      delete gridRef.current.dataset.resizing;
      if (resize.handle.hasPointerCapture(resize.pointerId)) resize.handle.releasePointerCapture(resize.pointerId);
      if (commit && resize.size !== resize.startSize) {
        pad.resize(resize.axis, resize.index, resize.size);
        refresh();
      }
      const grid = gridRef.current;
      requestAnimationFrame(() => {
        if (resizeRef.current?.property !== resize.property) grid?.style.removeProperty(resize.property);
      });
      const finalSize = Math.round(commit ? resize.size : resize.startSize);
      resize.handle.setAttribute("aria-valuenow", finalSize);
      resize.handle.setAttribute("aria-valuetext", `${finalSize} pixels`);
    }

    function resetDimension(event, axis, index) {
      event.preventDefault();
      event.stopPropagation();
      if (pad.resize(axis, index, null)) refresh();
    }

    function handleResizeKey(event, axis, index) {
      if (event.key === "Escape" && resizeRef.current) {
        endResize(event, false);
        return;
      }
      if (["Home", "Enter", "Delete", "Backspace"].includes(event.key)) {
        resetDimension(event, axis, index);
        return;
      }
      const direction = axis === "column"
        ? { ArrowLeft: -1, ArrowRight: 1 }[event.key]
        : { ArrowUp: -1, ArrowDown: 1 }[event.key];
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      if (pad.resize(axis, index, resizeSize(axis, index) + direction * (event.shiftKey ? 20 : 4))) refresh();
    }

    function resizeHandle(axis, index) {
      const limits = SHEET_DIMENSIONS[axis];
      const label = axis === "column" ? `column ${columnLabel(index)}` : `row ${index + 1}`;
      const size = pad.dimension(axis, index, axis === "row" ? settings.lineHeight : limits.default);
      return h("span", {
        className: `sheet-resize-handle ${axis}-resize-handle`,
        role: "separator",
        tabIndex: 0,
        "data-size-axis": axis,
        "data-size-index": index,
        "aria-label": `Resize ${label}`,
        "aria-orientation": axis === "column" ? "vertical" : "horizontal",
        "aria-valuemin": limits.min,
        "aria-valuemax": limits.max,
        "aria-valuenow": size,
        "aria-valuetext": `${size} pixels`,
        title: `Drag to resize ${label}. Arrow keys adjust; Shift adjusts faster. Double-click or Enter resets.`,
        onPointerDown: (event) => startResize(event, axis, index),
        onPointerMove: updateResize,
        onPointerUp: (event) => endResize(event),
        onPointerCancel: (event) => endResize(event, false),
        onLostPointerCapture: (event) => endResize(event, false),
        onClick: (event) => event.stopPropagation(),
        onDoubleClick: (event) => resetDimension(event, axis, index),
        onKeyDown: (event) => handleResizeKey(event, axis, index),
      });
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
      ...Array.from({ length: pad.columnCount }, (_, column) => h("div", {
        className: `column-header ${pad.selection.kind === "columns" && pad.selection.columns.includes(column) ? "selected" : ""}`,
        key: `column-${column}`,
        role: "columnheader",
      }, h("button", {
        type: "button",
        className: "sheet-header-select",
        onClick: (event) => {
          pad.selectColumns(column, {
            extend: event.shiftKey || (rangeSelectionEnabled && pad.selection.kind === "columns"),
            toggle: event.ctrlKey || event.metaKey,
          });
          refresh();
        },
        "aria-label": `Select column ${columnLabel(column)}`,
      }, columnLabel(column)), resizeHandle("column", column))),
    ];

    pad.grid.forEach((row, rowIndex) => {
      gridChildren.push(h("div", {
        className: `row-header ${pad.selection.kind === "rows" && pad.selection.rows.includes(rowIndex) ? "selected" : ""}`,
        key: `row-${rowIndex}`,
        role: "rowheader",
      }, h("button", {
        type: "button",
        className: "sheet-header-select",
        onClick: (event) => {
          pad.selectRows(rowIndex, {
            extend: event.shiftKey || (rangeSelectionEnabled && pad.selection.kind === "rows"),
            toggle: event.ctrlKey || event.metaKey,
          });
          refresh();
        },
        "aria-label": `Select row ${rowIndex + 1}`,
      }, rowIndex + 1), resizeHandle("row", rowIndex)));

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
          readOnly: rangeSelectionEnabled,
          "data-cell": key,
          "aria-label": `${coordinate(rowIndex, columnIndex)} value`,
          onPointerDown: (event) => {
            if (event.button !== 0) return;
            if (rangeSelectionEnabled) {
              event.preventDefault();
              initialCaretRef.current = null;
              return;
            }
            const selecting = !active || selected.length > 1 || event.shiftKey
              || document.activeElement !== event.currentTarget;
            initialCaretRef.current = selecting ? event.currentTarget : null;
            if (selecting) {
              pad.selectCell(rowIndex, columnIndex, event.shiftKey);
              refresh();
            }
          },
          onClick: (event) => {
            if (rangeSelectionEnabled) {
              event.preventDefault();
              if (pad.selection.kind !== "cells") pad.selectCell(pad.activeCell.row, pad.activeCell.column);
              pad.selectCell(rowIndex, columnIndex, true);
              refresh();
              return;
            }
            if (initialCaretRef.current === event.currentTarget) moveCaretToEnd(event.currentTarget);
            initialCaretRef.current = null;
          },
          onFocus: (event) => {
            if (pad.activeCell.row === rowIndex && pad.activeCell.column === columnIndex) return;
            pad.selectCell(rowIndex, columnIndex, rangeSelectionEnabled);
            if (!rangeSelectionEnabled) moveCaretToEnd(event.currentTarget);
            refresh();
          },
          onChange: (event) => {
            pad.setCell(rowIndex, columnIndex, event.target.value, "typing");
            refresh();
          },
          onKeyDown: (event) => handleCellKeyDown(event, rowIndex, columnIndex),
          onPaste: (event) => {
            if (rangeSelectionEnabled) {
              event.preventDefault();
              return;
            }
            const text = event.clipboardData.getData("text");
            if (!/[\t\r\n]/.test(text)) return;
            event.preventDefault();
            const size = pad.paste(text, rowIndex, columnIndex);
            refresh();
            if (size) notify(`Pasted ${size.rows} × ${size.columns} cells`);
          },
          autoComplete: "off",
          autoCapitalize: "off",
          autoCorrect: "off",
          spellCheck: false,
        })));
      });
    });

    return h(React.Fragment, null,
      h(UI.PadToolbar, {
        label: "CELLPAD",
        metrics: `${pad.columnCount} columns × ${pad.rowCount} rows · ${coordinate(pad.activeCell.row, pad.activeCell.column)} · ${pad.selectionLabel} selected · ${numericCount} numeric`,
        settings: h(UI.DisplaySettings, {
          definitions: SETTING_DEFINITIONS,
          editorKind: "cells",
          id: "cell-display-settings",
          settings,
          onChange: (key, value) => setSettings((current) => ({ ...current, [key]: value })),
          onReset: () => setSettings(DEFAULT_SETTINGS),
        }),
      },
        h("button", {
          type: "button",
          "aria-pressed": rangeSelectionEnabled,
          title: "Extend the current selection by tapping cells or headers. Turn off to edit cells.",
          onClick: () => {
            if (!rangeSelectionEnabled && document.activeElement?.matches(".cell-input")) document.activeElement.blur();
            setRangeSelectionEnabled((enabled) => !enabled);
          },
        }, "Select range"),
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
      h("section", {
        className: "sheet-viewport",
        id: "active-pad-content",
        role: "tabpanel",
        "aria-labelledby": `pad-tab-${pad.id}`,
        ref: viewportRef,
        "aria-label": `${pad.title} spreadsheet`,
        onKeyDown: (event) => {
          if ((event.key === "Delete" || event.key === "Backspace")
            && event.target.closest(".sheet-header-select, .corner")) clearSelectedCells(event);
        },
        onScroll: (event) => {
          pad.scroll = { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft };
        },
      }, h("div", {
        className: "sheet-grid",
        ref: gridRef,
        role: "grid",
        "aria-rowcount": pad.rowCount,
        "aria-colcount": pad.columnCount,
        style: {
          gridTemplateColumns: `var(--row-header-width, 54px) ${pad.columnWidths.map((width, index) =>
            `var(--resize-column-${index}, ${width === null ? "var(--cell-width, 140px)" : `${width}px`})`).join(" ")}`,
          gridTemplateRows: `${settings.lineHeight}px ${pad.rowHeights.map((height, index) =>
            `var(--resize-row-${index}, ${height ?? settings.lineHeight}px)`).join(" ")}`,
        },
      }, gridChildren)),
      h(UI.PadFooter, null,
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
