(() => {
  const DISMISSED_KEY = 'campo-belo-push-onboarding-dismissed-v1';
  const ENABLED_KEY = 'campo-belo-push-onboarding-enabled-v1';
  const standalone = matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
  if (!standalone) return;

  try {
    if (localStorage.getItem(DISMISSED_KEY) || localStorage.getItem(ENABLED_KEY)) return;
  } catch {
    // Se o armazenamento estiver bloqueado, ainda mostramos o convite nesta abertura.
  }

  const supported = 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
  if (!supported || Notification.permission === 'denied') return;

  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = 'pwa/push-onboarding.css';
  document.head.append(styleLink);

  const dialog = document.createElement('dialog');
  dialog.className = 'push-onboarding';
  dialog.setAttribute('aria-labelledby', 'pushOnboardingTitle');
  dialog.innerHTML = `
    <section class="push-onboarding__card">
      <span class="push-onboarding__brand">Revista Digital Campo Belo</span>
      <h2 id="pushOnboardingTitle">Fique por dentro do bairro</h2>
      <p>Receba avisos sobre notícias, serviços e novidades do Campo Belo direto neste aparelho.</p>
      <p class="push-onboarding__note">Você escolhe se quer ativar e pode cancelar quando quiser.</p>
      <p class="push-onboarding__status" role="status" aria-live="polite" hidden></p>
      <div class="push-onboarding__actions">
        <button class="push-onboarding__enable" type="button">Ativar notificações</button>
        <button class="push-onboarding__later" type="button">Agora não</button>
      </div>
    </section>`;
  document.body.append(dialog);

  const enableButton = dialog.querySelector('.push-onboarding__enable');
  const laterButton = dialog.querySelector('.push-onboarding__later');
  const status = dialog.querySelector('.push-onboarding__status');

  function remember(key) {
    try { localStorage.setItem(key, '1'); } catch { /* Preferência temporária neste aparelho. */ }
  }

  function finish(key = DISMISSED_KEY) {
    remember(key);
    if (dialog.open) dialog.close();
    dialog.remove();
    styleLink.remove();
  }

  function setStatus(message, isError = false) {
    status.hidden = false;
    status.textContent = message;
    status.classList.toggle('push-onboarding__status--error', isError);
  }

  function decodeVapidKey(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }

  async function subscribe() {
    let registration = await navigator.serviceWorker.getRegistration('./');
    if (!registration) registration = await navigator.serviceWorker.register('./sw.js');
    registration = await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const configResponse = await fetch('./api/push/config', { cache: 'no-store' });
      if (!configResponse.ok) throw new Error('O serviço de avisos ainda não está disponível. Tente novamente mais tarde.');
      const { publicKey } = await configResponse.json();
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(publicKey)
      });
    }

    const saved = await fetch('./api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });
    if (!saved.ok) throw new Error('Não foi possível concluir a ativação. Tente novamente mais tarde.');
  }

  laterButton.addEventListener('click', () => finish());
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    finish();
  });

  enableButton.addEventListener('click', async () => {
    enableButton.disabled = true;
    laterButton.disabled = true;
    try {
      // Solicitar primeiro mantém o pedido do sistema ligado ao toque da pessoa.
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('Sem problema. Para ativar depois, use Notificações no app e as configurações deste aparelho.');
        enableButton.hidden = true;
        laterButton.disabled = false;
        laterButton.textContent = 'Fechar';
        remember(DISMISSED_KEY);
        return;
      }

      setStatus('Ativando neste aparelho…');
      await subscribe();
      finish(ENABLED_KEY);
    } catch (error) {
      setStatus(error?.message || 'Não foi possível ativar agora. Tente novamente mais tarde.', true);
      enableButton.disabled = false;
      laterButton.disabled = false;
      enableButton.textContent = 'Tentar novamente';
    }
  });

  (async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration('./');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        finish(ENABLED_KEY);
        return;
      }

      if (Notification.permission === 'granted') {
        try {
          await subscribe();
          finish(ENABLED_KEY);
          return;
        } catch {
          // A permissão já existe; se a inscrição falhar, oferecemos a tentativa manual.
        }
      }

      dialog.showModal();
    } catch {
      dialog.showModal();
    }
  })();
})();
