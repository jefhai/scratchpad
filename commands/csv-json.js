ScratchpadCommands.register({
  id: "csv-json", name: "CSV to JSON", description: "Turn a CSV table into objects",
  category: "JSON & data", icon: "↔", tags: "csv json convert",
  run(text) {
    const [headers, ...rows] = ScratchpadCommandUtils.parseCsv(text);
    return JSON.stringify(
      rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))),
      null,
      2,
    );
  },
});
