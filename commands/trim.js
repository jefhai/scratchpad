ScratchpadCommands.register({
  id: "trim", name: "Trim", description: "Remove surrounding whitespace",
  category: "Text", icon: "⌁", tags: "trim whitespace clean", run: (text) => text.trim(),
});
