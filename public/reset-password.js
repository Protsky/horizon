const PAGE_BASE_PATH = window.location.pathname.startsWith('/bank') ? '/bank' : '';

function pathFor(path) {
  const normalized = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`;
  return `${PAGE_BASE_PATH}${normalized}`;
}

function navTo(path) {
  window.location.href = pathFor(path);
}

const elements = {
  form: document.getElementById('resetPasswordForm'),
  token: document.getElementById('resetToken'),
  newPassword: document.getElementById('resetNewPassword'),
  confirmPassword: document.getElementById('resetConfirmPassword'),
  submitBtn: document.getElementById('resetSubmitBtn'),
  inlineMessage: document.getElementById('resetInlineMessage'),
  toast: document.getElementById('resetToast'),
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 4200);
}

function setInlineMessage(message, tone = 'error') {
  const text = String(message || '').trim();
  elements.inlineMessage.textContent = text;
  elements.inlineMessage.classList.remove('error', 'success');

  if (!text) {
    elements.inlineMessage.classList.add('hidden');
    return;
  }

  elements.inlineMessage.classList.add(tone === 'success' ? 'success' : 'error');
  elements.inlineMessage.classList.remove('hidden');
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
    throw new Error(message);
  }

  return payload;
}

async function handleSubmit(event) {
  event.preventDefault();
  setInlineMessage('');

  const token = elements.token.value.trim();
  const newPassword = elements.newPassword.value;
  const confirmPassword = elements.confirmPassword.value;

  if (!token) {
    setInlineMessage('Reset token is required.');
    showToast('Reset token is required.');
    return;
  }

  if (newPassword.length < 8) {
    setInlineMessage('Password must be at least 8 characters.');
    showToast('Password must be at least 8 characters.');
    return;
  }

  if (newPassword !== confirmPassword) {
    setInlineMessage('Password confirmation does not match.');
    showToast('Password confirmation does not match.');
    return;
  }

  elements.submitBtn.disabled = true;
  try {
    await api('/api/auth/reset-password', {
      method: 'POST',
      body: { token, newPassword },
    });

    setInlineMessage('Password reset complete. Redirecting to login...', 'success');
    showToast('Password reset complete. Redirecting...');
    setTimeout(() => {
      navTo('/login');
    }, 900);
  } catch (error) {
    setInlineMessage(error.message);
    showToast(error.message);
  } finally {
    elements.submitBtn.disabled = false;
  }
}

function bootstrap() {
  // Do not auto-fill token from URL. User must paste token manually.
  if (window.location.search.includes('token=')) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  elements.form.addEventListener('submit', handleSubmit);
}

bootstrap();
