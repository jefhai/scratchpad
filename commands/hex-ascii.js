ScratchpadCommands.register({
  id: "hex-ascii", name: "Hex to ASCII", description: "Decode hexadecimal bytes",
  category: "Encoding", icon: "0x", tags: "hex ascii decode",
  run: (text) => text.replace(/(?:0x)?([0-9a-f]{2})/gi, (_, byte) => String.fromCharCode(Number.parseInt(byte, 16))),
});
