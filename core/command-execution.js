(() => {
  const Domain = globalThis.ScratchpadDomain;

  class CommandExecution {
    constructor(workspace, library) {
      this.workspace = workspace;
      this.library = library;
      this.current = null;
    }

    get working() { return this.current !== null; }
    cancel() { this.current = null; }

    isCurrent(job) {
      return this.current === job
        && this.workspace.active === job.pad
        && this.workspace.tabs.includes(job.pad)
        && job.pad.value === job.value
        && JSON.stringify(job.pad.selection) === job.selectionKey;
    }

    async run(metadata, options = {}) {
      if (this.working) return { status: "busy" };
      const pad = this.workspace.active;
      const job = {
        pad,
        value: pad.value,
        selectionKey: JSON.stringify(pad.selection),
      };
      const selection = JSON.parse(job.selectionKey);
      const hasSelection = pad.kind === "text" && selection.end > selection.start;
      const input = pad.kind === "text"
        ? hasSelection ? job.value.slice(selection.start, selection.end) : job.value
        : pad.selectedEntries();
      this.current = job;

      try {
        const command = await this.library.load(pad.kind, metadata.id);
        if (!this.isCurrent(job)) return { status: "cancelled" };
        let notice;
        const result = await command.run(input, {
          ...options,
          setNotice: (message) => { notice = message; },
          selection,
          ...(pad.kind === "sheet" ? { grid: job.value.map((row) => row.slice()) } : {}),
        });
        if (!this.isCurrent(job)) return { status: "cancelled" };

        if (pad.kind === "sheet") {
          pad.result = { name: command.name, value: String(result) };
          return { status: "changed", notice: `${command.name} · ${result}` };
        }
        if (typeof result !== "string") throw new Error(`${command.name} did not return text.`);
        const next = hasSelection
          ? job.value.slice(0, selection.start) + result + job.value.slice(selection.end)
          : result;
        if (next === job.value) {
          return { status: "unchanged", notice: notice ?? `${command.name} · No change` };
        }
        pad.setText(next);
        if (hasSelection) pad.setSelection(selection.start, selection.start + result.length);
        else pad.setSelection(0, 0);
        return {
          status: "changed",
          notice: notice ?? `${command.name} · ${hasSelection ? "selection" : "full text"}`,
        };
      } catch (error) {
        if (!this.isCurrent(job)) return { status: "cancelled" };
        throw error;
      } finally {
        if (this.current === job) this.current = null;
      }
    }
  }

  Domain.CommandExecution = CommandExecution;
})();
