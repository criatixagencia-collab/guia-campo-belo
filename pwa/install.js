(() => {
  if (!window.isSecureContext) return;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(error => {
      console.warn('Não foi possível ativar o modo offline.', error);
    });
  }

  const button = document.getElementById('appInstallButton');
  if (!button) return;
  const standalone = matchMedia('(display-mode: standalone)');
  const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const privacyTools = document.querySelector('.privacy-tools');
  let pushOnboardingLoaded = false;

  function loadPushOnboarding() {
    const isStandalone = standalone.matches || navigator.standalone === true;
    if (pushOnboardingLoaded || !isStandalone
      || !('serviceWorker' in navigator)
      || !('PushManager' in window)
      || !('Notification' in window)) return;

    pushOnboardingLoaded = true;
    const script = document.createElement('script');
    script.src = 'pwa/push-onboarding.js';
    script.async = true;
    document.head.append(script);
  }

  if (privacyTools && !document.getElementById('openPushSettings')) {
    const link = document.createElement('a');
    link.id = 'openPushSettings';
    link.href = 'notificacoes.html';
    link.textContent = 'Notificações';
    privacyTools.append(link);
  }
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

  standalone.addEventListener('change', () => {
    updateButton();
    loadPushOnboarding();
  });

  updateButton();
  loadPushOnboarding();
})();
