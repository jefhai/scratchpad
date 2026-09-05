(() => {
  const Domain = globalThis.ScratchpadDomain;
  const VERSION = 1;
  const limits = Object.freeze({
    tabs: 128,
    textLength: 4 * 1024 * 1024,
    characters: 8 * 1024 * 1024,
    nodes: 2_000_000,
    rows: 10_000,
    columns: 1_000,
    cells: 50_000,
    history: 100,
    titleLength: 200,
  });

  function invalid() { throw new Error("Workspace state is invalid or exceeds the desktop session limits."); }
  function record(value) {
    if (!value || typeof value !== "object") invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid();
    return value;
  }
  // Read only own data properties. Unknown fields never become document properties.
  function field(value, key) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && !Object.hasOwn(descriptor, "value")) invalid();
    return descriptor?.value;
  }
  function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER - 1) {
    if (!Number.isSafeInteger(value) || value < min || value > max) invalid();
    return value;
  }
  function array(value, maximum, read) {
    if (!Array.isArray(value) || value.length > maximum) invalid();
    return Array.from({ length: value.length }, (_, index) => read(field(value, index), index));
  }
  function take(budget, characters = 0, nodes = 1) {
    budget.characters += characters;
    budget.nodes += nodes;
    if (budget.characters > limits.characters || budget.nodes > limits.nodes) invalid();
  }
  function string(value, budget, maximum = limits.textLength) {
    if (typeof value !== "string" || value.length > maximum) invalid();
    take(budget, value.length);
    return value;
  }
  function sheetValue(value, budget) {
    record(value);
    const source = field(value, "grid");
    if (!Array.isArray(source) || !source.length || source.length > limits.rows) invalid();
    const first = field(source, 0);
    if (!Array.isArray(first) || !first.length || first.length > limits.columns
      || first.length * source.length > limits.cells) invalid();
    const columns = first.length;
    take(budget, 0, source.length);
    const grid = array(source, limits.rows, (row) => {
      if (!Array.isArray(row) || row.length !== columns) invalid();
      return array(row, columns, (cell) => string(cell, budget));
    });
    function dimensions(key, length, axis) {
      const sourceValues = field(value, key);
      if (sourceValues === undefined) return Array(length).fill(null);
      if (!Array.isArray(sourceValues) || sourceValues.length !== length) invalid();
      const range = Domain.SHEET_DIMENSIONS[axis];
      take(budget, 0, length);
      return array(sourceValues, length, (size) => size === null ? null : integer(size, range.min, range.max));
    }
    return {
      grid,
      columnWidths: dimensions("columnWidths", columns, "column"),
      rowHeights: dimensions("rowHeights", grid.length, "row"),
    };
  }
  function scroll(value) {
    if (value === undefined) return { top: 0, left: 0 };
    record(value);
    const position = (key) => {
      const number = field(value, key);
      if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000) invalid();
      return number;
    };
    return { top: position("top"), left: position("left") };
  }
  function point(value, rows, columns) {
    record(value);
    return {
      row: Math.min(integer(field(value, "row")), rows - 1),
      column: Math.min(integer(field(value, "column")), columns - 1),
    };
  }
  function selection(value, tab) {
    if (value === undefined) return tab.kind === "text"
      ? { start: 0, end: 0, direction: "none" } : Domain.initialSelection();
    record(value);
    if (tab.kind === "text") {
      const direction = field(value, "direction") ?? "none";
      if (!["none", "forward", "backward"].includes(direction)) invalid();
      const length = tab.history.present.length;
      const start = Math.min(integer(field(value, "start")), length);
      const end = Math.min(integer(field(value, "end")), length);
      return { start: Math.min(start, end), end: Math.max(start, end), direction };
    }
    const grid = tab.history.present.grid;
    const kind = field(value, "kind");
    if (!["cells", "rows", "columns"].includes(kind)) invalid();
    const indices = (key, count) => [...new Set(array(field(value, key) ?? [], count,
      (index) => integer(index, 0, count - 1)))];
    const rows = indices("rows", grid.length);
    const columns = indices("columns", grid[0].length);
    return {
      kind: (kind === "rows" && !rows.length) || (kind === "columns" && !columns.length) ? "cells" : kind,
      start: point(field(value, "start"), grid.length, grid[0].length),
      end: point(field(value, "end"), grid.length, grid[0].length),
      rows,
      columns,
    };
  }

  function normalize(snapshot, { trimHistory = false } = {}) {
    record(snapshot);
    if (field(snapshot, "version") !== VERSION) invalid();
    const budget = { characters: 0, nodes: 0 };
    const sources = field(snapshot, "tabs");
    if (!Array.isArray(sources) || !sources.length || sources.length > limits.tabs) invalid();
    const seen = new Set();
    // Reserve the budget for every present value before considering undo history.
    const tabs = array(sources, limits.tabs, (source) => {
      record(source);
      const id = integer(field(source, "id"), 1);
      if (seen.has(id)) invalid();
      seen.add(id);
      const kind = field(source, "kind");
      if (kind !== "text" && kind !== "sheet") invalid();
      const history = record(field(source, "history"));
      const tab = {
        id,
        title: string(field(source, "title"), budget, limits.titleLength),
        kind,
        history: { past: [], present: kind === "text"
          ? string(field(history, "present"), budget) : sheetValue(field(history, "present"), budget), future: [] },
      };
      tab.selection = selection(field(source, "selection"), tab);
      tab.scroll = scroll(field(source, "scroll"));
      if (kind === "sheet") {
        const grid = tab.history.present.grid;
        const origin = { row: 0, column: 0 };
        const activeCell = field(source, "activeCell"), cellAnchor = field(source, "cellAnchor");
        tab.activeCell = point(activeCell === undefined ? origin : activeCell, grid.length, grid[0].length);
        tab.cellAnchor = point(cellAnchor === undefined ? tab.activeCell : cellAnchor, grid.length, grid[0].length);
        tab.rowAnchor = Math.min(integer(field(source, "rowAnchor") ?? 0), grid.length - 1);
        tab.columnAnchor = Math.min(integer(field(source, "columnAnchor") ?? 0), grid[0].length - 1);
        const result = field(source, "result");
        tab.result = result === undefined || result === null ? null : {
          name: string(field(record(result), "name"), budget, limits.titleLength),
          value: string(field(result, "value"), budget),
        };
      }
      return tab;
    });
    tabs.forEach((tab, index) => {
      const source = field(field(sources, index), "history");
      const readValue = (value, valueBudget) => tab.kind === "text" ? string(value, valueBudget) : sheetValue(value, valueBudget);
      for (const key of ["past", "future"]) {
        const entries = field(source, key) ?? [];
        if (!Array.isArray(entries) || (!trimHistory && entries.length > limits.history)) invalid();
        const count = Math.min(entries.length, limits.history);
        // Past is oldest first; future is next redo first. Retain contiguous usable entries.
        for (let offset = 0; offset < count; offset += 1) {
          const entryIndex = key === "past" ? entries.length - offset - 1 : offset;
          const nextBudget = { ...budget };
          let entry;
          try { entry = readValue(field(entries, entryIndex), nextBudget); }
          catch (error) { if (trimHistory) break; throw error; }
          budget.characters = nextBudget.characters;
          budget.nodes = nextBudget.nodes;
          if (key === "past") tab.history.past.unshift(entry);
          else tab.history.future.push(entry);
        }
      }
    });
    const counts = record(field(snapshot, "counts"));
    const nextId = integer(field(snapshot, "nextId"), 1);
    const largestId = Math.max(...tabs.map((tab) => tab.id));
    const activeId = integer(field(snapshot, "activeId"), 1);
    if (!seen.has(activeId)) invalid();
    return {
      version: VERSION,
      nextId: Math.max(nextId, largestId + 1),
      counts: {
        text: Math.max(integer(field(counts, "text")), tabs.filter((tab) => tab.kind === "text").length),
        sheet: Math.max(integer(field(counts, "sheet")), tabs.filter((tab) => tab.kind === "sheet").length),
      },
      activeId,
      tabs,
    };
  }

  function serialize(workspace) {
    return normalize({
      version: VERSION,
      nextId: workspace.nextId,
      counts: workspace.counts,
      activeId: workspace.activeId,
      tabs: workspace.tabs.map((tab) => ({
        id: tab.id, title: tab.title, kind: tab.kind,
        history: { past: tab.history.past, present: tab.history.present, future: tab.history.future },
        selection: tab.selection, scroll: tab.scroll,
        ...(tab.kind === "sheet" ? {
          activeCell: tab.activeCell, cellAnchor: tab.cellAnchor,
          rowAnchor: tab.rowAnchor, columnAnchor: tab.columnAnchor,
          result: tab.result,
        } : {}),
      })),
    }, { trimHistory: true });
  }
  function validate(snapshot) {
    try { return normalize(snapshot); } catch { return null; }
  }
  function restore(snapshot) {
    const state = validate(snapshot);
    if (!state) return null;
    const workspace = new Domain.Workspace("");
    workspace.tabs = state.tabs.map((tab) => {
      const pad = tab.kind === "text"
        ? new Domain.TextDocument({ id: tab.id, title: tab.title, text: tab.history.present })
        : new Domain.SheetDocument({ id: tab.id, title: tab.title, grid: tab.history.present.grid });
      pad.history.past = tab.history.past;
      pad.history.present = tab.history.present;
      pad.history.future = tab.history.future;
      pad.history.lastChange = null;
      pad.selection = tab.selection;
      pad.scroll = tab.scroll;
      if (tab.kind === "sheet") {
        pad.activeCell = tab.activeCell;
        pad.cellAnchor = tab.cellAnchor;
        pad.rowAnchor = tab.rowAnchor;
        pad.columnAnchor = tab.columnAnchor;
        pad.result = tab.result;
      }
      return pad;
    });
    workspace.activeId = state.activeId;
    workspace.nextId = state.nextId;
    workspace.counts = state.counts;
    return workspace;
  }

  Domain.WorkspaceState = Object.freeze({ version: VERSION, limits, serialize, validate, restore });
  if (typeof module !== "undefined" && module.exports) module.exports = Domain.WorkspaceState;
})();
