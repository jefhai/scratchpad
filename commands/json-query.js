ScratchpadCommands.register({
  id: "json-query", name: "JSON to query string", description: "Build URL query parameters",
  category: "JSON & data", icon: "=?", tags: "json query url params",
  run: (text) => new URLSearchParams(
    Object.entries(JSON.parse(text)).map(([key, value]) => [key, String(value)]),
  ).toString(),
});
