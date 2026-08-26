ScratchpadCommands.register({
  id: "hex-decimal", name: "Hex to decimal", description: "Convert base 16 to base 10",
  category: "Numbers", icon: "10", tags: "hex decimal number",
  run: (text) => ScratchpadCommandUtils.parseInteger(text.replace(/^0x/i, ""), 16).toString(10),
});
