(function () {
  'use strict';
  const tr = (key, vars = {}) => window.TKI18n?.t?.(key, vars) || key;

  if (window.__TK_PLOPPLOP_WITHDRAWAL_LOADED__) return;
  window.__TK_PLOPPLOP_WITHDRAWAL_LOADED__ = true;

  const STORAGE_KEY = 'tk-plopplop-pending-withdrawal-v1';
  const CREATE_FUNCTION = 'plopplop-create-withdrawal';
  const VERIFY_FUNCTION = 'plopplop-verify-withdrawal';
  const VALID_METHODS = new Set(['moncash', 'natcash']);
  const FINAL_STATUSES = new Set(['completed', 'refunded', 'manual_review', 'cancelled']);
  const STATUS_MESSAGES = {
    reserved: tr('sensitive.withdraw.reserved'),
    processing: tr('sensitive.withdraw.processing'),
    pending: tr('sensitive.withdraw.pending'),
    completed: tr('sensitive.withdraw.completed'),
    failed: tr('sensitive.withdraw.failed'),
    refunded: tr('sensitive.withdraw.refunded'),
    manual_review: tr('sensitive.withdraw.manual_review'),
    cancelled: tr('sensitive.withdraw.cancelled')
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
    button.textContent = busy ? (label || tr('sensitive.withdraw.busy')) : tr('sensitive.withdraw.submit');
  }

  async function getClient() {
    if (window.supabaseClient) return window.supabaseClient;
    if (typeof window.getSupabaseClient === 'function') {
      const client = await window.getSupabaseClient();
      if (client) return client;
    }
    throw new Error(tr('sensitive.withdraw.supabase_unavailable'));
  }

  async function requireSession(client) {
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session) {
      window.saveRedirectTarget?.('withdraw.html');
      window.tryRedirectToLogin?.('login-register/login.html');
      throw new Error(tr('sensitive.withdraw.login_required'));
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
        if (body?.error === 'Withdrawal provider is not configured') return { message: tr('sensitive.withdraw.provider_unavailable'), status };
        if (body?.error === 'Insufficient wallet balance') return { message: tr('sensitive.withdraw.insufficient'), status };
        if (body?.error === 'request_id conflict') return { message: tr('sensitive.withdraw.request_conflict'), status };
        if (status && STATUS_MESSAGES[status]) return { message: STATUS_MESSAGES[status], status };
        if (body?.error) return { message: String(body.error), status };
      }
    } catch {
      // Le message générique reste sûr.
    }
    return { message: error?.message || tr('sensitive.withdraw.generic_error'), status };
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
        <button class="btn btn-primary" data-withdraw-verify type="button">${tr('sensitive.withdraw.verify')}</button>
        <button class="btn" data-withdraw-clear type="button">${tr('sensitive.withdraw.new_request')}</button>
      </div>`;
    byId('withdraw-feedback-box')?.insertAdjacentElement('afterend', panel);
    panel.querySelector('[data-withdraw-verify]')?.addEventListener('click', async () => {
      const pending = readPending();
      if (!pending?.request_id) return setFeedback(tr('sensitive.withdraw.no_pending'), 'warn');
      await verifyWithdrawal(pending.request_id);
    });
    panel.querySelector('[data-withdraw-clear]')?.addEventListener('click', () => {
      const pending = readPending();
      if (pending?.request_id && !FINAL_STATUSES.has(String(pending.status || ''))) {
        setFeedback(tr('sensitive.withdraw.check_existing'), 'warn');
        return;
      }
      savePending(null);
      panel.hidden = true;
      setFeedback(tr('sensitive.withdraw.new_ready'), 'warn');
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
    if (title) title.textContent = status === 'completed' ? tr('sensitive.withdraw.completed_title') : status === 'refunded' ? tr('sensitive.withdraw.refunded_title') : tr('sensitive.withdraw.tracking_title');
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
        list.innerHTML = `<div class="card-item"><strong>${tr('sensitive.withdraw.empty_title')}</strong><span>${tr('sensitive.withdraw.empty_text')}</span></div>`;
        return;
      }
      list.innerHTML = data.map((item) => {
        const status = String(item.status || 'pending');
        return `
          <article class="card-item" data-provider="plopplop">
            <strong>${escapeHtml(new Date(item.created_at).toLocaleString(window.TKI18n?.getLocale?.() || 'fr-FR'))}</strong>
            <span>${escapeHtml(money(item.amount))} • ${escapeHtml(methodLabel(item.method))}</span>
            <span>Destinataire : ${escapeHtml(maskRecipient(item.recipient))}</span>
            <span>${tr('sensitive.withdraw.reference')} : ${escapeHtml(item.provider_reference || '—')}</span>
            <span>Statut : ${escapeHtml(status)}</span>
            ${['pending', 'processing', 'reserved', 'failed'].includes(status) ? `<button class="btn" data-withdraw-request-id="${escapeHtml(item.request_id)}" type="button">${tr('sensitive.withdraw.verify_now')}</button>` : ''}
          </article>`;
      }).join('');
    } catch (error) {
      console.error('Erreur historique retrait PlopPlop.', error);
      list.innerHTML = `<div class="card-item"><strong>${tr('sensitive.withdraw.history_unavailable')}</strong><span>${tr('sensitive.withdraw.reload')}</span></div>`;
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
    if (!Number.isFinite(amount) || amount < 25 || amount > 100000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) {
      setFeedback(tr('sensitive.withdraw.amount_error'), 'error');
      return;
    }
    if (!VALID_METHODS.has(method)) {
      setFeedback(tr('sensitive.withdraw.method_error'), 'error');
      return;
    }
    if (!recipient) {
      setFeedback(tr('sensitive.withdraw.phone_error'), 'error');
      return;
    }

    const existing = readPending();
    if (existing?.request_id && !FINAL_STATUSES.has(String(existing.status || '')) && (
      Number(existing.amount) !== amount || String(existing.method) !== method || String(existing.recipient) !== recipient
    )) {
      setFeedback(tr('sensitive.withdraw.existing_request'), 'warn');
      showStatus(existing);
      return;
    }

    const confirmed = window.confirm(`Confirmer le retrait de ${money(amount)} vers ${methodLabel(method)} (${maskRecipient(recipient)}) ?`);
    if (!confirmed) return;

    setBusy(true, tr('sensitive.withdraw.processing_request'));
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
    setBusy(true, tr('sensitive.withdraw.verifying'));
    setFeedback(tr('sensitive.withdraw.verifying_message'), 'warn');
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
