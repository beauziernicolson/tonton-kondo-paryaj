(function () {
  'use strict';

  if (window.__TK_PLOPPLOP_PENDING_SYNC_LOADED__) return;
  window.__TK_PLOPPLOP_PENDING_SYNC_LOADED__ = true;

  const JOBS = [
    {
      key: 'tk-plopplop-pending-deposit-v1',
      fn: 'plopplop-verify-payment',
      event: 'tonton:plopplop-deposit-updated',
      final: new Set(['completed', 'manual_review', 'amount_mismatch', 'cancelled'])
    },
    {
      key: 'tk-plopplop-pending-withdrawal-v1',
      fn: 'plopplop-verify-withdrawal',
      event: 'tonton:plopplop-withdrawal-updated',
      final: new Set(['completed', 'refunded', 'manual_review', 'cancelled'])
    }
  ];

  function read(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  function write(key, value) {
    try {
      if (!value) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Un navigateur bloquant le stockage ne doit pas casser l'authentification.
    }
  }

  async function waitForClient(maxMs = 12000) {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      if (window.supabaseClient) return window.supabaseClient;
      if (typeof window.getSupabaseClient === 'function') {
        try {
          const client = await window.getSupabaseClient();
          if (client) return client;
        } catch {
          // Attendre le prochain essai.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return null;
  }

  async function runJob(client, job) {
    const pending = read(job.key);
    if (!pending?.request_id || job.final.has(String(pending.status || ''))) return;
    const last = Number(pending.last_auto_verify_at || 0);
    if (Date.now() - last < 30000) return;

    write(job.key, { ...pending, last_auto_verify_at: Date.now() });
    const { data, error } = await client.functions.invoke(job.fn, {
      body: { request_id: pending.request_id }
    });
    if (error) {
      // Une référence introuvable côté serveur ne redeviendra jamais valide :
      // on nettoie pour ne pas bloquer indéfiniment une nouvelle tentative.
      if (error?.context?.status === 404) write(job.key, null);
      return;
    }
    if (!data) return;

    const status = String(data.status || 'pending');
    if (job.final.has(status)) write(job.key, null);
    else write(job.key, { ...pending, status, last_auto_verify_at: Date.now(), updated_at: new Date().toISOString() });

    window.dispatchEvent(new CustomEvent(job.event, { detail: { status, request_id: pending.request_id } }));
    if (status === 'completed') window.dispatchEvent(new CustomEvent('tonton:wallet-updated', { detail: { source: 'plopplop' } }));
  }

  async function init() {
    if (document.visibilityState === 'hidden') return;
    const hasPending = JOBS.some((job) => Boolean(read(job.key)?.request_id));
    if (!hasPending) return;
    const client = await waitForClient();
    if (!client) return;
    const { data } = await client.auth.getSession();
    if (!data?.session) return;
    for (const job of JOBS) {
      try { await runJob(client, job); } catch { /* Le bouton manuel reste disponible. */ }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 500), { once: true });
  else setTimeout(init, 500);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') init(); });
})();
