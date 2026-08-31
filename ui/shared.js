(() => {
  const UI = globalThis.ScratchpadUI ??= {};
  const { useEffect, useRef, useState } = React;
  const h = React.createElement;

  function TabBar({ workspace, onChange }) {
    const listRef = useRef(null);
    const addButtonRef = useRef(null);
    const [menuPosition, setMenuPosition] = useState(null);

    useEffect(() => {
      const close = () => setMenuPosition(null);
      const closeOnEscape = (event) => {
        if (event.key === "Escape") close();
      };
      window.addEventListener("resize", close);
      document.addEventListener("keydown", closeOnEscape);
      return () => {
        window.removeEventListener("resize", close);
        document.removeEventListener("keydown", closeOnEscape);
      };
    }, []);

    function openNewPadMenu() {
      if (menuPosition) {
        setMenuPosition(null);
        return;
      }
      const rectangle = addButtonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: Math.round(rectangle.bottom + 8),
        left: Math.max(8, Math.min(Math.round(rectangle.left), window.innerWidth - 218)),
      });
    }

    function add(kind) {
      workspace.add(kind);
      setMenuPosition(null);
      onChange();
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollLeft = listRef.current.scrollWidth;
      });
    }

    function scrollTabs(event) {
      const list = event.currentTarget;
      if (list.scrollWidth <= list.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      list.scrollLeft += event.deltaY;
    }

    return h(React.Fragment, null,
      h("div", { className: "tabs-bar" },
        h("div", {
          className: "tabs-list",
          ref: listRef,
          role: "tablist",
          "aria-label": "Pads",
          onWheel: scrollTabs,
        },
          workspace.tabs.map((tab) => h("div", {
            className: `tab-item ${tab.id === workspace.activeId ? "active" : ""}`,
            key: tab.id,
            "data-kind": tab.kind,
          },
            h("button", {
              className: "tab-button",
              type: "button",
              role: "tab",
              "aria-selected": tab.id === workspace.activeId,
              onClick: () => {
                workspace.select(tab.id);
                setMenuPosition(null);
                onChange();
              },
            },
              h("span", { className: `tab-status ${tab.kind}`, "aria-hidden": "true" }),
              h("span", { className: "tab-title" }, tab.title),
            ),
            h("button", {
              className: "tab-close",
              type: "button",
              onClick: () => {
                workspace.close(tab.id);
                setMenuPosition(null);
                onChange();
              },
              "aria-label": `Close ${tab.title}`,
            }, "×"),
          )),
          h("button", {
            className: "add-tab",
            ref: addButtonRef,
            type: "button",
            onClick: openNewPadMenu,
            "aria-label": "Add a new pad",
            "aria-haspopup": "menu",
            "aria-expanded": Boolean(menuPosition),
          }, "+"),
        ),
      ),
      menuPosition && h("section", {
        className: "new-pad-menu",
        role: "menu",
        "aria-label": "New pad type",
        style: menuPosition,
      },
        h("button", { type: "button", role: "menuitem", onClick: () => add("text") },
          h("span", { className: "new-pad-icon text", "aria-hidden": "true" }, "¶"),
          h("span", null,
            h("strong", null, "Scratchpad"),
            h("small", null, "Text and developer transformations"),
          ),
        ),
        h("button", { type: "button", role: "menuitem", onClick: () => add("sheet") },
          h("span", { className: "new-pad-icon sheet", "aria-hidden": "true" }, "▦"),
          h("span", null,
            h("strong", null, "Cellpad"),
            h("small", null, "Rows, columns, and calculations"),
          ),
        ),
      ),
    );
  }

  function DisplaySettings({
    definitions,
    editorKind,
    id,
    onChange,
    onReset,
    settings,
  }) {
    const [open, setOpen] = useState(false);

    return h("div", { className: "settings-wrap" },
      h("button", {
        className: "settings-button",
        type: "button",
        onClick: () => setOpen((current) => !current),
        "aria-expanded": open,
        "aria-controls": id,
        "aria-label": "Display settings",
      }, "⚙"),
      open && h("section", {
        className: "settings-menu",
        id,
        "data-editor-kind": editorKind,
        "aria-label": "Display settings",
      },
        h("div", { className: "settings-heading" },
          h("div", null,
            h("span", null, "EDITOR"),
            h("strong", null, "Display settings"),
          ),
          h("button", { type: "button", onClick: () => setOpen(false), "aria-label": "Close settings" }, "×"),
        ),
        definitions.map(({ key, label, max, min, step, unit }) => h("label", {
          className: "setting-row",
          key,
        },
          h("span", null,
            h("strong", null, label),
            h("small", null, `${settings[key]}${unit}`),
          ),
          h("input", {
            type: "range",
            min,
            max,
            step,
            value: settings[key],
            onChange: (event) => onChange(key, Number(event.target.value)),
          }),
        )),
        h("button", { className: "reset-settings", type: "button", onClick: onReset }, "Reset defaults"),
      ),
    );
  }

  function CommandPalette({ commands, meta, onClose, onRun, query, setQuery, title, working }) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const searchRef = useRef(null);
    const search = query.trim().toLowerCase();
    const filtered = search
      ? commands.filter((command) => (
        `${command.name} ${command.description} ${command.tags} ${command.category}`
          .toLowerCase()
          .includes(search)
      ))
      : commands;

    useEffect(() => {
      setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
      window.setTimeout(() => searchRef.current?.focus());
    }, []);

    function handleKeyDown(event) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => Math.min(index + 1, filtered.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
      } else if (event.key === "Enter" && filtered[selectedIndex]) {
        event.preventDefault();
        onRun(filtered[selectedIndex]);
      }
    }

    return h("div", { className: "palette-backdrop", onMouseDown: onClose },
      h("section", {
        className: "command-palette",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "Command search",
        onMouseDown: (event) => event.stopPropagation(),
      },
        h("button", { className: "palette-close", onClick: onClose, "aria-label": "Close commands" }, "×"),
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
            onKeyDown: handleKeyDown,
            placeholder: "Search commands…",
            "aria-label": "Search commands",
            autoComplete: "off",
          }),
          h("kbd", null, "ESC"),
        ),
        h("div", { className: "palette-meta" },
          h("span", null, `${filtered.length} commands`),
          h("span", null, meta),
        ),
        h("div", { className: `command-list ${working ? "working" : ""}` },
          filtered.map((command, index) => h("button", {
            className: `command-row ${index === selectedIndex ? "selected" : ""}`,
            key: command.id,
            type: "button",
            onMouseEnter: () => setSelectedIndex(index),
            onClick: () => onRun(command),
          },
            h("span", { className: "command-icon" }, command.icon),
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

  function PadControls({
    document,
    onOpenCommands,
    onRedo,
    onUndo,
    shortcut,
  }) {
    return h(React.Fragment, null,
      h("button", {
        className: "command-trigger pad-control-button",
        type: "button",
        onClick: onOpenCommands,
        "aria-keyshortcuts": shortcut === "⌘" ? "Meta+J" : "Control+J",
      },
        h("kbd", null, shortcut), h("kbd", null, "J"),
        h("span", { className: "shortcut-label" }, "Commands"),
      ),
      h("button", {
        className: "command-trigger history-trigger pad-control-button",
        type: "button",
        onClick: onUndo,
        disabled: !document.canUndo,
        "aria-keyshortcuts": shortcut === "⌘" ? "Meta+Z" : "Control+Z",
      },
        h("kbd", null, shortcut), h("kbd", null, "Z"),
        h("span", { className: "shortcut-label" }, "Undo"),
      ),
      h("button", {
        className: "command-trigger history-trigger pad-control-button",
        type: "button",
        onClick: onRedo,
        disabled: !document.canRedo,
        "aria-keyshortcuts": shortcut === "⌘" ? "Meta+Y" : "Control+Y",
      },
        h("kbd", null, shortcut), h("kbd", null, "Y"),
        h("span", { className: "shortcut-label" }, "Redo"),
      ),
    );
  }

  Object.assign(UI, { CommandPalette, DisplaySettings, PadControls, TabBar });
})();
