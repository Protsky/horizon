const state = {
  config: {
    freeTrialDays: 1,
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

const elements = {
  switchLoginBtn: document.getElementById('switchLoginBtn'),
  switchRegisterBtn: document.getElementById('switchRegisterBtn'),
  loginForm: document.getElementById('loginForm'),
  registerForm: document.getElementById('registerForm'),
  loginSubmitBtn: document.getElementById('loginSubmitBtn'),
  loginInlineMessage: document.getElementById('loginInlineMessage'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  registerName: document.getElementById('registerName'),
  registerEmail: document.getElementById('registerEmail'),
  registerPassword: document.getElementById('registerPassword'),
  resendVerificationBtn: document.getElementById('resendVerificationBtn'),
  notice: document.getElementById('loginNotice'),
  toast: document.getElementById('loginToast'),
};

const freeTrialNodes = Array.from(document.querySelectorAll('[data-free-trial-days]'));
const allowedNextPaths = new Set(['/app', '/search', '/support', '/settings', '/admin']);

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 4200);
}

function setAuthMode(mode) {
  const loginMode = mode === 'login';
  elements.loginForm.classList.toggle('hidden', !loginMode);
  elements.registerForm.classList.toggle('hidden', loginMode);
  elements.switchLoginBtn.classList.toggle('active', loginMode);
  elements.switchRegisterBtn.classList.toggle('active', !loginMode);
  if (loginMode) {
    setLoginInlineMessage('');
  }
}

function renderFreeTrialDays() {
  const days = Math.max(1, Number(state.config.freeTrialDays || 1));
  freeTrialNodes.forEach((node) => {
    node.textContent = String(days);
  });
}

function getNextPath() {
  const params = new URLSearchParams(window.location.search);
  const requested = String(params.get('next') || '').trim();
  if (!requested || !requested.startsWith('/')) {
    return '/app';
  }
  return allowedNextPaths.has(requested) ? requested : '/app';
}

function renderLoginNotice() {
  const params = new URLSearchParams(window.location.search);
  const reason = String(params.get('reason') || '').trim().toLowerCase();
  const from = String(params.get('from') || '').trim().toLowerCase();

  let message = '';
  if (reason === 'login_required') {
    if (from === 'database') {
      message = 'Please log in first to open the database.';
    } else if (from === 'support') {
      message = 'Please log in first to open support.';
    } else if (from === 'settings') {
      message = 'Please log in first to open settings.';
    } else if (from === 'admin') {
      message = 'Please log in first to open the admin area.';
    } else {
      message = 'Please log in first to continue.';
    }
  }

  if (!message) {
    elements.notice.classList.add('hidden');
    elements.notice.textContent = '';
    return;
  }

  elements.notice.textContent = message;
  elements.notice.classList.remove('hidden');
}

function setLoginInlineMessage(message, tone = 'error') {
  const text = String(message || '').trim();
  elements.loginInlineMessage.textContent = text;
  elements.loginInlineMessage.classList.remove('error', 'success');

  if (!text) {
    elements.loginInlineMessage.classList.add('hidden');
    return;
  }

  elements.loginInlineMessage.classList.add(tone === 'success' ? 'success' : 'error');
  elements.loginInlineMessage.classList.remove('hidden');
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

async function loadPublicConfig() {
  try {
    const config = await api('/api/config/public');
    state.config = {
      ...state.config,
      ...config,
    };
  } catch (error) {
    // optional
  }
  renderFreeTrialDays();
}

async function ensureAnonymousOrRedirect() {
  try {
    const payload = await api('/api/auth/me');
    if (payload.authenticated && payload.user) {
      state.user = payload.user;
      navTo(getNextPath());
      return false;
    }
  } catch (error) {
    // optional
  }
  return true;
}

async function handleLogin(event) {
  event.preventDefault();
  const email = elements.loginEmail.value.trim();
  const password = elements.loginPassword.value;
  setLoginInlineMessage('');
  const initialButtonLabel = elements.loginSubmitBtn.textContent;
  elements.loginSubmitBtn.disabled = true;
  elements.loginSubmitBtn.textContent = 'Checking...';

  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setLoginInlineMessage('Login successful. Redirecting...', 'success');
    showToast('Login successful.');
    navTo(getNextPath());
  } catch (error) {
    let message = error.message;
    if (error && error.payload && error.payload.error === 'EMAIL_NOT_VERIFIED') {
      message = 'Email not verified. Check your inbox and verify first.';
    }
    setLoginInlineMessage(message);
    showToast(message);
  } finally {
    elements.loginSubmitBtn.disabled = false;
    elements.loginSubmitBtn.textContent = initialButtonLabel;
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const name = elements.registerName.value.trim();
  const email = elements.registerEmail.value.trim();
  const password = elements.registerPassword.value;

  try {
    const payload = await api('/api/auth/register', {
      method: 'POST',
      body: { name, email, password },
    });
    elements.registerPassword.value = '';
    const message =
      (payload && payload.message) ||
      `Account created. Verify your email, then add your card to start the ${state.config.freeTrialDays}-day free trial.`;
    showToast(message);
  } catch (error) {
    showToast(error.message);
  }
}

async function handleResendVerification() {
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
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.resendVerificationBtn.disabled = false;
  }
}

function bindEvents() {
  elements.switchLoginBtn.addEventListener('click', () => setAuthMode('login'));
  elements.switchRegisterBtn.addEventListener('click', () => setAuthMode('register'));
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.registerForm.addEventListener('submit', handleRegister);
  elements.resendVerificationBtn.addEventListener('click', handleResendVerification);
}

async function bootstrap() {
  bindEvents();
  setAuthMode('login');
  renderLoginNotice();
  await loadPublicConfig();
  await ensureAnonymousOrRedirect();
}

bootstrap();
