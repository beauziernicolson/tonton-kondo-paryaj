(function () {
  'use strict';

  if (window.__TK_PLOPPLOP_WITHDRAWAL_LOADED__) return;
  window.__TK_PLOPPLOP_WITHDRAWAL_LOADED__ = true;

  const STORAGE_KEY = 'tk-plopplop-pending-withdrawal-v1';
  const CREATE_FUNCTION = 'plopplop-create-withdrawal';
  const VERIFY_FUNCTION = 'plopplop-verify-withdrawal';
  const VALID_METHODS = new Set(['moncash', 'natcash']);
  const FINAL_STATUSES = new Set(['completed', 'refunded', 'manual_review', 'cancelled']);
  const STATUS_MESSAGES = {
    reserved: 'Les fonds sont réservés. Vous pouvez relancer la même demande sans deuxième débit.',
    processing: 'Le retrait est en cours de traitement.',
    pending: 'Le fournisseur n’a pas encore confirmé le résultat. Aucun deuxième retrait ne sera lancé.',
    completed: 'Retrait effectué avec succès.',
    failed: 'Le retrait a échoué. Vérifiez son statut avant toute nouvelle tentative.',
    refunded: 'Le transfert a échoué et le montant réservé a été remboursé une seule fois.',
    manual_review: 'Cette opération nécessite une vérification administrative. Ne recommencez pas le retrait.',
    cancelled: 'Ce retrait a été annulé.'
  };

  let busy = false;
  let historyBusy = false;
  const byId = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function normalizeRecipient(value) {
    let digits = String(value ?? '').replace(/\D/g, '');
    if (/^\d{8}$/.test(digits)) digits = `509${digits}`;
    return /^509\d{8}$/.test(digits) ? digits : null;
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

  function getOrCreateRequestId(amount, method, recipient) {
    const existing = readPending();
    if (
      existing?.request_id &&
      !FINAL_STATUSES.has(String(existing.status || '')) &&
      Number(existing.amount) === Number(amount) &&
      String(existing.method) === method &&
      String(existing.recipient) === recipient
    ) return existing.request_id;

    const requestId = crypto.randomUUID();
    savePending({ request_id: requestId, amount, method, recipient, status: 'draft', created_at: new Date().toISOString() });
    return requestId;
  }

  function setFeedback(message, type = '') {
    const box = byId('withdraw-feedback-box');
    if (!box) return;
    box.className = 'feedback';
    if (type) box.classList.add(type);
    box.textContent = message;
  }

  function setBusy(value, label) {
    busy = Boolean(value);
    const button = byId('withdraw-submit-btn');
    if (!button) return;
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
    button.textContent = busy ? (label || 'Traitement…') : 'Retirer avec PlopPlop';
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
      window.saveRedirectTarget?.('withdraw.html');
      window.tryRedirectToLogin?.('login-register/login.html');
      throw new Error('Vous devez être connecté.');
    }
    return data.session;
  }

  async function parseFunctionError(error) {
    let status = null;
    try {
      const response = error?.context;
      if (response && typeof response.clone === 'function') {
        const body = await response.clone().json();
        status = body?.status ? String(body.status) : null;
        if (body?.error === 'Withdrawal provider is not configured') return { message: 'Le service de retrait PlopPlop n’est pas encore configuré côté serveur.', status };
        if (body?.error === 'Insufficient wallet balance') return { message: 'Votre solde est insuffisant pour ce retrait.', status };
        if (body?.error === 'request_id conflict') return { message: 'Cette référence correspond à un autre montant, numéro ou moyen de paiement.', status };
        if (status && STATUS_MESSAGES[status]) return { message: STATUS_MESSAGES[status], status };
        if (body?.error) return { message: String(body.error), status };
      }
    } catch {
      // Le message générique reste sûr.
    }
    return { message: error?.message || 'Une erreur est survenue. Vérifiez le statut avant de recommencer.', status };
  }

  function ensureStatusPanel() {
    let panel = document.querySelector('[data-plopplop-withdraw-status-panel]');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.dataset.plopplopWithdrawStatusPanel = '';
    panel.className = 'field-card';
    panel.hidden = true;
    panel.innerHTML = `
      <strong data-withdraw-status-title>Suivi du retrait</strong>
      <p data-withdraw-status-message></p>
      <div class="btn-row">
        <button class="btn btn-primary" data-withdraw-verify type="button">Vérifier le retrait</button>
        <button class="btn" data-withdraw-clear type="button">Nouvelle demande</button>
      </div>`;
    byId('withdraw-feedback-box')?.insertAdjacentElement('afterend', panel);
    panel.querySelector('[data-withdraw-verify]')?.addEventListener('click', async () => {
      const pending = readPending();
      if (!pending?.request_id) return setFeedback('Aucun retrait à vérifier.', 'warn');
      await verifyWithdrawal(pending.request_id);
    });
    panel.querySelector('[data-withdraw-clear]')?.addEventListener('click', () => {
      const pending = readPending();
      if (pending?.request_id && !FINAL_STATUSES.has(String(pending.status || ''))) {
        setFeedback('Vérifiez d’abord le retrait existant pour éviter une double demande.', 'warn');
        return;
      }
      savePending(null);
      panel.hidden = true;
      setFeedback('Vous pouvez préparer une nouvelle demande.', 'warn');
    });
    return panel;
  }

  function showStatus(record) {
    const panel = ensureStatusPanel();
    const status = String(record?.status || 'pending');
    panel.hidden = false;
    const title = panel.querySelector('[data-withdraw-status-title]');
    const message = panel.querySelector('[data-withdraw-status-message]');
    const verifyButton = panel.querySelector('[data-withdraw-verify]');
    if (title) title.textContent = status === 'completed' ? 'Retrait terminé' : status === 'refunded' ? 'Retrait remboursé' : 'Suivi du retrait';
    if (message) message.textContent = STATUS_MESSAGES[status] || STATUS_MESSAGES.pending;
    if (verifyButton) verifyButton.hidden = !['pending', 'processing', 'reserved', 'failed'].includes(status);
  }

  function money(value) {
    return `${Number(value || 0).toLocaleString(window.TKI18n?.getLocale?.() || 'fr-FR')} HTG`;
  }
  function methodLabel(value) {
    return ({ moncash: 'MonCash', natcash: 'NatCash' })[String(value || '').toLowerCase()] || '—';
  }
  function maskRecipient(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 4 ? `${digits.slice(0, 3)}*****${digits.slice(-3)}` : '—';
  }

  async function loadHistory() {
    if (historyBusy) return;
    historyBusy = true;
    const list = byId('withdraw-history-list');
    if (!list) { historyBusy = false; return; }
    try {
      const client = await getClient();
      await requireSession(client);
      const { data, error } = await client
        .from('plopplop_withdrawals')
        .select('id,request_id,provider_reference,amount,fee,method,recipient,status,completed_at,refunded_at,created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      if (!data?.length) {
        list.innerHTML = '<div class="card-item"><strong>Aucun retrait PlopPlop</strong><span>Vos futures demandes apparaîtront ici.</span></div>';
        return;
      }
      list.innerHTML = data.map((item) => {
        const status = String(item.status || 'pending');
        return `
          <article class="card-item" data-provider="plopplop">
            <strong>${escapeHtml(new Date(item.created_at).toLocaleString(window.TKI18n?.getLocale?.() || 'fr-FR'))}</strong>
            <span>${escapeHtml(money(item.amount))} • ${escapeHtml(methodLabel(item.method))}</span>
            <span>Destinataire : ${escapeHtml(maskRecipient(item.recipient))}</span>
            <span>Réf. : ${escapeHtml(item.provider_reference || '—')}</span>
            <span>Statut : ${escapeHtml(status)}</span>
            ${['pending', 'processing', 'reserved', 'failed'].includes(status) ? `<button class="btn" data-withdraw-request-id="${escapeHtml(item.request_id)}" type="button">Vérifier maintenant</button>` : ''}
          </article>`;
      }).join('');
    } catch (error) {
      console.error('Erreur historique retrait PlopPlop.', error);
      list.innerHTML = '<div class="card-item"><strong>Historique indisponible</strong><span>Rechargez la page pour réessayer.</span></div>';
    } finally {
      historyBusy = false;
    }
  }

  async function refreshWallet() {
    try {
      const wallet = await window.getAuthenticatedWallet?.();
      const target = byId('header-wallet-balance');
      if (wallet && target) target.textContent = `${Number(wallet.balance || 0).toLocaleString(window.TKI18n?.getLocale?.() || 'fr-FR')} ${wallet.currency || 'HTG'}`;
    } catch {
      // L’actualisation visuelle ne modifie pas le retrait.
    }
  }

  async function createWithdrawal(event) {
    event?.preventDefault();
    if (busy) return;
    const amount = Number(byId('withdraw-amount-input')?.value);
    const method = String(byId('withdraw-method-input')?.value || '').trim().toLowerCase();
    const recipient = normalizeRecipient(byId('withdraw-recipient-input')?.value);
    if (!Number.isFinite(amount) || amount < 20 || amount > 100000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) {
      setFeedback('Le retrait doit être compris entre 20 et 100 000 HTG.', 'error');
      return;
    }
    if (!VALID_METHODS.has(method)) {
      setFeedback('Choisissez MonCash ou NatCash.', 'error');
      return;
    }
    if (!recipient) {
      setFeedback('Saisissez un numéro au format 509XXXXXXXX.', 'error');
      return;
    }

    const existing = readPending();
    if (existing?.request_id && !FINAL_STATUSES.has(String(existing.status || '')) && (
      Number(existing.amount) !== amount || String(existing.method) !== method || String(existing.recipient) !== recipient
    )) {
      setFeedback('Un autre retrait est déjà en cours. Vérifiez-le avant de changer les paramètres.', 'warn');
      showStatus(existing);
      return;
    }

    const confirmed = window.confirm(`Confirmer le retrait de ${money(amount)} vers ${methodLabel(method)} (${maskRecipient(recipient)}) ?`);
    if (!confirmed) return;

    setBusy(true, 'Traitement du retrait…');
    const requestId = getOrCreateRequestId(amount, method, recipient);
    try {
      const client = await getClient();
      await requireSession(client);
      const { data, error } = await client.functions.invoke(CREATE_FUNCTION, {
        body: { request_id: requestId, amount, method, recipient }
      });
      if (error) throw error;
      const status = String(data?.status || 'pending');
      if (FINAL_STATUSES.has(status)) savePending(null);
      else savePending({ request_id: requestId, amount, method, recipient, status, provider_reference: data?.provider_reference || null, updated_at: new Date().toISOString() });
      setFeedback(STATUS_MESSAGES[status] || STATUS_MESSAGES.pending, status === 'completed' ? 'success' : status === 'refunded' ? 'warn' : status === 'manual_review' ? 'error' : 'warn');
      showStatus({ status });
      await Promise.all([loadHistory(), refreshWallet()]);
    } catch (error) {
      const failure = await parseFunctionError(error);
      const pending = readPending() || { request_id: requestId, amount, method, recipient };
      const failureStatus = failure.status || (pending.status === 'draft' ? 'reserved' : pending.status);
      if (FINAL_STATUSES.has(failureStatus)) savePending(null);
      else savePending({ ...pending, status: failureStatus, updated_at: new Date().toISOString() });
      setFeedback(failure.message, failureStatus === 'refunded' ? 'warn' : 'error');
      showStatus({ status: failureStatus });
      await Promise.all([loadHistory(), refreshWallet()]);
    } finally {
      setBusy(false);
    }
  }

  async function verifyWithdrawal(requestId) {
    if (busy || !requestId) return;
    setBusy(true, 'Vérification…');
    setFeedback('Vérification du retrait en cours…', 'warn');
    try {
      const client = await getClient();
      await requireSession(client);
      const { data, error } = await client.functions.invoke(VERIFY_FUNCTION, { body: { request_id: requestId } });
      if (error) throw error;
      const status = String(data?.status || 'pending');
      const current = readPending() || {};
      if (FINAL_STATUSES.has(status)) savePending(null);
      else savePending({ ...current, request_id: requestId, status, updated_at: new Date().toISOString() });
      setFeedback(STATUS_MESSAGES[status] || STATUS_MESSAGES.pending, status === 'completed' ? 'success' : status === 'refunded' ? 'warn' : status === 'manual_review' ? 'error' : 'warn');
      showStatus({ status });
      await Promise.all([loadHistory(), refreshWallet()]);
    } catch (error) {
      const failure = await parseFunctionError(error);
      if (failure.status && FINAL_STATUSES.has(failure.status)) savePending(null);
      setFeedback(failure.message, failure.status === 'refunded' ? 'warn' : 'error');
      showStatus({ status: failure.status || readPending()?.status || 'pending' });
      await loadHistory();
    } finally {
      setBusy(false);
    }
  }

  async function init() {
    ensureStatusPanel();
    byId('plopplop-withdrawal-form')?.addEventListener('submit', createWithdrawal);
    byId('withdraw-history-list')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-withdraw-request-id]');
      if (button) await verifyWithdrawal(button.dataset.withdrawRequestId);
    });
    const pending = readPending();
    if (pending?.request_id) showStatus(pending);
    await Promise.all([loadHistory(), refreshWallet()]);
    const params = new URLSearchParams(window.location.search);
    const requestId = params.get('request_id') || pending?.request_id || null;
    if (requestId && params.get('verify') === '1') await verifyWithdrawal(requestId);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
