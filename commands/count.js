ScratchpadCommands.register({
  id: "count", name: "Count text", description: "Show characters, words, and lines",
  category: "Text", icon: "#", tags: "count words characters lines",
  run(text, context) {
    const message = `${text.length.toLocaleString()} characters · ${(text.match(/\S+/g)?.length ?? 0).toLocaleString()} words · ${(text ? text.split(/\r?\n/).length : 0).toLocaleString()} lines`;
    context.setNotice(message);
    return text;
  },
});
