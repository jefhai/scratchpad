ScratchpadCommands.register({
  id: "binary-decimal", name: "Binary to decimal", description: "Convert base 2 to base 10",
  category: "Numbers", icon: "10", tags: "binary decimal number",
  run: (text) => ScratchpadCommandUtils.parseInteger(text, 2).toString(10),
});
