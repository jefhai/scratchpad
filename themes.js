(() => {
  const themes = [
    {
      id: "light",
      name: "Light",
      description: "Warm paper with dark text",
      base: "#fbfaf6",
      overlay: "#d9ff55",
      dark: false,
    },
    {
      id: "dark",
      name: "Dark",
      description: "Deep green with soft white text",
      base: "#151d19",
      overlay: "#d9ff55",
      dark: true,
    },
    {
      id: "solarized-light",
      name: "Solarized Light",
      description: "Low-glare cream and teal",
      base: "#fdf6e3",
      overlay: "#2aa198",
      dark: false,
    },
    {
      id: "solarized-dark",
      name: "Solarized Dark",
      description: "Low-glare navy and teal",
      base: "#002b36",
      overlay: "#2aa198",
      dark: true,
    },
    {
      id: "nord",
      name: "Nord",
      description: "Arctic blue-gray contrast",
      base: "#2e3440",
      overlay: "#88c0d0",
      dark: true,
    },
    {
      id: "dracula",
      name: "Dracula",
      description: "Dark violet with bright accents",
      base: "#282a36",
      overlay: "#bd93f9",
      dark: true,
    },
    {
      id: "high-contrast",
      name: "High Contrast",
      description: "Maximum black-and-white contrast",
      base: "#000000",
      overlay: "#ffff00",
      dark: true,
    },
  ];

  const themeClasses = themes.map((theme) => `theme-${theme.id}`);
  let selectedTheme = "light";
  let menu = null;
  let themeButton = null;
  let shell = null;
  let classObserver = null;

  const themeProperties = [
    "--ink",
    "--muted",
    "--paper",
    "--panel",
    "--line",
    "--acid",
    "--deep",
    "--editor-text",
  ];

  function currentThemeButton() {
    const current = document.querySelector(".theme-button");
    themeButton = current;
    return themeButton;
  }

  function savedTheme() {
    try {
      const value = localStorage.getItem("workbench-theme");
      return themes.some((theme) => theme.id === value) ? value : null;
    } catch {
      return null;
    }
  }

  function themeSymbol(theme) {
    const stroke = theme.dark ? "#ffffff59" : "#1e2d263d";
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
      `<circle cx="16" cy="16" r="15" fill="${theme.base}"/>`,
      `<path d="M26.6066 5.3934A15 15 0 0 1 5.3934 26.6066L26.6066 5.3934Z" fill="${theme.overlay}"/>`,
      `<circle cx="16" cy="16" r="15" fill="none" stroke="${stroke}" stroke-width="1"/>`,
      "</svg>",
    ].join("");
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }

  function updateButton() {
    const theme = themes.find((item) => item.id === selectedTheme) ?? themes[0];
    const button = currentThemeButton();
    if (!button) return;
    button.style.setProperty("--theme-button-symbol", themeSymbol(theme));
    button.dataset.theme = theme.id;
    button.setAttribute("aria-label", `Choose color theme. Current: ${theme.name}`);
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", String(Boolean(menu)));
    if (menu) button.setAttribute("aria-controls", menu.id);
    else button.removeAttribute("aria-controls");
  }

  function updateMenuSelection() {
    menu?.querySelectorAll(".theme-option").forEach((option) => {
      const active = option.dataset.theme === selectedTheme;
      option.classList.toggle("active", active);
      option.setAttribute("aria-checked", String(active));
      option.tabIndex = active ? 0 : -1;
    });
  }

  function syncMenuTheme() {
    if (!menu || !shell) return;
    const shellStyles = getComputedStyle(shell);
    const theme = themes.find((item) => item.id === selectedTheme) ?? themes[0];
    themeProperties.forEach((property) => {
      menu.style.setProperty(property, shellStyles.getPropertyValue(property));
    });
    menu.dataset.theme = selectedTheme;
    menu.classList.toggle("dark", theme.dark);
  }

  function applyTheme(themeId, persist = true) {
    const theme = themes.find((item) => item.id === themeId) ?? themes[0];
    selectedTheme = theme.id;
    shell?.classList.remove(...themeClasses, "dark");
    shell?.classList.add(`theme-${theme.id}`);
    if (theme.dark) shell?.classList.add("dark");
    if (persist) {
      try {
        localStorage.setItem("workbench-theme", theme.id);
      } catch {
        // A theme can still be used for this session when storage is blocked.
      }
    }
    syncMenuTheme();
    updateButton();
    updateMenuSelection();
  }

  function closeMenu(restoreFocus = false) {
    if (!menu) return;
    menu?.remove();
    menu = null;
    updateButton();
    if (restoreFocus) currentThemeButton()?.focus({ preventScroll: true });
  }

  function positionMenu() {
    const button = currentThemeButton();
    if (!menu || !button) return;
    const buttonRect = button.getBoundingClientRect();
    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const gap = 8;
    const menuWidth = Math.min(width <= 480 ? width - gap * 2 : 320, width - gap * 2);
    menu.style.width = `${Math.max(0, menuWidth)}px`;
    menu.style.maxHeight = `${Math.max(0, height - gap * 2)}px`;
    const menuHeight = menu.getBoundingClientRect().height;
    menu.style.top = `${Math.max(top + gap, Math.min(buttonRect.bottom + gap, top + height - menuHeight - gap))}px`;
    menu.style.left = `${Math.max(left + gap, Math.min(buttonRect.right - menuWidth, left + width - menuWidth - gap))}px`;
    menu.style.right = "auto";
  }

  function openMenu() {
    if (menu) {
      closeMenu(true);
      return;
    }

    document.dispatchEvent(new CustomEvent("scratchpad:popover-open", {
      detail: { id: "color-theme-menu" },
    }));

    menu = document.createElement("section");
    menu.id = "color-theme-menu";
    menu.className = "theme-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Color themes");

    const heading = document.createElement("div");
    heading.className = "theme-menu-heading";
    const label = document.createElement("span");
    label.className = "theme-menu-label";
    label.textContent = "COLOR THEME";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "theme-menu-close";
    closeButton.setAttribute("aria-label", "Close color theme menu");
    closeButton.textContent = "×";
    heading.append(label, closeButton);
    menu.append(heading);

    themes.forEach((theme) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "theme-option";
      option.dataset.theme = theme.id;
      option.setAttribute("role", "menuitemradio");

      const swatch = document.createElement("span");
      swatch.className = "theme-swatch";
      swatch.style.backgroundImage = themeSymbol(theme);

      const copy = document.createElement("span");
      copy.className = "theme-option-copy";
      const name = document.createElement("strong");
      name.textContent = theme.name;
      const description = document.createElement("small");
      description.textContent = theme.description;
      copy.append(name, description);

      const check = document.createElement("span");
      check.className = "theme-check";
      check.textContent = "✓";
      check.setAttribute("aria-hidden", "true");
      option.append(swatch, copy, check);
      menu.append(option);
    });

    document.body.append(menu);
    syncMenuTheme();
    positionMenu();
    updateMenuSelection();
    updateButton();
    const selected = menu.querySelector('.theme-option[aria-checked="true"]');
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView({ block: "nearest" });
  }

  function initialize() {
    shell = document.querySelector(".app-shell");
    themeButton = currentThemeButton();
    if (!shell || !themeButton) {
      requestAnimationFrame(initialize);
      return;
    }

    selectedTheme = savedTheme()
      ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    applyTheme(selectedTheme, false);

    classObserver = new MutationObserver(() => {
      if (!shell.classList.contains(`theme-${selectedTheme}`)) applyTheme(selectedTheme, false);
    });
    classObserver.observe(shell, { attributes: true, attributeFilter: ["class"] });

    new MutationObserver((records) => {
      const buttonChanged = records.some((record) => (
        [...record.addedNodes, ...record.removedNodes].some((node) => (
          node.nodeType === Node.ELEMENT_NODE
          && (node.matches(".theme-button") || node.querySelector(".theme-button"))
        ))
      ));
      if (buttonChanged) {
        closeMenu();
        updateButton();
      }
    }).observe(shell, { childList: true, subtree: true });
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest?.(".theme-menu-close")) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }

    const option = event.target.closest?.(".theme-option");
    if (option) {
      event.preventDefault();
      event.stopPropagation();
      applyTheme(option.dataset.theme);
      closeMenu(true);
      return;
    }

    const clickedThemeButton = event.target.closest?.(".theme-button");
    if (clickedThemeButton) {
      event.preventDefault();
      event.stopPropagation();
      themeButton = clickedThemeButton;
      openMenu();
      return;
    }

  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (menu && !event.target.closest?.(".theme-menu, .theme-button")) closeMenu();
  }, true);

  document.addEventListener("focusin", (event) => {
    if (menu && !event.target.closest?.(".theme-menu, .theme-button")) closeMenu();
  });

  document.addEventListener("scratchpad:popover-open", (event) => {
    if (event.detail?.id !== "color-theme-menu") closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }

    if (!menu || !menu.contains(event.target)) return;
    if (event.key === "Tab") {
      // Resume the page's normal tab order from the menu's trigger.
      closeMenu(true);
      return;
    }

    const options = Array.from(menu.querySelectorAll(".theme-option"));
    const currentIndex = options.indexOf(document.activeElement);
    let nextIndex = null;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % options.length;
    if (event.key === "ArrowUp") nextIndex = currentIndex < 0
      ? options.length - 1
      : (currentIndex - 1 + options.length) % options.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = options.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      event.stopPropagation();
      options.forEach((option, index) => { option.tabIndex = index === nextIndex ? 0 : -1; });
      options[nextIndex]?.focus({ preventScroll: true });
      options[nextIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, true);

  window.addEventListener("resize", positionMenu);
  window.addEventListener("scroll", positionMenu, true);
  window.visualViewport?.addEventListener("resize", positionMenu);
  window.visualViewport?.addEventListener("scroll", positionMenu);
  window.addEventListener("storage", (event) => {
    if (event.key === "workbench-theme") {
      const theme = savedTheme();
      if (theme) applyTheme(theme, false);
    }
  });
  initialize();
})();
