ScratchpadCommands.register({
  id: "epoch-now", name: "Generate epoch timestamp", description: "Insert the current Unix epoch in seconds",
  category: "Numbers", icon: "NOW", tags: "epoch timestamp unix current now integer int seconds",
  run: () => Math.floor(Date.now() / 1000).toString(),
});
