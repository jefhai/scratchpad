(() => {
  const UI = globalThis.ScratchpadUI;
  const { useEffect, useMemo, useRef, useState } = React;
  const h = React.createElement;

  function CommandPalette({ commands, meta, onClose, onRun, query, setQuery, title, working }) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const searchRef = useRef(null);
    const listRef = useRef(null);
    const filtered = useMemo(() => {
      const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      return terms.length
        ? commands.filter((command) => terms.every((term) => command.searchText.includes(term)))
        : commands;
    }, [commands, query]);
    const activeIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));
    const selected = filtered[activeIndex];
    const optionId = (command) => `command-option-${command.id}`;

    useEffect(() => { setSelectedIndex(0); }, [commands, query]);
    useEffect(() => { searchRef.current?.focus(); }, []);
    useEffect(() => {
      const row = listRef.current?.querySelector('[aria-selected="true"]');
      row?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, filtered]);

    function handleSearchKeyDown(event) {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setSelectedIndex(Math.max(0, Math.min(activeIndex + direction, filtered.length - 1)));
      } else if (event.key === "Enter" && selected) {
        event.preventDefault();
        if (!working && !event.repeat) onRun(selected);
      }
    }

    function trapFocus(event) {
      if (event.key !== "Tab") return;
      const focusable = [...event.currentTarget.querySelectorAll("button, input")]
        .filter((element) => !element.disabled && element.tabIndex >= 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    return h("div", {
      className: "palette-backdrop",
      onPointerDown: (event) => { if (event.target === event.currentTarget) onClose(); },
    },
      h("section", {
        className: "command-palette",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "Command search",
        onKeyDown: trapFocus,
      },
        h("button", { type: "button", className: "palette-close", onClick: onClose, "aria-label": "Close commands" }, "×"),
        h("div", { className: "palette-title" },
          h("span", null, "COMMANDS"),
          h("strong", null, title),
        ),
        h("label", { className: "search-box" },
          h("span", { "aria-hidden": "true" }, "⌕"),
          h("input", {
            ref: searchRef,
            value: query,
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: handleSearchKeyDown,
            placeholder: "Search commands…",
            role: "combobox",
            "aria-label": "Search commands",
            "aria-expanded": "true",
            "aria-controls": "command-results",
            "aria-autocomplete": "list",
            "aria-activedescendant": selected ? optionId(selected) : undefined,
            autoComplete: "off",
            autoCapitalize: "none",
            spellCheck: false,
            enterKeyHint: "go",
          }),
          h("kbd", null, "ESC"),
        ),
        h("div", { className: "palette-meta" },
          h("span", { role: "status", "aria-live": "polite" }, working ? "Loading or running command…" : `${filtered.length} commands`),
          h("span", null, meta),
        ),
        h("div", {
          className: `command-list ${working ? "working" : ""}`,
          id: "command-results",
          ref: listRef,
          role: "listbox",
          "aria-label": "Commands",
          "aria-busy": working,
        },
          filtered.map((command, index) => h("button", {
            className: `command-row ${index === activeIndex ? "selected" : ""}`,
            id: optionId(command),
            key: command.id,
            type: "button",
            role: "option",
            tabIndex: -1,
            "aria-selected": index === activeIndex,
            disabled: working,
            onPointerMove: (event) => { if (event.pointerType === "mouse") setSelectedIndex(index); },
            onClick: () => { if (!working) onRun(command); },
          },
            h("span", { className: "command-icon", "aria-hidden": "true" }, command.icon),
            h("span", { className: "command-copy" },
              h("strong", null, command.name),
              h("small", null, command.description),
            ),
            h("span", { className: "command-category" }, command.category),
            h("span", { className: "run-glyph", "aria-hidden": "true" }, "↵"),
          )),
          !filtered.length && h("div", { className: "empty-state" },
            h("strong", null, "No command found."),
            h("span", null, "Try another search."),
          ),
        ),
      ),
    );
  }

  UI.CommandPalette = CommandPalette;
})();
