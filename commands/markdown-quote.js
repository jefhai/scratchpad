ScratchpadCommands.register({
  id: "markdown-quote", name: "Markdown quote", description: "Prefix every line with >",
  category: "Text", icon: ">_", tags: "markdown quote blockquote",
  run: (text) => text.split(/\r?\n/).map((line) => `> ${line}`).join("\n"),
});
