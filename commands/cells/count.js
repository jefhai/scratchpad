ScratchpadCellCommands.register({
  id: "count", name: "Count numbers", description: "Count numeric cells in the selection",
  category: "Summary", icon: "#", tags: "count numbers numeric cells",
  run(entries) {
    return ScratchpadCellCommandUtils.numericValues(entries).length.toString();
  },
});
