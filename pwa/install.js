(() => {
  if (!window.isSecureContext) return;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(error => {
      console.warn('Não foi possível ativar o modo offline.', error);
    });
  }

  const button = document.getElementById('appInstallButton');
  const dialog = document.getElementById('appInstallDialog');
  const help = document.getElementById('appInstallHelp');
  const standalone = matchMedia('(display-mode: standalone)');
  const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(navigator.userAgent);
  let installPrompt;
  let installed = false;

  function updateButton() {
    button.hidden = installed || standalone.matches || navigator.standalone === true
      || (!installPrompt && !isAppleMobile && !isAndroid);
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    updateButton();
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    installPrompt = undefined;
    updateButton();
  });

  standalone.addEventListener('change', updateButton);

  button.addEventListener('click', async () => {
    if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = undefined;
      try {
        const { outcome } = await prompt.prompt();
        if (outcome === 'accepted') installed = true;
        updateButton();
        return;
      } catch {
        updateButton();
      }
    }

    help.textContent = isAppleMobile
      ? 'Abra esta página no Safari. Toque em Compartilhar, depois em Adicionar à Tela de Início. Se aparecer a opção Abrir como App, deixe-a ativada e toque em Adicionar.'
      : 'Abra esta página no Chrome. No menu ⋮, escolha Instalar aplicativo ou Adicionar à tela inicial e confirme.';
    dialog.showModal();
  });

  updateButton();
})();
