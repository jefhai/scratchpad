ScratchpadCommands.register({
  id: "reverse-string", name: "Reverse text", description: "Flip character order",
  category: "Text", icon: "↔", tags: "reverse string text",
  run: (text) => Array.from(text).reverse().join(""),
});
