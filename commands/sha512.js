ScratchpadCommands.register({
  id: "sha512", name: "SHA-512", description: "Create a SHA-512 digest",
  category: "Security", icon: "S5", tags: "sha512 hash digest",
  run: (text) => ScratchpadCommandUtils.digest("SHA-512", text),
});
