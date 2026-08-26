ScratchpadCommands.register({
  id: "kebab-case", name: "kebab-case", description: "Join words with hyphens",
  category: "Case", icon: "k-k", tags: "kebab case hyphen",
  run: (text) => ScratchpadCommandUtils.words(text).map((word) => word.toLowerCase()).join("-"),
});
