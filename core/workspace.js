(() => {
  const Domain = globalThis.ScratchpadDomain;
  const { SheetDocument, TextDocument, starterGrid } = Domain;

  class Workspace {
    constructor(sampleText) {
      this.nextId = 1;
      this.counts = { text: 0, sheet: 0 };
      const first = this.build("text", sampleText);
      this.tabs = [first];
      this.activeId = first.id;
    }

    get active() {
      return this.tabs.find((tab) => tab.id === this.activeId) ?? this.tabs[0];
    }

    build(kind, initialValue) {
      const id = this.nextId;
      this.nextId += 1;
      this.counts[kind] += 1;
      if (kind === "sheet") {
        return new SheetDocument({
          id,
          title: `Cellpad ${this.counts.sheet}`,
          grid: initialValue ?? starterGrid(),
        });
      }
      return new TextDocument({
        id,
        title: `Scratchpad ${this.counts.text}`,
        text: initialValue ?? "",
      });
    }

    add(kind) {
      const tab = this.build(kind);
      this.tabs.push(tab);
      this.activeId = tab.id;
      return tab;
    }

    select(id) {
      if (!this.tabs.some((tab) => tab.id === id)) return false;
      this.activeId = id;
      return true;
    }

    close(id) {
      const index = this.tabs.findIndex((tab) => tab.id === id);
      if (index < 0) return null;
      if (this.tabs.length === 1) {
        const replacement = this.build("text");
        this.tabs = [replacement];
        this.activeId = replacement.id;
        return replacement;
      }
      this.tabs = this.tabs.filter((tab) => tab.id !== id);
      if (this.activeId === id) {
        this.activeId = this.tabs[Math.min(index, this.tabs.length - 1)].id;
      }
      return this.active;
    }
  }

  Domain.Workspace = Workspace;
})();
