const PAGE_BASE_PATH = window.location.pathname.startsWith('/bank') ? '/bank' : '';

function pathFor(path) {
  const normalized = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`;
  return `${PAGE_BASE_PATH}${normalized}`;
}

const elements = {
  message: document.getElementById('verifyMessage'),
  toast: document.getElementById('verifyToast'),
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 4500);
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

async function verify() {
  const params = new URLSearchParams(window.location.search);
  const token = String(params.get('token') || '').trim();

  if (!token) {
    elements.message.textContent = 'Missing verification token.';
    return;
  }

  try {
    const payload = await api('/api/auth/verify-email', {
      method: 'POST',
      body: { token },
    });
    elements.message.textContent = payload.message || 'Email verified successfully.';
    showToast('Verification complete. You can now log in.');
  } catch (error) {
    elements.message.textContent = error.message;
    showToast(error.message);
  }
}

verify();
