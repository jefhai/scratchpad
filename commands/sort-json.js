ScratchpadCommands.register({
  id: "sort-json", name: "Sort JSON keys", description: "Alphabetize keys recursively",
  category: "JSON & data", icon: "AZ", tags: "json sort keys alphabetize",
  run: (text) => JSON.stringify(ScratchpadCommandUtils.sortJson(JSON.parse(text)), null, 2),
});
