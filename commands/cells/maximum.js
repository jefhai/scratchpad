ScratchpadCellCommands.register({
  id: "maximum", name: "Maximum value", description: "Find the largest selected number",
  category: "Summary", icon: "MAX", tags: "maximum max largest high",
  run(entries) {
    const values = ScratchpadCellCommandUtils.requireNumbers(entries);
    return ScratchpadCellCommandUtils.cleanNumber(Math.max(...values.map((entry) => entry.number)));
  },
});
