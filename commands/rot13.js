ScratchpadCommands.register({
  id: "rot13", name: "ROT13", description: "Rotate letters by 13 places",
  category: "Encoding", icon: "R13", tags: "rot13 cipher",
  run: (text) => text.replace(
    /[a-z]/gi,
    (letter) => String.fromCharCode(letter.charCodeAt(0) + (letter.toLowerCase() < "n" ? 13 : -13)),
  ),
});
