ScratchpadCellCommands.register({
  id: "sum", name: "Add values", description: "Add every numeric cell in the selection",
  category: "Arithmetic", icon: "+", tags: "sum total add plus",
  run(entries) {
    const values = ScratchpadCellCommandUtils.requireNumbers(entries);
    return ScratchpadCellCommandUtils.cleanNumber(values.reduce((total, entry) => total + entry.number, 0));
  },
});
