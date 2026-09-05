(() => {
  const baseUrl = new URL("./", document.currentScript.src);

  class CommandLoader {
    constructor({ catalog, registries, document: ownerDocument = document, timeoutMs = 20000 }) {
      this.catalog = catalog;
      this.registries = registries;
      this.document = ownerDocument;
      this.timeoutMs = timeoutMs;
      this.pending = new Map();
    }

    load(kind, id) {
      const metadata = this.catalog[kind]?.find((command) => command.id === id);
      if (!metadata) return Promise.reject(new Error("This command is not available for this pad."));
      const registry = this.registries[kind];
      const loaded = registry.get(id);
      if (loaded) return Promise.resolve(loaded);
      const key = `${kind}:${id}`;
      if (this.pending.has(key)) return this.pending.get(key);

      const request = new Promise((resolve, reject) => {
        const script = this.document.createElement("script");
        let settled = false;
        let timer;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) script.dataset.scratchpadLoadExpired = "true";
          script.onload = null;
          script.onerror = null;
          script.remove();
          if (error) reject(error);
          else resolve(registry.get(id));
        };
        const unavailable = () => new Error(`Could not load ${metadata.name}. Check your connection and try again.`);
        script.async = true;
        script.src = new URL(metadata.file, baseUrl).href;
        script.onload = () => finish(registry.get(id) ? null : unavailable());
        script.onerror = () => finish(unavailable());
        timer = setTimeout(() => finish(unavailable()), this.timeoutMs);
        this.document.head.appendChild(script);
      });
      this.pending.set(key, request);
      const forget = () => { if (this.pending.get(key) === request) this.pending.delete(key); };
      request.then(forget, forget);
      return request;
    }
  }

  globalThis.ScratchpadCommandLoader = CommandLoader;
  globalThis.ScratchpadCommandLibrary = new CommandLoader({
    catalog: ScratchpadCommandCatalog,
    registries: { text: ScratchpadCommands, sheet: ScratchpadCellCommands },
  });
})();
