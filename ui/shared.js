(() => {
  const UI = globalThis.ScratchpadUI ??= {};
  const { useLayoutEffect, useRef, useState } = React;
  const h = React.createElement;
  const PRESETS = [
    { label: "Default", lineHeight: 30, caretSpacing: 1, lineNumberSize: 15, underlineGap: 5 },
    { label: "Medium", lineHeight: 38, caretSpacing: 2, lineNumberSize: 19, underlineGap: 6 },
    { label: "Larger", lineHeight: 38, caretSpacing: 5, lineNumberSize: 21, underlineGap: 8 },
  ];

  // Shared dismissal never steals focus from a control clicked outside the popup.
  function usePopover(id, open, setOpen, buttonRef, panelRef) {
    useLayoutEffect(() => {
      if (!open) return;
      const panel = panelRef.current;
      const close = (restore = false) => {
        setOpen(false);
        if (restore) buttonRef.current?.focus({ preventScroll: true });
      };
      function position() {
        const anchor = buttonRef.current?.getBoundingClientRect();
        if (!anchor || !panel) return;
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
        const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
        panel.style.maxWidth = `${Math.max(0, width - 16)}px`;
        panel.style.maxHeight = `${Math.max(0, height - 16)}px`;
        const bounds = panel.getBoundingClientRect();
        panel.style.left = `${Math.max(left + 8, Math.min(anchor.right - bounds.width, left + width - bounds.width - 8))}px`;
        panel.style.top = `${Math.max(top + 8, Math.min(anchor.bottom + 8, top + height - bounds.height - 8))}px`;
      }
      function outside(event) {
        if (!panel.contains(event.target) && !buttonRef.current?.contains(event.target)) close();
      }
      function keydown(event) {
        if (event.key !== "Escape") return;
        event.preventDefault(); event.stopPropagation(); close(true);
      }
      function otherPopover(event) { if (event.detail?.id !== id) close(); }
      document.dispatchEvent(new CustomEvent("scratchpad:popover-open", { detail: { id } }));
      position();
      panel.querySelector("button, input")?.focus({ preventScroll: true });
      document.addEventListener("pointerdown", outside);
      document.addEventListener("focusin", outside);
      document.addEventListener("keydown", keydown, true);
      document.addEventListener("scratchpad:popover-open", otherPopover);
      window.addEventListener("resize", position);
      window.visualViewport?.addEventListener("resize", position);
      window.visualViewport?.addEventListener("scroll", position);
      const observer = new ResizeObserver(position);
      observer.observe(panel);
      return () => {
        observer.disconnect();
        document.removeEventListener("pointerdown", outside);
        document.removeEventListener("focusin", outside);
        document.removeEventListener("keydown", keydown, true);
        document.removeEventListener("scratchpad:popover-open", otherPopover);
        window.removeEventListener("resize", position);
        window.visualViewport?.removeEventListener("resize", position);
        window.visualViewport?.removeEventListener("scroll", position);
      };
    }, [id, open]);
  }

  function TabBar({ workspace, onChange }) {
    const listRef = useRef(null), addButtonRef = useRef(null), menuRef = useRef(null);
    const [menuOpen, setMenuOpen] = useState(false);
    usePopover("new-pad-menu", menuOpen, setMenuOpen, addButtonRef, menuRef);

    useLayoutEffect(() => {
      const list = listRef.current, active = list.querySelector(".tab-item.active");
      if (!active) return;
      // Only selection changes reveal tabs; scrolling never changes selection.
      const bounds = active.getBoundingClientRect(), viewport = list.getBoundingClientRect();
      if (bounds.left < viewport.left) list.scrollLeft -= viewport.left - bounds.left;
      else if (bounds.right > viewport.right) list.scrollLeft += bounds.right - viewport.right;
    }, [workspace.activeId]);

    function focusTab() {
      requestAnimationFrame(() => listRef.current?.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true }));
    }
    function select(id, focus = false) {
      workspace.select(id); setMenuOpen(false); onChange();
      if (focus) focusTab();
    }
    function closeTab(id) { workspace.close(id); setMenuOpen(false); onChange(); focusTab(); }
    function tabKeydown(event, tab) {
      const index = workspace.tabs.indexOf(tab);
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % workspace.tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + workspace.tabs.length) % workspace.tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = workspace.tabs.length - 1;
      else if (event.key === "Delete") { event.preventDefault(); closeTab(tab.id); return; }
      else return;
      event.preventDefault(); select(workspace.tabs[next].id, true);
    }
    function add(kind) {
      workspace.add(kind); setMenuOpen(false); onChange();
      requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollLeft = listRef.current.scrollWidth; });
      focusTab();
    }
    return h(React.Fragment, null,
      h("div", { className: "tabs-bar" },
        h("div", {
          className: "tabs-list", ref: listRef, role: "tablist", "aria-label": "Pads",
          onWheel: (event) => {
            const list = event.currentTarget;
            if (list.scrollWidth > list.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX)) list.scrollLeft += event.deltaY;
          },
        },
          workspace.tabs.map((tab) => h("div", {
            className: `tab-item ${tab.id === workspace.activeId ? "active" : ""}`,
            key: tab.id, "data-kind": tab.kind, role: "presentation",
          },
            h("button", {
              className: "tab-button", type: "button", role: "tab", id: `pad-tab-${tab.id}`,
              "aria-controls": "active-pad-content", "aria-selected": tab.id === workspace.activeId,
              tabIndex: tab.id === workspace.activeId ? 0 : -1,
              onClick: () => select(tab.id), onKeyDown: (event) => tabKeydown(event, tab),
            },
              h("span", { className: `tab-status ${tab.kind}`, "aria-hidden": "true" }),
              h("span", { className: "tab-title" }, tab.title),
            ),
            h("button", { className: "tab-close", type: "button", "aria-label": `Close ${tab.title}`, onClick: () => closeTab(tab.id) }, "×"),
          )),
          h("button", {
            className: "add-tab", ref: addButtonRef, type: "button", onClick: () => setMenuOpen(!menuOpen),
            "aria-label": "Add a new pad", "aria-haspopup": "menu", "aria-controls": "new-pad-menu", "aria-expanded": menuOpen,
          }, "+"),
        ),
      ),
      menuOpen && h("section", {
        className: "new-pad-menu", id: "new-pad-menu", ref: menuRef, role: "menu", "aria-label": "New pad type",
        onKeyDown: (event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const buttons = [...menuRef.current.querySelectorAll("button")], current = buttons.indexOf(document.activeElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].focus();
        },
      },
        [["text", "¶", "Scratchpad", "Text and developer transformations"], ["sheet", "▦", "Cellpad", "Rows, columns, and calculations"]].map(([kind, icon, name, description]) =>
          h("button", { key: kind, type: "button", role: "menuitem", onClick: () => add(kind) },
            h("span", { className: `new-pad-icon ${kind}`, "aria-hidden": "true" }, icon),
            h("span", null, h("strong", null, name), h("small", null, description)),
          )),
      ),
    );
  }

  function DisplaySettings({ definitions, editorKind, id, onChange, onReset, settings }) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef(null), menuRef = useRef(null);
    usePopover(id, open, setOpen, buttonRef, menuRef);
    const close = () => { setOpen(false); buttonRef.current?.focus({ preventScroll: true }); };
    const presetKeys = definitions.map(({ key }) => key).filter((key) => key !== "tabSize");
    return h("div", { className: "settings-wrap" },
      h("button", {
        className: "settings-button", type: "button", ref: buttonRef, onClick: () => setOpen(!open),
        "aria-expanded": open, "aria-controls": id, "aria-haspopup": "dialog", "aria-label": "Display settings", title: "Display settings",
      }, h("svg", {
        className: "settings-icon", viewBox: "0 0 24 24", width: 20, height: 20,
        fill: "none", stroke: "currentColor", strokeWidth: 1.6,
        strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false",
      },
        h("path", { d: "M9 3h6l.5 2 2 1.2 2-.6 2.5 4.3L20.5 11v2l1.5 1.1-2.5 4.3-2-.6-2 1.2-.5 2H9l-.5-2-2-1.2-2 .6L2 14.1 3.5 13v-2L2 9.9l2.5-4.3 2 .6 2-1.2Z" }),
        h("circle", { cx: 12, cy: 12, r: 3 }),
      )),
      open && h("section", {
        className: "settings-menu", id, ref: menuRef, role: "dialog", "data-editor-kind": editorKind, "aria-label": "Display settings",
      },
        h("div", { className: "settings-heading" },
          h("div", null, h("span", null, "EDITOR"), h("strong", null, "Display settings")),
          h("button", { type: "button", onClick: close, "aria-label": "Close settings" }, "×"),
        ),
        h("div", { className: "display-size-presets", role: "group", "aria-label": "Display size presets" },
          PRESETS.map((preset) => h("button", {
            key: preset.label, type: "button", "aria-pressed": presetKeys.every((key) => settings[key] === preset[key]),
            onClick: () => presetKeys.forEach((key) => { if (key in preset) onChange(key, preset[key]); }),
          }, preset.label)),
        ),
        definitions.map(({ key, label, max, min, step, unit }) => h("label", { className: "setting-row", key },
          h("span", null, h("strong", null, label), h("small", null, `${settings[key]}${unit}`)),
          h("input", { type: "range", min, max, step, value: settings[key], onChange: (event) => onChange(key, Number(event.target.value)), "aria-label": label }),
        )),
        h("button", { className: "reset-settings", type: "button", onClick: onReset }, "Reset defaults"),
      ),
    );
  }

  function PadToolbar({ label, metrics, children, settings }) {
    const toolbarRef = useRef(null), labelRef = useRef(null), metricsRef = useRef(null);
    const actionsRef = useRef(null), fixedRef = useRef(null);
    const [compact, setCompact] = useState(false);
    useLayoutEffect(() => {
      function measure() {
        const toolbar = toolbarRef.current, style = getComputedStyle(toolbar);
        const available = toolbar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const actions = actionsRef.current;
        const visibleActions = [...actions.children].filter((child) => !child.hidden);
        const actionsWidth = visibleActions.reduce((width, child) => width + child.getBoundingClientRect().width, 0)
          + Math.max(0, visibleActions.length - 1) * (parseFloat(getComputedStyle(actions).columnGap) || 0);
        const needed = labelRef.current.scrollWidth + metricsRef.current.scrollWidth
          + actionsWidth + fixedRef.current.offsetWidth + 44;
        setCompact(available < needed);
      }
      const observer = new ResizeObserver(measure);
      [toolbarRef, labelRef, metricsRef, actionsRef, fixedRef].forEach((ref) => observer.observe(ref.current));
      measure();
      return () => observer.disconnect();
    }, [metrics]);
    return h("header", { className: `pad-toolbar${compact ? " is-compact" : ""}`, ref: toolbarRef },
      h("div", { className: "pad-meta" },
        h("span", { className: "pad-kind", ref: labelRef }, label),
        h("div", { className: "pad-metrics", tabIndex: 0, "aria-label": `${label} statistics` },
          h("span", { ref: metricsRef }, metrics),
        ),
      ),
      h("div", { className: "pad-tools" },
        h("div", { className: "pad-actions", ref: actionsRef, "aria-label": `${label} actions` },
          children,
          UI.DesktopDownload && h(UI.DesktopDownload),
        ),
        h("div", { className: "pad-fixed-actions", ref: fixedRef },
          h("button", { className: "theme-button", type: "button", "aria-label": "Choose color theme" }),
          settings,
        ),
      ),
    );
  }

  function PadFooter({ children }) { return h("footer", { className: "pad-footer" }, children); }

  async function copyText(text) {
    if (globalThis.ScratchpadDesktop?.copyText) await globalThis.ScratchpadDesktop.copyText(text);
    else await navigator.clipboard.writeText(text);
  }

  async function saveTextFile(text, kind) {
    if (!["text", "sheet"].includes(kind)) throw new Error("Unknown document type");
    if (globalThis.ScratchpadDesktop?.saveFile) return globalThis.ScratchpadDesktop.saveFile(text, kind);
    const url = URL.createObjectURL(new Blob([text], {
      type: kind === "text" ? "text/plain;charset=utf-8" : "text/csv;charset=utf-8",
    }));
    const link = document.createElement("a");
    link.href = url;
    link.download = kind === "text" ? "scratchpad.txt" : "cellpad.csv";
    link.click();
    URL.revokeObjectURL(url);
    return true;
  }

  function PadControls({ document, onOpenCommands, onRedo, onUndo, shortcut }) {
    const controls = [
      { label: "Commands", key: "J", action: onOpenCommands },
      { label: "Undo", key: "Z", action: onUndo, disabled: !document.canUndo },
      { label: "Redo", key: "Y", action: onRedo, disabled: !document.canRedo },
    ];
    return h("div", { className: "pad-controls", role: "group", "aria-label": "Editor commands and history" },
      controls.map(({ label, key, action, disabled }) => h("button", {
        key, className: "pad-control-button", type: "button", onClick: action, disabled,
        "aria-label": label, "aria-keyshortcuts": `${shortcut === "⌘" ? "Meta" : "Control"}+${key}`, title: `${label} (${shortcut}+${key})`,
      },
        h("span", { className: "shortcut-keys", "aria-hidden": "true" }, h("kbd", null, shortcut), h("kbd", null, key)),
        h("span", { className: "shortcut-label" }, label),
      )),
    );
  }

  Object.assign(UI, { DisplaySettings, PadControls, PadFooter, PadToolbar, TabBar, usePopover, copyText, saveTextFile });
})();
