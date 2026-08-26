ScratchpadCommands.register({
  id: "sha256", name: "SHA-256", description: "Create a SHA-256 digest",
  category: "Security", icon: "S2", tags: "sha256 hash digest",
  run: (text) => ScratchpadCommandUtils.digest("SHA-256", text),
});
