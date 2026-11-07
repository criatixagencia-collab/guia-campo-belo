(() => {
  const KEY = 'campo-belo-analytics-choice-v1';
  const MEASUREMENT_ID = 'G-Q0TDM5LTPM';
  const banner = document.getElementById('privacyBanner');
  const openSettings = document.getElementById('openPrivacySettings');

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  });

  function readChoice() {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  }

  function saveChoice(choice) {
    try { localStorage.setItem(KEY, choice); } catch (_) {}
  }

  function loadAnalytics() {
    if (window.__campoBeloAnalyticsLoaded) return;
    window.__campoBeloAnalyticsLoaded = true;
    window.gtag('consent', 'update', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
    window.gtag('js', new Date());
    window.gtag('config', MEASUREMENT_ID);
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    document.head.appendChild(script);
  }

  function choose(choice) {
    saveChoice(choice);
    window.gtag('consent', 'update', {
      analytics_storage: choice === 'accepted' ? 'granted' : 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
    if (choice === 'accepted') loadAnalytics();
    if (banner) banner.hidden = true;
  }

  const choice = readChoice();
  const settingsRequested = new URLSearchParams(location.search).has('privacy-settings');
  if (choice === 'accepted') loadAnalytics();
  if (banner && (settingsRequested || (choice !== 'accepted' && choice !== 'rejected')))
    banner.hidden = false;
  if (settingsRequested) history.replaceState(null, '', location.pathname + location.hash);

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
