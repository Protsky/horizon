const state = {
  config: {
    stripeEnabled: false,
    twintEnabled: false,
    licenseDays: 14,
    licensePriceCents: 1000,
    licenseCurrency: 'chf',
    subscriptionIntervalDays: 14,
    freeTrialDays: 1,
    freeTrialRequiresCard: true,
    autoRenewLocked: false,
  },
  user: null,
  searchTimer: null,
};

const PAGE_BASE_PATH = window.location.pathname.startsWith('/bank') ? '/bank' : '';

function pathFor(path) {
  const normalized = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`;
  return `${PAGE_BASE_PATH}${normalized}`;
}

function navTo(path) {
  window.location.href = pathFor(path);
}

function loginRedirectPath(nextPath, from) {
  const params = new URLSearchParams();
  params.set('reason', 'login_required');
  params.set('next', nextPath || '/app');
  if (from) {
    params.set('from', from);
  }
  return `/login?${params.toString()}`;
}

const elements = {
  menuAdminLink: document.getElementById('menuAdminLink'),
  logoutBtn: document.getElementById('searchLogoutBtn'),
  accountSummary: document.getElementById('searchAccountSummary'),
  gate: document.getElementById('searchGate'),
  gateTitle: document.getElementById('searchGateTitle'),
  gateDescription: document.getElementById('searchGateDescription'),
  buyLicenseBtn: document.getElementById('searchBuyLicenseBtn'),
  shell: document.getElementById('searchShell'),
  searchInput: document.getElementById('searchInput'),
  searchMeta: document.getElementById('searchMeta'),
  results: document.getElementById('results'),
  toast: document.getElementById('searchToast'),
};

function isAdminUser() {
  return Boolean(state.user && state.user.role === 'admin');
}

function hasAccess() {
  return Boolean(state.user && state.user.licenseActive);
}

function isTrialEligible() {
  if (!state.user) {
    return false;
  }
  return Boolean(state.user.emailVerified && !state.user.trialGranted);
}

function formatDate(iso) {
  if (!iso) {
    return 'n/a';
  }
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return 'n/a';
  }
  return value.toLocaleString('en-US');
}

function formatPrice(cents, currency) {
  const amount = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: String(currency || 'EUR').toUpperCase(),
    }).format(amount);
  } catch (error) {
    return `${amount.toFixed(2)} ${currency || 'EUR'}`;
  }
}

function paymentMethodLabel() {
  return state.config.twintEnabled ? 'card or TWINT' : 'card';
}

function daysRemaining(iso) {
  const expiresAt = Date.parse(iso || '');
  if (Number.isNaN(expiresAt)) {
    return 0;
  }
  const diff = expiresAt - Date.now();
  if (diff <= 0) {
    return 0;
  }
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 4200);
}

async function api(path, options = {}) {
  const response = await fetch(pathFor(path), {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    const message = (payload && payload.error) || `Request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

function renderResults(items) {
  elements.results.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'result';
    empty.textContent = 'No results found for this query.';
    elements.results.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const box = document.createElement('article');
    box.className = 'result';

    const title = document.createElement('h4');
    title.textContent = item.question || 'Question';

    const feedback = document.createElement('p');
    feedback.textContent = item.feedback || '';

    box.appendChild(title);
    box.appendChild(feedback);
    elements.results.appendChild(box);
  });
}

function renderUserState() {
  if (!state.user) {
    elements.accountSummary.textContent = 'Session not valid';
    elements.shell.classList.add('hidden');
    elements.gate.classList.add('hidden');
    return;
  }

  const admin = isAdminUser();
  elements.menuAdminLink.classList.toggle('hidden', !admin);
  const roleTag = admin ? 'admin' : 'user';
  elements.accountSummary.textContent = `${state.user.name} (${state.user.email}) - ${roleTag}`;

  if (hasAccess()) {
    elements.gate.classList.add('hidden');
    elements.shell.classList.remove('hidden');
    const left = Number(state.user.daysRemaining || daysRemaining(state.user.licenseExpiresAt));
    elements.searchMeta.textContent = `Subscription active - ${left} day${left === 1 ? '' : 's'} left (until ${formatDate(state.user.licenseExpiresAt)})`;
    return;
  }

  elements.shell.classList.add('hidden');
  elements.results.innerHTML = '';
  elements.gate.classList.remove('hidden');

  const price = formatPrice(state.config.licensePriceCents, state.config.licenseCurrency);
  const intervalDays = Number(state.config.subscriptionIntervalDays || state.config.licenseDays || 14);
  const trialDays = Math.max(1, Number(state.config.freeTrialDays || 1));
  const status = String(state.user.subscriptionStatus || '').toLowerCase();
  const hasManagedSubscription =
    Boolean(state.user.stripeSubscriptionId) &&
    status &&
    status !== 'canceled' &&
    status !== 'incomplete_expired';
  if (isTrialEligible()) {
    elements.gateTitle.textContent = `${trialDays}-day free trial available`;
    elements.gateDescription.textContent =
      'Add your card to start trial access. Then CHF 10 every 14 days, cancel anytime in Settings.';
    elements.buyLicenseBtn.textContent = `Start ${trialDays}-day free trial`;
  } else {
    elements.gateTitle.textContent = 'Subscription required for database access';
    elements.gateDescription.textContent =
      `Plan: ${price} every ${intervalDays} days with ${paymentMethodLabel()}. Cancel anytime in Settings.`;
    elements.buyLicenseBtn.textContent = hasManagedSubscription
      ? 'Open settings'
      : `Start ${intervalDays}-day subscription`;
  }
  elements.buyLicenseBtn.disabled = !state.config.stripeEnabled;

  if (!state.config.stripeEnabled) {
    elements.gateDescription.textContent =
      'Stripe is not configured on the server. Set STRIPE_* environment variables.';
  }
}

async function loadPublicConfig() {
  try {
    const config = await api('/api/config/public');
    state.config = {
      ...state.config,
      ...config,
    };
  } catch (error) {
    showToast('Config unavailable. Using defaults.');
  }
}

async function refreshUser() {
  try {
    const payload = await api('/api/auth/me');
    if (!payload.authenticated) {
      navTo(loginRedirectPath('/search', 'database'));
      return false;
    }

    state.user = payload.user;
    renderUserState();
    return true;
  } catch (error) {
    navTo(loginRedirectPath('/search', 'database'));
    return false;
  }
}

async function startCheckout() {
  if (!state.user) {
    navTo(loginRedirectPath('/search', 'database'));
    return;
  }

  const status = String(state.user.subscriptionStatus || '').toLowerCase();
  const hasManagedSubscription =
    Boolean(state.user.stripeSubscriptionId) &&
    status &&
    status !== 'canceled' &&
    status !== 'incomplete_expired';
  if (hasManagedSubscription) {
    navTo('/settings');
    return;
  }

  if (!state.config.stripeEnabled) {
    showToast('Stripe is not configured on the server.');
    return;
  }

  elements.buyLicenseBtn.disabled = true;
  elements.buyLicenseBtn.textContent = 'Redirecting...';

  try {
    const payload = await api('/api/billing/create-checkout-session', {
      method: 'POST',
    });

    if (!payload.url) {
      throw new Error('Checkout URL unavailable');
    }

    window.location.href = payload.url;
  } catch (error) {
    showToast(error.message);
    renderUserState();
  }
}

async function runSearch() {
  if (!hasAccess()) {
    return;
  }

  const query = elements.searchInput.value.trim();
  if (query.length < 2) {
    elements.results.innerHTML = '';
    elements.searchMeta.textContent = 'Type at least 2 characters.';
    return;
  }

  elements.searchMeta.textContent = 'Searching...';

  try {
    const items = await api(`/api/questions/search?q=${encodeURIComponent(query)}`);
    elements.searchMeta.textContent = `${items.length} results for "${query}"`;
    renderResults(items);
  } catch (error) {
    if (error.status === 401 || error.status === 402) {
      await refreshUser();
      showToast('Database access unavailable. Activate subscription.');
      return;
    }
    elements.searchMeta.textContent = 'Search failed.';
  }
}

function handleSearchInput() {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(runSearch, 250);
}

async function handleLogout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    // ignore
  }
  navTo('/app');
}

function handleLicenseNotice() {
  const params = new URLSearchParams(window.location.search);
  const licenseFlag = params.get('license');
  if (licenseFlag === 'required') {
    showToast('You need an active subscription to use the database.');
    params.delete('license');
    const query = params.toString();
    const cleaned = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState({}, '', cleaned);
  }
}

function bindEvents() {
  elements.logoutBtn.addEventListener('click', handleLogout);
  elements.buyLicenseBtn.addEventListener('click', startCheckout);
  elements.searchInput.addEventListener('input', handleSearchInput);
}

async function bootstrap() {
  bindEvents();
  await loadPublicConfig();
  const ok = await refreshUser();
  if (!ok) {
    return;
  }
  handleLicenseNotice();
}

bootstrap();
