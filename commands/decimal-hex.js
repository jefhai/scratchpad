ScratchpadCommands.register({
  id: "decimal-hex", name: "Decimal to hex", description: "Convert base 10 to base 16",
  category: "Numbers", icon: "0x", tags: "decimal hex number",
  run: (text) => ScratchpadCommandUtils.parseInteger(text, 10).toString(16).toUpperCase(),
});
