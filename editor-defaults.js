(() => {
  const settingsKey = "workbench-editor-settings";

  try {
    if (!localStorage.getItem(settingsKey)) {
      localStorage.setItem(settingsKey, JSON.stringify({ tabSize: 2 }));
    }
  } catch {
    // TextPad supplies the same defaults when storage is unavailable.
  }
})();
