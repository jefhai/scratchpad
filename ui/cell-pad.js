(() => {
  const UI = globalThis.ScratchpadUI;
  const Domain = globalThis.ScratchpadDomain;
  const { useEffect, useMemo, useRef } = React;
  const h = React.createElement;
  const { columnLabel, coordinate, isNumeric } = Domain;

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function CellPad({ pad, notify, onChange, onOpenCommands, shortcut }) {
    const viewportRef = useRef(null);
    const selected = pad.selectedCoordinates();
    const selectedKeys = useMemo(
      () => new Set(selected.map(({ row, column }) => `${row}:${column}`)),
      [pad, pad.grid, pad.selection],
    );
    const numericCount = pad.selectedEntries().filter((entry) => isNumeric(entry.value)).length;

    useEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      viewport.scrollTop = pad.scroll.top;
      viewport.scrollLeft = pad.scroll.left;
      requestAnimationFrame(() => document.querySelector('[data-cell="0:0"]')?.focus());
    }, [pad.id]);

    function refresh() { onChange(); }

    function focusCell(row, column) {
      const next = pad.focusCell(row, column);
      refresh();
      requestAnimationFrame(() => {
        document.querySelector(`[data-cell="${next.row}:${next.column}"]`)?.focus();
      });
    }

    function undo() {
      if (pad.undo()) refresh();
      requestAnimationFrame(() => document.querySelector(`[data-cell="${pad.activeCell.row}:${pad.activeCell.column}"]`)?.focus());
    }

    function redo() {
      if (pad.redo()) refresh();
      requestAnimationFrame(() => document.querySelector(`[data-cell="${pad.activeCell.row}:${pad.activeCell.column}"]`)?.focus());
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
        h("div", { className: "sheet-meta" },
          h("span", null, "CELLPAD"),
          h("span", null, `${pad.columnCount} columns × ${pad.rowCount} rows`),
        ),
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
          h("button", { className: "theme-button", type: "button", "aria-label": "Choose color theme" }),
        ),
      ),
      h("div", { className: "formula-bar" },
        h("span", { className: "cell-address" }, coordinate(pad.activeCell.row, pad.activeCell.column)),
        h("span", { className: "formula-symbol", "aria-hidden": "true" }, "fx"),
        h("input", {
          className: "formula-input",
          value: pad.activeValue,
          onChange: (event) => {
            pad.setCell(pad.activeCell.row, pad.activeCell.column, event.target.value, "typing");
            refresh();
          },
          "aria-label": `Edit ${coordinate(pad.activeCell.row, pad.activeCell.column)}`,
          placeholder: "Enter text or a number",
        }),
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
        h("button", { className: "command-trigger", onClick: onOpenCommands },
          h("kbd", null, shortcut), h("kbd", null, "J"), " Commands",
        ),
        h(UI.HistoryControls, { document: pad, onUndo: undo, onRedo: redo, shortcut }),
        h("span", { className: "sheet-selection-summary" },
          `${pad.selectionLabel} selected · ${numericCount} numeric · ${pad.columnCount} × ${pad.rowCount} sheet`,
        ),
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
