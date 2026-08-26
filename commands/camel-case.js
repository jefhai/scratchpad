ScratchpadCommands.register({
  id: "camel-case", name: "camelCase", description: "Join words in camel case",
  category: "Case", icon: "cC", tags: "camel case",
  run: (text) => ScratchpadCommandUtils.words(text)
    .map((word, index) => index
      ? word[0].toUpperCase() + word.slice(1).toLowerCase()
      : word.toLowerCase())
    .join(""),
});
