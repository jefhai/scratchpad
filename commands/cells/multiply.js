ScratchpadCellCommands.register({
  id: "multiply", name: "Multiply values", description: "Multiply every numeric cell in the selection",
  category: "Arithmetic", icon: "×", tags: "multiply product times",
  run(entries) {
    const values = ScratchpadCellCommandUtils.requireNumbers(entries);
    return ScratchpadCellCommandUtils.cleanNumber(values.reduce((total, entry) => total * entry.number, 1));
  },
});
