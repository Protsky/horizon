(function bootstrapMenu() {
  const toggle = document.querySelector('[data-menu-toggle]');
  const menu = document.querySelector('.main-menu');
  const headerActions = document.querySelector('.header-actions');
  if (!toggle || !menu) {
    return;
  }

  let actionsAnchor = null;
  if (headerActions && headerActions.parentNode) {
    actionsAnchor = document.createComment('header-actions-anchor');
    headerActions.parentNode.insertBefore(actionsAnchor, headerActions);
  }

  function syncActionsPlacement() {
    if (!headerActions) {
      return;
    }

    const mobile = window.innerWidth <= 760;
    if (mobile) {
      if (headerActions.parentNode !== menu) {
        menu.appendChild(headerActions);
      }
      return;
    }

    if (actionsAnchor && actionsAnchor.parentNode && headerActions.parentNode !== actionsAnchor.parentNode) {
      actionsAnchor.parentNode.insertBefore(headerActions, actionsAnchor);
    }
  }

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'menu-backdrop';
  backdrop.setAttribute('aria-label', 'Close menu');
  document.body.appendChild(backdrop);

  function setMenuOpen(open) {
    syncActionsPlacement();
    const shouldOpen = Boolean(open) && window.innerWidth <= 760;
    menu.classList.toggle('open', shouldOpen);
    backdrop.classList.toggle('open', shouldOpen);
    document.body.classList.toggle('menu-open', shouldOpen);
    toggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  toggle.addEventListener('click', () => {
    const open = !menu.classList.contains('open');
    setMenuOpen(open);
  });

  backdrop.addEventListener('click', closeMenu);

  menu.addEventListener('click', (event) => {
    if (window.innerWidth > 760) {
      return;
    }
    if (event.target.closest('a')) {
      closeMenu();
    }
  });

  document.addEventListener('click', (event) => {
    if (window.innerWidth > 760) {
      return;
    }
    if (menu.contains(event.target) || toggle.contains(event.target)) {
      return;
    }
    closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
    }
  });

  window.addEventListener('resize', () => {
    syncActionsPlacement();
    if (window.innerWidth > 760) {
      closeMenu();
    }
  });

  syncActionsPlacement();
})();

const BASE_PATH = window.location.pathname.startsWith('/bank') ? '/bank' : '';

(function bootstrapAuthMenu() {
  const menu = document.querySelector('.main-menu');
  if (!menu) {
    return;
  }

  function pathFor(path) {
    const raw = String(path || '');
    const normalized = raw.startsWith('/') ? raw : `/${raw}`;
    if (!BASE_PATH) {
      return normalized;
    }
    if (normalized.startsWith(`${BASE_PATH}/`) || normalized === BASE_PATH) {
      return normalized;
    }
    return `${BASE_PATH}${normalized}`;
  }

  function normalizeMenuPath(href) {
    const cleanHref = String(href || '').trim();
    if (!cleanHref || cleanHref.startsWith('http') || cleanHref.startsWith('mailto:') || cleanHref.startsWith('#')) {
      return null;
    }

    const pathOnly = cleanHref.split('#')[0].split('?')[0];
    if (!pathOnly) {
      return null;
    }

    let normalized = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
    if (BASE_PATH && normalized.startsWith(`${BASE_PATH}/`)) {
      normalized = normalized.slice(BASE_PATH.length);
    }
    return normalized;
  }

  async function requestJson(path, options = {}) {
    const response = await fetch(pathFor(path), {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      const error = new Error((payload && payload.error) || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }

    return payload;
  }

  function loginUrl(nextPath, from) {
    const params = new URLSearchParams();
    params.set('reason', 'login_required');
    params.set('next', nextPath || '/app');
    if (from) {
      params.set('from', from);
    }
    return pathFor(`/login?${params.toString()}`);
  }

  const protectedPages = {
    '/search': 'database',
    '/support': 'support',
    '/settings': 'settings',
    '/admin': 'admin',
  };

  ['openAuthBtn', 'logoutBtn', 'searchLogoutBtn', 'supportLogoutBtn', 'settingsLogoutBtn', 'adminLogoutBtn']
    .map((id) => document.getElementById(id))
    .filter(Boolean)
    .forEach((node) => node.classList.add('hidden'));

  const existingLoginLink = Array.from(menu.querySelectorAll('a.menu-link')).find((node) => {
    return normalizeMenuPath(node.getAttribute('href')) === '/login';
  });
  const menuAuthLink = existingLoginLink || document.createElement('a');
  if (!existingLoginLink) {
    menuAuthLink.className = 'menu-link';
    menu.appendChild(menuAuthLink);
  }
  menuAuthLink.id = 'menuAuthLink';

  const existingFaqLink = Array.from(menu.querySelectorAll('a.menu-link')).find((node) => {
    return normalizeMenuPath(node.getAttribute('href')) === '/faq';
  });
  const menuFaqLink = existingFaqLink || document.createElement('a');
  if (!existingFaqLink) {
    menuFaqLink.className = 'menu-link';
    const adminLink = menu.querySelector('#menuAdminLink');
    if (adminLink) {
      menu.insertBefore(menuFaqLink, adminLink);
    } else if (menuAuthLink.parentNode === menu) {
      menu.insertBefore(menuFaqLink, menuAuthLink);
    } else {
      menu.appendChild(menuFaqLink);
    }
  }
  menuFaqLink.id = 'menuFaqLink';
  menuFaqLink.href = pathFor('/faq');
  menuFaqLink.textContent = 'FAQ';

  let authState = 'unknown';
  let authPromise = null;

  function applyAuthMenuState() {
    const isLoginPage = normalizeMenuPath(window.location.pathname) === '/login';
    const isFaqPage = normalizeMenuPath(window.location.pathname) === '/faq';
    menuFaqLink.classList.toggle('active', isFaqPage);
    if (authState === 'authenticated') {
      menuAuthLink.textContent = 'Logout';
      menuAuthLink.href = pathFor('/app');
      menuAuthLink.dataset.mode = 'logout';
      menuAuthLink.classList.remove('active');
      return;
    }

    menuAuthLink.textContent = 'Login';
    menuAuthLink.href = pathFor('/login');
    menuAuthLink.dataset.mode = 'login';
    menuAuthLink.classList.toggle('active', isLoginPage);
  }

  async function resolveAuthState(force = false) {
    if (!force && authState !== 'unknown') {
      return authState;
    }
    if (authPromise) {
      return authPromise;
    }
    authPromise = requestJson('/api/auth/me')
      .then((payload) => {
        authState = payload && payload.authenticated ? 'authenticated' : 'guest';
        applyAuthMenuState();
        return authState;
      })
      .catch(() => {
        authState = 'guest';
        applyAuthMenuState();
        return authState;
      })
      .finally(() => {
        authPromise = null;
      });
    return authPromise;
  }

  menuAuthLink.addEventListener('click', async (event) => {
    if (menuAuthLink.dataset.mode !== 'logout') {
      return;
    }
    event.preventDefault();
    try {
      await requestJson('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      // ignore and continue
    }
    window.location.href = pathFor('/app');
  });

  menu.addEventListener('click', (event) => {
    const link = event.target.closest('a.menu-link');
    if (!link || link === menuAuthLink) {
      return;
    }

    const targetPath = normalizeMenuPath(link.getAttribute('href'));
    if (!targetPath || !Object.prototype.hasOwnProperty.call(protectedPages, targetPath)) {
      return;
    }

    if (authState === 'authenticated') {
      return;
    }

    event.preventDefault();
    const from = protectedPages[targetPath];

    const continueNavigation = () => {
      if (authState === 'authenticated') {
        window.location.href = pathFor(targetPath);
        return;
      }
      window.location.href = loginUrl(targetPath, from);
    };

    if (authState === 'unknown') {
      resolveAuthState(true).finally(continueNavigation);
      return;
    }

    continueNavigation();
  });

  applyAuthMenuState();
  resolveAuthState(true);
})();

(function bootstrapNotifications() {
  const siteHeader = document.querySelector('.site-header');
  const menuToggle = document.querySelector('[data-menu-toggle]');
  const headerActions = document.querySelector('.header-actions');
  if (!headerActions || !siteHeader) {
    return;
  }

  function pathFor(path) {
    const raw = String(path || '');
    const normalized = raw.startsWith('/') ? raw : `/${raw}`;
    if (!BASE_PATH) {
      return normalized;
    }
    if (normalized.startsWith(`${BASE_PATH}/`) || normalized === BASE_PATH) {
      return normalized;
    }
    return `${BASE_PATH}${normalized}`;
  }

  function formatDate(iso) {
    const parsed = Date.parse(String(iso || ''));
    if (Number.isNaN(parsed)) {
      return '';
    }
    return new Date(parsed).toLocaleString('en-US');
  }

  async function requestJson(path, options = {}) {
    const response = await fetch(pathFor(path), {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      const error = new Error((payload && payload.error) || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }

    return payload;
  }

  const shell = document.createElement('div');
  shell.className = 'notification-shell';
  shell.innerHTML = `
    <button class="notification-btn" type="button" aria-label="Open notifications" aria-expanded="false">
      <span class="notification-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="M9 18h6" />
          <path d="M12 4a4 4 0 0 0-4 4v2.3c0 .8-.3 1.6-.8 2.2L5.6 14a1 1 0 0 0 .7 1.7h11.4a1 1 0 0 0 .7-1.7l-1.6-1.5c-.5-.6-.8-1.4-.8-2.2V8a4 4 0 0 0-4-4Z" />
          <path d="M10 18a2 2 0 0 0 4 0" />
        </svg>
      </span>
      <span class="notification-label">Notifications</span>
      <span class="notification-badge hidden">0</span>
    </button>
    <aside class="notification-panel" aria-label="Notifications">
      <div class="notification-panel-head">
        <strong>Notifications</strong>
        <button class="notification-read-btn" type="button">Mark all read</button>
      </div>
      <div class="notification-list"></div>
    </aside>
  `;
  const actionsAnchor = document.createComment('notification-actions-anchor');
  const mobileAnchor = document.createComment('notification-mobile-anchor');
  headerActions.insertBefore(actionsAnchor, headerActions.firstChild);
  if (menuToggle && menuToggle.parentNode) {
    menuToggle.parentNode.insertBefore(mobileAnchor, menuToggle);
  }

  function syncNotificationPlacement() {
    const mobile = window.innerWidth <= 760;
    if (mobile && menuToggle && mobileAnchor.parentNode) {
      siteHeader.classList.add('has-mobile-bell');
      if (shell.parentNode !== mobileAnchor.parentNode) {
        mobileAnchor.parentNode.insertBefore(shell, mobileAnchor);
      }
      return;
    }

    siteHeader.classList.remove('has-mobile-bell');
    if (actionsAnchor.parentNode && shell.parentNode !== actionsAnchor.parentNode) {
      actionsAnchor.parentNode.insertBefore(shell, actionsAnchor);
    }
  }

  const button = shell.querySelector('.notification-btn');
  const badge = shell.querySelector('.notification-badge');
  const panel = shell.querySelector('.notification-panel');
  const list = shell.querySelector('.notification-list');
  const markReadButton = shell.querySelector('.notification-read-btn');

  let isAuthenticated = false;
  let pollTimer = null;

  function getNextPathForLogin() {
    const currentPath = window.location.pathname.startsWith(BASE_PATH)
      ? window.location.pathname.slice(BASE_PATH.length) || '/app'
      : window.location.pathname || '/app';
    const allowed = new Set(['/app', '/search', '/support', '/settings', '/admin']);
    return allowed.has(currentPath) ? currentPath : '/app';
  }

  function loginUrl() {
    const params = new URLSearchParams();
    params.set('reason', 'login_required');
    params.set('next', getNextPathForLogin());
    params.set('from', 'home');
    return pathFor(`/login?${params.toString()}`);
  }

  function setBadge(unreadCount) {
    const count = Number(unreadCount || 0);
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.remove('hidden');
      shell.classList.add('has-unread');
      markReadButton.disabled = false;
      return;
    }
    badge.textContent = '0';
    badge.classList.add('hidden');
    shell.classList.remove('has-unread');
    markReadButton.disabled = true;
  }

  function renderGuestNotice() {
    list.innerHTML = '';
    const guestRow = document.createElement('a');
    guestRow.className = 'notification-item';
    guestRow.href = loginUrl();

    const head = document.createElement('div');
    head.className = 'notification-item-head';
    const type = document.createElement('span');
    type.className = 'status-pill warn';
    type.textContent = 'Login';
    head.appendChild(type);

    const title = document.createElement('strong');
    title.textContent = 'Sign in to see notifications';

    const body = document.createElement('p');
    body.textContent = 'Support, security, billing, and news updates will appear here.';

    guestRow.appendChild(head);
    guestRow.appendChild(title);
    guestRow.appendChild(body);
    list.appendChild(guestRow);
  }

  function normalizeNotificationScope(item) {
    const scope = String((item && item.scope) || '').trim().toLowerCase();
    if (
      scope === 'support' ||
      scope === 'news' ||
      scope === 'security' ||
      scope === 'billing' ||
      scope === 'system'
    ) {
      return scope;
    }
    const type = String((item && item.type) || '')
      .trim()
      .toLowerCase();
    if (type === 'support') {
      return 'support';
    }
    if (type === 'newsletter' || type === 'news') {
      return 'news';
    }
    if (type === 'security') {
      return 'security';
    }
    if (type === 'billing') {
      return 'billing';
    }
    return 'general';
  }

  function notificationBadgeMeta(scope) {
    if (scope === 'support') {
      return { label: 'Support', className: 'warn' };
    }
    if (scope === 'news') {
      return { label: 'News', className: 'good' };
    }
    if (scope === 'security') {
      return { label: 'Security', className: 'warn' };
    }
    if (scope === 'billing') {
      return { label: 'Billing', className: 'good' };
    }
    return { label: 'System', className: 'good' };
  }

  function renderItems(items) {
    list.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'notification-empty';
      empty.textContent = 'No new notifications.';
      list.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const scope = normalizeNotificationScope(item);
      const badgeMeta = notificationBadgeMeta(scope);
      const row = document.createElement('a');
      row.className = 'notification-item';
      row.href = pathFor(item.link || '/app');
      row.dataset.scope = scope;

      const top = document.createElement('div');
      top.className = 'notification-item-head';

      const type = document.createElement('span');
      type.className = `status-pill ${badgeMeta.className}`;
      type.textContent = badgeMeta.label;

      const date = document.createElement('small');
      date.textContent = formatDate(item.createdAt);

      top.appendChild(type);
      top.appendChild(date);

      const title = document.createElement('strong');
      title.textContent = item.title || 'Notification';

      const body = document.createElement('p');
      body.textContent = item.body || '';

      row.appendChild(top);
      row.appendChild(title);
      row.appendChild(body);
      list.appendChild(row);
    });
  }

  function closePanel() {
    shell.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
  }

  function openPanel() {
    shell.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
  }

  async function markRead(scope = 'all') {
    if (!isAuthenticated) {
      return;
    }
    try {
      const payload = await requestJson('/api/notifications/read', {
        method: 'POST',
        body: { scope },
      });
      setBadge(payload && payload.unreadCount);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        isAuthenticated = false;
        setBadge(0);
        renderGuestNotice();
      }
    }
  }

  async function loadNotifications() {
    if (!isAuthenticated) {
      setBadge(0);
      renderGuestNotice();
      return;
    }
    try {
      const payload = await requestJson('/api/notifications');
      const items = Array.isArray(payload.items) ? payload.items : [];
      renderItems(items);
      setBadge(payload.unreadCount);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        isAuthenticated = false;
        setBadge(0);
        renderGuestNotice();
      }
    }
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      loadNotifications();
    }, 60000);
  }

  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (shell.classList.contains('open')) {
      closePanel();
      return;
    }
    openPanel();
    await loadNotifications();
  });

  panel.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  list.addEventListener('click', (event) => {
    const target = event.target.closest('a.notification-item');
    if (!target) {
      return;
    }
    event.preventDefault();
    const href = target.getAttribute('href') || pathFor('/app');
    const scope = target.dataset.scope || 'all';
    closePanel();
    markRead(scope).finally(() => {
      window.location.href = href;
    });
  });

  markReadButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    await markRead('all');
    await loadNotifications();
  });

  document.addEventListener('click', (event) => {
    if (!shell.classList.contains('open')) {
      return;
    }
    if (shell.contains(event.target)) {
      return;
    }
    closePanel();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePanel();
    }
  });

  window.addEventListener('resize', () => {
    syncNotificationPlacement();
    if (window.innerWidth > 760) {
      closePanel();
    }
  });

  (async () => {
    syncNotificationPlacement();
    try {
      const payload = await requestJson('/api/auth/me');
      isAuthenticated = Boolean(payload && payload.authenticated);
      if (!isAuthenticated) {
        setBadge(0);
        renderGuestNotice();
        return;
      }
      await loadNotifications();
      startPolling();
    } catch (error) {
      isAuthenticated = false;
      setBadge(0);
      renderGuestNotice();
    }
  })();
})();

(function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  const swUrl = `${BASE_PATH}/service-worker.js`;
  const swScope = `${BASE_PATH || ''}/`;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl, { scope: swScope }).catch(() => {
      // ignore
    });
  });
})();

(function bootstrapPwaNudge() {
  const ua = String(window.navigator.userAgent || '').toLowerCase();
  const mobileUa = /iphone|ipad|ipod|android|mobile/.test(ua);
  const smallViewport = window.matchMedia('(max-width: 980px)').matches;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const isMobile = mobileUa || (coarsePointer && smallViewport);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (!isMobile || isStandalone) {
    return;
  }

  const dismissKey = 'tropobank_pwa_nudge_dismissed_session';
  const forceShow = new URLSearchParams(window.location.search).get('pwa') === '1';

  function isDismissedForSession() {
    try {
      return window.sessionStorage.getItem(dismissKey) === '1';
    } catch (error) {
      return false;
    }
  }

  if (!forceShow && isDismissedForSession()) {
    return;
  }

  const isIos = /iphone|ipad|ipod/.test(ua) && /safari/.test(ua) && !/crios|fxios|edgios|opr\//.test(ua);

  let deferredPrompt = null;
  let mode = 'fallback';
  let mounted = false;

  const panel = document.createElement('aside');
  panel.className = 'pwa-nudge';
  panel.setAttribute('aria-label', 'Install app');
  panel.innerHTML = `
    <div class="pwa-nudge-head">
      <img src="${BASE_PATH}/icon-180.png" alt="Tropobank app icon" class="pwa-nudge-icon" />
      <div>
        <strong id="pwaNudgeTitle">Install Tropobank</strong>
        <p id="pwaNudgeMessage">Open faster and study in app mode.</p>
      </div>
    </div>
    <div class="pwa-nudge-actions">
      <button type="button" class="pwa-nudge-primary" id="pwaNudgePrimary">Install app</button>
      <button type="button" class="pwa-nudge-secondary" id="pwaNudgeClose">Later</button>
    </div>
    <div class="pwa-nudge-steps" id="pwaNudgeSteps">
      <span>1) Tap Share</span>
      <span>2) Tap Add to Home Screen</span>
    </div>
  `;

  const titleEl = panel.querySelector('#pwaNudgeTitle');
  const messageEl = panel.querySelector('#pwaNudgeMessage');
  const primaryBtn = panel.querySelector('#pwaNudgePrimary');
  const closeBtn = panel.querySelector('#pwaNudgeClose');
  const stepsEl = panel.querySelector('#pwaNudgeSteps');

  function setDismissedNow() {
    try {
      window.sessionStorage.setItem(dismissKey, '1');
    } catch (error) {
      // ignore
    }
  }

  function mount() {
    if (mounted) {
      return;
    }
    document.body.appendChild(panel);
    mounted = true;
    requestAnimationFrame(() => {
      panel.classList.add('show');
    });
  }

  function hide(persist = true) {
    if (persist) {
      setDismissedNow();
    }
    panel.classList.remove('show', 'show-steps');
    setTimeout(() => {
      if (panel.parentNode) {
        panel.parentNode.removeChild(panel);
      }
      mounted = false;
    }, 220);
  }

  function updateMode(nextMode) {
    mode = nextMode;
    panel.classList.remove('show-steps');

    if (mode === 'install') {
      titleEl.textContent = 'Install Tropobank';
      messageEl.textContent = 'Faster launch, full-screen, and quick access from your home screen.';
      primaryBtn.textContent = 'Install app';
      return;
    }

    if (mode === 'ios') {
      titleEl.textContent = 'Add Tropobank to Home Screen';
      messageEl.textContent = 'On iPhone/iPad install uses Safari menu.';
      primaryBtn.textContent = 'Show steps';
      return;
    }

    titleEl.textContent = 'Install Tropobank';
    messageEl.textContent = 'If install does not open, use browser menu and choose Install app.';
    primaryBtn.textContent = 'Show steps';
  }

  async function handlePrimary() {
    if (mode === 'install' && deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const result = await deferredPrompt.userChoice;
        deferredPrompt = null;
        if (result && result.outcome === 'accepted') {
          hide(true);
          return;
        }
      } catch (error) {
        // fallback to steps
      }
    }
    panel.classList.toggle('show-steps');
  }

  primaryBtn.addEventListener('click', handlePrimary);
  closeBtn.addEventListener('click', () => hide(true));

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    updateMode('install');
    mount();
  });

  window.addEventListener('appinstalled', () => {
    hide(false);
  });

  setTimeout(() => {
    if (deferredPrompt) {
      updateMode('install');
      mount();
      return;
    }
    if (isIos) {
      updateMode('ios');
      mount();
      return;
    }
    updateMode('fallback');
    mount();
  }, 1200);

  stepsEl.addEventListener('click', (event) => {
    event.stopPropagation();
  });
})();
