const state = {
  user: null,
  config: {
    licenseDays: 14,
  },
  users: [],
  supportRequests: [],
  newsletters: [],
  coupons: [],
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
  accountSummary: document.getElementById('adminAccountSummary'),
  refreshBtn: document.getElementById('adminRefreshBtn'),
  refreshSupportBtn: document.getElementById('adminRefreshSupportBtn'),
  logoutBtn: document.getElementById('adminLogoutBtn'),
  meta: document.getElementById('adminMeta'),
  supportMeta: document.getElementById('supportMeta'),
  usersBody: document.getElementById('adminUsersBody'),
  supportList: document.getElementById('adminSupportList'),
  statsUsers: document.getElementById('adminStatsUsers'),
  statsVerified: document.getElementById('adminStatsVerified'),
  statsActive: document.getElementById('adminStatsActive'),
  statsLicensed: document.getElementById('adminStatsLicensed'),
  statsSubscriptions: document.getElementById('adminStatsSubscriptions'),
  statsTrialActive: document.getElementById('adminStatsTrialActive'),
  statsRenewalOff: document.getElementById('adminStatsRenewalOff'),
  statsSupportOpen: document.getElementById('adminStatsSupportOpen'),
  statsNewsletters: document.getElementById('adminStatsNewsletters'),
  statsCoupons: document.getElementById('adminStatsCoupons'),
  newsletterMeta: document.getElementById('newsletterMeta'),
  newsletterForm: document.getElementById('newsletterForm'),
  newsletterTitle: document.getElementById('newsletterTitle'),
  newsletterMessage: document.getElementById('newsletterMessage'),
  newsletterSubmitBtn: document.getElementById('newsletterSubmitBtn'),
  newsletterList: document.getElementById('newsletterList'),
  couponMeta: document.getElementById('couponMeta'),
  couponForm: document.getElementById('couponForm'),
  couponCode: document.getElementById('couponCode'),
  couponDays: document.getElementById('couponDays'),
  couponMaxRedemptions: document.getElementById('couponMaxRedemptions'),
  couponExpiresAt: document.getElementById('couponExpiresAt'),
  couponNote: document.getElementById('couponNote'),
  couponSubmitBtn: document.getElementById('couponSubmitBtn'),
  couponList: document.getElementById('couponList'),
  toast: document.getElementById('adminToast'),
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

function couponStatusClass(status) {
  if (status === 'active') {
    return 'good';
  }
  return 'warn';
}

function couponStatusLabel(status) {
  if (status === 'inactive') {
    return 'Inactive';
  }
  if (status === 'expired') {
    return 'Expired';
  }
  if (status === 'exhausted') {
    return 'Exhausted';
  }
  return 'Active';
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

function renderStats() {
  const now = Date.now();
  const total = state.users.length;
  const verified = state.users.filter((user) => Boolean(user.emailVerified)).length;
  const activeSessions = state.users.filter((user) => user.activeSession).length;
  const activeLicenses = state.users.filter((user) => user.licenseActive).length;
  const subscriptions = state.users.filter((user) => Boolean(user.stripeSubscriptionId)).length;
  const trialActive = state.users.filter((user) => {
    if (!user.trialGranted || !user.trialEndsAt) {
      return false;
    }
    const trialEndsAt = Date.parse(user.trialEndsAt);
    return !Number.isNaN(trialEndsAt) && trialEndsAt > now;
  }).length;
  const renewalOff = state.users.filter(
    (user) => Boolean(user.stripeSubscriptionId) && user.autoRenew === false,
  ).length;
  const supportOpen = state.supportRequests.filter((request) => request.status === 'open').length;
  const newsletters = state.newsletters.length;
  const activeCoupons = state.coupons.filter((coupon) => coupon.status === 'active').length;

  elements.statsUsers.textContent = String(total);
  elements.statsVerified.textContent = String(verified);
  elements.statsActive.textContent = String(activeSessions);
  elements.statsLicensed.textContent = String(activeLicenses);
  elements.statsSubscriptions.textContent = String(subscriptions);
  elements.statsTrialActive.textContent = String(trialActive);
  elements.statsRenewalOff.textContent = String(renewalOff);
  elements.statsSupportOpen.textContent = String(supportOpen);
  elements.statsNewsletters.textContent = String(newsletters);
  elements.statsCoupons.textContent = String(activeCoupons);
}

function renderUsers() {
  elements.usersBody.innerHTML = '';

  if (!state.users.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.dataset.label = 'Users';
    cell.colSpan = 5;
    cell.textContent = 'No users found.';
    row.appendChild(cell);
    elements.usersBody.appendChild(row);
    return;
  }

  state.users.forEach((user) => {
    const row = document.createElement('tr');

    const userCell = document.createElement('td');
    const userBox = document.createElement('div');
    userBox.className = 'admin-user';
    const nameEl = document.createElement('strong');
    nameEl.textContent = user.name || 'User';
    const emailEl = document.createElement('small');
    emailEl.textContent = user.email || '';
    userBox.appendChild(nameEl);
    userBox.appendChild(emailEl);
    userCell.appendChild(userBox);

    const roleCell = document.createElement('td');
    roleCell.dataset.label = 'Role';
    roleCell.textContent = user.role || 'user';

    const licenseCell = document.createElement('td');
    licenseCell.dataset.label = 'License';
    if (user.licenseActive) {
      const pill = document.createElement('span');
      pill.className = 'status-pill good';
      pill.textContent = 'active';
      licenseCell.appendChild(pill);
      const line = document.createElement('div');
      line.className = 'source';
      line.textContent = `until ${formatDate(user.licenseExpiresAt)}`;
      licenseCell.appendChild(line);
    } else {
      const pill = document.createElement('span');
      pill.className = 'status-pill warn';
      pill.textContent = 'inactive';
      licenseCell.appendChild(pill);
    }

    const sessionCell = document.createElement('td');
    sessionCell.dataset.label = 'Session';
    if (user.activeSession) {
      const pill = document.createElement('span');
      pill.className = 'status-pill good';
      pill.textContent = 'online';
      sessionCell.appendChild(pill);
    } else {
      const pill = document.createElement('span');
      pill.className = 'status-pill warn';
      pill.textContent = 'offline';
      sessionCell.appendChild(pill);
    }

    const actionsCell = document.createElement('td');
    actionsCell.dataset.label = 'Actions';
    const actions = document.createElement('div');
    actions.className = 'admin-actions';

    const extendBtn = document.createElement('button');
    extendBtn.className = 'mini-btn';
    extendBtn.type = 'button';
    extendBtn.textContent = `+${state.config.licenseDays} days`;
    extendBtn.dataset.action = 'extend';
    extendBtn.dataset.userId = user.id;

    const revokeLicenseBtn = document.createElement('button');
    revokeLicenseBtn.className = 'mini-btn';
    revokeLicenseBtn.type = 'button';
    revokeLicenseBtn.textContent = 'Revoke license';
    revokeLicenseBtn.dataset.action = 'revoke-license';
    revokeLicenseBtn.dataset.userId = user.id;

    const revokeSessionBtn = document.createElement('button');
    revokeSessionBtn.className = 'mini-btn';
    revokeSessionBtn.type = 'button';
    revokeSessionBtn.textContent = 'Force logout';
    revokeSessionBtn.dataset.action = 'revoke-session';
    revokeSessionBtn.dataset.userId = user.id;

    const deleteUserBtn = document.createElement('button');
    deleteUserBtn.className = 'mini-btn danger-btn';
    deleteUserBtn.type = 'button';
    deleteUserBtn.textContent = 'Delete account';
    deleteUserBtn.dataset.action = 'delete-user';
    deleteUserBtn.dataset.userId = user.id;
    deleteUserBtn.dataset.userEmail = user.email || '';
    deleteUserBtn.dataset.userName = user.name || 'User';
    if (state.user && state.user.id === user.id) {
      deleteUserBtn.disabled = true;
      deleteUserBtn.textContent = 'Current admin';
      deleteUserBtn.title = 'You cannot delete your own account';
    }

    actions.appendChild(extendBtn);
    actions.appendChild(revokeLicenseBtn);
    actions.appendChild(revokeSessionBtn);
    actions.appendChild(deleteUserBtn);
    actionsCell.appendChild(actions);

    row.appendChild(userCell);
    userCell.dataset.label = 'User';
    row.appendChild(roleCell);
    row.appendChild(licenseCell);
    row.appendChild(sessionCell);
    row.appendChild(actionsCell);
    elements.usersBody.appendChild(row);
  });
}

function requestSortMs(request) {
  const updatedAt = Date.parse(request.updatedAt || request.repliedAt || request.createdAt || '');
  if (!Number.isNaN(updatedAt)) {
    return updatedAt;
  }
  const createdAt = Date.parse(request.createdAt || '');
  return Number.isNaN(createdAt) ? 0 : createdAt;
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

function buildSupportRequestItem(request) {
  const item = document.createElement('article');
  item.className = 'support-item';

  const head = document.createElement('div');
  head.className = 'support-item-head';

  const title = document.createElement('strong');
  title.textContent = request.subject || 'Support request';

  const status = document.createElement('span');
  status.className = `status-pill ${supportStatusClass(request.status)}`;
  status.textContent = supportStatusLabel(request.status);

  head.appendChild(title);
  head.appendChild(status);

  const message = document.createElement('p');
  message.textContent = request.message || '';

  const created = document.createElement('div');
  created.className = 'source';
  created.textContent = `Created: ${formatDate(request.createdAt)} | Updated: ${formatDate(request.updatedAt)}`;

  item.appendChild(head);
  item.appendChild(message);
  item.appendChild(created);

  const attachmentNode = renderSupportAttachment(request.attachment);
  if (attachmentNode) {
    item.appendChild(attachmentNode);
  }

  if (request.adminReply) {
    const reply = document.createElement('div');
    reply.className = 'support-reply';

    const replyTitle = document.createElement('strong');
    replyTitle.textContent = 'Latest reply';

    const replyBody = document.createElement('p');
    replyBody.textContent = request.adminReply;

    const replyMeta = document.createElement('div');
    replyMeta.className = 'source';
    replyMeta.textContent = `By ${request.repliedBy || 'admin'} on ${formatDate(request.repliedAt)}`;

    reply.appendChild(replyTitle);
    reply.appendChild(replyBody);
    reply.appendChild(replyMeta);
    item.appendChild(reply);
  }

  const form = document.createElement('form');
  form.className = 'support-reply-form';
  form.dataset.requestId = request.id;

  const replyInput = document.createElement('textarea');
  replyInput.name = 'reply';
  replyInput.rows = 3;
  replyInput.placeholder = 'Write a reply (optional if you only update status)';

  const controls = document.createElement('div');
  controls.className = 'support-reply-controls';

  const statusSelect = document.createElement('select');
  statusSelect.name = 'status';
  ['open', 'answered', 'closed'].forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = supportStatusLabel(value);
    if (value === request.status) {
      option.selected = true;
    }
    statusSelect.appendChild(option);
  });

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'solid-btn';
  submit.textContent = 'Save update';

  controls.appendChild(statusSelect);
  controls.appendChild(submit);

  form.appendChild(replyInput);
  form.appendChild(controls);
  item.appendChild(form);

  return item;
}

function renderSupportRequests() {
  elements.supportList.innerHTML = '';

  const total = state.supportRequests.length;
  const open = state.supportRequests.filter((request) => request.status === 'open').length;

  if (!total) {
    elements.supportMeta.textContent = '0 open / 0 total';
    const empty = document.createElement('div');
    empty.className = 'support-item';
    empty.textContent = 'No support requests yet.';
    elements.supportList.appendChild(empty);
    return;
  }

  const groupedMap = new Map();
  state.supportRequests.forEach((request) => {
    const userKey =
      String(request.userId || '').trim() ||
      String(request.userEmail || '').trim().toLowerCase() ||
      `unknown_${String(request.id || '').trim()}`;
    if (!groupedMap.has(userKey)) {
      groupedMap.set(userKey, {
        userName: request.userName || 'User',
        userEmail: request.userEmail || 'n/a',
        requests: [],
      });
    }
    groupedMap.get(userKey).requests.push(request);
  });

  const groups = Array.from(groupedMap.values()).map((group) => {
    const requests = group.requests
      .slice()
      .sort((a, b) => requestSortMs(b) - requestSortMs(a));
    const openCount = requests.filter((entry) => entry.status === 'open').length;
    const latestMs = requests.length ? requestSortMs(requests[0]) : 0;
    return {
      ...group,
      requests,
      openCount,
      totalCount: requests.length,
      latestMs,
    };
  });

  groups.sort((a, b) => {
    const openDiff = b.openCount - a.openCount;
    if (openDiff !== 0) {
      return openDiff;
    }
    const latestDiff = b.latestMs - a.latestMs;
    if (latestDiff !== 0) {
      return latestDiff;
    }
    return String(a.userName || '').localeCompare(String(b.userName || ''), 'en', {
      sensitivity: 'base',
    });
  });

  elements.supportMeta.textContent = `${open} open / ${total} total / ${groups.length} users`;

  groups.forEach((group, index) => {
    const wrapper = document.createElement('section');
    wrapper.className = 'support-user-group';

    const accordion = document.createElement('details');
    accordion.className = 'support-user-accordion';
    if (group.openCount > 0 || index === 0) {
      accordion.open = true;
    }

    const summary = document.createElement('summary');
    summary.className = 'support-user-summary';

    const summaryMain = document.createElement('div');
    summaryMain.className = 'support-user-summary-main';

    const summaryTitle = document.createElement('strong');
    summaryTitle.textContent = group.userName || 'User';

    const summarySubtitle = document.createElement('span');
    summarySubtitle.className = 'support-user-email';
    summarySubtitle.textContent = group.userEmail || 'n/a';

    summaryMain.appendChild(summaryTitle);
    summaryMain.appendChild(summarySubtitle);

    const summaryStats = document.createElement('div');
    summaryStats.className = 'support-user-summary-stats';

    const openPill = document.createElement('span');
    openPill.className = `status-pill ${group.openCount > 0 ? 'warn' : 'good'}`;
    openPill.textContent = `${group.openCount} open`;

    const totalPill = document.createElement('span');
    totalPill.className = 'status-pill good';
    totalPill.textContent = `${group.totalCount} total`;

    summaryStats.appendChild(openPill);
    summaryStats.appendChild(totalPill);

    summary.appendChild(summaryMain);
    summary.appendChild(summaryStats);

    const body = document.createElement('div');
    body.className = 'support-user-body';

    const latest = document.createElement('div');
    latest.className = 'source support-user-latest';
    latest.textContent = `Latest update: ${formatDate(group.requests[0] && group.requests[0].updatedAt)}`;
    body.appendChild(latest);

    group.requests.forEach((request) => {
      body.appendChild(buildSupportRequestItem(request));
    });

    accordion.appendChild(summary);
    accordion.appendChild(body);
    wrapper.appendChild(accordion);
    elements.supportList.appendChild(wrapper);
  });
}

function renderNewsletters() {
  elements.newsletterList.innerHTML = '';
  const total = state.newsletters.length;
  elements.newsletterMeta.textContent = `${total} published`;

  if (!total) {
    const empty = document.createElement('div');
    empty.className = 'support-item';
    empty.textContent = 'No newsletters published yet.';
    elements.newsletterList.appendChild(empty);
    return;
  }

  state.newsletters.forEach((entry) => {
    const item = document.createElement('article');
    item.className = 'support-item';

    const head = document.createElement('div');
    head.className = 'support-item-head';

    const title = document.createElement('strong');
    title.textContent = entry.title || 'Newsletter';

    const badge = document.createElement('span');
    badge.className = 'status-pill good';
    badge.textContent = 'Published';

    head.appendChild(title);
    head.appendChild(badge);

    const body = document.createElement('p');
    body.textContent = entry.message || '';

    const meta = document.createElement('div');
    meta.className = 'source';
    const publishedAt = entry.publishedAt || entry.createdAt;
    const author = entry.authorName ? ` by ${entry.authorName}` : '';
    meta.textContent = `Published: ${formatDate(publishedAt)}${author}`;

    item.appendChild(head);
    item.appendChild(body);
    item.appendChild(meta);
    elements.newsletterList.appendChild(item);
  });
}

function couponRemainingLabel(entry) {
  if (entry.remainingRedemptions === null || entry.remainingRedemptions === undefined) {
    return 'unlimited uses';
  }
  return `${entry.remainingRedemptions} left`;
}

function renderCoupons() {
  elements.couponList.innerHTML = '';

  const total = state.coupons.length;
  const active = state.coupons.filter((entry) => entry.status === 'active').length;
  elements.couponMeta.textContent = `${active} active / ${total} total`;

  if (!total) {
    const empty = document.createElement('div');
    empty.className = 'support-item';
    empty.textContent = 'No coupon tokens yet.';
    elements.couponList.appendChild(empty);
    return;
  }

  state.coupons.forEach((entry) => {
    const item = document.createElement('article');
    item.className = 'support-item';

    const head = document.createElement('div');
    head.className = 'support-item-head';

    const title = document.createElement('strong');
    title.textContent = entry.code || 'COUPON';

    const badge = document.createElement('span');
    badge.className = `status-pill ${couponStatusClass(entry.status)}`;
    badge.textContent = couponStatusLabel(entry.status);

    head.appendChild(title);
    head.appendChild(badge);

    const details = document.createElement('p');
    const expiresPart = entry.expiresAt ? ` | expires ${formatDate(entry.expiresAt)}` : '';
    details.textContent = `+${entry.days} days | ${couponRemainingLabel(entry)}${expiresPart}`;

    const meta = document.createElement('div');
    meta.className = 'source';
    meta.textContent = `Created ${formatDate(entry.createdAt)} by ${entry.createdBy || 'admin'} | Redeemed ${entry.redemptionsCount} times`;

    item.appendChild(head);
    item.appendChild(details);
    item.appendChild(meta);

    if (entry.note) {
      const note = document.createElement('div');
      note.className = 'source';
      note.textContent = `Note: ${entry.note}`;
      item.appendChild(note);
    }

    const actions = document.createElement('div');
    actions.className = 'admin-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'mini-btn';
    toggleBtn.dataset.couponAction = 'toggle';
    toggleBtn.dataset.couponId = entry.id;
    toggleBtn.dataset.active = entry.active ? 'true' : 'false';
    toggleBtn.textContent = entry.active ? 'Disable' : 'Enable';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'mini-btn danger-btn';
    deleteBtn.dataset.couponAction = 'delete';
    deleteBtn.dataset.couponId = entry.id;
    deleteBtn.dataset.couponCode = entry.code || '';
    deleteBtn.textContent = 'Remove';

    actions.appendChild(toggleBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(actions);

    elements.couponList.appendChild(item);
  });
}

async function loadConfig() {
  try {
    const config = await api('/api/config/public');
    if (config && Number.isFinite(Number(config.licenseDays))) {
      state.config.licenseDays = Number(config.licenseDays);
    }
  } catch (error) {
    // optional
  }
}

async function ensureAdminUser() {
  let me;
  try {
    me = await api('/api/auth/me');
  } catch (error) {
    navTo(loginRedirectPath('/admin', 'admin'));
    return false;
  }

  if (!me.authenticated) {
    navTo(loginRedirectPath('/admin', 'admin'));
    return false;
  }

  if (!me.user || me.user.role !== 'admin') {
    showToast('Admin access required.');
    setTimeout(() => {
      navTo('/app');
    }, 800);
    return false;
  }

  state.user = me.user;
  elements.accountSummary.textContent = `${me.user.name} (${me.user.email})`;
  return true;
}

async function loadUsers() {
  const payload = await api('/api/admin/users');
  state.users = Array.isArray(payload.users) ? payload.users : [];
  elements.meta.textContent = `${state.users.length} users loaded`;
  renderStats();
  renderUsers();
}

async function loadSupportRequests() {
  const payload = await api('/api/admin/support/requests');
  state.supportRequests = Array.isArray(payload.requests) ? payload.requests : [];
  renderSupportRequests();
  renderStats();
}

async function loadNewsletters() {
  const payload = await api('/api/admin/newsletters');
  state.newsletters = Array.isArray(payload.newsletters) ? payload.newsletters : [];
  renderNewsletters();
  renderStats();
}

async function loadCoupons() {
  const payload = await api('/api/admin/coupons');
  state.coupons = Array.isArray(payload.coupons) ? payload.coupons : [];
  renderCoupons();
  renderStats();
}

async function handleUserAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const userId = button.dataset.userId;
  if (!action || !userId) {
    return;
  }

  if (action === 'delete-user') {
    const label =
      String(button.dataset.userEmail || '').trim() ||
      String(button.dataset.userName || '').trim() ||
      'this account';
    const confirmed = window.confirm(
      `Delete account ${label}? This action cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
  }

  button.disabled = true;
  try {
    if (action === 'extend') {
      await api(`/api/admin/users/${encodeURIComponent(userId)}/license/extend`, {
        method: 'POST',
        body: { days: state.config.licenseDays },
      });
      showToast('License extended.');
    } else if (action === 'revoke-license') {
      await api(`/api/admin/users/${encodeURIComponent(userId)}/license/revoke`, {
        method: 'POST',
      });
      showToast('License revoked.');
    } else if (action === 'revoke-session') {
      await api(`/api/admin/users/${encodeURIComponent(userId)}/session/revoke`, {
        method: 'POST',
      });
      showToast('Session revoked.');
    } else if (action === 'delete-user') {
      await api(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      showToast('Account deleted.');
    }

    if (action === 'delete-user') {
      await Promise.all([loadUsers(), loadSupportRequests(), loadCoupons()]);
    } else {
      await loadUsers();
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function handleSupportAction(event) {
  const form = event.target.closest('form.support-reply-form');
  if (!form) {
    return;
  }

  event.preventDefault();

  const requestId = form.dataset.requestId;
  if (!requestId) {
    return;
  }

  const replyField = form.querySelector('textarea[name="reply"]');
  const statusField = form.querySelector('select[name="status"]');
  const submitButton = form.querySelector('button[type="submit"]');

  const reply = replyField ? replyField.value.trim() : '';
  const status = statusField ? String(statusField.value || '').trim() : '';

  if (!reply && !status) {
    showToast('Provide a reply and/or status update.');
    return;
  }

  submitButton.disabled = true;
  try {
    await api(`/api/admin/support/requests/${encodeURIComponent(requestId)}/reply`, {
      method: 'POST',
      body: { reply, status },
    });
    showToast('Support request updated.');
    await loadSupportRequests();
  } catch (error) {
    showToast(error.message);
  } finally {
    submitButton.disabled = false;
  }
}

async function handleNewsletterSubmit(event) {
  event.preventDefault();

  const title = elements.newsletterTitle.value.trim();
  const message = elements.newsletterMessage.value.trim();

  if (title.length < 3 || title.length > 160) {
    showToast('Title must be between 3 and 160 characters.');
    return;
  }

  if (message.length < 10 || message.length > 4000) {
    showToast('Message must be between 10 and 4000 characters.');
    return;
  }

  elements.newsletterSubmitBtn.disabled = true;
  try {
    await api('/api/admin/newsletters', {
      method: 'POST',
      body: { title, message },
    });
    elements.newsletterTitle.value = '';
    elements.newsletterMessage.value = '';
    showToast('Newsletter published.');
    await loadNewsletters();
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.newsletterSubmitBtn.disabled = false;
  }
}

async function handleCouponSubmit(event) {
  event.preventDefault();

  const code = String(elements.couponCode.value || '').trim().toUpperCase();
  const days = Number.parseInt(elements.couponDays.value, 10);
  const maxRedemptions = Number.parseInt(elements.couponMaxRedemptions.value, 10);
  const expiresLocal = String(elements.couponExpiresAt.value || '').trim();
  const note = String(elements.couponNote.value || '').trim();

  if (!/^[A-Z0-9-]{4,40}$/.test(code)) {
    showToast('Code must be 4-40 chars (A-Z, 0-9, -).');
    return;
  }
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    showToast('Bonus days must be between 1 and 365.');
    return;
  }
  if (!Number.isFinite(maxRedemptions) || maxRedemptions < 0) {
    showToast('Max redemptions must be 0 or more.');
    return;
  }
  if (note.length > 160) {
    showToast('Note must be 160 chars or fewer.');
    return;
  }

  let expiresAt = null;
  if (expiresLocal) {
    const asMs = Date.parse(expiresLocal);
    if (Number.isNaN(asMs)) {
      showToast('Invalid expiration date.');
      return;
    }
    if (asMs <= Date.now()) {
      showToast('Expiration must be in the future.');
      return;
    }
    expiresAt = new Date(asMs).toISOString();
  }

  elements.couponSubmitBtn.disabled = true;
  try {
    await api('/api/admin/coupons', {
      method: 'POST',
      body: { code, days, maxRedemptions, expiresAt, note },
    });
    elements.couponCode.value = '';
    elements.couponDays.value = '14';
    elements.couponMaxRedemptions.value = '1';
    elements.couponExpiresAt.value = '';
    elements.couponNote.value = '';
    showToast('Coupon created.');
    await loadCoupons();
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.couponSubmitBtn.disabled = false;
  }
}

async function handleCouponAction(event) {
  const button = event.target.closest('button[data-coupon-action]');
  if (!button) {
    return;
  }

  const action = button.dataset.couponAction;
  const couponId = button.dataset.couponId;
  if (!couponId || (action !== 'toggle' && action !== 'delete')) {
    return;
  }

  if (action === 'delete') {
    const label = String(button.dataset.couponCode || '').trim() || couponId;
    const confirmed = window.confirm(`Remove coupon ${label} from dashboard?`);
    if (!confirmed) {
      return;
    }
  }

  button.disabled = true;
  try {
    if (action === 'toggle') {
      const currentlyActive = button.dataset.active === 'true';
      await api(`/api/admin/coupons/${encodeURIComponent(couponId)}/status`, {
        method: 'POST',
        body: { active: !currentlyActive },
      });
      showToast(!currentlyActive ? 'Coupon enabled.' : 'Coupon disabled.');
    } else {
      await api(`/api/admin/coupons/${encodeURIComponent(couponId)}`, {
        method: 'DELETE',
      });
      showToast('Coupon removed.');
    }
    await loadCoupons();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
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

async function handleRefreshDashboard() {
  try {
    await Promise.all([loadUsers(), loadNewsletters(), loadCoupons()]);
  } catch (error) {
    showToast(error.message);
  }
}

function bindEvents() {
  elements.refreshBtn.addEventListener('click', handleRefreshDashboard);
  elements.refreshSupportBtn.addEventListener('click', loadSupportRequests);
  elements.logoutBtn.addEventListener('click', handleLogout);
  elements.usersBody.addEventListener('click', handleUserAction);
  elements.supportList.addEventListener('submit', handleSupportAction);
  elements.newsletterForm.addEventListener('submit', handleNewsletterSubmit);
  elements.couponForm.addEventListener('submit', handleCouponSubmit);
  elements.couponList.addEventListener('click', handleCouponAction);
}

async function bootstrap() {
  bindEvents();
  await loadConfig();
  const ok = await ensureAdminUser();
  if (!ok) {
    return;
  }
  await Promise.all([loadUsers(), loadSupportRequests(), loadNewsletters(), loadCoupons()]);
}

bootstrap();
