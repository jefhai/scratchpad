(() => {
  // Keep editor scrolling inside the visible viewport when a mobile keyboard opens.
  const root = document.documentElement;
  let frame = 0;
  function update() {
    frame = 0;
    const viewport = window.visualViewport;
    root.style.setProperty("--workspace-height", `${viewport?.height ?? innerHeight}px`);
    root.style.setProperty("--workspace-top", `${viewport?.offsetTop ?? 0}px`);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  update();
})();
