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
    administrator: 'admin/dashboard.html',
  };

  let supabaseClient = null;
  let loadingClient = null;
  let clientInitializingPromise = null;
  const SIGNUP_RATE_LIMIT_WINDOW_MS = 60_000;
  const signupCooldownByKey = new Map();

  function getSupabaseConfig() {
    const url = String(global.SUPABASE_URL || '').trim();
    const key = String(global.SUPABASE_ANON_KEY || '').trim();
    return { url, key };
  }

  function isAdminRole(role) {
    const normalized = String(role || '').toLowerCase();
    return ['admin', 'super_admin', 'administrator'].includes(normalized);
  }

  function getRoleDestination(role) {
    const normalized = String(role || DEFAULT_ROLE).toLowerCase();
    if (!normalized || normalized === DEFAULT_ROLE) {
      return 'dashboard.html';
    }
    if (isAdminRole(normalized)) {
      return ROLE_REDIRECTS[normalized] || 'admin/dashboard.html';
    }
    if (normalized === 'agent') {
      return ROLE_REDIRECTS.agent || 'dashboard.html';
    }
    return 'dashboard.html';
  }

  function isSafeRedirectTarget(target) {
    const rawValue = String(target || '').trim();
    if (!rawValue) {
      return false;
    }

    const normalizedValue = rawValue
      .replace(/^file:\/\//i, '')
      .replace(/^https?:\/\/[^/]+/i, '')
      .replace(/^\/+/, '');

    if (!normalizedValue || normalizedValue === 'login-register/login.html' || normalizedValue === 'login.html') {
      return false;
    }

    if (normalizedValue === 'dashboard2.html' || normalizedValue === '/dashboard2.html' || normalizedValue.includes('/admin/') || normalizedValue === 'admin/dashboard.html' || normalizedValue === 'admin') {
      return false;
    }

    return true;
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

    if (!isSafeRedirectTarget(value)) {
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
    if (storedTarget && isSafeRedirectTarget(storedTarget)) {
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
      return 'Identifiants invalides. Vérifiez vos informations de connexion.';
    }

    if (message.includes('email') && message.includes('invalid')) {
      return 'Adresse email invalide.';
    }

    return error?.message || 'Une erreur est survenue. Veuillez réessayer.';
  }

  function isValidPhone(phone) {
    const normalized = normalizePhone(phone);
    return Boolean(normalized && /^509\d{8}$/.test(normalized));
  }

  function getSignupCooldownKey(email, phone) {
    return `${String(email || '').trim().toLowerCase()}::${String(phone || '').trim()}`;
  }

  function isSignupRateLimited(email, phone) {
    const key = getSignupCooldownKey(email, phone);
    const lastAttemptAt = signupCooldownByKey.get(key);
    if (!lastAttemptAt) {
      return false;
    }

    const now = Date.now();
    if (now - lastAttemptAt < SIGNUP_RATE_LIMIT_WINDOW_MS) {
      return true;
    }

    signupCooldownByKey.delete(key);
    return false;
  }

  function rememberSignupAttempt(email, phone) {
    const key = getSignupCooldownKey(email, phone);
    signupCooldownByKey.set(key, Date.now());
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
   */
  function generateTechnicalEmailFromPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    return `tk${digits}@gmail.com`;
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

    // If initialization is already in progress, wait for it
    if (clientInitializingPromise) {
      return clientInitializingPromise;
    }

    // Start initialization
    clientInitializingPromise = (async () => {
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
    })();

    try {
      return await clientInitializingPromise;
    } finally {
      clientInitializingPromise = null;
    }
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
      const phoneInput = String(formData.phone || '').trim();
      const password = String(formData.password || '');
      const fullName = String(formData.full_name || formData.fullName || '').trim();
      const role = String(formData.role || DEFAULT_ROLE).toLowerCase();

      if (!fullName) {
        return { ok: false, message: 'Veuillez saisir votre nom complet.', role, redirectTo: resolvePostLoginDestination(role) };
      }

      if (!phoneInput) {
        return { ok: false, message: 'Veuillez saisir votre numéro de téléphone.', role, redirectTo: resolvePostLoginDestination(role) };
      }

      if (!isValidPhone(phoneInput)) {
        return { ok: false, message: 'Veuillez saisir un numéro de téléphone valide.', role, redirectTo: resolvePostLoginDestination(role) };
      }

      if (!password) {
        return { ok: false, message: 'Veuillez saisir un mot de passe.', role, redirectTo: resolvePostLoginDestination(role) };
      }

      if (String(password).length < 6) {
        return { ok: false, message: 'Le mot de passe doit contenir au moins 6 caractères.', role, redirectTo: resolvePostLoginDestination(role) };
      }

      const normalizedPhone = normalizePhone(phoneInput);
      const client = await getSupabaseClient();
      const phoneExists = await phoneAlreadyExists(normalizedPhone, client);
      if (phoneExists) {
        return { ok: false, message: 'Ce numéro possède déjà un compte.', role, redirectTo: resolvePostLoginDestination(role) };
      }

      const authEmail = generateTechnicalEmailFromPhone(normalizedPhone);
      if (isSignupRateLimited(authEmail, normalizedPhone)) {
        return {
          ok: false,
          message: 'Trop de tentatives de création de compte. Veuillez patienter quelques minutes avant de réessayer.',
          role,
          redirectTo: resolvePostLoginDestination(role),
        };
      }

      console.log('FINAL AUTH EMAIL:', authEmail);
      const redirectUrl = resolveRedirectUrl('dashboard.html');
      const { data, error } = await client.auth.signUp({
        email: authEmail,
        password,
        options: {
          data: {
            phone: normalizedPhone,
            full_name: fullName,
            role: role || 'client',
            real_email: null,
          },
          emailRedirectTo: redirectUrl,
        },
      });

      if (error) {
        console.error('Signup error full:', error);
        const errorMessage = String(error?.message || '').toLowerCase();
        if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests') || errorMessage.includes('429')) {
          rememberSignupAttempt(authEmail, normalizedPhone);
          return {
            ok: false,
            message: 'Trop de tentatives de création de compte. Veuillez patienter quelques minutes avant de réessayer.',
            role,
            redirectTo: resolvePostLoginDestination(role),
          };
        }

        return {
          ok: false,
          message: 'Impossible de créer le compte pour le moment. Vérifiez vos informations puis réessayez.',
          role,
          redirectTo: resolvePostLoginDestination(role),
        };
      }

      const hasSession = Boolean(data.session?.user);
      const userId = data.user?.id;
      let walletMessage = null;
      if (userId && hasSession) {
        try {
          const { error: walletInsertError } = await client.from('wallets').insert({
            user_id: userId,
            balance: 0,
            currency: 'HTG',
            status: 'active',
          });

          if (walletInsertError) {
            walletMessage = 'Votre portefeuille sera activé automatiquement.';
          }
        } catch (walletError) {
          walletMessage = 'Votre portefeuille sera activé automatiquement.';
        }

        saveCurrentUser({
          id: userId,
          email: authEmail,
          role,
          full_name: fullName || data.user?.user_metadata?.full_name || null,
          phone: normalizedPhone,
        });
      } else {
        saveCurrentUser(null);
      }

      if (!hasSession) {
        return {
          ok: true,
          needsLogin: true,
          message: 'Compte créé. Connectez-vous maintenant avec votre numéro et votre mot de passe.',
          role,
          redirectTo: 'login-register/login.html',
          data,
        };
      }

      return {
        ok: true,
        message: walletMessage ? 'Compte créé avec succès. Votre portefeuille sera activé automatiquement.' : 'Compte créé avec succès.',
        role,
        redirectTo: 'dashboard.html',
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
      const phoneInput = String(formData.phone || '').trim();
      const password = String(formData.password || '');

      if (!password) {
        return { ok: false, message: 'Veuillez saisir votre mot de passe.', role: DEFAULT_ROLE };
      }

      if (!phoneInput || !isValidPhone(phoneInput)) {
        return { ok: false, message: 'Veuillez saisir un numéro de téléphone valide.', role: DEFAULT_ROLE };
      }

      const normalizedPhone = normalizePhone(phoneInput);
      const client = await getSupabaseClient();
      const technicalEmail = generateTechnicalEmailFromPhone(normalizedPhone);
      const profileEmail = await resolveEmailFromPhone(normalizedPhone, client);
      const candidateEmails = [
        profileEmail && /^tk\d+@gmail\.com$/i.test(String(profileEmail)) ? profileEmail : null,
        technicalEmail,
      ].filter(Boolean);

      let data = null;
      let error = null;
      let emailForAuth = '';

      for (const candidateEmail of candidateEmails) {
        const signInResult = await client.auth.signInWithPassword({ email: candidateEmail, password });
        if (signInResult.error) {
          console.error('LOGIN error full:', signInResult.error);
          console.log('LOGIN authEmail used:', candidateEmail);
          console.log('LOGIN normalizedPhone:', normalizedPhone);
          error = signInResult.error;
          if (String(error?.message || '').toLowerCase().includes('invalid login') || String(error?.message || '').toLowerCase().includes('user not found')) {
            continue;
          }
          break;
        }

        console.log('LOGIN authEmail used:', candidateEmail);
        console.log('LOGIN normalizedPhone:', normalizedPhone);
        data = signInResult.data;
        error = null;
        emailForAuth = candidateEmail;
        break;
      }

      if (!data || error) {
        return { ok: false, message: 'Numéro ou mot de passe incorrect.', role: DEFAULT_ROLE };
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

  async function resetPasswordForEmail(email) {
    try {
      const normalizedEmail = String(email || '').trim();
      if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return { ok: false, message: 'Veuillez saisir une adresse email valide.' };
      }

      const client = await getSupabaseClient();
      const redirectTo = resolveRedirectUrl('login-register/login.html');
      const { error } = await client.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });

      if (error) {
        return { ok: false, message: mapAuthError(error) };
      }

      return {
        ok: true,
        message: 'Si cette adresse est associée à un compte, un lien de réinitialisation a été envoyé.',
      };
    } catch (error) {
      return { ok: false, message: error?.message || 'Impossible d’envoyer la demande de réinitialisation.' };
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
      .in('type', ['deposit', 'withdrawal'])
      .order('created_at', { ascending: false })
      .limit(4);

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

  function getTransactionTypeLabel(type) {
    const normalizedType = String(type || '').toLowerCase();
    if (normalizedType === 'deposit') return 'Dépôt';
    if (normalizedType === 'withdrawal') return 'Retrait';
    return 'Transaction';
  }

  function getTransactionStatusLabel(status) {
    const normalizedStatus = String(status || '').toLowerCase();
    if (normalizedStatus === 'pending') return 'En attente';
    if (normalizedStatus === 'approved') return 'Validé';
    if (normalizedStatus === 'rejected') return 'Refusé';
    if (normalizedStatus === 'cancelled') return 'Annulé';
    if (normalizedStatus === 'completed') return 'Terminé';
    return status || 'En attente';
  }

  function getTransactionStatusClass(status) {
    const normalizedStatus = String(status || '').toLowerCase();
    if (normalizedStatus === 'approved') return 'history-badge success';
    if (normalizedStatus === 'rejected') return 'history-badge danger';
    return 'history-badge pending';
  }

  function getTransactionIcon(type) {
    const normalizedType = String(type || '').toLowerCase();
    if (normalizedType === 'deposit') return '💰';
    if (normalizedType === 'withdrawal') return '🏧';
    return '💳';
  }

  function formatShortHistoryDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (target.getTime() === today.getTime()) return 'Aujourd’hui';
    if (target.getTime() === yesterday.getTime()) return 'Hier';
    return `${String(target.getDate()).padStart(2, '0')}/${String(target.getMonth() + 1).padStart(2, '0')}`;
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
        historyEl.className = 'empty-history';
        historyEl.innerHTML = `
          <div class="empty-history-inner">
            <span class="empty-icon">
              <svg viewBox="0 0 24 24"><path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="9"/></svg>
            </span>
            <div>
              <strong>Aucune activité récente</strong>
              <p>Vos dépôts et retraits apparaîtront ici.</p>
              <a class="history-empty-cta" href="deposit.html">Faire un dépôt</a>
            </div>
          </div>
        `;
      } else {
        historyEl.className = 'history-feed';
        historyEl.innerHTML = transactions.map((item) => {
          const amount = Number(item.amount || 0);
          const typeLabel = getTransactionTypeLabel(item.type);
          const icon = getTransactionIcon(item.type);
          const statusLabel = getTransactionStatusLabel(item.status);
          const statusClass = getTransactionStatusClass(item.status);
          const signedAmount = amount >= 0 ? `+ ${Math.abs(amount).toLocaleString('fr-FR')} ${currency}` : `- ${Math.abs(amount).toLocaleString('fr-FR')} ${currency}`;
          const amountClass = amount >= 0 ? 'history-amount positive' : 'history-amount negative';
          return `
            <div class="history-item">
              <div class="history-icon">${icon}</div>
              <div class="history-main">
                <strong>${typeLabel}</strong>
                <span>${item.description || 'Mouvement de compte'}</span>
              </div>
              <div class="history-meta">
                <div class="${amountClass}">${signedAmount}</div>
                <div class="${statusClass}">${statusLabel}</div>
                <div class="history-date">${formatShortHistoryDate(item.created_at)}</div>
              </div>
            </div>
          `;
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
  global.resetPasswordForEmail = resetPasswordForEmail;
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
  global.getRoleDestination = getRoleDestination;
  global.resolveRedirectUrl = resolveRedirectUrl;
  global.getSupabaseClient = getSupabaseClient;
})(window);
