ScratchpadCommands.register({
  id: "minify-json", name: "Minify JSON", description: "Remove JSON whitespace",
  category: "JSON & data", icon: "{}", tags: "json minify compress",
  run: (text) => JSON.stringify(JSON.parse(text)),
});
