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

  document.querySelectorAll('.flyer-frame[data-price-updates]').forEach((frame) => {
    frame.addEventListener('load', () => {
      const updates = JSON.parse(frame.dataset.priceUpdates);
      const applied = new Set();

      function updatePrices(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        let node;

        while ((node = walker.nextNode())) {
          if (node.nodeType === Node.TEXT_NODE) {
            const value = node.nodeValue.trim();
            if (updates[value] && !applied.has(value)) {
              node.nodeValue = node.nodeValue.replace(value, updates[value]);
              applied.add(value);
            }
          } else if (node.shadowRoot) {
            updatePrices(node.shadowRoot);
          }
        }
      }

      function removeRequestedItem(root) {
        const removeText = frame.dataset.removeText;
        if (!removeText) return;
        const elements = root.querySelectorAll('*');

        elements.forEach((element) => {
          if (element.shadowRoot) removeRequestedItem(element.shadowRoot);
          if (element.children.length || element.textContent.trim() !== removeText) return;

          let row = element;
          while (row && row !== root) {
            if (row.style?.display === 'flex' && row.textContent.includes('R$')) {
              row.style.display = 'none';
              return;
            }
            row = row.parentElement;
          }
        });
      }

      const retry = window.setInterval(() => {
        removeRequestedItem(frame.contentDocument.body);
        updatePrices(frame.contentDocument.body);
        if (applied.size === Object.keys(updates).length) window.clearInterval(retry);
      }, 100);

      window.setTimeout(() => window.clearInterval(retry), 3000);
    });
  });
})();
