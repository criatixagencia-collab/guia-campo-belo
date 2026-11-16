(() => {
  const enableButton = document.getElementById('enablePush');
  const disableButton = document.getElementById('disablePush');
  const status = document.getElementById('pushStatus');
  const instructions = document.getElementById('pushInstructions');
  if (!enableButton || !disableButton || !status) return;

  const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let registration;

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('push-status--error', isError);
  }

  function updateControls(subscription, showMessage = true) {
    const needsHomeScreen = isAppleMobile && !standalone;
    enableButton.hidden = !supported;
    disableButton.hidden = !supported || !subscription;
    enableButton.disabled = !supported || needsHomeScreen || Notification.permission === 'denied';
    if (needsHomeScreen && showMessage) {
      instructions.hidden = false;
      setStatus('No iPhone, adicione primeiro à Tela de Início para ativar notificações.');
    } else if (!supported && showMessage) {
      setStatus('Este navegador não oferece notificações push para o app.', true);
    } else if (Notification.permission === 'denied' && showMessage) {
      setStatus('As notificações foram bloqueadas nas configurações do navegador.');
      instructions.hidden = false;
    } else if (subscription && showMessage) {
      setStatus('Este aparelho já está inscrito para receber avisos.');
    } else if (showMessage) {
      setStatus('Você decide se quer receber avisos. Não pedimos e-mail nem telefone.');
    }
  }

  async function getRegistration() {
    registration = await navigator.serviceWorker.getRegistration('./');
    if (!registration) registration = await navigator.serviceWorker.register('./sw.js');
    return navigator.serviceWorker.ready;
  }

  function decodeVapidKey(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }

  async function currentSubscription() {
    if (!supported) return null;
    try { return await (await getRegistration()).pushManager.getSubscription(); }
    catch { return null; }
  }

  if (!supported) {
    updateControls(null);
  } else {
    currentSubscription().then(updateControls);
  }

  enableButton.addEventListener('click', async () => {
    enableButton.disabled = true;
    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('Sem sua autorização, o app não envia notificações.');
        return;
      }

      const ready = await getRegistration();
      let subscription = await ready.pushManager.getSubscription();
      if (!subscription) {
        const configResponse = await fetch('./api/push/config', { cache: 'no-store' });
        if (!configResponse.ok) throw new Error('O serviço de notificações ainda está sendo preparado.');
        const { publicKey } = await configResponse.json();
        subscription = await ready.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(publicKey)
        });
      }

      const saved = await fetch('./api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
      if (!saved.ok) throw new Error('Não foi possível salvar a inscrição. Tente novamente mais tarde.');
      instructions.hidden = true;
      setStatus('Pronto. Este aparelho receberá os avisos da Revista Digital Campo Belo.');
      disableButton.hidden = false;
    } catch (error) {
      setStatus(error?.message || 'Não foi possível ativar as notificações.', true);
    } finally {
      updateControls(await currentSubscription(), false);
    }
  });

  disableButton.addEventListener('click', async () => {
    disableButton.disabled = true;
    try {
      const subscription = await currentSubscription();
      if (!subscription) {
        updateControls(null);
        return;
      }
      const response = await fetch('./api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint })
      });
      if (!response.ok) throw new Error('Não foi possível concluir o cancelamento. Tente novamente.');
      await subscription.unsubscribe();
      setStatus('Inscrição cancelada neste aparelho.');
    } catch (error) {
      setStatus(error?.message || 'Não foi possível cancelar as notificações.', true);
    } finally {
      updateControls(await currentSubscription(), false);
    }
  });
})();
