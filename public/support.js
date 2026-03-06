const state = {
  user: null,
  supportRequests: [],
  supportShowAll: false,
};

const PAGE_BASE_PATH = window.location.pathname.startsWith('/bank') ? '/bank' : '';
const SUPPORT_ATTACHMENT_MAX_BYTES = 6 * 1024 * 1024;
const SUPPORT_ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const DEFAULT_ATTACHMENT_META = 'Add one image (max 6 MB).';
const SUPPORT_VISIBLE_LIMIT = 8;

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
  accountSummary: document.getElementById('supportAccountSummary'),
  openDatabaseBtn: document.getElementById('openDatabaseBtn'),
  logoutBtn: document.getElementById('supportLogoutBtn'),
  supportForm: document.getElementById('supportForm'),
  supportSubject: document.getElementById('supportSubject'),
  supportMessage: document.getElementById('supportMessage'),
  supportAttachment: document.getElementById('supportAttachment'),
  supportAttachmentMeta: document.getElementById('supportAttachmentMeta'),
  sendSupportBtn: document.getElementById('sendSupportBtn'),
  refreshSupportBtn: document.getElementById('refreshSupportBtn'),
  supportList: document.getElementById('supportList'),
  toast: document.getElementById('supportToast'),
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 4200);
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

function supportStatusClass(status) {
  if (status === 'answered' || status === 'closed') {
    return 'good';
  }
  return 'warn';
}

function supportStatusLabel(status) {
  if (status === 'answered') {
    return 'Answered';
  }
  if (status === 'closed') {
    return 'Closed';
  }
  return 'Open';
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return '0 KB';
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function estimateDataUrlBytes(dataUrl) {
  const value = String(dataUrl || '');
  const commaIndex = value.indexOf(',');
  if (commaIndex < 0) {
    return 0;
  }
  const base64 = value.slice(commaIndex + 1).replace(/\s+/g, '');
  if (!base64) {
    return 0;
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function setAttachmentMeta(text) {
  if (!elements.supportAttachmentMeta) {
    return;
  }
  elements.supportAttachmentMeta.textContent = text || DEFAULT_ATTACHMENT_META;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

async function buildAttachmentPayload() {
  if (!elements.supportAttachment || !elements.supportAttachment.files.length) {
    return null;
  }

  const file = elements.supportAttachment.files[0];
  const mimeType = String(file.type || '').trim().toLowerCase();
  if (!SUPPORT_ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new Error('Only JPG, PNG, WEBP, or GIF images are allowed.');
  }
  if (file.size > SUPPORT_ATTACHMENT_MAX_BYTES) {
    throw new Error('Image too large. Max 6 MB.');
  }

  const dataUrl = await fileToDataUrl(file);
  const decodedSize = estimateDataUrlBytes(dataUrl);
  if (!decodedSize || decodedSize > SUPPORT_ATTACHMENT_MAX_BYTES) {
    throw new Error('Image too large. Max 6 MB.');
  }

  return {
    fileName: file.name || 'support-image',
    mimeType,
    dataUrl,
  };
}

function attachmentSrc(attachment) {
  const url = String((attachment && attachment.url) || '').trim();
  if (!url) {
    return '';
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return pathFor(url);
}

function renderSupportAttachment(attachment) {
  if (!attachment || !attachment.url) {
    return null;
  }

  const src = attachmentSrc(attachment);
  if (!src) {
    return null;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'support-attachment';

  const link = document.createElement('a');
  link.className = 'support-attachment-link';
  link.href = src;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';

  const image = document.createElement('img');
  image.className = 'support-attachment-image';
  image.src = src;
  image.loading = 'lazy';
  image.alt = attachment.fileName ? `Attachment: ${attachment.fileName}` : 'Support attachment';

  link.appendChild(image);

  const meta = document.createElement('div');
  meta.className = 'source';
  meta.textContent = `Attachment: ${attachment.fileName || 'image'}${
    attachment.sizeBytes ? ` (${formatBytes(attachment.sizeBytes)})` : ''
  }`;

  wrapper.appendChild(link);
  wrapper.appendChild(meta);
  return wrapper;
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

function renderAccount() {
  if (!state.user) {
    return;
  }

  const role = state.user.role === 'admin' ? 'admin' : 'user';
  elements.accountSummary.textContent = `${state.user.name} (${state.user.email}) - ${role}`;
  elements.menuAdminLink.classList.toggle('hidden', state.user.role !== 'admin');
}

function renderSupportRequests() {
  elements.supportList.innerHTML = '';
  elements.supportList.classList.add('support-list-compact');

  if (!state.supportRequests.length) {
    const empty = document.createElement('div');
    empty.className = 'support-item';
    empty.textContent = 'No support requests yet.';
    elements.supportList.appendChild(empty);
    return;
  }

  const total = state.supportRequests.length;
  const visibleRequests = state.supportShowAll
    ? state.supportRequests
    : state.supportRequests.slice(0, SUPPORT_VISIBLE_LIMIT);

  visibleRequests.forEach((request, index) => {
    const item = document.createElement('article');
    item.className = 'support-item support-item-list';

    const accordion = document.createElement('details');
    accordion.className = 'support-item-accordion';
    if (request.status === 'open' && index < 2) {
      accordion.open = true;
    }

    const summary = document.createElement('summary');
    summary.className = 'support-item-summary';

    const summaryMain = document.createElement('div');
    summaryMain.className = 'support-item-summary-main';

    const title = document.createElement('strong');
    title.textContent = request.subject || 'Support request';

    const summaryMeta = document.createElement('span');
    summaryMeta.className = 'support-item-summary-meta';
    summaryMeta.textContent = `Sent: ${formatDate(request.createdAt)}`;

    summaryMain.appendChild(title);
    summaryMain.appendChild(summaryMeta);

    const summarySide = document.createElement('div');
    summarySide.className = 'support-item-summary-side';

    const badge = document.createElement('span');
    badge.className = `status-pill ${supportStatusClass(request.status)}`;
    badge.textContent = supportStatusLabel(request.status);

    summarySide.appendChild(badge);
    if (request.adminReply) {
      const replyBadge = document.createElement('span');
      replyBadge.className = 'status-pill good';
      replyBadge.textContent = 'Reply';
      summarySide.appendChild(replyBadge);
    }
    if (request.attachment && request.attachment.url) {
      const attachmentBadge = document.createElement('span');
      attachmentBadge.className = 'status-pill good';
      attachmentBadge.textContent = 'Photo';
      summarySide.appendChild(attachmentBadge);
    }

    summary.appendChild(summaryMain);
    summary.appendChild(summarySide);

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'support-item-body';

    const body = document.createElement('p');
    body.textContent = request.message || '';

    const meta = document.createElement('div');
    meta.className = 'source';
    meta.textContent = `Sent: ${formatDate(request.createdAt)}`;

    bodyWrap.appendChild(body);
    bodyWrap.appendChild(meta);

    const attachmentNode = renderSupportAttachment(request.attachment);
    if (attachmentNode) {
      bodyWrap.appendChild(attachmentNode);
    }

    if (request.adminReply) {
      const reply = document.createElement('div');
      reply.className = 'support-reply';

      const replyTitle = document.createElement('strong');
      replyTitle.textContent = 'Admin reply';

      const replyBody = document.createElement('p');
      replyBody.textContent = request.adminReply;

      const replyMeta = document.createElement('div');
      replyMeta.className = 'source';
      replyMeta.textContent = `Updated: ${formatDate(request.repliedAt || request.updatedAt)}`;

      reply.appendChild(replyTitle);
      reply.appendChild(replyBody);
      reply.appendChild(replyMeta);
      bodyWrap.appendChild(reply);
    }

    accordion.appendChild(summary);
    accordion.appendChild(bodyWrap);
    item.appendChild(accordion);
    elements.supportList.appendChild(item);
  });

  if (total > SUPPORT_VISIBLE_LIMIT) {
    const controls = document.createElement('div');
    controls.className = 'support-list-controls';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ghost-btn';
    toggle.textContent = state.supportShowAll
      ? 'Show less'
      : `Show all requests (${total})`;
    toggle.addEventListener('click', () => {
      state.supportShowAll = !state.supportShowAll;
      renderSupportRequests();
    });

    controls.appendChild(toggle);
    elements.supportList.appendChild(controls);
  }
}

async function refreshUser() {
  try {
    const payload = await api('/api/auth/me');
    if (!payload.authenticated) {
      navTo(loginRedirectPath('/support', 'support'));
      return false;
    }
    state.user = payload.user;
    renderAccount();
    return true;
  } catch (error) {
    navTo(loginRedirectPath('/support', 'support'));
    return false;
  }
}

async function loadSupportRequests() {
  const payload = await api('/api/support/requests/mine');
  state.supportRequests = Array.isArray(payload.requests) ? payload.requests : [];
  if (state.supportRequests.length <= SUPPORT_VISIBLE_LIMIT) {
    state.supportShowAll = false;
  }
  renderSupportRequests();
}

async function handleSupportSubmit(event) {
  event.preventDefault();

  const subject = elements.supportSubject.value.trim();
  const message = elements.supportMessage.value.trim();

  if (subject.length < 3 || subject.length > 120) {
    showToast('Subject must be between 3 and 120 characters.');
    return;
  }

  if (message.length < 10 || message.length > 4000) {
    showToast('Message must be between 10 and 4000 characters.');
    return;
  }

  elements.sendSupportBtn.disabled = true;
  try {
    const attachment = await buildAttachmentPayload();
    await api('/api/support/requests', {
      method: 'POST',
      body: { subject, message, attachment },
    });
    elements.supportSubject.value = '';
    elements.supportMessage.value = '';
    if (elements.supportAttachment) {
      elements.supportAttachment.value = '';
    }
    setAttachmentMeta(DEFAULT_ATTACHMENT_META);
    showToast('Support request sent.');
    await loadSupportRequests();
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.sendSupportBtn.disabled = false;
  }
}

function openDatabaseFlow() {
  if (!state.user) {
    navTo(loginRedirectPath('/search', 'database'));
    return;
  }

  if (!state.user.licenseActive) {
    showToast('No active subscription. Activate billing to access the database.');
    navTo('/search?license=required');
    return;
  }

  navTo('/search');
}

async function handleRefreshSupport() {
  try {
    await loadSupportRequests();
  } catch (error) {
    showToast(error.message);
  }
}

function handleAttachmentInputChange() {
  if (!elements.supportAttachment || !elements.supportAttachment.files.length) {
    setAttachmentMeta(DEFAULT_ATTACHMENT_META);
    return;
  }
  const file = elements.supportAttachment.files[0];
  const mimeType = String(file.type || '').trim().toLowerCase();
  if (!SUPPORT_ALLOWED_IMAGE_TYPES.has(mimeType)) {
    setAttachmentMeta('Unsupported file type. Use JPG, PNG, WEBP, or GIF.');
    return;
  }
  setAttachmentMeta(`Selected: ${file.name} (${formatBytes(file.size)})`);
}

async function handleLogout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    // ignore
  }
  navTo('/app');
}

function bindEvents() {
  elements.supportForm.addEventListener('submit', handleSupportSubmit);
  elements.refreshSupportBtn.addEventListener('click', handleRefreshSupport);
  elements.openDatabaseBtn.addEventListener('click', openDatabaseFlow);
  elements.logoutBtn.addEventListener('click', handleLogout);
  if (elements.supportAttachment) {
    elements.supportAttachment.addEventListener('change', handleAttachmentInputChange);
  }
}

async function bootstrap() {
  bindEvents();
  setAttachmentMeta(DEFAULT_ATTACHMENT_META);
  const ok = await refreshUser();
  if (!ok) {
    return;
  }
  await loadSupportRequests();
}

bootstrap();
