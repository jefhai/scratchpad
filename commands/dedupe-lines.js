ScratchpadCommands.register({
  id: "dedupe-lines", name: "Remove duplicate lines", description: "Keep the first of each line",
  category: "Text", icon: "≠", tags: "duplicate unique lines dedupe",
  run: (text) => [...new Set(text.split(/\r?\n/))].join("\n"),
});
