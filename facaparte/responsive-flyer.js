(() => {
  const SOURCE_WIDTH = 1080;

  function resizeFlyers() {
    document.querySelectorAll('.flyer-shell').forEach((shell) => {
      const scale = Math.min(1, shell.clientWidth / SOURCE_WIDTH);
      shell.style.setProperty('--flyer-scale', scale);
    });
  }

  resizeFlyers();
  window.addEventListener('resize', resizeFlyers, { passive: true });

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(resizeFlyers);
    document.querySelectorAll('.flyer-shell').forEach((shell) => observer.observe(shell));
  }
})();
