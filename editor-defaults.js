(() => {
  const settingsKey = "workbench-editor-settings";

  if (!localStorage.getItem(settingsKey)) {
    localStorage.setItem(settingsKey, JSON.stringify({ tabSize: 2 }));
  }
})();
