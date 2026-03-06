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
  openAuthBtn: document.getElementById('openAuthBtn'),
  goDatabaseBtn: document.getElementById('goDatabaseBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  startNowBtn: document.getElementById('startNowBtn'),
  authPanel: document.getElementById('authPanel'),
  userPanel: document.getElementById('userPanel'),
  loginForm: document.getElementById('loginForm'),
  registerForm: document.getElementById('registerForm'),
  switchLoginBtn: document.getElementById('switchLoginBtn'),
  switchRegisterBtn: document.getElementById('switchRegisterBtn'),
  registerEmail: document.getElementById('registerEmail'),
  registerPassword: document.getElementById('registerPassword'),
  registerName: document.getElementById('registerName'),
  resendVerificationBtn: document.getElementById('resendVerificationBtn'),
  accountSummary: document.getElementById('accountSummary'),
  accessSummary: document.getElementById('accessSummary'),
  licenseTitle: document.getElementById('licenseTitle'),
  licenseDescription: document.getElementById('licenseDescription'),
  buyLicenseBtn: document.getElementById('buyLicenseBtn'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  openDatabaseBtn: document.getElementById('openDatabaseBtn'),
  toast: document.getElementById('toast'),
};
const freeTrialNodes = Array.from(document.querySelectorAll('[data-free-trial-days]'));

function isAdminUser() {
  return Boolean(state.user && state.user.role === 'admin');
}

function hasSearchAccess() {
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

function renderFreeTrialDays() {
  const days = Math.max(1, Number(state.config.freeTrialDays || 1));
  freeTrialNodes.forEach((node) => {
    node.textContent = String(days);
  });
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

function setAuthMode(mode) {
  if (
    !elements.loginForm ||
    !elements.registerForm ||
    !elements.switchLoginBtn ||
    !elements.switchRegisterBtn
  ) {
    return;
  }
  const loginMode = mode === 'login';
  elements.loginForm.classList.toggle('hidden', !loginMode);
  elements.registerForm.classList.toggle('hidden', loginMode);
  elements.switchLoginBtn.classList.toggle('active', loginMode);
  elements.switchRegisterBtn.classList.toggle('active', !loginMode);
}

function openAuthPanel(mode, nextPath, from) {
  if (state.user) {
    showToast('You are already logged in. Logout to switch account.');
    return;
  }
  navTo(loginRedirectPath(nextPath || '/app', from || 'home'));
}

function renderUserState() {
  const authenticated = Boolean(state.user);
  const admin = isAdminUser();
  const access = hasSearchAccess();

  if (elements.menuAdminLink) {
    elements.menuAdminLink.classList.toggle('hidden', !admin);
  }
  if (elements.openAuthBtn) {
    elements.openAuthBtn.classList.toggle('hidden', authenticated);
  }
  if (elements.logoutBtn) {
    elements.logoutBtn.classList.toggle('hidden', !authenticated);
  }
  if (elements.goDatabaseBtn) {
    elements.goDatabaseBtn.classList.toggle('hidden', !authenticated);
  }
  if (elements.userPanel) {
    elements.userPanel.classList.toggle('hidden', !authenticated);
  }

  if (elements.authPanel) {
    elements.authPanel.classList.add('hidden');
  }

  if (!authenticated) {
    if (elements.accountSummary) {
      elements.accountSummary.textContent = '-';
    }
    if (elements.accessSummary) {
      elements.accessSummary.textContent = 'Login to view your account status.';
    }
    return;
  }

  if (elements.accountSummary) {
    elements.accountSummary.textContent = `${state.user.name} (${state.user.email})`;
  }

  if (admin) {
    if (access) {
      if (elements.accessSummary) {
        elements.accessSummary.textContent = 'Role: admin with active database subscription';
      }
    } else {
      if (elements.accessSummary) {
        elements.accessSummary.textContent =
          'Role: admin without active database subscription. Activate billing to search.';
      }
    }
  } else if (access) {
    if (elements.accessSummary) {
      elements.accessSummary.textContent = 'Role: user with active database subscription';
    }
  } else {
    if (elements.accessSummary) {
      elements.accessSummary.textContent = 'Role: user without active subscription. Activate billing to access database.';
    }
  }

  const intervalDays = Number(state.config.subscriptionIntervalDays || state.config.licenseDays || 14);
  const trialDays = Math.max(1, Number(state.config.freeTrialDays || 1));

  if (access) {
    const left = Number(state.user.daysRemaining || daysRemaining(state.user.licenseExpiresAt));
    if (elements.licenseTitle) {
      elements.licenseTitle.textContent = 'Subscription active';
    }
    if (elements.licenseDescription) {
      elements.licenseDescription.textContent =
        `${left} day${left === 1 ? '' : 's'} left (until ${formatDate(state.user.licenseExpiresAt)}). CHF 10 every 14 days, cancel anytime in Settings.`;
    }
    if (elements.buyLicenseBtn) {
      elements.buyLicenseBtn.textContent = 'Manage subscription';
      elements.buyLicenseBtn.disabled = !state.config.stripeEnabled;
    }
  } else {
    if (isTrialEligible()) {
      if (elements.licenseTitle) {
        elements.licenseTitle.textContent = `${trialDays}-day free trial available`;
      }
      if (elements.licenseDescription) {
        elements.licenseDescription.textContent =
          'Card required. Then CHF 10 every 14 days. Cancel anytime in Settings.';
      }
      if (elements.buyLicenseBtn) {
        elements.buyLicenseBtn.textContent = `Start ${trialDays}-day free trial`;
      }
    } else {
      const price = formatPrice(state.config.licensePriceCents, state.config.licenseCurrency);
      if (elements.licenseTitle) {
        elements.licenseTitle.textContent = 'Subscription required for database access';
      }
      if (elements.licenseDescription) {
        elements.licenseDescription.textContent =
          `Plan: ${price} every ${intervalDays} days with ${paymentMethodLabel()}. Cancel anytime in Settings.`;
      }
      if (elements.buyLicenseBtn) {
        elements.buyLicenseBtn.textContent = `Start ${intervalDays}-day subscription`;
      }
    }
    if (elements.buyLicenseBtn) {
      elements.buyLicenseBtn.disabled = !state.config.stripeEnabled;
    }

    if (!state.config.stripeEnabled) {
      if (elements.licenseDescription) {
        elements.licenseDescription.textContent =
          'Stripe is not configured on the server. Set STRIPE_* environment variables.';
      }
    }
  }
}

async function loadPublicConfig() {
  try {
    const config = await api('/api/config/public');
    state.config = {
      ...state.config,
      ...config,
    };
    renderFreeTrialDays();
  } catch (error) {
    renderFreeTrialDays();
    showToast('Config unavailable. Using defaults.');
  }
}

async function refreshUser() {
  try {
    const payload = await api('/api/auth/me');
    if (payload.authenticated) {
      state.user = payload.user;
    } else {
      state.user = null;
      if (payload.reason === 'SESSION_REVOKED') {
        showToast('Session revoked: logged in from another device/browser.');
      }
    }
  } catch (error) {
    state.user = null;
    showToast('Session check failed.');
  }
  renderUserState();
}

async function startCheckout() {
  if (!state.user) {
    openAuthPanel('login', '/settings', 'settings');
    return;
  }

  if (!state.config.stripeEnabled) {
    showToast('Stripe is not configured on the server.');
    return;
  }

  if (elements.buyLicenseBtn) {
    elements.buyLicenseBtn.disabled = true;
    elements.buyLicenseBtn.textContent = 'Redirecting...';
  }

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

async function handlePrimaryAction() {
  if (!state.user) {
    openAuthPanel('login', '/settings', 'settings');
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

  await startCheckout();
}

function openDatabaseFlow() {
  if (!state.user) {
    openAuthPanel('login', '/search', 'database');
    return;
  }

  if (!hasSearchAccess()) {
    showToast('No active subscription. Activate billing to access the database.');
    navTo('/search?license=required');
    return;
  }

  navTo('/search');
}

function openSettingsFlow() {
  if (!state.user) {
    openAuthPanel('login', '/settings', 'settings');
    return;
  }
  navTo('/settings');
}

async function handleLogin(event) {
  if (!elements.loginForm) {
    return;
  }
  event.preventDefault();
  const loginEmailInput = document.getElementById('loginEmail');
  const loginPasswordInput = document.getElementById('loginPassword');
  if (!loginEmailInput || !loginPasswordInput) {
    return;
  }
  const email = loginEmailInput.value;
  const password = loginPasswordInput.value;

  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    await refreshUser();
    showToast('Login successful.');
    elements.userPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (error && error.payload && error.payload.error === 'EMAIL_NOT_VERIFIED') {
      showToast('Email not verified. Check your inbox and then start trial with card setup.');
      return;
    }
    showToast(error.message);
  }
}

async function handleRegister(event) {
  if (!elements.registerForm || !elements.registerName || !elements.registerEmail || !elements.registerPassword) {
    return;
  }
  event.preventDefault();
  const name = elements.registerName.value;
  const email = elements.registerEmail.value;
  const password = elements.registerPassword.value;

  try {
    const payload = await api('/api/auth/register', {
      method: 'POST',
      body: { name, email, password },
    });
    setAuthMode('register');
    elements.registerPassword.value = '';
    const message =
      (payload && payload.message) ||
      `Account created. Verify your email, then add your card to start the ${state.config.freeTrialDays}-day free trial.`;
    showToast(message);
    if (payload && payload.verificationLink) {
      showToast(`Verification link: ${payload.verificationLink}`);
    }
  } catch (error) {
    showToast(error.message);
  }
}

async function handleResendVerification() {
  if (!elements.resendVerificationBtn || !elements.registerEmail) {
    return;
  }
  const email = String(elements.registerEmail.value || '').trim();
  if (!email) {
    showToast('Enter your email in the register field first.');
    return;
  }

  elements.resendVerificationBtn.disabled = true;
  try {
    const payload = await api('/api/auth/resend-verification', {
      method: 'POST',
      body: { email },
    });
    showToast(payload.message || 'Verification email sent if account exists.');
    if (payload.verificationLink) {
      showToast(`Verification link: ${payload.verificationLink}`);
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.resendVerificationBtn.disabled = false;
  }
}

async function handleLogout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    // ignore
  }
  state.user = null;
  renderUserState();
  showToast('Logged out.');
}

async function parsePaymentFeedback() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get('payment');
  const sessionId = params.get('session_id');

  if (!payment) {
    return;
  }

  if (payment === 'success') {
    showToast('Payment completed. Refreshing subscription...');
    if (sessionId) {
      try {
        await api('/api/billing/confirm-session', {
          method: 'POST',
          body: { sessionId },
        });
      } catch (error) {
        showToast('Payment confirmed, but subscription sync failed.');
      }
    }
    await refreshUser();
  }

  if (payment === 'cancel') {
    showToast('Payment canceled.');
  }

  params.delete('payment');
  params.delete('session_id');
  const query = params.toString();
  const cleaned = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState({}, '', cleaned);
}

function bindEvents() {
  if (elements.switchLoginBtn) {
    elements.switchLoginBtn.addEventListener('click', () => setAuthMode('login'));
  }
  if (elements.switchRegisterBtn) {
    elements.switchRegisterBtn.addEventListener('click', () => setAuthMode('register'));
  }
  if (elements.openAuthBtn) {
    elements.openAuthBtn.addEventListener('click', () => navTo('/login'));
  }
  if (elements.startNowBtn) {
    elements.startNowBtn.addEventListener('click', openDatabaseFlow);
  }
  if (elements.goDatabaseBtn) {
    elements.goDatabaseBtn.addEventListener('click', openDatabaseFlow);
  }
  if (elements.loginForm) {
    elements.loginForm.addEventListener('submit', handleLogin);
  }
  if (elements.registerForm) {
    elements.registerForm.addEventListener('submit', handleRegister);
  }
  if (elements.resendVerificationBtn) {
    elements.resendVerificationBtn.addEventListener('click', handleResendVerification);
  }
  if (elements.logoutBtn) {
    elements.logoutBtn.addEventListener('click', handleLogout);
  }
  if (elements.buyLicenseBtn) {
    elements.buyLicenseBtn.addEventListener('click', handlePrimaryAction);
  }
  if (elements.openDatabaseBtn) {
    elements.openDatabaseBtn.addEventListener('click', openDatabaseFlow);
  }
  if (elements.openSettingsBtn) {
    elements.openSettingsBtn.addEventListener('click', openSettingsFlow);
  }
}

async function bootstrap() {
  bindEvents();
  if (elements.loginForm) {
    setAuthMode('login');
  }
  await loadPublicConfig();
  await refreshUser();
  await parsePaymentFeedback();
}

bootstrap();
