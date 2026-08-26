ScratchpadCommands.register({
  id: "url-defang", name: "Defang URL", description: "Make URLs safe to share",
  category: "Encoding", icon: "[.]", tags: "url defang security",
  run: (text) => text.replace(/^http/gi, "hxxp").replace(/\./g, "[.]"),
});
