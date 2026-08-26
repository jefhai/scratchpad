ScratchpadCommands.register({
  id: "snake-case", name: "snake_case", description: "Join words with underscores",
  category: "Case", icon: "s_s", tags: "snake case underscore",
  run: (text) => ScratchpadCommandUtils.words(text).map((word) => word.toLowerCase()).join("_"),
});
