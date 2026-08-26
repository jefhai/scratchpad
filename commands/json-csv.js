ScratchpadCommands.register({
  id: "json-csv", name: "JSON to CSV", description: "Turn object rows into CSV",
  category: "JSON & data", icon: "↔", tags: "json csv convert",
  run(text) {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const escape = ScratchpadCommandUtils.csvEscape;
    return [
      headers.map(escape).join(","),
      ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
    ].join("\n");
  },
});
