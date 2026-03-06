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
  logoutBtn: document.getElementById('settingsLogoutBtn'),
  accountSummary: document.getElementById('settingsAccountSummary'),
  currentName: document.getElementById('currentName'),
  currentEmail: document.getElementById('currentEmail'),
  currentRole: document.getElementById('currentRole'),
  currentCreatedAt: document.getElementById('currentCreatedAt'),
  currentLicenseStatus: document.getElementById('currentLicenseStatus'),
  profileForm: document.getElementById('profileForm'),
  profileName: document.getElementById('profileName'),
  saveProfileBtn: document.getElementById('saveProfileBtn'),
  passwordForm: document.getElementById('passwordForm'),
  currentPassword: document.getElementById('currentPassword'),
  newPassword: document.getElementById('newPassword'),
  confirmPassword: document.getElementById('confirmPassword'),
  savePasswordBtn: document.getElementById('savePasswordBtn'),
  supportForm: document.getElementById('supportForm'),
  supportSubject: document.getElementById('supportSubject'),
  supportMessage: document.getElementById('supportMessage'),
  supportAttachment: document.getElementById('supportAttachment'),
  supportAttachmentMeta: document.getElementById('supportAttachmentMeta'),
  sendSupportBtn: document.getElementById('sendSupportBtn'),
  refreshSupportBtn: document.getElementById('refreshSupportBtn'),
  supportList: document.getElementById('supportList'),
  couponRedeemForm: document.getElementById('couponRedeemForm'),
  couponRedeemCode: document.getElementById('couponRedeemCode'),
  couponRedeemBtn: document.getElementById('couponRedeemBtn'),
  couponRedeemMeta: document.getElementById('couponRedeemMeta'),
  licenseTitle: document.getElementById('licenseTitle'),
  licenseDescription: document.getElementById('licenseDescription'),
  renewalAlert: document.getElementById('renewalAlert'),
  buyLicenseBtn: document.getElementById('buyLicenseBtn'),
  toggleAutoRenewBtn: document.getElementById('toggleAutoRenewBtn'),
  openDatabaseBtn: document.getElementById('openDatabaseBtn'),
  toast: document.getElementById('settingsToast'),
};

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

function getDaysRemaining(iso) {
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

function renewalAlertState(user) {
  const days = Number(user.daysRemaining || getDaysRemaining(user.licenseExpiresAt));
  if (!user.licenseActive) {
    return {
      tone: 'urgent',
      message: 'Subscription inactive. Database access is blocked until payment is active.',
    };
  }
  if (days <= 3) {
    return {
      tone: 'urgent',
      message: `Only ${days} day${days === 1 ? '' : 's'} left. Renewal is near.`,
    };
  }
  if (days <= 7) {
    return {
      tone: 'warn',
      message: `${days} days left before renewal date.`,
    };
  }
  return {
    tone: 'good',
    message: `${days} days remaining on your current period.`,
  };
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

function renderUserState() {
  if (!state.user) {
    return;
  }

  const admin = isAdminUser();
  const roleTag = admin ? 'admin' : 'user';

  elements.menuAdminLink.classList.toggle('hidden', !admin);
  elements.accountSummary.textContent = `${state.user.name} (${state.user.email}) - ${roleTag}`;

  elements.currentName.textContent = state.user.name || '-';
  elements.currentEmail.textContent = state.user.email || '-';
  elements.currentRole.textContent = roleTag;
  elements.currentCreatedAt.textContent = formatDate(state.user.createdAt);
  elements.profileName.value = state.user.name || '';

  const intervalDays = Number(state.config.subscriptionIntervalDays || state.config.licenseDays || 14);
  const trialDays = Math.max(1, Number(state.config.freeTrialDays || 1));
  const price = formatPrice(state.config.licensePriceCents, state.config.licenseCurrency);
  const daysRemaining = Number(state.user.daysRemaining || getDaysRemaining(state.user.licenseExpiresAt));
  const renewal = renewalAlertState(state.user);
  const hasSubscription = Boolean(state.user.stripeSubscriptionId);
  const status = String(state.user.subscriptionStatus || '').toLowerCase();
  const hasManagedSubscription =
    hasSubscription && status && status !== 'canceled' && status !== 'incomplete_expired';
  const hasBonusAccess = hasSearchAccess() && !hasManagedSubscription;

  if (hasBonusAccess) {
    elements.renewalAlert.textContent =
      `Bonus active until ${formatDate(state.user.licenseExpiresAt)}. No recurring charge is currently active.`;
    elements.renewalAlert.className = 'renewal-alert good';
  } else if (isTrialEligible()) {
    elements.renewalAlert.textContent =
      `Start your ${trialDays}-day free trial by adding a valid card. Then CHF 10 every 14 days, cancel anytime.`;
    elements.renewalAlert.className = 'renewal-alert warn';
  } else {
    elements.renewalAlert.textContent = renewal.message;
    elements.renewalAlert.className = `renewal-alert ${renewal.tone}`;
  }

  if (hasSearchAccess()) {
    if (hasManagedSubscription) {
      elements.currentLicenseStatus.textContent = `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left (until ${formatDate(state.user.licenseExpiresAt)})`;
      elements.licenseTitle.textContent = 'Subscription active';
      elements.licenseDescription.textContent =
        `Next charge: ${price} every ${intervalDays} days. You can cancel anytime.`;
    } else {
      elements.currentLicenseStatus.textContent = `Bonus active - ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left (until ${formatDate(state.user.licenseExpiresAt)})`;
      elements.licenseTitle.textContent = 'Bonus active';
      elements.licenseDescription.textContent =
        `Bonus access is active until ${formatDate(state.user.licenseExpiresAt)}. Start a subscription anytime.`;
    }
  } else {
    elements.currentLicenseStatus.textContent = 'inactive (database access blocked)';
    if (isTrialEligible()) {
      elements.licenseTitle.textContent = `${trialDays}-day free trial available`;
      elements.licenseDescription.textContent =
        'Card required. First charge starts after trial. You can cancel anytime.';
    } else {
      elements.licenseTitle.textContent = 'Subscription required';
      elements.licenseDescription.textContent =
        `Plan: ${price} every ${intervalDays} days. You can cancel anytime.`;
    }
  }

  const autoRenewLocked = Boolean(state.config.autoRenewLocked);
  elements.toggleAutoRenewBtn.classList.toggle('hidden', !hasSubscription || autoRenewLocked);
  elements.toggleAutoRenewBtn.textContent = state.user.autoRenew ? 'Cancel renewal' : 'Resume renewal';
  elements.toggleAutoRenewBtn.disabled = !state.config.stripeEnabled || !hasManagedSubscription || autoRenewLocked;

  elements.buyLicenseBtn.textContent = hasManagedSubscription
    ? 'Subscription active'
    : hasSearchAccess()
      ? `Start ${intervalDays}-day subscription`
      : isTrialEligible()
        ? `Start ${trialDays}-day free trial`
        : `Start ${intervalDays}-day subscription`;
  elements.buyLicenseBtn.disabled = !state.config.stripeEnabled || hasManagedSubscription;

  if (!state.config.stripeEnabled) {
    elements.licenseDescription.textContent =
      'Stripe is not configured on the server. Set STRIPE_* environment variables.';
    elements.renewalAlert.textContent = 'Billing unavailable until Stripe is configured.';
    elements.renewalAlert.className = 'renewal-alert warn';
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
      navTo(loginRedirectPath('/settings', 'settings'));
      return false;
    }

    state.user = payload.user;
    renderUserState();
    return true;
  } catch (error) {
    navTo(loginRedirectPath('/settings', 'settings'));
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

async function startCheckout() {
  if (!state.user) {
    navTo(loginRedirectPath('/settings', 'settings'));
    return;
  }

  const status = String(state.user.subscriptionStatus || '').toLowerCase();
  const hasManagedSubscription =
    Boolean(state.user.stripeSubscriptionId) &&
    status &&
    status !== 'canceled' &&
    status !== 'incomplete_expired';
  if (hasManagedSubscription) {
    showToast('Subscription already active. Use "Cancel renewal" if needed.');
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

async function handleProfileSave(event) {
  event.preventDefault();

  const name = elements.profileName.value.trim();
  if (name.length < 2 || name.length > 80) {
    showToast('Invalid name (2-80 characters).');
    return;
  }

  elements.saveProfileBtn.disabled = true;
  try {
    const payload = await api('/api/user/profile', {
      method: 'POST',
      body: { name },
    });
    state.user = payload.user;
    renderUserState();
    showToast('Profile updated.');
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.saveProfileBtn.disabled = false;
  }
}

async function handlePasswordSave(event) {
  event.preventDefault();

  const currentPassword = elements.currentPassword.value;
  const newPassword = elements.newPassword.value;
  const confirmPassword = elements.confirmPassword.value;

  if (newPassword.length < 8) {
    showToast('New password is too short.');
    return;
  }

  if (newPassword !== confirmPassword) {
    showToast('Password confirmation does not match.');
    return;
  }

  elements.savePasswordBtn.disabled = true;
  try {
    await api('/api/user/password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
    elements.currentPassword.value = '';
    elements.newPassword.value = '';
    elements.confirmPassword.value = '';
    showToast('Password updated.');
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.savePasswordBtn.disabled = false;
  }
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

async function handleCouponRedeem(event) {
  event.preventDefault();

  const code = String(elements.couponRedeemCode.value || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,40}$/.test(code)) {
    showToast('Invalid code format.');
    return;
  }

  elements.couponRedeemBtn.disabled = true;
  try {
    const payload = await api('/api/coupons/redeem', {
      method: 'POST',
      body: { code },
    });
    if (payload && payload.user) {
      state.user = payload.user;
      renderUserState();
    } else {
      await refreshUser();
    }
    elements.couponRedeemCode.value = '';
    elements.couponRedeemMeta.textContent = `Code applied: +${payload.daysAdded || 0} days. New expiry: ${formatDate(payload.licenseExpiresAt)}.`;
    showToast(payload.message || 'Coupon applied.');
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.couponRedeemBtn.disabled = false;
  }
}

function openDatabaseFlow() {
  if (!state.user) {
    navTo(loginRedirectPath('/search', 'database'));
    return;
  }

  if (hasSearchAccess()) {
    navTo('/search');
    return;
  }

  showToast('No active subscription. Activate billing to access the database.');
  navTo('/search?license=required');
}

async function handleLicenseAction() {
  if (!state.user) {
    navTo(loginRedirectPath('/settings', 'settings'));
    return;
  }

  await startCheckout();
}

async function handleAutoRenewToggle() {
  if (state.config.autoRenewLocked) {
    showToast('Renewal settings are locked for this plan.');
    return;
  }
  if (!state.user || !state.user.stripeSubscriptionId) {
    return;
  }

  if (!state.config.stripeEnabled) {
    showToast('Stripe is not configured on the server.');
    return;
  }

  const nextEnabled = !state.user.autoRenew;
  elements.toggleAutoRenewBtn.disabled = true;

  try {
    const payload = await api('/api/billing/subscription/auto-renew', {
      method: 'POST',
      body: { enabled: nextEnabled },
    });

    if (payload && payload.user) {
      state.user = payload.user;
      renderUserState();
    } else {
      await refreshUser();
    }
    showToast(nextEnabled ? 'Renewal resumed.' : 'Renewal canceled at period end.');
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.toggleAutoRenewBtn.disabled = false;
  }
}

async function handleLogout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    // ignore
  }
  navTo('/app');
}

async function parsePaymentFeedback() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get('payment');
  const sessionId = params.get('session_id');

  if (!payment) {
    return;
  }

  if (payment === 'success') {
    showToast('Payment completed. Confirming subscription...');
    if (sessionId) {
      try {
        const payload = await api('/api/billing/confirm-session', {
          method: 'POST',
          body: { sessionId },
        });
        state.user = payload.user;
      } catch (error) {
        showToast('Payment succeeded, but subscription sync failed.');
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

async function handleSupportRefresh() {
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

function bindEvents() {
  elements.logoutBtn.addEventListener('click', handleLogout);
  elements.profileForm.addEventListener('submit', handleProfileSave);
  elements.passwordForm.addEventListener('submit', handlePasswordSave);
  elements.supportForm.addEventListener('submit', handleSupportSubmit);
  elements.couponRedeemForm.addEventListener('submit', handleCouponRedeem);
  elements.refreshSupportBtn.addEventListener('click', handleSupportRefresh);
  elements.buyLicenseBtn.addEventListener('click', handleLicenseAction);
  elements.toggleAutoRenewBtn.addEventListener('click', handleAutoRenewToggle);
  elements.openDatabaseBtn.addEventListener('click', openDatabaseFlow);
  if (elements.supportAttachment) {
    elements.supportAttachment.addEventListener('change', handleAttachmentInputChange);
  }
}

async function bootstrap() {
  bindEvents();
  setAttachmentMeta(DEFAULT_ATTACHMENT_META);
  await loadPublicConfig();
  const ok = await refreshUser();
  if (!ok) {
    return;
  }
  await loadSupportRequests();
  await parsePaymentFeedback();
}

bootstrap();
