(() => {
  const editorSelector = "textarea.editor";
  const indentModeKey = "workbench-indent-mode";
  const underlineMirror = document.createElement("div");
  const underlineMarker = document.createElement("span");
  const heldHistoryShortcuts = new Set();
  let underlineFrame = 0;

  Object.assign(underlineMirror.style, {
    position: "fixed",
    top: "0",
    left: "-100000px",
    visibility: "hidden",
    pointerEvents: "none",
    margin: "0",
    border: "0",
    whiteSpace: "pre",
    overflow: "visible",
  });
  underlineMirror.setAttribute("aria-hidden", "true");
  document.body.append(underlineMirror);

  function historyShortcutKey(event) {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey) return null;
    const key = event.key.toLowerCase();
    return key === "z" || key === "y" ? key : null;
  }

  document.addEventListener(
    "keydown",
    (event) => {
      const key = historyShortcutKey(event);
      if (!key) return;

      if (event.repeat || heldHistoryShortcuts.has(key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      heldHistoryShortcuts.add(key);
    },
    true,
  );

  document.addEventListener(
    "keyup",
    (event) => {
      const key = event.key.toLowerCase();
      if (key === "z" || key === "y") heldHistoryShortcuts.delete(key);
      if (key === "control" || key === "meta") heldHistoryShortcuts.clear();
    },
    true,
  );

  window.addEventListener("blur", () => heldHistoryShortcuts.clear());

  function getSpacesPerTab(editor) {
    const configuredSize = Number.parseInt(getComputedStyle(editor).tabSize, 10);
    return Number.isFinite(configuredSize) ? configuredSize : 2;
  }

  function resetTabSize() {
    const setting = Array.from(document.querySelectorAll(".setting-row")).find(
      (row) => row.querySelector("strong")?.textContent === "Tab spacing size",
    );
    const input = setting?.querySelector('input[type="range"]');
    if (!input) return;

    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    valueSetter.call(input, "2");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function getUnderlineGap() {
    try {
      const settings = JSON.parse(
        localStorage.getItem("workbench-editor-settings") || "{}",
      );
      return Number.isFinite(settings.underlineGap) ? settings.underlineGap : 5;
    } catch {
      return 5;
    }
  }

  function measureUnderlineLine(editor, line) {
    const style = getComputedStyle(editor);
    Object.assign(underlineMirror.style, {
      width: `${editor.clientWidth}px`,
      boxSizing: "border-box",
      padding: `${style.paddingTop} 0 0`,
      font: style.font,
      fontKerning: style.fontKerning,
      fontFeatureSettings: style.fontFeatureSettings,
      fontVariationSettings: style.fontVariationSettings,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      tabSize: style.tabSize,
      textRendering: style.textRendering,
      direction: style.direction,
    });
    underlineMarker.textContent = line || "\u200b";
    underlineMirror.replaceChildren(underlineMarker);

    const mirrorRect = underlineMirror.getBoundingClientRect();
    const markerRect = underlineMarker.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const scaleX = editor.offsetWidth > 0
      ? editorRect.width / editor.offsetWidth
      : 1;
    const scaleY = editor.offsetHeight > 0
      ? editorRect.height / editor.offsetHeight
      : scaleX;
    return {
      bottom: (markerRect.bottom - mirrorRect.top) / scaleY,
      width: line ? markerRect.width / scaleX : 0,
    };
  }

  function updateUnderlineForSelection(editor) {
    if (document.activeElement !== editor) return;

    const underline = editor.parentElement?.querySelector(
      ".active-line-underline",
    );
    if (!underline) return;

    const focusPosition = editor.selectionDirection === "backward"
      ? editor.selectionStart
      : editor.selectionEnd;
    const lineIndex = editor.value.slice(0, focusPosition).split(/\r?\n/).length - 1;
    const line = editor.value.split(/\r?\n/)[lineIndex] || "";
    let activeLineNumber = null;
    editor.parentElement.querySelectorAll(".line-numbers span").forEach(
      (lineNumber, index) => {
        const isActive = index === lineIndex;
        lineNumber.classList.toggle("active", isActive);
        if (isActive) activeLineNumber = lineNumber;
      },
    );
    const style = getComputedStyle(editor);
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const measuredLine = measureUnderlineLine(editor, line);
    const underlineLeft = 8;
    const textEnd = measuredLine.width > 0
      ? editor.offsetLeft + paddingLeft - editor.scrollLeft + measuredLine.width
      : editor.offsetLeft - 1;
    const underlineTop = (activeLineNumber?.offsetTop ?? paddingTop)
      + measuredLine.bottom
      - paddingTop
      + getUnderlineGap()
      - editor.scrollTop;

    underline.style.left = `${underlineLeft}px`;
    underline.style.width = `${Math.max(
      editor.offsetLeft - underlineLeft - 1,
      textEnd - underlineLeft,
    )}px`;
    underline.style.transform = `translate3d(0, ${underlineTop}px, 0)`;
    underline.style.opacity = "1";
  }

  function scheduleUnderlineUpdate(editor) {
    window.cancelAnimationFrame(underlineFrame);
    underlineFrame = window.requestAnimationFrame(() => {
      updateUnderlineForSelection(editor);
    });
  }

  function insertsTabCharacters() {
    return localStorage.getItem(indentModeKey) === "tabs";
  }

  function getIndentation(editor) {
    return insertsTabCharacters() ? "\t" : " ".repeat(getSpacesPerTab(editor));
  }

  function setIndentMode(useTabs) {
    localStorage.setItem(indentModeKey, useTabs ? "tabs" : "spaces");
    updateSetting();
  }

  function setEditorValue(editor, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    ).set;

    valueSetter.call(editor, value);
    const inputEvent = new Event("input", { bubbles: true });
    Object.defineProperty(inputEvent, "scratchpadHistoryKind", { value: "indent" });
    editor.dispatchEvent(inputEvent);
  }

  function removeIndentation(line, spacesPerTab) {
    if (line.startsWith("\t")) return line.slice(1);
    return line.replace(new RegExp(`^ {1,${spacesPerTab}}`), "");
  }

  function restoreSelection(editor, start, end = start) {
    window.setTimeout(() => {
      editor.focus();
      editor.setSelectionRange(start, end);
      editor.dispatchEvent(new Event("select", { bubbles: true }));
    });
  }

  function transformCurrentLine(editor, shouldDetab) {
    const { selectionStart, value } = editor;
    const indentation = getIndentation(editor);

    if (!shouldDetab) {
      setEditorValue(
        editor,
        value.slice(0, selectionStart) + indentation + value.slice(selectionStart),
      );
      restoreSelection(editor, selectionStart + indentation.length);
      return;
    }

    const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const lineEnd = value.indexOf("\n", selectionStart);
    const resolvedLineEnd = lineEnd === -1 ? value.length : lineEnd;
    const line = value.slice(lineStart, resolvedLineEnd);
    const transformedLine = removeIndentation(line, getSpacesPerTab(editor));
    const removedLength = line.length - transformedLine.length;

    if (removedLength > 0) {
      setEditorValue(
        editor,
        value.slice(0, lineStart) + transformedLine + value.slice(resolvedLineEnd),
      );
    }

    restoreSelection(editor, Math.max(lineStart, selectionStart - removedLength));
  }

  function transformSelectedLines(editor, shouldDetab) {
    const { selectionStart, selectionEnd, value } = editor;
    const blockStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const finalSelectedPosition =
      value[selectionEnd - 1] === "\n"
        ? Math.max(selectionStart, selectionEnd - 2)
        : selectionEnd - 1;
    const followingNewline = value.indexOf("\n", finalSelectedPosition);
    const blockEnd = followingNewline === -1 ? value.length : followingNewline;
    const selectedBlock = value.slice(blockStart, blockEnd);
    const spacesPerTab = getSpacesPerTab(editor);
    const indentation = getIndentation(editor);

    const transformedBlock = selectedBlock
      .split("\n")
      .map((line) => (
        shouldDetab ? removeIndentation(line, spacesPerTab) : indentation + line
      ))
      .join("\n");

    if (transformedBlock !== selectedBlock) {
      setEditorValue(
        editor,
        value.slice(0, blockStart) + transformedBlock + value.slice(blockEnd),
      );
    }

    restoreSelection(editor, blockStart, blockStart + transformedBlock.length);
  }

  function updateSetting() {
    const setting = document.querySelector("#indent-mode-setting");
    if (!setting) return;

    const editor = document.querySelector(editorSelector);
    const useTabs = insertsTabCharacters();
    const toggle = setting.querySelector("input");
    const value = setting.querySelector("small");
    const spacesPerTab = editor ? getSpacesPerTab(editor) : 2;

    const displayValue = useTabs ? "Tab character" : `${spacesPerTab} spaces`;
    if (toggle.checked !== useTabs) toggle.checked = useTabs;
    if (value.textContent !== displayValue) value.textContent = displayValue;
  }

  function ensureSetting() {
    const menu = document.querySelector('.settings-menu[data-editor-kind="text"]');
    if (!menu || menu.querySelector("#indent-mode-setting")) {
      updateSetting();
      return;
    }

    const setting = document.createElement("label");
    setting.id = "indent-mode-setting";
    setting.className = "setting-row indent-mode-setting";

    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = "Tab key inserts";
    const value = document.createElement("small");
    copy.append(name, value);

    const toggle = document.createElement("input");
    toggle.className = "indent-mode-toggle";
    toggle.type = "checkbox";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", "Insert tab characters instead of spaces");
    toggle.addEventListener("change", () => setIndentMode(toggle.checked));

    setting.append(copy, toggle);
    menu.querySelector(".reset-settings")?.before(setting);
    updateSetting();
  }

  document.addEventListener(
    "keydown",
    (event) => {
      const editor = event.target.closest?.(editorSelector);
      if (!editor || event.key !== "Tab") return;

      event.preventDefault();
      event.stopPropagation();

      if (editor.selectionStart === editor.selectionEnd) {
        transformCurrentLine(editor, event.shiftKey);
      } else {
        transformSelectedLines(editor, event.shiftKey);
      }
    },
    true,
  );

  document.addEventListener(
    "select",
    (event) => {
      const editor = event.target.closest?.(editorSelector);
      if (editor) scheduleUnderlineUpdate(editor);
    },
    true,
  );

  document.addEventListener(
    "selectionchange",
    () => {
      const editor = document.activeElement?.closest?.(editorSelector);
      if (editor) scheduleUnderlineUpdate(editor);
    },
  );

  document.addEventListener(
    "scroll",
    (event) => {
      const editor = event.target.closest?.(editorSelector);
      if (editor) scheduleUnderlineUpdate(editor);
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      if (!event.target.closest?.('.settings-menu[data-editor-kind="text"] .reset-settings')) return;
      setIndentMode(false);
      window.setTimeout(resetTabSize);
    },
    true,
  );

  new MutationObserver(ensureSetting).observe(document.body, {
    attributes: true,
    childList: true,
    subtree: true,
  });
})();
