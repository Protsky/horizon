const PAGE_BASE_PATH = window.location.pathname.startsWith('/bank') ? '/bank' : '';

function pathFor(path) {
  const normalized = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`;
  return `${PAGE_BASE_PATH}${normalized}`;
}

const elements = {
  form: document.getElementById('forgotPasswordForm'),
  email: document.getElementById('forgotEmail'),
  submitBtn: document.getElementById('forgotSubmitBtn'),
  message: document.getElementById('forgotMessage'),
  toast: document.getElementById('forgotToast'),
};

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
    throw new Error(message);
  }

  return payload;
}

async function handleSubmit(event) {
  event.preventDefault();

  const email = elements.email.value.trim();
  if (!email) {
    showToast('Please enter your email.');
    return;
  }

  elements.submitBtn.disabled = true;

  try {
    await api('/api/auth/forgot-password', {
      method: 'POST',
      body: { email },
    });

    elements.message.textContent =
      'If the email exists, a reset email has been sent. Use the latest email only (new requests invalidate previous tokens).';

    showToast('Request processed.');
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.submitBtn.disabled = false;
  }
}

function bootstrap() {
  elements.form.addEventListener('submit', handleSubmit);
}

bootstrap();
