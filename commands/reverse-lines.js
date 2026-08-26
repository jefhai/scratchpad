ScratchpadCommands.register({
  id: "reverse-lines", name: "Reverse lines", description: "Flip line order",
  category: "Text", icon: "↕", tags: "reverse lines order",
  run: (text) => text.split(/\r?\n/).reverse().join("\n"),
});
