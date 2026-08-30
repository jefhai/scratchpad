ScratchpadCellCommands.register({
  id: "divide", name: "Divide values", description: "Divide the first selected number by each following number",
  category: "Arithmetic", icon: "÷", tags: "divide quotient ratio",
  run(entries) {
    const values = ScratchpadCellCommandUtils.requireNumbers(entries, 2);
    if (values.slice(1).some((entry) => entry.number === 0)) throw new Error("Cannot divide by zero");
    return ScratchpadCellCommandUtils.cleanNumber(
      values.slice(1).reduce((total, entry) => total / entry.number, values[0].number),
    );
  },
});
