ScratchpadCommands.register({
  id: "title-case", name: "Start Case", description: "Capitalize each word",
  category: "Case", icon: "Aa", tags: "title start case",
  run: (text) => ScratchpadCommandUtils.words(text)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" "),
});
