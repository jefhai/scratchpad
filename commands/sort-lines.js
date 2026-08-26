ScratchpadCommands.register({
  id: "sort-lines", name: "Sort lines", description: "Alphabetize lines",
  category: "Text", icon: "AZ", tags: "sort lines alphabetize",
  run: (text) => text
    .split(/\r?\n/)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }))
    .join("\n"),
});
