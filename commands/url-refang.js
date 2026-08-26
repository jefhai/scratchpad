ScratchpadCommands.register({
  id: "url-refang", name: "Refang URL", description: "Restore a defanged URL",
  category: "Encoding", icon: ".", tags: "url refang security",
  run: (text) => text.replace(/^hxxp/gi, "http").replace(/\[\.\]/g, "."),
});
