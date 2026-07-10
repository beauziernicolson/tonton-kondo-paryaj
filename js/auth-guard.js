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

    const userMenuWrap = global.document?.querySelector('.user-menu-wrap');
    if (userMenuWrap) {
      userMenuWrap.hidden = true;
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
    const balance = wallet?.balance != null ? Number(wallet.balance).toLocaleString('fr-FR') : '0';
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

  async function updateAuthHeader() {
    const container = ensureAuthHeaderContainer();
    if (!container) {
      return;
    }

    setHeaderVisibility();

    try {
      if (global.getAuthenticatedProfile) {
        const authData = await global.getAuthenticatedProfile();
        const currentUser = authData?.currentUser || null;
        const wallet = authData?.wallet || null;

        if (currentUser) {
          renderLoggedInHeader(container, currentUser, wallet);
          return;
        }
      }

      if (global.getCurrentUser) {
        const storedUser = global.getCurrentUser();
        if (storedUser) {
          renderLoggedInHeader(container, storedUser, null);
          return;
        }
      }

      renderLoggedOutHeader(container);
    } catch (error) {
      console.warn('auth-guard header update failed:', error);
      renderLoggedOutHeader(container);
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
        if (global.saveRedirectTarget) {
          global.saveRedirectTarget(getNormalizedPathname().replace(/^\/+/, ''));
        }

        const target = getRelativeHref('login-register/login.html');
        global.location.replace(target);
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

  global.updateAuthHeader = updateAuthHeader;
  global.enforceAuthGuard = enforceAuthGuard;
})(window);
