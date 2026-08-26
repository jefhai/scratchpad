ScratchpadCommands.register({
  id: "timestamp-date", name: "Timestamp to UTC", description: "Convert Unix seconds to a date",
  category: "Numbers", icon: "UTC", tags: "timestamp date unix utc time",
  run(text) {
    const timestamp = ScratchpadCommandUtils.parseInteger(text, 10);
    return new Date(timestamp * (text.trim().length > 10 ? 1 : 1000)).toISOString();
  },
});
