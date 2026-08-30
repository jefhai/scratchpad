ScratchpadCellCommands.register({
  id: "minimum", name: "Minimum value", description: "Find the smallest selected number",
  category: "Summary", icon: "MIN", tags: "minimum min smallest low",
  run(entries) {
    const values = ScratchpadCellCommandUtils.requireNumbers(entries);
    return ScratchpadCellCommandUtils.cleanNumber(Math.min(...values.map((entry) => entry.number)));
  },
});
