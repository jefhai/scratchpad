(() => {
  const presets = [
    {
      label: "Default",
      values: {
        "Line spacing": 30,
        "Caret spacing": 1,
        "Line number size": 15,
        "Underline gap": 5,
      },
    },
    {
      label: "Medium",
      values: {
        "Line spacing": 38,
        "Caret spacing": 2,
        "Line number size": 19,
        "Underline gap": 6,
      },
    },
    {
      label: "Larger",
      values: {
        "Line spacing": 38,
        "Caret spacing": 5,
        "Line number size": 21,
        "Underline gap": 8,
      },
    },
  ];

  function findSetting(name) {
    return Array.from(document.querySelectorAll(".setting-row")).find(
      (row) => row.querySelector("strong")?.textContent === name,
    );
  }

  function getSettingInput(name) {
    return findSetting(name)?.querySelector('input[type="range"]');
  }

  function updateSelection() {
    const presetRow = document.querySelector("#display-size-presets");
    if (!presetRow) return;

    presetRow.querySelectorAll("button").forEach((button) => {
      const preset = presets[Number(button.dataset.presetIndex)];
      const active = preset && Object.entries(preset.values).every(
        ([name, value]) => Number(getSettingInput(name)?.value) === value,
      );
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setRangeValue(input, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    valueSetter.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function selectPreset(preset) {
    Object.entries(preset.values).forEach(([name, value]) => {
      const input = getSettingInput(name);
      if (input) setRangeValue(input, value);
    });
    window.requestAnimationFrame(updateSelection);
  }

  function ensurePresets() {
    const setting = findSetting("Line spacing");
    if (!setting) return;

    if (document.querySelector("#display-size-presets")) {
      updateSelection();
      return;
    }

    const presetRow = document.createElement("div");
    presetRow.id = "display-size-presets";
    presetRow.className = "display-size-presets";
    presetRow.setAttribute("role", "group");
    presetRow.setAttribute("aria-label", "Display size presets");

    presets.forEach((preset, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.presetIndex = String(index);
      button.textContent = preset.label;
      button.addEventListener("click", () => selectPreset(preset));
      presetRow.append(button);
    });

    setting.before(presetRow);
    updateSelection();
  }

  document.addEventListener("input", (event) => {
    if (event.target.closest?.(".settings-menu")) {
      updateSelection();
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest?.(".reset-settings")) {
      window.setTimeout(updateSelection);
    }
  }, true);

  new MutationObserver(ensurePresets).observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
