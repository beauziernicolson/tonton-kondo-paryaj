(function (global) {
  const PUBLIC_PAGES = [
    'index.html',
    'login-register/login.html',
    'login-register/login.html',
    'login-register/forgot-password.html',
  ];

  function getNormalizedPathname() {
    return String(global.location?.pathname || '').replace(/\\/g, '/');
  }

  function getPageName() {
    const pathname = getNormalizedPathname();
    const segments = pathname.split('/').filter(Boolean);
    return segments.length ? segments[segments.length - 1] : 'index.html';
  }

  function isPublicPage() {
    const pathname = getNormalizedPathname();
    if (!pathname || pathname === '/' || pathname.endsWith('/')) {
      return true;
    }

    const normalized = pathname.replace(/^\/+/, '');
    if (PUBLIC_PAGES.includes(normalized)) {
      return true;
    }

    if (normalized.includes('login-register/')) {
      return true;
    }

    return false;
  }

  function isProtectedPage() {
    if (isPublicPage()) {
      return false;
    }

    const pathname = getNormalizedPathname();
    if (!pathname || pathname === '/') {
      return false;
    }

    return pathname.includes('/jeux/') || pathname.includes('/admin/') || pathname.includes('/agent/') || pathname.includes('/login-register/') === false;
  }

  function getRelativeHref(target) {
    const pathname = getNormalizedPathname();
    const segments = pathname.split('/').filter(Boolean);
    const isNestedPage = segments.length > 1 && !segments[segments.length - 1].includes('.html');
    const depth = isNestedPage ? segments.length - 1 : Math.max(segments.length - 1, 0);
    const prefix = depth > 0 ? '../'.repeat(depth) : '';
    return `${prefix}${target}`;
  }

  let TEMPORARY_AUTH_REDIRECTS_DISABLED = true;

  function tryRedirectToLogin(target) {
    if (TEMPORARY_AUTH_REDIRECTS_DISABLED) {
      console.warn('Authentification temporaire désactivée : redirection vers', target, 'supprimée.');
      return;
    }

    if (global.saveRedirectTarget) {
      global.saveRedirectTarget(getNormalizedPathname().replace(/^\/+/, ''));
    }

    const loginHref = getRelativeHref(target || 'login-register/login.html');
    global.location.replace(loginHref);
  }

  function ensureAuthHeaderContainer() {
    let container = global.document?.getElementById('authHeaderActions');
    if (container) {
      return container;
    }

    const headerActions = global.document?.querySelector('.header-actions');
    if (!headerActions) {
      return null;
    }

    container = global.document.createElement('div');
    container.id = 'authHeaderActions';
    container.className = 'auth-header-actions';
    headerActions.appendChild(container);
    return container;
  }

  function setHeaderVisibility() {
    const walletChip = global.document?.querySelector('.wallet-chip');
    if (walletChip) {
      walletChip.style.display = 'none';
    }
  }

  function ensureNotificationsBadgeStyle() {
    if (!global.document || !global.document.head) {
      return;
    }

    if (global.document.getElementById('tonton-notifications-badge-style')) {
      return;
    }

    const style = global.document.createElement('style');
    style.id = 'tonton-notifications-badge-style';
    style.textContent = '.notifications-badge[hidden] { display: none !important; }';
    global.document.head.appendChild(style);
  }

  async function updateNotificationsBadges() {
    ensureNotificationsBadgeStyle();
    const badges = Array.from(global.document?.querySelectorAll('.notifications-badge') || []);
    if (!badges.length) {
      return;
    }

    badges.forEach((badge) => {
      badge.textContent = '';
      badge.hidden = true;
    });

    try {
      const client = global.getSupabaseClient ? await global.getSupabaseClient() : null;
      if (!client) {
        return;
      }

      const currentUser = global.getCurrentUserAsync ? await global.getCurrentUserAsync() : null;
      if (!currentUser) {
        return;
      }

      const { data, error } = await client.rpc('count_unread_notifications');
      if (error) {
        throw error;
      }

      const normalizedCount = Number.parseInt(Number(data || 0), 10);
      const safeCount = Number.isFinite(normalizedCount) ? Math.max(0, normalizedCount) : 0;

      if (safeCount <= 0) {
        return;
      }

      const displayValue = safeCount > 99 ? '99+' : String(safeCount);
      badges.forEach((badge) => {
        badge.textContent = displayValue;
        badge.hidden = false;
      });
    } catch (error) {
      console.warn('notifications badge update failed:', error);
      badges.forEach((badge) => {
        badge.textContent = '';
        badge.hidden = true;
      });
    }
  }

  function showUserInitialsInMenu(user) {
    const userAvatar = global.document?.getElementById('userAvatar');
    if (!userAvatar) {
      return null;
    }

    const displayName = user?.full_name || user?.email || 'Utilisateur';
    const firstLetter = String(displayName).trim().charAt(0).toUpperCase();
    userAvatar.innerHTML = '';

    const avatarUrl = user?.avatar_url || user?.picture || null;
    if (avatarUrl) {
      const img = global.document.createElement('img');
      img.src = avatarUrl;
      img.alt = displayName;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      userAvatar.appendChild(img);
      return displayName;
    }

    userAvatar.textContent = firstLetter || 'U';
    return displayName;
  }

  function bindUserMenu() {
    const userMenuWrap = global.document?.getElementById('userMenuWrap');
    const userMenuButton = global.document?.getElementById('userMenuButton');
    const userMenu = global.document?.getElementById('userMenu');
    const logoutMenuBtn = global.document?.getElementById('logoutMenuBtn');

    if (!userMenuWrap || !userMenuButton || !userMenu) {
      return;
    }

    if (userMenuButton.dataset.menuBound === 'true') {
      return;
    }

    userMenuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = userMenu.classList.toggle('open');
      userMenuButton.setAttribute('aria-expanded', String(Boolean(isOpen)));
      userMenu.setAttribute('aria-hidden', String(!isOpen));
    });

    global.document.addEventListener('click', (event) => {
      if (!userMenuWrap.contains(event.target)) {
        userMenu.classList.remove('open');
        userMenuButton.setAttribute('aria-expanded', 'false');
        userMenu.setAttribute('aria-hidden', 'true');
      }
    });

    logoutMenuBtn?.addEventListener('click', async () => {
      const result = await global.logoutUser?.();
      if (result?.ok) {
        global.location.reload();
      }
    });

    userMenuButton.dataset.menuBound = 'true';
  }

  async function syncUserMenuState(currentUser = null) {
    const userMenuWrap = global.document?.getElementById('userMenuWrap');
    const userAvatar = global.document?.getElementById('userAvatar');

    if (!userMenuWrap) {
      return;
    }

    userMenuWrap.hidden = false;

    const resolvedUser = currentUser || (global.getCurrentUserAsync ? await global.getCurrentUserAsync() : global.getCurrentUser?.());
    if (resolvedUser) {
      showUserInitialsInMenu(resolvedUser);
      return;
    }

    if (userAvatar) {
      userAvatar.textContent = 'U';
    }
  }

  function renderLoggedOutHeader(container) {
    if (!container) return;

    container.innerHTML = `
      <a class="header-auth-btn btn" href="${getRelativeHref('login-register/login.html')}">Connexion</a>
      <a class="header-auth-btn btn" href="${getRelativeHref('login-register/login.html')}">Créer un compte</a>
    `;
    container.style.display = 'flex';
    container.style.gap = '8px';
    container.style.alignItems = 'center';
    container.style.flexWrap = 'wrap';
  }

  function renderLoggedInHeader(container, currentUser, wallet) {
    if (!container) return;

    const displayName = currentUser?.full_name || currentUser?.email || 'Profil';
    const balance = wallet?.balance != null ? Number(wallet.balance).toLocaleString(window.TKI18n?.getLocale?.() || 'fr-FR') : '0';
    const currency = wallet?.currency || 'HTG';

    container.innerHTML = `
      <div class="wallet-chip" style="display:flex; margin-right:6px;">
        <span><strong>${balance} ${currency}</strong><span>Solde disponible</span></span>
      </div>
      <a class="header-auth-btn btn" href="${getRelativeHref('profile.html')}">Profil</a>
      <button class="header-auth-btn btn" type="button" data-auth-logout="true">Déconnexion</button>
    `;

    container.style.display = 'flex';
    container.style.gap = '8px';
    container.style.alignItems = 'center';
    container.style.flexWrap = 'wrap';

    const logoutButton = container.querySelector('[data-auth-logout="true"]');
    if (logoutButton && global.logoutUser) {
      logoutButton.addEventListener('click', async () => {
        await global.logoutUser();
        global.location.reload();
      });
    }
  }

  async function refreshAuthHeaderBalance() {
    const container = ensureAuthHeaderContainer();
    if (!container) {
      return null;
    }

    try {
      const authData = global.getAuthenticatedProfile ? await global.getAuthenticatedProfile() : null;
      const currentUser = authData?.currentUser || null;
      const wallet = authData?.wallet || null;

      if (currentUser) {
        renderLoggedInHeader(container, currentUser, wallet);
        await syncUserMenuState(currentUser);
        await updateNotificationsBadges();
        return wallet;
      }

      const storedUser = global.getCurrentUser ? global.getCurrentUser() : null;
      if (storedUser) {
        renderLoggedInHeader(container, storedUser, null);
        await syncUserMenuState(storedUser);
        await updateNotificationsBadges();
        return null;
      }

      renderLoggedOutHeader(container);
      await syncUserMenuState(null);
      await updateNotificationsBadges();
      return null;
    } catch (error) {
      console.warn('auth header balance refresh failed:', error);
      return null;
    }
  }

  async function updateAuthHeader() {
    const container = ensureAuthHeaderContainer();
    if (!container) {
      return;
    }

    setHeaderVisibility();
    bindUserMenu();

    try {
      if (global.getAuthenticatedProfile) {
        const authData = await global.getAuthenticatedProfile();
        const currentUser = authData?.currentUser || null;
        const wallet = authData?.wallet || null;

        if (currentUser) {
          renderLoggedInHeader(container, currentUser, wallet);
          await syncUserMenuState(currentUser);
          await updateNotificationsBadges();
          return;
        }
      }

      if (global.getCurrentUser) {
        const storedUser = global.getCurrentUser();
        if (storedUser) {
          renderLoggedInHeader(container, storedUser, null);
          await syncUserMenuState(storedUser);
          await updateNotificationsBadges();
          return;
        }
      }

      renderLoggedOutHeader(container);
      await syncUserMenuState(null);
      await updateNotificationsBadges();
    } catch (error) {
      console.warn('auth-guard header update failed:', error);
      renderLoggedOutHeader(container);
      await syncUserMenuState(null);
      await updateNotificationsBadges();
    }
  }

  async function waitForSession() {
    const firstAttempt = global.getCurrentUserAsync ? await global.getCurrentUserAsync() : null;
    if (firstAttempt) {
      return firstAttempt;
    }

    await new Promise((resolve) => global.setTimeout(resolve, 800));
    return global.getCurrentUserAsync ? await global.getCurrentUserAsync() : null;
  }

  async function enforceAuthGuard() {
    if (!global.document) {
      return;
    }

    await updateAuthHeader();

    if (!isProtectedPage()) {
      return;
    }

    try {
      const user = await waitForSession();
      if (!user) {
        // ⚠️ TEMPORAIRE : remettre avant production
        // Auth obligatoire désactivée temporairement
        /*
        if (global.saveRedirectTarget) {
          global.saveRedirectTarget(getNormalizedPathname().replace(/^\/+/, ''));
        }

        const target = getRelativeHref('login-register/login.html');
        global.location.replace(target);
        */
      }
    } catch (error) {
      console.warn('auth-guard protection failed:', error);
    }
  }

  if (global.document) {
    global.addEventListener('DOMContentLoaded', () => {
      enforceAuthGuard();
    });
  }

  global.addEventListener('notifications:changed', () => {
    updateNotificationsBadges();
  });

  global.addEventListener('tonton:wallet-updated', () => {
    refreshAuthHeaderBalance();
  });

  global.tryRedirectToLogin = tryRedirectToLogin;
  global.updateAuthHeader = updateAuthHeader;
  global.refreshAuthHeaderBalance = refreshAuthHeaderBalance;
  global.updateNotificationsBadges = updateNotificationsBadges;
  global.enforceAuthGuard = enforceAuthGuard;
})(window);
