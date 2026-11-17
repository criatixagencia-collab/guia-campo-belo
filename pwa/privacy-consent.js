(() => {
  const KEY = 'campo-belo-analytics-choice-v1';
  const MEASUREMENT_ID = 'G-Q0TDM5LTPM';
  const banner = document.getElementById('privacyBanner');
  const openSettings = document.getElementById('openPrivacySettings');
  const rejectButton = document.getElementById('rejectAnalytics');
  const acceptButton = document.getElementById('acceptAnalytics');
  const title = document.getElementById('privacyBannerTitle');
  const bannerCopy = banner?.querySelector('.privacy-banner__copy p');
  const policyLink = banner?.querySelector('.privacy-banner__copy a');

  if (title) title.textContent = 'Preferências de métricas';
  if (bannerCopy) bannerCopy.textContent = 'O Google Analytics mede a audiência automaticamente para ajudar a entender tendências de acesso. Não usamos esses dados para anúncios ou personalização. Você pode desativar as métricas a qualquer momento.';
  if (policyLink) policyLink.textContent = 'Saiba mais na política de privacidade.';
  if (openSettings) openSettings.textContent = 'Gerenciar métricas';
  if (rejectButton) rejectButton.textContent = 'Desativar métricas';
  if (acceptButton) acceptButton.textContent = 'Manter métricas ativas';

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };

  function readChoice() {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  }

  function saveChoice(choice) {
    try { localStorage.setItem(KEY, choice); } catch (_) {}
  }

  function loadAnalytics() {
    if (window.__campoBeloAnalyticsLoaded || window[`ga-disable-${MEASUREMENT_ID}`]) return;
    window.__campoBeloAnalyticsLoaded = true;
    window.gtag('js', new Date());
    window.gtag('config', MEASUREMENT_ID, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    document.head.appendChild(script);
  }

  function clearAnalyticsCookies() {
    const names = document.cookie.split(';')
      .map(cookie => cookie.split('=')[0].trim())
      .filter(name => name === '_ga' || name.startsWith('_ga_'));
    const domains = [null];
    if (location.hostname === 'campobelosp.com.br' || location.hostname === 'www.campobelosp.com.br') {
      domains.push('campobelosp.com.br', '.campobelosp.com.br');
    }
    for (const name of names) {
      for (const domain of domains) {
        const domainPart = domain ? `; Domain=${domain}` : '';
        document.cookie = `${name}=; Max-Age=0; Path=/${domainPart}; SameSite=Lax; Secure`;
      }
    }
  }

  function choose(choice) {
    saveChoice(choice);
    window[`ga-disable-${MEASUREMENT_ID}`] = choice === 'rejected';
    if (choice === 'accepted') loadAnalytics();
    else clearAnalyticsCookies();
    if (banner) banner.hidden = true;
  }

  const choice = readChoice();
  const settingsRequested = new URLSearchParams(location.search).has('privacy-settings');
  if (choice === 'rejected') {
    if (rejectButton) rejectButton.textContent = 'Continuar sem métricas';
    if (acceptButton) acceptButton.textContent = 'Ativar métricas';
  }
  window[`ga-disable-${MEASUREMENT_ID}`] = choice === 'rejected';
  if (choice !== 'rejected') loadAnalytics();
  if (banner) banner.hidden = !settingsRequested;
  if (settingsRequested) history.replaceState(null, '', location.pathname + location.hash);

  window.addEventListener('storage', event => {
    if (event.key !== KEY) return;
    const disabled = event.newValue === 'rejected';
    window[`ga-disable-${MEASUREMENT_ID}`] = disabled;
    if (disabled) clearAnalyticsCookies();
    else loadAnalytics();
  });

  document.getElementById('acceptAnalytics')?.addEventListener('click', () => choose('accepted'));
  document.getElementById('rejectAnalytics')?.addEventListener('click', () => choose('rejected'));
  openSettings?.addEventListener('click', () => {
    if (banner) {
      banner.hidden = false;
      document.getElementById('acceptAnalytics')?.focus();
    } else {
      location.href = './?privacy-settings=1';
    }
  });
})();
