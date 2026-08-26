ScratchpadCommands.register({
  id: "shuffle-lines", name: "Shuffle lines", description: "Randomize line order",
  category: "Text", icon: "⇄", tags: "shuffle random lines",
  run(text) {
    const lines = text.split(/\r?\n/);
    for (let index = lines.length - 1; index > 0; index -= 1) {
      const other = Math.floor(Math.random() * (index + 1));
      [lines[index], lines[other]] = [lines[other], lines[index]];
    }
    return lines.join("\n");
  },
});
