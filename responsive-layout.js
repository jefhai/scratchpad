(() => {
  const intermediateMinimum = 481;
  const intermediateMaximum = 700;
  let frame = 0;
  let toolbar = null;
  let metrics = null;
  let actions = null;

  function textWidth(element) {
    const style = getComputedStyle(element);
    const probe = document.createElement("span");
    probe.textContent = element.textContent;
    Object.assign(probe.style, {
      position: "fixed",
      top: "-10000px",
      left: "-10000px",
      visibility: "hidden",
      whiteSpace: "nowrap",
      font: style.font,
      letterSpacing: style.letterSpacing,
    });
    document.body.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  }

  function intrinsicActionsWidth() {
    const visibleChildren = Array.from(actions.children).filter(
      (child) => child.getBoundingClientRect().width > 0,
    );
    const gap = Number.parseFloat(getComputedStyle(actions).gap) || 0;
    return visibleChildren.reduce(
      (width, child) => width + child.getBoundingClientRect().width,
      Math.max(0, visibleChildren.length - 1) * gap,
    );
  }

  function updateLayout() {
    frame = 0;
    const width = toolbar.getBoundingClientRect().width;
    const intermediate = width >= intermediateMinimum && width <= intermediateMaximum;
    if (!intermediate) {
      toolbar.classList.remove("metrics-compact");
      return;
    }

    const naturalToolbarPadding = 24;
    const naturalToolbarGap = 8;
    const availableMetricsWidth = width
      - naturalToolbarPadding
      - naturalToolbarGap
      - intrinsicActionsWidth();
    const compact = textWidth(metrics) > availableMetricsWidth;
    toolbar.classList.toggle("metrics-compact", compact);
  }

  function scheduleUpdate() {
    if (frame) return;
    frame = requestAnimationFrame(updateLayout);
  }

  function initialize() {
    toolbar = document.querySelector(".editor-toolbar");
    metrics = document.querySelector(".editor-meta span:last-child");
    actions = document.querySelector(".editor-actions");
    if (!toolbar || !metrics || !actions) {
      requestAnimationFrame(initialize);
      return;
    }

    new ResizeObserver(scheduleUpdate).observe(toolbar);
    new MutationObserver(scheduleUpdate).observe(metrics, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", scheduleUpdate);
    scheduleUpdate();
  }

  initialize();
})();
