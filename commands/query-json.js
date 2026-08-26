ScratchpadCommands.register({
  id: "query-json", name: "Query string to JSON", description: "Parse URL query parameters",
  category: "JSON & data", icon: "?=", tags: "query url json params",
  run: (text) => JSON.stringify(Object.fromEntries(new URLSearchParams(text.replace(/^\?/, ""))), null, 2),
});
