ScratchpadCommands.register({
  id: "format-json", name: "Format JSON", description: "Clean and indent JSON",
  category: "Popular", icon: "{ }", tags: "json pretty clean indent",
  run(text) {
    const editor = document.querySelector("textarea.editor");
    const configuredSize = Number.parseInt(
      editor ? getComputedStyle(editor).tabSize : "",
      10,
    );
    const tabSize = Number.isFinite(configuredSize) ? configuredSize : 2;
    const indentation = " ".repeat(Math.max(1, tabSize));

    return JSON.stringify(JSON.parse(text), null, "\t").replace(
      /^\t+/gm,
      (tabs) => indentation.repeat(tabs.length),
    );
  },
});
