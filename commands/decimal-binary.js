ScratchpadCommands.register({
  id: "decimal-binary", name: "Decimal to binary", description: "Convert base 10 to base 2",
  category: "Numbers", icon: "01", tags: "decimal binary number",
  run: (text) => ScratchpadCommandUtils.parseInteger(text, 10).toString(2),
});
