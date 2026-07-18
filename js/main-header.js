(function () {
  'use strict';

  function getHeaderElements() {
    return {
      wrap: document.getElementById('userMenuWrap'),
      button: document.getElementById('userMenuButton'),
      menu: document.getElementById('userMenu'),
      avatar: document.getElementById('userAvatar'),
      logout: document.getElementById('logoutMenuBtn'),
      wallet: document.getElementById('wallet-balance'),
      guestActions: document.getElementById('mobileGuestActions')
    };
  }

  function setMenuState(open) {
    const { button, menu } = getHeaderElements();
    if (!button || !menu) return;
    menu.classList.toggle('open', open);
    menu.hidden = !open;
    menu.setAttribute('aria-hidden', String(!open));
    button.setAttribute('aria-expanded', String(open));
  }

  function formatBalance(value, currency) {
    return `${Number(value || 0).toLocaleString(window.TKI18n?.getLocale?.() || 'fr-FR')} ${currency || 'HTG'}`;
  }

  async function getCurrentUserSafe() {
    try {
      if (typeof window.getCurrentUserAsync === 'function') return await window.getCurrentUserAsync();
      if (typeof window.getCurrentUser === 'function') return window.getCurrentUser();
    } catch (error) {
      console.warn('Lecture utilisateur header impossible :', error);
    }
    return null;
  }

  function renderAvatar(user) {
    const { avatar } = getHeaderElements();
    if (!avatar) return;
    const metadata = user?.user_metadata || user?.raw_user_meta_data || {};
    const name = user?.full_name || metadata.full_name || metadata.name || user?.email || 'Utilisateur';
    const avatarUrl = user?.avatar_url || metadata.avatar_url || metadata.picture || user?.picture || '';
    avatar.innerHTML = '';
    if (avatarUrl) {
      const image = document.createElement('img');
      image.src = avatarUrl;
      image.alt = name;
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => { avatar.textContent = String(name).trim().charAt(0).toUpperCase() || 'U'; }, { once:true });
      avatar.appendChild(image);
    } else {
      avatar.textContent = String(name).trim().charAt(0).toUpperCase() || 'U';
    }
  }

  async function refreshSharedHeader() {
    const { wrap, wallet, guestActions } = getHeaderElements();
    const user = await getCurrentUserSafe();
    if (wrap) wrap.hidden = !user;
    if (guestActions) guestActions.hidden = Boolean(user);
    if (!user) {
      if (wallet) wallet.textContent = '';
      return;
    }
    renderAvatar(user);
    try {
      let walletData = null;
      if (typeof window.getAuthenticatedWallet === 'function') {
        walletData = await window.getAuthenticatedWallet();
      } else if (window.supabaseClient?.from && user.id) {
        const result = await window.supabaseClient.from('wallets').select('balance,currency').eq('user_id', user.id).single();
        if (!result.error) walletData = result.data;
      }
      if (wallet && walletData) wallet.textContent = formatBalance(walletData.balance, walletData.currency);
    } catch (error) {
      console.warn('Lecture solde header impossible :', error);
    }
  }

  async function logout() {
    try {
      if (typeof window.logoutUser === 'function') {
        const result = await window.logoutUser();
        if (result?.ok === false) return;
      } else if (window.supabaseClient?.auth?.signOut) {
        await window.supabaseClient.auth.signOut();
      }
      window.location.href = 'login-register/login.html';
    } catch (error) {
      console.error('Erreur de déconnexion :', error);
    }
  }

  // Capture phase prevents legacy page handlers from toggling the menu twice.
  document.addEventListener('click', function (event) {
    const button = event.target.closest('#userMenuButton');
    const menu = event.target.closest('#userMenu');
    const logoutButton = event.target.closest('#logoutMenuBtn');
    if (logoutButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      logout();
      return;
    }
    if (button) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const currentMenu = document.getElementById('userMenu');
      setMenuState(!currentMenu?.classList.contains('open'));
      return;
    }
    if (!menu) setMenuState(false);
  }, true);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      setMenuState(false);
      document.getElementById('userMenuButton')?.focus();
    }
  });

  async function initialize() {
    const { menu, button } = getHeaderElements();
    if (menu) { menu.hidden = true; menu.classList.remove('open'); menu.setAttribute('aria-hidden','true'); }
    if (button) button.setAttribute('aria-expanded','false');
    await refreshSharedHeader();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once:true });
  else initialize();
  window.addEventListener('pageshow', refreshSharedHeader);
  window.addEventListener('focus', refreshSharedHeader);
  window.addEventListener('auth:changed', refreshSharedHeader);
  window.addEventListener('tonton:wallet-updated', refreshSharedHeader);
  window.refreshMainHeader = refreshSharedHeader;
})();
