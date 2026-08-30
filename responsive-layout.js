(() => {
  const intermediateMinimum = 481;
  const intermediateMaximum = 700;
  let frame = 0;
  let toolbar = null;
  let metrics = null;
  let actions = null;
  let toolbarObserver = null;
  let metricsObserver = null;

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
    if (!toolbar?.isConnected || !metrics?.isConnected || !actions?.isConnected) {
      connect();
      return;
    }

    const width = toolbar.getBoundingClientRect().width;
    const intermediate = width >= intermediateMinimum && width <= intermediateMaximum;
    if (!intermediate) {
      toolbar.classList.remove("metrics-compact");
      return;
    }

    const availableMetricsWidth = width - 24 - 8 - intrinsicActionsWidth();
    toolbar.classList.toggle("metrics-compact", textWidth(metrics) > availableMetricsWidth);
  }

  function scheduleUpdate() {
    if (!frame) frame = requestAnimationFrame(updateLayout);
  }

  function disconnectObservers() {
    toolbarObserver?.disconnect();
    metricsObserver?.disconnect();
    toolbarObserver = null;
    metricsObserver = null;
  }

  function connect() {
    const nextToolbar = document.querySelector(".editor-toolbar");
    const nextMetrics = nextToolbar?.querySelector(".editor-meta span:last-child");
    const nextActions = nextToolbar?.querySelector(".editor-actions");
    if (nextToolbar === toolbar && nextMetrics === metrics && nextActions === actions) {
      scheduleUpdate();
      return;
    }

    disconnectObservers();
    toolbar = nextToolbar;
    metrics = nextMetrics;
    actions = nextActions;
    if (!toolbar || !metrics || !actions) return;

    toolbarObserver = new ResizeObserver(scheduleUpdate);
    toolbarObserver.observe(toolbar);
    metricsObserver = new MutationObserver(scheduleUpdate);
    metricsObserver.observe(metrics, { characterData: true, childList: true, subtree: true });
    scheduleUpdate();
  }

  new MutationObserver(connect).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("resize", scheduleUpdate);
  connect();
})();
