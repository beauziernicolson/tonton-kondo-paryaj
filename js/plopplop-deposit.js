(function () {
  'use strict';

  const STORAGE_KEY = 'tk-plopplop-pending-deposit-v1';
  const CREATE_FUNCTION = 'plopplop-create-payment';
  const VERIFY_FUNCTION = 'plopplop-verify-payment';
  const VALID_METHODS = new Set(['moncash', 'natcash', 'kashpaw', 'all']);
  const STATUS_MESSAGES = {
    pending: 'Paiement en attente de confirmation.',
    completed: 'Votre dépôt a été confirmé et votre portefeuille a été crédité.',
    failed: 'Une erreur est survenue. Vous pouvez vérifier à nouveau sans recommencer le paiement.',
    amount_mismatch: 'Le paiement nécessite une vérification manuelle. Aucun montant n’a été ajouté.',
    manual_review: 'Le paiement nécessite une vérification manuelle. Aucun montant n’a été ajouté.',
    cancelled: 'Ce paiement a été annulé.'
  };

  let busy = false;
  let renderingHistory = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function readPending() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
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

  function getOrCreateRequestId(amount, method) {
    const current = readPending();
    if (
      current &&
      current.request_id &&
      Number(current.amount) === Number(amount) &&
      String(current.payment_method) === method &&
      current.status !== 'completed'
    ) {
      return current.request_id;
    }

    const requestId = crypto.randomUUID();
    savePending({
      request_id: requestId,
      amount,
      payment_method: method,
      status: 'draft',
      created_at: new Date().toISOString()
    });
    return requestId;
  }

  function setFeedback(message, type) {
    const box = byId('feedback-box');
    if (!box) return;
    box.className = 'feedback';
    if (type) box.classList.add(type);
    box.textContent = message;
  }

  function setBusy(value) {
    busy = Boolean(value);
    const button = byId('submit-btn');
    if (!button) return;
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
    button.textContent = busy ? 'Connexion à PlopPlop…' : 'Continuer vers le paiement';
  }

  async function getClient() {
    if (window.supabaseClient) return window.supabaseClient;
    if (typeof window.getSupabaseClient === 'function') {
      return await window.getSupabaseClient();
    }
    throw new Error('Connexion Supabase indisponible.');
  }

  async function getSession(client) {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) {
      window.saveRedirectTarget?.('deposit.html');
      window.tryRedirectToLogin?.('login-register/login.html');
      throw new Error('Vous devez être connecté.');
    }
    return data.session;
  }

  async function functionErrorMessage(error) {
    try {
      const response = error?.context;
      if (response && typeof response.json === 'function') {
        const body = await response.clone().json();
        if (body?.error === 'Payment provider is not configured') {
          return 'Le service de paiement est temporairement indisponible.';
        }
        if (body?.error === 'request_id conflict') {
          return 'Cette tentative de paiement ne correspond plus au montant ou à la méthode sélectionnée.';
        }
        if (body?.error) return String(body.error);
      }
    } catch {
      // Use the generic message below.
    }
    return error?.message || 'Une erreur est survenue. Vous pouvez vérifier à nouveau sans recommencer le paiement.';
  }

  function injectStyles() {
    if (document.querySelector('[data-plopplop-step10a-styles]')) return;
    const style = document.createElement('style');
    style.dataset.plopplopStep10aStyles = 'true';
    style.textContent = `
      .btn[disabled] { opacity:.62; cursor:not-allowed; transform:none!important; }
      .tk-plopplop-status {
        margin-top:12px; border:1px solid rgba(255,255,255,.10); border-radius:16px;
        padding:12px; background:rgba(255,255,255,.035); display:grid; gap:10px;
      }
      .tk-plopplop-status[hidden] { display:none; }
      .tk-plopplop-status strong { color:#fff; }
      .tk-plopplop-status p { margin:0; font-size:13px; line-height:1.55; }
      .tk-plopplop-status-actions { display:flex; flex-wrap:wrap; gap:8px; }
      .tk-plopplop-status-actions .btn { min-height:42px; }
      .tk-plopplop-method-icon {
        height:96px; border-radius:12px; display:grid; place-items:center;
        background:linear-gradient(135deg,rgba(255,210,31,.14),rgba(57,168,255,.14));
        color:#fff; font-size:26px; font-weight:900; border:1px solid rgba(255,255,255,.08);
      }
      .badge.completed { background:rgba(70,227,111,.10); color:#e7fff0; border-color:rgba(70,227,111,.18); }
      .badge.failed,.badge.amount_mismatch,.badge.manual_review {
        background:rgba(255,107,107,.10); color:#fff2f2; border-color:rgba(255,107,107,.18);
      }
      .tk-plopplop-verify-mini {
        margin-top:9px; padding:8px 10px; border-radius:10px; border:1px solid rgba(255,210,31,.22);
        background:rgba(255,210,31,.08); color:#fff5c6; cursor:pointer; font-weight:800;
      }
      @media (max-width:420px) {
        .tk-plopplop-status-actions { display:grid; grid-template-columns:1fr; }
        .tk-plopplop-status-actions .btn { width:100%; }
      }
      @media (min-width:1600px) {
        .tk-plopplop-status { padding:16px; }
      }
    `;
    document.head.appendChild(style);
  }

  function configureForm() {
    const amountInput = byId('amount-input');
    if (amountInput) {
      amountInput.min = '20';
      amountInput.step = '1';
      amountInput.placeholder = 'Minimum 20 HTG';
    }

    const methodInput = byId('method-input');
    if (methodInput) {
      methodInput.innerHTML = `
        <option value="moncash">MonCash</option>
        <option value="natcash">NatCash</option>
        <option value="kashpaw">KashPaw</option>
        <option value="all">Toutes les méthodes disponibles</option>
      `;
    }

    const phoneField = byId('phone-input')?.closest('.field-card');
    const referenceField = byId('reference-input')?.closest('.field-card');
    if (phoneField) phoneField.hidden = true;
    if (referenceField) referenceField.hidden = true;

    const button = byId('submit-btn');
    if (button) button.textContent = 'Continuer vers le paiement';

    const grid = document.querySelector('.method-grid');
    if (grid && !grid.querySelector('[data-method="kashpaw"]')) {
      const kashpaw = document.createElement('div');
      kashpaw.className = 'method-card';
      kashpaw.dataset.method = 'kashpaw';
      kashpaw.innerHTML = `
        <div class="tk-plopplop-method-icon" aria-hidden="true">KP</div>
        <strong>KashPaw</strong>
        <span>Payez avec votre portefeuille KashPaw.</span>
      `;
      grid.appendChild(kashpaw);

      const all = document.createElement('div');
      all.className = 'method-card';
      all.dataset.method = 'all';
      all.innerHTML = `
        <div class="tk-plopplop-method-icon" aria-hidden="true">+</div>
        <strong>Toutes les méthodes</strong>
        <span>Laissez PlopPlop afficher les options disponibles.</span>
      `;
      grid.appendChild(all);
    }
  }

  function ensureStatusPanel() {
    let panel = document.querySelector('.tk-plopplop-status');
    if (panel) return panel;

    panel = document.createElement('section');
    panel.className = 'tk-plopplop-status';
    panel.hidden = true;
    panel.innerHTML = `
      <strong data-plopplop-status-title>Suivi du paiement</strong>
      <p data-plopplop-status-message></p>
      <div class="tk-plopplop-status-actions">
        <button class="btn btn-primary" data-plopplop-verify type="button">Vérifier le paiement</button>
        <button class="btn btn-secondary" data-plopplop-clear type="button">Nouvelle tentative</button>
      </div>
    `;

    const feedback = byId('feedback-box');
    feedback?.insertAdjacentElement('afterend', panel);

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
      setFeedback('Vous pouvez démarrer une nouvelle tentative de dépôt.', 'warn');
    });

    return panel;
  }

  function showPendingPanel(record) {
    const panel = ensureStatusPanel();
    const title = panel.querySelector('[data-plopplop-status-title]');
    const message = panel.querySelector('[data-plopplop-status-message]');
    const verifyButton = panel.querySelector('[data-plopplop-verify]');
    panel.hidden = false;
    if (title) title.textContent = record.status === 'completed' ? 'Paiement confirmé' : 'Paiement en cours';
    if (message) message.textContent = STATUS_MESSAGES[record.status] || STATUS_MESSAGES.pending;
    if (verifyButton) verifyButton.hidden = record.status === 'completed';
  }

  function formatMoney(value) {
    return `${Number(value || 0).toLocaleString(window.TKI18n?.getLocale?.() || 'fr-FR')} HTG`;
  }

  function methodLabel(value) {
    const labels = { moncash: 'MonCash', natcash: 'NatCash', kashpaw: 'KashPaw', all: 'Toutes' };
    return labels[String(value || '').toLowerCase()] || String(value || '—');
  }

  function statusLabel(value) {
    const labels = {
      pending: 'En attente',
      completed: 'Confirmé',
      failed: 'Échec',
      amount_mismatch: 'Montant à vérifier',
      manual_review: 'Révision manuelle',
      cancelled: 'Annulé'
    };
    return labels[value] || value;
  }

  async function loadHistory() {
    if (renderingHistory) return;
    renderingHistory = true;
    const list = byId('history-list');
    if (!list) {
      renderingHistory = false;
      return;
    }

    try {
      const client = await getClient();
      await getSession(client);
      const { data, error } = await client
        .from('plopplop_deposits')
        .select('id,request_id,amount,payment_method,status,provider_reference,payment_url,credited_at,created_at')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      if (!data?.length) {
        list.innerHTML = '<div class="card-item" data-provider="plopplop"><strong>Aucun dépôt PlopPlop</strong><span>Vos futurs paiements apparaîtront ici.</span></div>';
        return;
      }

      list.innerHTML = data.map((item) => `
        <article class="card-item" data-provider="plopplop">
          <strong>${new Date(item.created_at).toLocaleString(window.TKI18n?.getLocale?.() || 'fr-FR')}</strong>
          <span>${formatMoney(item.amount)} • ${methodLabel(item.payment_method)}</span>
          <span>Réf. : ${item.provider_reference || '—'}</span>
          <span style="margin-top:8px;"><span class="badge ${item.status}">${statusLabel(item.status)}</span></span>
          ${item.status === 'pending' ? `<button class="tk-plopplop-verify-mini" data-request-id="${item.request_id}" type="button">Vérifier maintenant</button>` : ''}
        </article>
      `).join('');
    } catch (error) {
      console.error('Erreur historique PlopPlop.', error);
      list.innerHTML = '<div class="card-item" data-provider="plopplop"><strong>Historique indisponible</strong><span>Rechargez la page pour réessayer.</span></div>';
    } finally {
      renderingHistory = false;
    }
  }

  async function refreshWalletHeader() {
    try {
      const wallet = await window.getAuthenticatedWallet?.();
      const element = byId('header-wallet-balance');
      if (wallet && element) {
        element.textContent = `${Number(wallet.balance || 0).toLocaleString(window.TKI18n?.getLocale?.() || 'fr-FR')} ${wallet.currency || 'HTG'}`;
      }
    } catch {
      // Non-blocking UI refresh.
    }
  }

  async function createPayment(event) {
    event?.preventDefault();
    event?.stopImmediatePropagation();

    if (busy) return;

    const amount = Number(byId('amount-input')?.value);
    const method = String(byId('method-input')?.value || '').trim().toLowerCase();

    if (!Number.isFinite(amount) || amount < 20) {
      setFeedback('Le montant minimum est de 20 HTG.', 'error');
      return;
    }
    if (!VALID_METHODS.has(method)) {
      setFeedback('Choisissez une méthode de paiement valide.', 'error');
      return;
    }

    setBusy(true);
    const requestId = getOrCreateRequestId(amount, method);

    try {
      const client = await getClient();
      await getSession(client);

      const { data, error } = await client.functions.invoke(CREATE_FUNCTION, {
        body: {
          request_id: requestId,
          amount,
          payment_method: method
        }
      });

      if (error) throw error;

      savePending({
        request_id: requestId,
        amount,
        payment_method: method,
        status: data?.status || 'pending',
        provider_reference: data?.provider_reference || null,
        payment_url: data?.payment_url || null,
        updated_at: new Date().toISOString()
      });

      if (data?.payment_url) {
        setFeedback('Redirection vers la page de paiement sécurisée…', 'success');
        showPendingPanel({ status: 'pending' });
        window.location.assign(data.payment_url);
        return;
      }

      setFeedback('Paiement en attente de confirmation.', 'warn');
      showPendingPanel({ status: 'pending' });
      await loadHistory();
    } catch (error) {
      const message = await functionErrorMessage(error);
      setFeedback(message, 'error');
      showPendingPanel({ status: 'pending' });
    } finally {
      setBusy(false);
    }
  }

  async function verifyPayment(requestId) {
    if (busy || !requestId) return;
    setBusy(true);
    setFeedback('Vérification du paiement en cours…', 'warn');

    try {
      const client = await getClient();
      await getSession(client);
      const { data, error } = await client.functions.invoke(VERIFY_FUNCTION, {
        body: { request_id: requestId }
      });
      if (error) throw error;

      const status = data?.status || 'pending';
      if (status === 'completed') {
        savePending(null);
        setFeedback(STATUS_MESSAGES.completed, 'success');
      } else {
        const current = readPending() || {};
        savePending({ ...current, request_id: requestId, status, updated_at: new Date().toISOString() });
        setFeedback(
          status === 'pending'
            ? 'Le paiement n’a pas encore été confirmé. Aucun montant n’a été ajouté.'
            : (STATUS_MESSAGES[status] || STATUS_MESSAGES.failed),
          status === 'pending' ? 'warn' : 'error'
        );
      }

      showPendingPanel({ status });
      await Promise.all([loadHistory(), refreshWalletHeader()]);
    } catch (error) {
      const message = await functionErrorMessage(error);
      setFeedback(
        message || 'Une erreur est survenue. Vous pouvez vérifier à nouveau sans recommencer le paiement.',
        'error'
      );
      showPendingPanel({ status: 'pending' });
    } finally {
      setBusy(false);
    }
  }

  function bindEvents() {
    const submit = byId('submit-btn');
    submit?.addEventListener('click', createPayment, true);

    byId('history-list')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-request-id]');
      if (!button) return;
      await verifyPayment(button.dataset.requestId);
    });
  }

  async function init() {
    injectStyles();
    configureForm();
    ensureStatusPanel();
    bindEvents();

    const params = new URLSearchParams(window.location.search);
    const pending = readPending();
    const requestId = params.get('request_id') || pending?.request_id || null;

    if (pending?.request_id) showPendingPanel(pending);

    await loadHistory();
    window.setTimeout(loadHistory, 900);
    window.setTimeout(loadHistory, 2500);

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