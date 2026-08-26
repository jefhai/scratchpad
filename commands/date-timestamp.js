ScratchpadCommands.register({
  id: "date-timestamp", name: "Date to timestamp", description: "Convert a date to Unix seconds",
  category: "Numbers", icon: "⌚", tags: "date timestamp unix time",
  run(text) {
    const milliseconds = new Date(text).getTime();
    if (Number.isNaN(milliseconds)) throw new Error("That date could not be parsed");
    return Math.floor(milliseconds / 1000).toString();
  },
});
