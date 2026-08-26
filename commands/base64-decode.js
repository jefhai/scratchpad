ScratchpadCommands.register({
  id: "base64-decode", name: "Base64 decode", description: "Decode Base64 into text",
  category: "Encoding", icon: "64", tags: "base64 decode",
  run: ScratchpadCommandUtils.decodeBase64,
});
