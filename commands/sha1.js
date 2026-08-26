ScratchpadCommands.register({
  id: "sha1", name: "SHA-1", description: "Create a SHA-1 digest",
  category: "Security", icon: "S1", tags: "sha1 hash digest",
  run: (text) => ScratchpadCommandUtils.digest("SHA-1", text),
});
