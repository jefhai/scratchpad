(() => {
  const Domain = globalThis.ScratchpadDomain ??= {};

  class History {
    constructor(initialValue, { clone = (value) => value, limit = 100 } = {}) {
      this.clone = clone;
      this.limit = limit;
      this.past = [];
      this.present = clone(initialValue);
      this.future = [];
      this.lastChange = null;
    }

    get canUndo() { return this.past.length > 0; }
    get canRedo() { return this.future.length > 0; }

    commit(nextValue, { group = null, at = Date.now(), windowMs = 800 } = {}) {
      if (Object.is(nextValue, this.present)) return false;
      const grouped = group
        && this.lastChange?.group === group
        && at - this.lastChange.at < windowMs;
      if (!grouped) this.past = [...this.past, this.present].slice(-this.limit);
      this.present = this.clone(nextValue);
      this.future = [];
      this.lastChange = group ? { group, at } : null;
      return true;
    }

    undo() {
      if (!this.canUndo) return false;
      const previous = this.past.at(-1);
      this.past = this.past.slice(0, -1);
      this.future = [this.present, ...this.future].slice(0, this.limit);
      this.present = previous;
      this.lastChange = null;
      return true;
    }

    redo() {
      if (!this.canRedo) return false;
      const [next, ...remaining] = this.future;
      this.past = [...this.past, this.present].slice(-this.limit);
      this.present = next;
      this.future = remaining;
      this.lastChange = null;
      return true;
    }
  }

  Domain.History = History;
})();
