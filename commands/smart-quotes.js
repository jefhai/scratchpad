ScratchpadCommands.register({
  id: "smart-quotes", name: "Replace smart quotes", description: "Normalize curly quotation marks",
  category: "Text", icon: "“”", tags: "smart quotes apostrophe replace",
  run: (text) => text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"),
});
