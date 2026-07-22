(function () {
  'use strict';

  if (window.__TK_PLOPPLOP_DEPOSIT_LOADED__) return;
  window.__TK_PLOPPLOP_DEPOSIT_LOADED__ = true;

  const STORAGE_KEY = 'tk-plopplop-pending-deposit-v1';
  const CREATE_FUNCTION = 'swift-action';
  const VERIFY_FUNCTION = 'plopplop-verify-payment';
  const VALID_METHODS = new Set(['moncash', 'natcash', 'kashpaw', 'all']);
  const FINAL_STATUSES = new Set(['completed', 'manual_review', 'amount_mismatch', 'cancelled']);
  const STATUS_MESSAGES = {
    pending: 'Paiement en attente de confirmation. Aucun montant n’a été ajouté.',
    completed: 'Votre dépôt est confirmé et votre portefeuille a été crédité.',
    failed: 'La vérification a échoué. Vous pouvez réessayer avec la même référence.',
    amount_mismatch: 'Le montant reçu est incohérent. Le dépôt est en révision manuelle et aucun crédit n’a été effectué.',
    manual_review: 'Le paiement nécessite une révision manuelle. Aucun montant n’a été ajouté.',
    cancelled: 'Ce paiement a été annulé.'
  };

  let busy = false;
  let historyBusy = false;

  const byId = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('\"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function readPending() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  function savePending(value) {
    if (!value) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }

  function getOrCreateRequestId(amount, paymentMethod) {
    const current = readPending();
    if (
      current?.request_id &&
      Number(current.amount) === Number(amount) &&
      String(current.payment_method) === paymentMethod &&
      !FINAL_STATUSES.has(String(current.status || ''))
    ) {
      return current.request_id;
    }

    const requestId = crypto.randomUUID();
    savePending({
      request_id: requestId,
      amount,
      payment_method: paymentMethod,
      status: 'draft',
      created_at: new Date().toISOString()
    });
    return requestId;
  }

  function setFeedback(message, type = '') {
    const box = byId('feedback-box');
    if (!box) return;
    box.className = 'feedback';
    if (type) box.classList.add(type);
    box.textContent = message;
  }

  function setBusy(value, label) {
    busy = Boolean(value);
    const button = byId('submit-btn');
    if (!button) return;
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
    button.textContent = busy ? (label || 'Traitement…') : 'Continuer vers le paiement';
  }

  async function getClient() {
    if (window.supabaseClient) return window.supabaseClient;
    if (typeof window.getSupabaseClient === 'function') {
      const client = await window.getSupabaseClient();
      if (client) return client;
    }
    throw new Error('Connexion Supabase indisponible.');
  }

  async function requireSession(client) {
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session) {
      window.saveRedirectTarget?.('deposit.html');
      window.tryRedirectToLogin?.('login-register/login.html');
      throw new Error('Vous devez être connecté.');
    }
    return data.session;
  }

  async function parseFunctionError(error) {
    try {
      const response = error?.context;
      if (response && typeof response.clone === 'function') {
        const body = await response.clone().json();
        if (body?.error === 'Payment provider is not configured') {
          return 'Le service PlopPlop est verrouillé jusqu’à la validation de sa configuration.';
        }
        if (body?.error === 'Redirect origins are not configured') {
          return 'Les domaines officiels de redirection PlopPlop ne sont pas encore confirmés.';
        }
        if (body?.error === 'request_id conflict') {
          return 'Cette référence correspond à un autre montant ou à une autre méthode.';
        }
        if (body?.status === 'manual_review') return STATUS_MESSAGES.manual_review;
        if (body?.error) return String(body.error);
      }
    } catch {
      // Le message générique ci-dessous reste sûr.
    }
    return error?.message || 'Une erreur est survenue. Réessayez sans changer le montant ni la méthode.';
  }

  function validRedirectUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(String(value));
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function ensureStatusPanel() {
    let panel = document.querySelector('[data-plopplop-status-panel]');
    if (panel) return panel;

    panel = document.createElement('section');
    panel.dataset.plopplopStatusPanel = '';
    panel.className = 'field-card';
    panel.hidden = true;
    panel.innerHTML = `
      <strong data-plopplop-status-title>Suivi du paiement</strong>
      <p data-plopplop-status-message></p>
      <div class="btn-row">
        <button class="btn btn-primary" data-plopplop-verify type="button">Vérifier le paiement</button>
        <button class="btn" data-plopplop-clear type="button">Nouvelle tentative</button>
      </div>`;

    byId('feedback-box')?.insertAdjacentElement('afterend', panel);
    panel.querySelector('[data-plopplop-verify]')?.addEventListener('click', async () => {
      const pending = readPending();
      if (!pending?.request_id) {
        setFeedback('Aucun paiement en attente.', 'warn');
        return;
      }
      await verifyPayment(pending.request_id);
    });
    panel.querySelector('[data-plopplop-clear]')?.addEventListener('click', () => {
      savePending(null);
      panel.hidden = true;
      setFeedback('Vous pouvez démarrer une nouvelle tentative.', 'warn');
    });
    return panel;
  }

  function showStatus(record) {
    const panel = ensureStatusPanel();
    const status = String(record?.status || 'pending');
    panel.hidden = false;
    const title = panel.querySelector('[data-plopplop-status-title]');
    const message = panel.querySelector('[data-plopplop-status-message]');
    const verifyButton = panel.querySelector('[data-plopplop-verify]');
    if (title) title.textContent = status === 'completed' ? 'Paiement confirmé' : 'Suivi du paiement';
    if (message) message.textContent = STATUS_MESSAGES[status] || STATUS_MESSAGES.failed;
    if (verifyButton) verifyButton.hidden = status !== 'pending' && status !== 'failed';
  }

  function money(value) {
    return `${Number(value || 0).toLocaleString(window.TKI18n?.getLocale?.() || 'fr-FR')} HTG`;
  }

  function methodLabel(value) {
    return ({ moncash: 'MonCash', natcash: 'NatCash', kashpaw: 'KashPaw', all: 'Toutes' })[String(value || '').toLowerCase()] || '—';
  }

  async function loadHistory() {
    if (historyBusy) return;
    historyBusy = true;
    const list = byId('history-list');
    if (!list) {
      historyBusy = false;
      return;
    }

    try {
      const client = await getClient();
      await requireSession(client);
      const { data, error } = await client
        .from('plopplop_deposits')
        .select('id,request_id,amount,payment_method,status,provider_reference,credited_at,created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;

      if (!data?.length) {
        list.innerHTML = '<div class="card-item"><strong>Aucun dépôt PlopPlop</strong><span>Vos futurs paiements apparaîtront ici.</span></div>';
        return;
      }

      list.innerHTML = data.map((item) => `
        <article class="card-item" data-provider="plopplop">
          <strong>${escapeHtml(new Date(item.created_at).toLocaleString(window.TKI18n?.getLocale?.() || 'fr-FR'))}</strong>
          <span>${escapeHtml(money(item.amount))} • ${escapeHtml(methodLabel(item.payment_method))}</span>
          <span>Réf. : ${escapeHtml(item.provider_reference || '—')}</span>
          <span>Statut : ${escapeHtml(String(item.status || 'pending'))}</span>
          ${item.status === 'pending' ? `<button class="btn" data-request-id="${escapeHtml(item.request_id)}" type="button">Vérifier maintenant</button>` : ''}
        </article>`).join('');
    } catch (error) {
      console.error('Erreur historique PlopPlop.', error);
      list.innerHTML = '<div class="card-item"><strong>Historique indisponible</strong><span>Rechargez la page pour réessayer.</span></div>';
    } finally {
      historyBusy = false;
    }
  }

  async function refreshWallet() {
    try {
      const wallet = await window.getAuthenticatedWallet?.();
      const target = byId('header-wallet-balance');
      if (wallet && target) {
        target.textContent = `${Number(wallet.balance || 0).toLocaleString(window.TKI18n?.getLocale?.() || 'fr-FR')} ${wallet.currency || 'HTG'}`;
      }
    } catch {
      // L’actualisation visuelle n’affecte pas le paiement.
    }
  }

  async function createPayment(event) {
    event?.preventDefault();
    if (busy) return;

    const amount = Number(byId('amount-input')?.value);
    const paymentMethod = String(byId('method-input')?.value || '').trim().toLowerCase();
    if (!Number.isFinite(amount) || amount < 20 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) {
      setFeedback('Le montant minimum est de 20 HTG.', 'error');
      return;
    }
    if (!VALID_METHODS.has(paymentMethod)) {
      setFeedback('Choisissez une méthode PlopPlop valide.', 'error');
      return;
    }

    setBusy(true, 'Connexion à PlopPlop…');
    const requestId = getOrCreateRequestId(amount, paymentMethod);

    try {
      const client = await getClient();
      await requireSession(client);
      const { data, error } = await client.functions.invoke(CREATE_FUNCTION, {
        body: { request_id: requestId, amount, payment_method: paymentMethod }
      });
      if (error) throw error;

      const status = String(data?.status || 'pending');
      const redirect = validRedirectUrl(data?.payment_url);
      savePending({
        request_id: requestId,
        amount,
        payment_method: paymentMethod,
        status,
        provider_reference: data?.provider_reference || null,
        payment_url: redirect,
        updated_at: new Date().toISOString()
      });
      showStatus({ status });
      await loadHistory();

      if (data?.payment_url && !redirect) {
        throw new Error('L’URL de paiement retournée est invalide.');
      }
      if (redirect) {
        setFeedback('Redirection vers la page de paiement sécurisée…', 'success');
        window.location.assign(redirect);
        return;
      }
      setFeedback(STATUS_MESSAGES[status] || STATUS_MESSAGES.pending, status === 'pending' ? 'warn' : 'error');
    } catch (error) {
      const message = await parseFunctionError(error);
      setFeedback(message, 'error');
      showStatus({ status: 'failed' });
    } finally {
      setBusy(false);
    }
  }

  async function verifyPayment(requestId) {
    if (busy || !requestId) return;
    setBusy(true, 'Vérification…');
    setFeedback('Vérification du paiement en cours…', 'warn');

    try {
      const client = await getClient();
      await requireSession(client);
      const { data, error } = await client.functions.invoke(VERIFY_FUNCTION, {
        body: { request_id: requestId }
      });
      if (error) throw error;

      const status = String(data?.status || 'pending');
      const current = readPending() || {};
      if (status === 'completed') savePending(null);
      else savePending({ ...current, request_id: requestId, status, updated_at: new Date().toISOString() });

      setFeedback(STATUS_MESSAGES[status] || STATUS_MESSAGES.failed, status === 'completed' ? 'success' : (status === 'pending' ? 'warn' : 'error'));
      showStatus({ status });
      await Promise.all([loadHistory(), refreshWallet()]);
    } catch (error) {
      const message = await parseFunctionError(error);
      setFeedback(message, 'error');
      showStatus({ status: 'failed' });
    } finally {
      setBusy(false);
    }
  }

  async function init() {
    ensureStatusPanel();
    byId('plopplop-deposit-form')?.addEventListener('submit', createPayment);
    byId('history-list')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-request-id]');
      if (button) await verifyPayment(button.dataset.requestId);
    });

    const pending = readPending();
    if (pending?.request_id) showStatus(pending);
    await Promise.all([loadHistory(), refreshWallet()]);

    const params = new URLSearchParams(window.location.search);
    const requestId = params.get('request_id') || pending?.request_id || null;
    if (requestId && (params.get('verify') === '1' || params.get('payment_return') === '1')) {
      await verifyPayment(requestId);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
