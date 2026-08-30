(() => {
  const Domain = globalThis.ScratchpadDomain;
  const { History } = Domain;
  const DEFAULT_ROWS = 24;
  const DEFAULT_COLUMNS = 10;

  function blankGrid(rows = DEFAULT_ROWS, columns = DEFAULT_COLUMNS) {
    return Array.from({ length: rows }, () => Array(columns).fill(""));
  }

  function starterGrid() {
    const grid = blankGrid();
    [
      ["Item", "Quantity", "Price"],
      ["Keyboard", "2", "89.99"],
      ["Monitor", "1", "249.00"],
      ["Cable", "3", "12.50"],
    ].forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
      grid[rowIndex][columnIndex] = value;
    }));
    return grid;
  }

  function cloneGrid(grid) { return grid.map((row) => row.slice()); }

  function initialSelection() {
    return {
      kind: "cells",
      start: { row: 0, column: 0 },
      end: { row: 0, column: 0 },
      rows: [],
      columns: [],
    };
  }

  function rangeBetween(first, second) {
    const start = Math.min(first, second);
    const end = Math.max(first, second);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }

  function columnLabel(index) {
    let label = "";
    let value = index + 1;
    while (value > 0) {
      value -= 1;
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26);
    }
    return label;
  }

  function coordinate(row, column) { return `${columnLabel(column)}${row + 1}`; }
  function isNumeric(value) {
    return String(value).trim() !== "" && Number.isFinite(Number(value));
  }

  class PadDocument {
    constructor({ id, title, kind, initialValue, clone }) {
      this.id = id;
      this.title = title;
      this.kind = kind;
      this.history = new History(initialValue, { clone });
    }

    get value() { return this.history.present; }
    get canUndo() { return this.history.canUndo; }
    get canRedo() { return this.history.canRedo; }
    undo() { return this.history.undo(); }
    redo() { return this.history.redo(); }
  }

  class TextDocument extends PadDocument {
    constructor({ id, title, text = "" }) {
      super({ id, title, kind: "text", initialValue: text });
      this.selection = { start: 0, end: 0, direction: "none" };
      this.scroll = { top: 0, left: 0 };
    }

    get text() { return this.value; }

    get stats() {
      return {
        characters: this.text.length,
        words: this.text.match(/\S+/g)?.length ?? 0,
        lines: Math.max(1, this.text.split(/\r?\n/).length),
        selected: Math.abs(this.selection.end - this.selection.start),
      };
    }

    setText(text, kind = "command") {
      return this.history.commit(text, {
        group: kind === "typing" ? `typing:${this.id}` : null,
      });
    }

    setSelection(start, end, direction = "none") {
      this.selection = { start, end, direction };
    }
  }

  class SheetDocument extends PadDocument {
    constructor({ id, title, grid = blankGrid() }) {
      super({ id, title, kind: "sheet", initialValue: grid, clone: cloneGrid });
      this.selection = initialSelection();
      this.activeCell = { row: 0, column: 0 };
      this.cellAnchor = { row: 0, column: 0 };
      this.rowAnchor = 0;
      this.columnAnchor = 0;
      this.result = null;
      this.scroll = { top: 0, left: 0 };
    }

    get grid() { return this.value; }
    get rowCount() { return this.grid.length; }
    get columnCount() { return this.grid[0].length; }
    get activeValue() {
      return this.grid[this.activeCell.row]?.[this.activeCell.column] ?? "";
    }

    replaceGrid(grid) { return this.history.commit(grid); }

    setCell(row, column, value, kind = "typing") {
      if (this.grid[row][column] === value) return false;
      const next = cloneGrid(this.grid);
      next[row][column] = value;
      return this.history.commit(next, {
        group: kind === "typing" ? `typing:${row}:${column}` : null,
      });
    }

    focusCell(row, column) {
      const next = {
        row: Math.max(0, Math.min(row, this.rowCount - 1)),
        column: Math.max(0, Math.min(column, this.columnCount - 1)),
      };
      this.activeCell = next;
      this.cellAnchor = next;
      this.selection = { ...initialSelection(), start: next, end: next };
      return next;
    }

    selectCell(row, column, extend = false) {
      const next = { row, column };
      this.activeCell = next;
      if (extend) {
        this.selection = { ...initialSelection(), start: this.cellAnchor, end: next };
      } else {
        this.cellAnchor = next;
        this.selection = { ...initialSelection(), start: next, end: next };
      }
    }

    selectRows(row, { extend = false, toggle = false } = {}) {
      this.activeCell = { row, column: this.activeCell.column };
      let rows;
      if (extend) {
        rows = rangeBetween(this.rowAnchor, row);
      } else if (toggle) {
        rows = this.selection.kind === "rows" ? this.selection.rows.slice() : [];
        rows = rows.includes(row) ? rows.filter((index) => index !== row) : [...rows, row];
        if (!rows.length) rows = [row];
        this.rowAnchor = row;
      } else {
        rows = [row];
        this.rowAnchor = row;
      }
      this.selection = { ...initialSelection(), kind: "rows", rows };
    }

    selectColumns(column, { extend = false, toggle = false } = {}) {
      this.activeCell = { row: this.activeCell.row, column };
      let columns;
      if (extend) {
        columns = rangeBetween(this.columnAnchor, column);
      } else if (toggle) {
        columns = this.selection.kind === "columns" ? this.selection.columns.slice() : [];
        columns = columns.includes(column)
          ? columns.filter((index) => index !== column)
          : [...columns, column];
        if (!columns.length) columns = [column];
        this.columnAnchor = column;
      } else {
        columns = [column];
        this.columnAnchor = column;
      }
      this.selection = { ...initialSelection(), kind: "columns", columns };
    }

    selectAll() {
      const start = { row: 0, column: 0 };
      this.activeCell = start;
      this.cellAnchor = start;
      this.selection = {
        ...initialSelection(),
        start,
        end: { row: this.rowCount - 1, column: this.columnCount - 1 },
      };
    }

    selectedCoordinates() {
      const coordinates = [];
      if (this.selection.kind === "rows") {
        this.selection.rows.slice().sort((a, b) => a - b).forEach((row) => {
          for (let column = 0; column < this.columnCount; column += 1) {
            coordinates.push({ row, column });
          }
        });
        return coordinates;
      }
      if (this.selection.kind === "columns") {
        for (let row = 0; row < this.rowCount; row += 1) {
          this.selection.columns.slice().sort((a, b) => a - b).forEach((column) => {
            coordinates.push({ row, column });
          });
        }
        return coordinates;
      }
      const rows = rangeBetween(this.selection.start.row, this.selection.end.row);
      const columns = rangeBetween(this.selection.start.column, this.selection.end.column);
      rows.forEach((row) => columns.forEach((column) => coordinates.push({ row, column })));
      return coordinates;
    }

    selectedEntries() {
      return this.selectedCoordinates().map(({ row, column }) => ({
        row,
        column,
        address: coordinate(row, column),
        value: this.grid[row][column],
      }));
    }

    selectionMatrix() {
      if (this.selection.kind === "rows") {
        return this.selection.rows.slice().sort((a, b) => a - b).map((row) => this.grid[row].slice());
      }
      if (this.selection.kind === "columns") {
        const columns = this.selection.columns.slice().sort((a, b) => a - b);
        return this.grid.map((row) => columns.map((column) => row[column]));
      }
      const rows = rangeBetween(this.selection.start.row, this.selection.end.row);
      const columns = rangeBetween(this.selection.start.column, this.selection.end.column);
      return rows.map((row) => columns.map((column) => this.grid[row][column]));
    }

    clearSelection() {
      const next = cloneGrid(this.grid);
      let changed = false;
      this.selectedCoordinates().forEach(({ row, column }) => {
        changed ||= next[row][column] !== "";
        next[row][column] = "";
      });
      return changed && this.replaceGrid(next);
    }

    clear() {
      this.result = null;
      this.focusCell(0, 0);
      return this.replaceGrid(blankGrid(this.rowCount, this.columnCount));
    }

    addRow() {
      return this.replaceGrid([...cloneGrid(this.grid), Array(this.columnCount).fill("")]);
    }

    addColumn() {
      return this.replaceGrid(this.grid.map((row) => [...row, ""]));
    }

    removeSelectedRows() {
      if (this.selection.kind !== "rows") return 0;
      const removing = new Set(this.selection.rows);
      const next = this.grid.filter((_, row) => !removing.has(row));
      if (!next.length) next.push(Array(this.columnCount).fill(""));
      this.replaceGrid(next);
      this.focusCell(0, 0);
      return removing.size;
    }

    removeSelectedColumns() {
      if (this.selection.kind !== "columns") return 0;
      const removing = new Set(this.selection.columns);
      const next = this.grid.map((row) => row.filter((_, column) => !removing.has(column)));
      if (!next[0].length) next.forEach((row) => row.push(""));
      this.replaceGrid(next);
      this.focusCell(0, 0);
      return removing.size;
    }

    paste(text, startRow, startColumn) {
      const rows = text.replace(/\r\n?/g, "\n").split("\n");
      if (rows.at(-1) === "") rows.pop();
      if (!rows.length) return null;
      const values = rows.map((row) => row.split("\t"));
      const width = Math.max(...values.map((row) => row.length));
      const next = cloneGrid(this.grid);
      while (next.length < startRow + values.length) next.push(Array(next[0].length).fill(""));
      next.forEach((row) => {
        while (row.length < startColumn + width) row.push("");
      });
      values.forEach((row, rowOffset) => row.forEach((value, columnOffset) => {
        next[startRow + rowOffset][startColumn + columnOffset] = value;
      }));
      this.replaceGrid(next);
      this.selection = {
        ...initialSelection(),
        start: { row: startRow, column: startColumn },
        end: { row: startRow + values.length - 1, column: startColumn + width - 1 },
      };
      return { rows: values.length, columns: width };
    }

    get selectionLabel() {
      if (this.selection.kind === "rows") {
        return `${this.selection.rows.length} row${this.selection.rows.length === 1 ? "" : "s"}`;
      }
      if (this.selection.kind === "columns") {
        return `${this.selection.columns.length} column${this.selection.columns.length === 1 ? "" : "s"}`;
      }
      const count = this.selectedCoordinates().length;
      return `${count} cell${count === 1 ? "" : "s"}`;
    }
  }

  Object.assign(Domain, {
    PadDocument,
    SheetDocument,
    TextDocument,
    blankGrid,
    cloneGrid,
    columnLabel,
    coordinate,
    initialSelection,
    isNumeric,
    rangeBetween,
    starterGrid,
  });
})();
