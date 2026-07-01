/**
 * Intégration Supabase Auth – branchement réel de l’authentification.
 * Le design reste inchangé ; la logique est connectée à Supabase Auth.
 */
(function (global) {
  const DEFAULT_ROLE = 'client';
  const STORAGE_KEY = 'tonton-kondo-current-user';
  const REDIRECT_KEY = 'redirect_after_login';
  const ROLE_REDIRECTS = {
    client: 'dashboard.html',
    agent: 'agent/dashboard.html',
    admin: 'admin/dashboard.html',
    super_admin: 'admin/dashboard.html',
  };

  let supabaseClient = null;
  let loadingClient = null;

  function getSupabaseConfig() {
    const url = String(global.SUPABASE_URL || '').trim();
    const key = String(global.SUPABASE_ANON_KEY || '').trim();
    return { url, key };
  }

  function getRoleDestination(role) {
    const normalized = String(role || DEFAULT_ROLE).toLowerCase();
    return ROLE_REDIRECTS[normalized] || 'dashboard.html';
  }

  function saveRedirectTarget(target) {
    const rawValue = String(target || '').trim();
    const normalizedValue = rawValue
      .replace(/^file:\/\//i, '')
      .replace(/^https?:\/\/[^/]+/i, '')
      .replace(/^\/+/, '');

    const segments = normalizedValue.split('/').filter(Boolean);
    const nickoIndex = segments.indexOf('nicko');
    const fallbackValue = nickoIndex >= 0 ? segments.slice(nickoIndex + 1).join('/') : segments.join('/');
    const value = fallbackValue || rawValue;

    if (!value || value === 'login-register/login.html' || value === 'login.html') {
      return null;
    }

    global.localStorage.setItem(REDIRECT_KEY, value);
    return value;
  }

  function consumeRedirectTarget() {
    const value = global.localStorage.getItem(REDIRECT_KEY);
    if (value) {
      global.localStorage.removeItem(REDIRECT_KEY);
    }
    return value;
  }

  function resolvePostLoginDestination(role = DEFAULT_ROLE) {
    const storedTarget = consumeRedirectTarget();
    if (storedTarget) {
      return storedTarget;
    }

    return getRoleDestination(role);
  }

  function getSiteRootUrl() {
    try {
      const currentUrl = new URL(String(global.location?.href || ''));
      if (currentUrl.protocol === 'file:') {
        const segments = currentUrl.pathname.split('/').filter(Boolean);
        const nickoIndex = segments.lastIndexOf('nicko');
        if (nickoIndex >= 0) {
          const rootSegments = segments.slice(0, nickoIndex + 1);
          const rootPath = '/' + rootSegments.join('/');
          return `${currentUrl.protocol}//${currentUrl.host}${rootPath}/`;
        }
      }
    } catch (error) {
      // Fallback to the current origin when the browser URL cannot be parsed.
    }

    return `${global.location?.origin || ''}/`;
  }

  function resolveRedirectUrl(target) {
    const rawValue = String(target || '').trim();
    if (!rawValue) {
      return rawValue;
    }

    if (/^(https?:|file:)/i.test(rawValue)) {
      return rawValue;
    }

    const baseUrl = getSiteRootUrl();
    return new URL(rawValue.replace(/^\/+/g, ''), baseUrl).toString();
  }

  function saveCurrentUser(userData) {
    const payload = userData ? { ...userData, role: String(userData.role || DEFAULT_ROLE).toLowerCase() } : null;
    global.currentUser = payload;
    if (payload) {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } else {
      global.localStorage.removeItem(STORAGE_KEY);
    }
    return payload;
  }

  function readStoredUser() {
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function mapAuthError(error) {
    const message = String(error?.message || '').toLowerCase();

    if (message.includes('user_already_exists') || message.includes('already registered') || message.includes('already exists')) {
      return 'Cet email est déjà utilisé. Essayez une autre adresse ou connectez-vous.';
    }

    if (message.includes('password') && (message.includes('invalid') || message.includes('too short') || message.includes('at least'))) {
      return 'Le mot de passe est invalide ou trop faible. Utilisez au moins 6 caractères.';
    }

    if (message.includes('invalid login') || message.includes('invalid_grant') || message.includes('user not found') || message.includes('no user found')) {
      return 'Utilisateur introuvable ou identifiants invalides. Vérifiez votre email et votre mot de passe.';
    }

    if (message.includes('email') && message.includes('invalid')) {
      return 'Adresse email invalide.';
    }

    return error?.message || 'Une erreur est survenue. Veuillez réessayer.';
  }

  /**
   * Normalise un numéro de téléphone.
   * Accepte : 33123456, +509 33123456, 50933123456
   * Retourne : 50933123456 (format unifié)
   */
  function normalizePhone(phone) {
    const cleaned = String(phone || '').replace(/[^0-9]/g, '');
    if (!cleaned) return '';
    if (cleaned.length === 8) return `509${cleaned}`;
    return cleaned;
  }

  /**
   * Génère un email technique à partir d'un téléphone normalisé.
   * Exemple : 50933123456 → phone_50933123456@tontonkondo.local
   */
  function generateTechnicalEmailFromPhone(phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new Error('Numéro de téléphone invalide.');
    }
    return `phone_${normalized}@tontonkondo.local`;
  }

  /**
   * Résout l'email technique à partir d'un numéro de téléphone.
   * Cherche le téléphone normalisé dans la table profiles et retourne l'email associé.
   */
  async function resolveEmailFromPhone(phone, client) {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;

    const { data, error } = await client
      .from('profiles')
      .select('email')
      .eq('phone', normalized)
      .maybeSingle();

    if (error) {
      console.error('Erreur recherche téléphone:', error);
      return null;
    }

    return data?.email || null;
  }

  /**
   * Vérifie si un numéro de téléphone existe déjà dans les profils.
   */
  async function phoneAlreadyExists(phone, client) {
    const normalized = normalizePhone(phone);
    if (!normalized) return false;

    const { data, error } = await client
      .from('profiles')
      .select('id')
      .eq('phone', normalized)
      .maybeSingle();

    if (error) {
      console.error('Erreur vérification téléphone:', error);
      return false;
    }

    return !!data;
  }

  function ensureSupabaseLoaded() {
    if (global.supabase && global.supabase.createClient) {
      return Promise.resolve(global.supabase);
    }

    if (!loadingClient) {
      loadingClient = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-supabase-auth]');
        if (existing) {
          existing.addEventListener('load', () => resolve(global.supabase), { once: true });
          existing.addEventListener('error', () => reject(new Error('Impossible de charger Supabase JS.')), { once: true });
          return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        script.async = true;
        script.dataset.supabaseAuth = 'true';
        script.onload = () => resolve(global.supabase);
        script.onerror = () => reject(new Error('Impossible de charger Supabase JS.'));
        document.head.appendChild(script);
      });
    }

    return loadingClient;
  }

  async function getSupabaseClient() {
    if (supabaseClient) {
      return supabaseClient;
    }

    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
      throw new Error('Configurez les clés Supabase dans js/auth-config.js avant de poursuivre.');
    }

    const supabase = await ensureSupabaseLoaded();
    supabaseClient = supabase.createClient(url, key);
    global.supabaseClient = supabaseClient;
    return supabaseClient;
  }

  async function ensureProfileAndWallet(user, fallbackRole = DEFAULT_ROLE) {
    const client = await getSupabaseClient();
    const userId = user?.id || user?.user_metadata?.sub;

    if (!userId) {
      return { profile: null, wallet: null };
    }

    const { data: existingProfile, error: profileSelectError } = await client
      .from('profiles')
      .select('id, full_name, role, phone, status, email')
      .eq('id', userId)
      .maybeSingle();

    if (profileSelectError) {
      throw profileSelectError;
    }

    const role = String(existingProfile?.role || user?.user_metadata?.role || fallbackRole).toLowerCase();
    const profilePayload = {
      id: userId,
      full_name: existingProfile?.full_name || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || 'Utilisateur',
      phone: existingProfile?.phone || user?.user_metadata?.phone || null,
      email: existingProfile?.email || user?.email || null,
      role,
      status: existingProfile?.status || 'active',
      updated_at: new Date().toISOString(),
    };

    if (!existingProfile) {
      const { error: profileInsertError } = await client.from('profiles').insert(profilePayload);
      if (profileInsertError) {
        throw profileInsertError;
      }
    } else {
      const { error: profileUpdateError } = await client.from('profiles').update(profilePayload).eq('id', userId);
      if (profileUpdateError) {
        throw profileUpdateError;
      }
    }

    const { data: existingWallet, error: walletSelectError } = await client
      .from('wallets')
      .select('id, user_id, balance, currency, status')
      .eq('user_id', userId)
      .maybeSingle();

    if (walletSelectError) {
      throw walletSelectError;
    }

    if (!existingWallet) {
      const { error: walletInsertError } = await client.from('wallets').insert({
        user_id: userId,
        balance: 0,
        currency: 'HTG',
        status: 'active',
      });

      if (walletInsertError) {
        throw walletInsertError;
      }
    }

    const { data: finalProfile, error: finalProfileError } = await client
      .from('profiles')
      .select('id, full_name, role, phone, status, email')
      .eq('id', userId)
      .maybeSingle();

    if (finalProfileError) {
      throw finalProfileError;
    }

    return { profile: finalProfile, wallet: existingWallet || { user_id: userId, balance: 0, currency: 'HTG', status: 'active' } };
  }

  async function loginWithGoogle() {
    try {
      const client = await getSupabaseClient();
      const storedTarget = consumeRedirectTarget();
      const fallbackTarget = getRoleDestination('client');
      const redirectTo = resolveRedirectUrl(storedTarget || fallbackTarget);
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: false,
        },
      });

      if (error) {
        return { ok: false, message: mapAuthError(error) };
      }

      return { ok: true, message: 'Redirection vers Google en cours…', data };
    } catch (error) {
      return { ok: false, message: error?.message || 'Impossible d’ouvrir la connexion Google.' };
    }
  }

  async function registerUser(formData = {}) {
    try {
      const emailInput = String(formData.email || '').trim();
      const phoneInput = String(formData.phone || '').trim();
      const password = String(formData.password || '');
      const fullName = String(formData.full_name || formData.fullName || '').trim();
      const role = String(formData.role || DEFAULT_ROLE).toLowerCase();

      // Déterminer la source (téléphone ou email)
      let email, normalizedPhone, usePhoneAuth = false;

      if (phoneInput) {
        // Cas téléphone : normaliser et vérifier s'il existe déjà
        normalizedPhone = normalizePhone(phoneInput);
        if (!normalizedPhone) {
          return { ok: false, message: 'Numéro de téléphone invalide.', role, redirectTo: resolvePostLoginDestination(role) };
        }

        // Vérifier que le téléphone n'existe pas déjà
        const client = await getSupabaseClient();
        const phoneExists = await phoneAlreadyExists(normalizedPhone, client);
        if (phoneExists) {
          return { ok: false, message: 'Ce numéro de téléphone est déjà utilisé.', role, redirectTo: resolvePostLoginDestination(role) };
        }

        // Générer l'email technique
        try {
          email = generateTechnicalEmailFromPhone(normalizedPhone);
          usePhoneAuth = true;
        } catch (err) {
          return { ok: false, message: 'Numéro de téléphone invalide.', role, redirectTo: resolvePostLoginDestination(role) };
        }
      } else if (emailInput) {
        // Cas email : utiliser l'email fourni
        email = emailInput;
        usePhoneAuth = false;
      } else {
        return { ok: false, message: 'Veuillez saisir une adresse email ou un numéro de téléphone.', role, redirectTo: resolvePostLoginDestination(role) };
      }

      if (!password) {
        return { ok: false, message: 'Veuillez saisir un mot de passe.', role, redirectTo: resolvePostLoginDestination(role) };
      }

      const client = await getSupabaseClient();
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone: normalizedPhone || phoneInput || null,
            role,
          },
        },
      });

      if (error) {
        return { ok: false, message: mapAuthError(error), role, redirectTo: resolvePostLoginDestination(role) };
      }

      const userId = data.user?.id;
      if (userId) {
        const profilePayload = {
          id: userId,
          full_name: fullName || data.user?.user_metadata?.full_name || email,
          phone: normalizedPhone || data.user?.user_metadata?.phone || null,
          email: emailInput || email,
          role,
          status: 'active',
          updated_at: new Date().toISOString(),
        };

        const { error: profileError } = await client.from('profiles').upsert(profilePayload, { onConflict: 'id' });
        if (profileError) {
          return {
            ok: false,
            message: 'Compte créé, mais la création du profil a échoué : ' + profileError.message,
            role,
            redirectTo: resolvePostLoginDestination(role),
          };
        }

        const { error: walletError } = await client.from('wallets').insert({
          user_id: userId,
          balance: 0,
          currency: 'HTG',
          status: 'active',
        });

        if (walletError) {
          return {
            ok: false,
            message: 'Compte créé, mais la création du wallet a échoué : ' + walletError.message,
            role,
            redirectTo: resolvePostLoginDestination(role),
          };
        }

        saveCurrentUser({
          id: userId,
          email: emailInput || email,
          role,
          full_name: profilePayload.full_name,
          phone: profilePayload.phone,
        });
      }

      return {
        ok: true,
        message: 'Compte créé avec succès.',
        role,
        redirectTo: resolvePostLoginDestination(role),
        data,
      };
    } catch (error) {
      return {
        ok: false,
        message: error?.message || 'Impossible d’initialiser Supabase Auth.',
        role: formData.role || DEFAULT_ROLE,
        redirectTo: resolvePostLoginDestination(formData.role || DEFAULT_ROLE),
      };
    }
  }

  async function loginUser(formData = {}) {
    try {
      const emailInput = String(formData.email || '').trim();
      const phoneInput = String(formData.phone || '').trim();
      const password = String(formData.password || '');

      // Déterminer la source et résoudre l'email pour Supabase Auth
      let emailForAuth = emailInput;
      if (phoneInput) {
        // Cas téléphone : normaliser et chercher l'email technique
        const normalizedPhone = normalizePhone(phoneInput);
        if (!normalizedPhone) {
          return { ok: false, message: 'Numéro de téléphone invalide.', role: DEFAULT_ROLE };
        }

        const client = await getSupabaseClient();
        emailForAuth = await resolveEmailFromPhone(normalizedPhone, client);
        if (!emailForAuth) {
          return { ok: false, message: 'Téléphone non enregistré.', role: DEFAULT_ROLE };
        }
      } else if (!emailInput) {
        return { ok: false, message: 'Veuillez saisir votre email ou votre téléphone.', role: DEFAULT_ROLE };
      }

      if (!password) {
        return { ok: false, message: 'Veuillez saisir votre mot de passe.', role: DEFAULT_ROLE };
      }

      const client = await getSupabaseClient();
      const { data, error } = await client.auth.signInWithPassword({ email: emailForAuth, password });

      if (error) {
        // Améliorer le message d'erreur pour le contexte téléphone
        let errorMsg = mapAuthError(error);
        if (phoneInput && errorMsg.includes('email')) {
          errorMsg = 'Téléphone ou mot de passe incorrect.';
        }
        return { ok: false, message: errorMsg, role: DEFAULT_ROLE };
      }

      const user = data.user;
      const session = data.session;
      const ensured = await ensureProfileAndWallet(user, 'client');
      const profileData = ensured.profile;
      const role = String(profileData?.role || 'client').toLowerCase();
      const redirectTo = resolvePostLoginDestination(role);
      const currentUser = {
        id: user?.id || null,
        email: profileData?.email || user?.email || emailForAuth,
        role,
        full_name: profileData?.full_name || user?.user_metadata?.full_name || emailForAuth,
        phone: profileData?.phone || user?.user_metadata?.phone || null,
      };

      saveCurrentUser(currentUser);

      return {
        ok: true,
        message: 'Connexion réussie.',
        role,
        redirectTo,
        data: {
          user,
          session,
          profile: profileData,
        },
      };
    } catch (error) {
      return {
        ok: false,
        message: error?.message || 'Impossible d’initialiser Supabase Auth.',
        role: DEFAULT_ROLE,
        redirectTo: resolvePostLoginDestination(DEFAULT_ROLE),
      };
    }
  }

  async function logoutUser() {
    try {
      const client = await getSupabaseClient();
      const { error } = await client.auth.signOut();
      if (error) {
        return { ok: false, message: mapAuthError(error) };
      }
      saveCurrentUser(null);
      return { ok: true, message: 'Déconnexion réussie.' };
    } catch (error) {
      return { ok: false, message: error?.message || 'Impossible de déconnecter l’utilisateur.' };
    }
  }

  async function getCurrentUserAsync() {
    const client = global.supabaseClient || (await getSupabaseClient());
    const { data, error } = await client.auth.getSession();

    if (error || !data.session?.user) {
      saveCurrentUser(null);
      return null;
    }

    const user = data.session.user;
    const ensured = await ensureProfileAndWallet(user, 'client');
    const profileData = ensured.profile;

    if (!profileData) {
      saveCurrentUser(null);
      return null;
    }

    const currentUser = {
      id: user.id,
      email: profileData.email || user.email,
      role: String(profileData.role || 'client').toLowerCase(),
      full_name: profileData.full_name || user.user_metadata?.full_name || user.email,
      phone: profileData.phone || user.user_metadata?.phone || null,
    };

    saveCurrentUser(currentUser);
    return currentUser;
  }

  async function getAuthenticatedProfile() {
    const client = global.supabaseClient || (await getSupabaseClient());
    const { data: sessionData, error: sessionError } = await client.auth.getSession();

    if (sessionError || !sessionData.session?.user) {
      saveCurrentUser(null);
      return null;
    }

    const user = sessionData.session.user;
    const ensured = await ensureProfileAndWallet(user, 'client');
    const profile = ensured.profile;
    const wallet = ensured.wallet;

    return {
      session: sessionData.session,
      user,
      profile,
      wallet,
      currentUser: {
        id: user.id,
        email: profile?.email || user.email,
        role: String(profile?.role || 'client').toLowerCase(),
        full_name: profile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email,
        phone: profile?.phone || user.user_metadata?.phone || null,
        provider: user.app_metadata?.provider || user.user_metadata?.provider || 'email',
        created_at: user.created_at || null,
        avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
      },
    };
  }

  async function getAuthenticatedWallet() {
    const data = await getAuthenticatedProfile();
    return data ? data.wallet : null;
  }

  async function getAuthenticatedDashboardData() {
    const client = global.supabaseClient || (await getSupabaseClient());
    const { data: sessionData, error: sessionError } = await client.auth.getSession();

    if (sessionError || !sessionData.session?.user) {
      saveCurrentUser(null);
      return null;
    }

    const user = sessionData.session.user;
    const ensured = await ensureProfileAndWallet(user, 'client');
    const profile = ensured.profile;
    const wallet = ensured.wallet;

    const { data: transactionsData, error: transactionsError } = await client
      .from('transactions')
      .select('id, type, amount, status, created_at, description')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);

    if (transactionsError) {
      throw transactionsError;
    }

    const role = String(profile?.role || user.user_metadata?.role || 'client').toLowerCase();

    return {
      session: sessionData.session,
      user,
      profile,
      wallet,
      transactions: transactionsData || [],
      currentUser: {
        id: user.id,
        email: profile?.email || user.email,
        role,
        full_name: profile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email,
        phone: profile?.phone || user.user_metadata?.phone || null,
        provider: user.app_metadata?.provider || user.user_metadata?.provider || 'email',
        avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
        created_at: user.created_at || null,
      },
    };
  }

  function renderDashboardPage(data) {
    if (!data || !global.document) return null;

    const documentRef = global.document;
    const user = data.user || {};
    const profile = data.profile || {};
    const wallet = data.wallet || {};
    const currentUser = data.currentUser || {};
    const transactions = Array.isArray(data.transactions) ? data.transactions : [];

    const displayName = profile.full_name || currentUser.full_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Joueur';
    const balance = Number(wallet.balance || 0);
    const currency = wallet.currency || 'HTG';
    const statusLabel = String(profile.status || 'active').toLowerCase() === 'active' ? 'Actif' : (profile.status || 'Actif');
    const avatarUrl = currentUser.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || null;

    const greetingEl = documentRef.querySelector('[data-dashboard-greeting]');
    if (greetingEl) greetingEl.textContent = displayName;

    const nameEl = documentRef.querySelector('[data-dashboard-name]');
    if (nameEl) nameEl.textContent = displayName;

    const emailEl = documentRef.querySelector('[data-dashboard-email]');
    if (emailEl) emailEl.textContent = profile.email || currentUser.email || user.email || '—';

    const roleEl = documentRef.querySelector('[data-dashboard-role]');
    if (roleEl) roleEl.textContent = String(profile.role || currentUser.role || 'client');

    const statusEl = documentRef.querySelector('[data-dashboard-status]');
    if (statusEl) statusEl.textContent = statusLabel;

    const statusChipEl = documentRef.querySelector('[data-dashboard-status-chip]');
    if (statusChipEl) statusChipEl.textContent = statusLabel;

    const balanceEl = documentRef.querySelector('[data-dashboard-balance]');
    if (balanceEl) balanceEl.textContent = `${balance.toLocaleString('fr-FR')} ${currency}`;

    const currencyEl = documentRef.querySelector('[data-dashboard-currency]');
    if (currencyEl) currencyEl.textContent = currency;

    const avatarEl = documentRef.querySelector('[data-dashboard-avatar]');
    if (avatarEl) {
      if (avatarUrl) {
        avatarEl.src = avatarUrl;
        avatarEl.alt = displayName;
      } else {
        avatarEl.textContent = String(displayName).trim().charAt(0).toUpperCase() || 'U';
        avatarEl.style.background = 'linear-gradient(135deg, rgba(255,210,31,.18), rgba(57,168,255,.18))';
        avatarEl.style.display = 'grid';
        avatarEl.style.placeItems = 'center';
      }
    }

    const balanceCardEl = documentRef.querySelector('[data-dashboard-balance-card]');
    if (balanceCardEl) balanceCardEl.textContent = `${balance.toLocaleString('fr-FR')} ${currency}`;

    const ticketsEl = documentRef.querySelector('[data-dashboard-tickets]');
    if (ticketsEl) ticketsEl.textContent = '0';

    const gainsEl = documentRef.querySelector('[data-dashboard-gains]');
    if (gainsEl) gainsEl.textContent = '0';

    const historyEl = documentRef.querySelector('[data-dashboard-transactions]');
    if (historyEl) {
      if (transactions.length === 0) {
        historyEl.innerHTML = '<div class="history-item"><div><strong>Aucune transaction récente</strong><span>Les opérations apparaîtront ici après votre premier mouvement.</span></div><em>—</em></div>';
      } else {
        historyEl.innerHTML = transactions.map((item) => {
          const amount = Number(item.amount || 0);
          const sign = amount >= 0 ? '+' : '-';
          const label = String(item.type || 'transaction').replace(/_/g, ' ');
          const status = String(item.status || 'pending');
          return `<div class="history-item"><div><strong>${label}</strong><span>${new Date(item.created_at).toLocaleString('fr-FR')} • ${status}</span></div><em>${sign} ${Math.abs(amount).toLocaleString('fr-FR')} ${currency}</em></div>`;
        }).join('');
      }
    }

    return data;
  }

  function renderProfilePage(data) {
    if (!data || !global.document) return null;

    const documentRef = global.document;
    const user = data.user || {};
    const profile = data.profile || {};
    const wallet = data.wallet || {};
    const currentUser = data.currentUser || {};

    const fullName = String(profile.full_name || currentUser.full_name || user.user_metadata?.full_name || user.user_metadata?.name || '').trim();
    const displayName = fullName || user.email || 'Utilisateur';
    const firstName = fullName ? fullName.split(' ')[0] : 'Utilisateur';
    const lastName = fullName ? fullName.replace(firstName, '').trim() : 'Compte';
    const avatarUrl = currentUser.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || null;

    const nameEl = documentRef.querySelector('[data-profile-name]');
    if (nameEl) nameEl.textContent = displayName;

    const nameFullEl = documentRef.querySelector('[data-profile-name-full]');
    if (nameFullEl) nameFullEl.textContent = fullName || 'Non renseigné';

    const roleTagEl = documentRef.querySelector('[data-profile-role-tag]');
    if (roleTagEl) roleTagEl.textContent = String(profile.role || currentUser.role || 'client').toUpperCase();

    const emailEl = documentRef.querySelector('[data-profile-email]');
    if (emailEl) emailEl.textContent = profile.email || currentUser.email || user.email || '—';

    const phoneEl = documentRef.querySelector('[data-profile-phone]');
    if (phoneEl) phoneEl.textContent = profile.phone || currentUser.phone || 'Non renseigné';

    const roleEl = documentRef.querySelector('[data-profile-role]');
    if (roleEl) roleEl.textContent = String(profile.role || currentUser.role || 'client');

    const statusEl = documentRef.querySelector('[data-profile-status]');
    if (statusEl) statusEl.textContent = String(profile.status || 'active');

    const providerEl = documentRef.querySelector('[data-profile-provider]');
    if (providerEl) providerEl.textContent = currentUser.provider || 'email';

    const providerSubEl = documentRef.querySelector('[data-profile-provider-sub]');
    if (providerSubEl) providerSubEl.textContent = currentUser.provider || 'email';

    const createdAtEl = documentRef.querySelector('[data-profile-created-at]');
    if (createdAtEl) {
      const createdAt = user.created_at || currentUser.created_at;
      createdAtEl.textContent = createdAt ? new Date(createdAt).toLocaleString('fr-FR') : 'Non disponible';
    }

    const balanceEl = documentRef.querySelector('[data-profile-balance]');
    if (balanceEl) balanceEl.textContent = wallet.balance != null ? `${Number(wallet.balance).toLocaleString('fr-FR')} ${wallet.currency || 'HTG'}` : '0 HTG';

    const currencyEl = documentRef.querySelector('[data-profile-currency]');
    if (currencyEl) currencyEl.textContent = wallet.currency || 'HTG';

    const walletStatusEl = documentRef.querySelector('[data-profile-wallet-status]');
    if (walletStatusEl) walletStatusEl.textContent = wallet.status || 'active';

    const avatarEl = documentRef.querySelector('[data-profile-avatar]');
    if (avatarEl) {
      if (avatarUrl) {
        avatarEl.src = avatarUrl;
        avatarEl.alt = displayName;
      } else {
        avatarEl.textContent = String(displayName).trim().charAt(0).toUpperCase() || 'U';
        avatarEl.style.background = 'linear-gradient(135deg, rgba(255,210,31,.18), rgba(57,168,255,.18))';
        avatarEl.style.display = 'grid';
        avatarEl.style.placeItems = 'center';
      }
    }

    const initialEl = documentRef.querySelector('[data-profile-initial]');
    if (initialEl) initialEl.textContent = String(firstName).charAt(0).toUpperCase() || 'U';

    const firstNameEl = documentRef.querySelector('[data-profile-first-name]');
    if (firstNameEl) firstNameEl.textContent = firstName;

    const lastNameEl = documentRef.querySelector('[data-profile-last-name]');
    if (lastNameEl) lastNameEl.textContent = lastName;

    const accountStatusEl = documentRef.querySelector('[data-profile-account-status]');
    if (accountStatusEl) accountStatusEl.textContent = `Statut : ${String(profile.status || 'active').toLowerCase() === 'active' ? 'Actif' : profile.status || 'Actif'}`;

    return data;
  }

  function getCurrentUser() {
    return readStoredUser() || global.currentUser || null;
  }

  function checkUserRole(role) {
    const currentUser = getCurrentUser();
    if (!currentUser) return false;
    return String(currentUser.role || DEFAULT_ROLE).toLowerCase() === String(role || '').toLowerCase();
  }

  global.registerUser = registerUser;
  global.loginUser = loginUser;
  global.loginWithGoogle = loginWithGoogle;
  global.logoutUser = logoutUser;
  global.getCurrentUser = getCurrentUser;
  global.getCurrentUserAsync = getCurrentUserAsync;
  global.getAuthenticatedProfile = getAuthenticatedProfile;
  global.getAuthenticatedWallet = getAuthenticatedWallet;
  global.saveRedirectTarget = saveRedirectTarget;
  global.getAuthenticatedDashboardData = getAuthenticatedDashboardData;
  global.renderDashboardPage = renderDashboardPage;
  global.renderProfilePage = renderProfilePage;
  global.checkUserRole = checkUserRole;
  global.resolveRoleDestination = getRoleDestination;
  global.resolveRedirectUrl = resolveRedirectUrl;
})(window);
