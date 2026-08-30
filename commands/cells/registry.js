(() => {
  const commands = [];

  function register(command) {
    if (!command?.id || typeof command.run !== "function") {
      throw new Error("Invalid cell command definition");
    }
    if (commands.some((item) => item.id === command.id)) {
      throw new Error(`Duplicate cell command: ${command.id}`);
    }
    commands.push(Object.freeze(command));
  }

  function numericValues(entries) {
    return entries
      .map((entry) => ({ ...entry, number: Number(String(entry.value).trim()) }))
      .filter((entry) => String(entry.value).trim() !== "" && Number.isFinite(entry.number));
  }

  function requireNumbers(entries, minimum = 1) {
    const values = numericValues(entries);
    if (values.length < minimum) {
      throw new Error(minimum === 1
        ? "Select at least one numeric cell"
        : `Select at least ${minimum} numeric cells`);
    }
    return values;
  }

  function cleanNumber(value) {
    if (!Number.isFinite(value)) throw new Error("The calculation is not finite");
    return Number.parseFloat(value.toPrecision(12)).toString();
  }

  globalThis.ScratchpadCellCommands = Object.freeze({ register, all: () => commands.slice() });
  globalThis.ScratchpadCellCommandUtils = Object.freeze({ cleanNumber, numericValues, requireNumbers });
})();
