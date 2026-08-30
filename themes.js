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
    if (current) themeButton = current;
    return themeButton;
  }

  function savedTheme() {
    const value = localStorage.getItem("workbench-theme");
    return themes.some((theme) => theme.id === value) ? value : null;
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
  }

  function updateMenuSelection() {
    menu?.querySelectorAll(".theme-option").forEach((option) => {
      const active = option.dataset.theme === selectedTheme;
      option.classList.toggle("active", active);
      option.setAttribute("aria-checked", String(active));
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
    if (persist) localStorage.setItem("workbench-theme", theme.id);
    syncMenuTheme();
    updateButton();
    updateMenuSelection();
  }

  function closeMenu() {
    menu?.remove();
    menu = null;
    updateButton();
    currentThemeButton()?.focus();
  }

  function positionMenu() {
    const button = currentThemeButton();
    if (!menu || !button) return;
    const buttonRect = button.getBoundingClientRect();
    menu.style.top = `${Math.round(buttonRect.bottom + 8)}px`;
    menu.style.right = `${Math.max(8, Math.round(window.innerWidth - buttonRect.right))}px`;
  }

  function openMenu() {
    if (menu) {
      closeMenu();
      return;
    }

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
    menu.querySelector('.theme-option[aria-checked="true"]')?.focus();
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

    new MutationObserver(updateButton).observe(shell, { childList: true, subtree: true });
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest?.(".theme-menu-close")) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }

    const option = event.target.closest?.(".theme-option");
    if (option) {
      event.preventDefault();
      event.stopPropagation();
      applyTheme(option.dataset.theme);
      closeMenu();
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

    if (menu && !event.target.closest?.(".theme-menu")) closeMenu();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    }
  }, true);

  window.addEventListener("resize", positionMenu);
  window.addEventListener("scroll", positionMenu, true);
  initialize();
})();
