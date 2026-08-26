ScratchpadCommands.register({
  id: "sponge-case", name: "sPoNgE cAsE", description: "Alternate letter casing",
  category: "Case", icon: "aA", tags: "sponge alternating case",
  run(text) {
    let uppercase = false;
    return text.replace(/[a-z]/gi, (letter) => {
      uppercase = !uppercase;
      return uppercase ? letter.toUpperCase() : letter.toLowerCase();
    });
  },
});
