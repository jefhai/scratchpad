ScratchpadCommands.register({
  id: "ascii-hex", name: "ASCII to hex", description: "Encode text as hexadecimal",
  category: "Encoding", icon: "0x", tags: "ascii hex encode",
  run: (text) => Array.from(
    new TextEncoder().encode(text),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join(" "),
});
