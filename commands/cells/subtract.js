ScratchpadCellCommands.register({
  id: "subtract", name: "Subtract values", description: "Subtract each selected number from the first",
  category: "Arithmetic", icon: "−", tags: "subtract minus difference",
  run(entries) {
    const values = ScratchpadCellCommandUtils.requireNumbers(entries, 2);
    return ScratchpadCellCommandUtils.cleanNumber(
      values.slice(1).reduce((total, entry) => total - entry.number, values[0].number),
    );
  },
});
