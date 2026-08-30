ScratchpadCellCommands.register({
  id: "average", name: "Average values", description: "Calculate the mean of the selected numeric cells",
  category: "Summary", icon: "AVG", tags: "average mean arithmetic",
  run(entries) {
    const values = ScratchpadCellCommandUtils.requireNumbers(entries);
    return ScratchpadCellCommandUtils.cleanNumber(
      values.reduce((total, entry) => total + entry.number, 0) / values.length,
    );
  },
});
