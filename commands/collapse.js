ScratchpadCommands.register({
  id: "collapse", name: "Collapse whitespace", description: "Replace whitespace with spaces",
  category: "Text", icon: "⇥", tags: "collapse whitespace spaces",
  run: (text) => text.replace(/\s+/g, " ").trim(),
});
