import assert from 'node:assert/strict';

const ALLOWED_REDIRECT_ORIGINS = new Set(['https://payments.example.test']);

function providerResponse(status, body, { raw = false, delayMs = 0 } = {}) {
  return async () => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return raw ? String(body) : JSON.stringify(body);
      }
    };
  };
}

function timeoutFetch() {
  return async (_url, options = {}) => {
    await new Promise((_, reject) => {
      const error = new DOMException('Aborted', 'AbortError');
      if (options.signal?.aborted) return reject(error);
      options.signal?.addEventListener('abort', () => reject(error), { once: true });
    });
  };
}

function safeRedirect(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (!ALLOWED_REDIRECT_ORIGINS.has(url.origin)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function makeState() {
  return {
    deposits: new Map(),
    providerReferences: new Map(),
    providerTransactions: new Map(),
    alerts: [],
    transactions: [],
    wallet: 0,
    providerCreateCalls: 0,
    providerVerifyCalls: 0
  };
}

function requestKey(userId, requestId) {
  return `${userId}:${requestId}`;
}

function alert(state, deposit, code, transactionId = null) {
  deposit.status = 'manual_review';
  state.alerts.push({
    deposit_id: deposit.id,
    code,
    details: { provider_transaction_id: transactionId }
  });
}

async function createPayment(state, { userId, requestId, amount, method, fetchImpl }) {
  if (amount < 20) return { status: 400, body: { error: 'minimum' } };
  if (!['moncash', 'natcash', 'kashpaw', 'all'].includes(method)) return { status: 400, body: { error: 'method' } };

  const key = requestKey(userId, requestId);
  let deposit = state.deposits.get(key);
  if (deposit) {
    if (deposit.amount !== amount || deposit.method !== method) return { status: 409, body: { error: 'request_id conflict' } };
    return { status: 200, body: { ...deposit, idempotent: true } };
  }

  deposit = {
    id: `dep-${state.deposits.size + 1}`,
    userId,
    requestId,
    amount,
    method,
    status: 'creating',
    provider_reference: `PP-${requestId}`,
    provider_transaction_id: null,
    payment_url: null,
    credited_at: null
  };
  state.deposits.set(key, deposit);
  state.providerReferences.set(deposit.provider_reference, deposit.id);
  state.providerCreateCalls += 1;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10);
  try {
    const response = await fetchImpl('https://provider.test/api/paiement-marchand', { signal: controller.signal });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!response.ok) {
      deposit.status = 'failed';
      return { status: response.status, body: { retryable: true } };
    }
    if (!body || typeof body !== 'object') {
      deposit.status = 'failed';
      return { status: 503, body: { error: 'non_json' } };
    }
    const url = safeRedirect(body.url);
    const transactionId = String(body.transaction_id || '').trim() || null;
    if (!url) {
      deposit.status = 'failed';
      return { status: 503, body: { error: 'missing_or_untrusted_url' } };
    }
    if (!transactionId) {
      deposit.status = 'failed';
      return { status: 503, body: { error: 'transaction_missing' } };
    }
    deposit.payment_url = url;
    deposit.provider_transaction_id = transactionId;
    deposit.status = 'pending';
    return { status: 200, body: { ...deposit } };
  } catch (error) {
    deposit.status = 'failed';
    return { status: 503, body: { error: error?.name === 'AbortError' ? 'timeout' : 'network' } };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyPayment(state, { userId, requestId, fetchImpl }) {
  const deposit = state.deposits.get(requestKey(userId, requestId));
  if (!deposit) return { status: 404, body: { error: 'not_found' } };
  if (deposit.status === 'completed') return { status: 200, body: { status: 'completed', idempotent: true } };
  if (deposit.status === 'manual_review') return { status: 409, body: { status: 'manual_review', idempotent: true } };

  state.providerVerifyCalls += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10);
  try {
    const response = await fetchImpl('https://provider.test/api/paiement-verify', { signal: controller.signal });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!response.ok) return { status: 503, body: { retryable: true, provider_status: response.status } };
    if (!body || typeof body !== 'object') {
      alert(state, deposit, 'provider_non_json');
      return { status: 409, body: { status: 'manual_review' } };
    }

    const status = String(body.trans_status || '').toLowerCase();
    const amount = Number(body.montant);
    const method = String(body.method || '').toLowerCase();
    const reference = String(body.refference_id || '').trim();
    const transactionId = String(body.id_transaction || '').trim();

    if (!['ok', 'no'].includes(status)) {
      alert(state, deposit, 'provider_status_missing_or_unknown', transactionId || null);
      return { status: 409, body: { status: 'manual_review' } };
    }
    if (reference && reference !== deposit.provider_reference) {
      alert(state, deposit, 'reference_mismatch', transactionId || null);
      return { status: 409, body: { status: 'manual_review' } };
    }
    if (!Number.isFinite(amount)) {
      alert(state, deposit, 'confirmed_amount_missing', transactionId || null);
      return { status: 409, body: { status: 'manual_review' } };
    }
    if (Math.round(amount * 100) !== Math.round(deposit.amount * 100)) {
      alert(state, deposit, 'confirmed_amount_mismatch', transactionId || null);
      return { status: 409, body: { status: 'manual_review' } };
    }
    if (!method || method !== deposit.method) {
      alert(state, deposit, method ? 'payment_method_mismatch' : 'payment_method_missing', transactionId || null);
      return { status: 409, body: { status: 'manual_review' } };
    }
    if (!transactionId) {
      alert(state, deposit, 'provider_transaction_id_missing');
      return { status: 409, body: { status: 'manual_review' } };
    }
    if (deposit.provider_transaction_id && deposit.provider_transaction_id !== transactionId) {
      alert(state, deposit, 'provider_transaction_id_changed', transactionId);
      return { status: 409, body: { status: 'manual_review' } };
    }
    const owner = state.providerTransactions.get(transactionId);
    if (owner && owner !== deposit.id) {
      alert(state, deposit, 'duplicate_provider_transaction', transactionId);
      return { status: 409, body: { status: 'manual_review' } };
    }

    if (status === 'no') {
      deposit.provider_transaction_id ||= transactionId;
      deposit.status = 'pending';
      return { status: 200, body: { status: 'pending' } };
    }

    state.providerTransactions.set(transactionId, deposit.id);
    if (!deposit.credited_at) {
      state.wallet += deposit.amount;
      state.transactions.push({ reference: `deposit-${deposit.provider_reference}`, amount: deposit.amount });
      deposit.credited_at = new Date().toISOString();
      deposit.status = 'completed';
    }
    return { status: 200, body: { status: 'completed' } };
  } catch (error) {
    return { status: 503, body: { retryable: true, error: error?.name === 'AbortError' ? 'timeout' : 'network' } };
  } finally {
    clearTimeout(timer);
  }
}

const tests = [];
async function test(name, fn) {
  try {
    await fn();
    tests.push({ name, passed: true });
  } catch (error) {
    tests.push({ name, passed: false, error: error.message });
  }
}

const validCreate = { status: true, url: 'https://payments.example.test/pay/abc', transaction_id: 'tx-create-1' };
const validVerify = (overrides = {}) => ({
  status: true,
  trans_status: 'ok',
  montant: 20,
  method: 'moncash',
  refference_id: 'PP-req-1',
  id_transaction: 'tx-create-1',
  ...overrides
});

await test('succès complet : création sans crédit puis vérification avec un seul crédit', async () => {
  const state = makeState();
  const created = await createPayment(state, { userId: 'u1', requestId: 'req-1', amount: 20, method: 'moncash', fetchImpl: providerResponse(200, validCreate) });
  assert.equal(created.status, 200);
  assert.equal(state.wallet, 0);
  const verified = await verifyPayment(state, { userId: 'u1', requestId: 'req-1', fetchImpl: providerResponse(200, validVerify()) });
  assert.equal(verified.body.status, 'completed');
  assert.equal(state.wallet, 20);
  assert.equal(state.transactions.length, 1);
});

await test('pending : aucun crédit', async () => {
  const state = makeState();
  await createPayment(state, { userId: 'u1', requestId: 'req-1', amount: 20, method: 'moncash', fetchImpl: providerResponse(200, validCreate) });
  const result = await verifyPayment(state, { userId: 'u1', requestId: 'req-1', fetchImpl: providerResponse(200, validVerify({ trans_status: 'no' })) });
  assert.equal(result.body.status, 'pending');
  assert.equal(state.wallet, 0);
});

for (const code of [400, 404, 429, 503]) {
  await test(`réponse HTTP fournisseur ${code} : retryable et aucun crédit`, async () => {
    const state = makeState();
    const result = await createPayment(state, { userId: 'u1', requestId: `req-${code}`, amount: 20, method: 'moncash', fetchImpl: providerResponse(code, { error: 'provider' }) });
    assert.equal(result.status, code);
    assert.equal(state.wallet, 0);
  });
}

await test('timeout : retryable, aucun crédit', async () => {
  const state = makeState();
  const result = await createPayment(state, { userId: 'u1', requestId: 'req-timeout', amount: 20, method: 'moncash', fetchImpl: timeoutFetch() });
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'timeout');
  assert.equal(state.wallet, 0);
});

await test('réponse non JSON : échec sûr, aucun crédit', async () => {
  const state = makeState();
  const result = await createPayment(state, { userId: 'u1', requestId: 'req-nonjson', amount: 20, method: 'moncash', fetchImpl: providerResponse(200, '<html>', { raw: true }) });
  assert.equal(result.status, 503);
  assert.equal(state.wallet, 0);
});

await test('URL absente : création refusée, aucun crédit', async () => {
  const state = makeState();
  const result = await createPayment(state, { userId: 'u1', requestId: 'req-url', amount: 20, method: 'moncash', fetchImpl: providerResponse(200, { transaction_id: 'tx' }) });
  assert.equal(result.status, 503);
  assert.equal(state.wallet, 0);
});

await test('transaction absente : création refusée, aucun crédit', async () => {
  const state = makeState();
  const result = await createPayment(state, { userId: 'u1', requestId: 'req-no-tx', amount: 20, method: 'moncash', fetchImpl: providerResponse(200, { url: 'https://payments.example.test/pay/abc' }) });
  assert.equal(result.status, 503);
  assert.equal(state.wallet, 0);
});

await test('statut absent : manual_review, alerte, aucun crédit', async () => {
  const state = makeState();
  await createPayment(state, { userId: 'u1', requestId: 'req-1', amount: 20, method: 'moncash', fetchImpl: providerResponse(200, validCreate) });
  const body = validVerify(); delete body.trans_status;
  const result = await verifyPayment(state, { userId: 'u1', requestId: 'req-1', fetchImpl: providerResponse(200, body) });
  assert.equal(result.body.status, 'manual_review');
  assert.equal(state.alerts.length, 1);
  assert.equal(state.wallet, 0);
});

await test('méthode différente : manual_review, aucun crédit', async () => {
  const state = makeState();
  await createPayment(state, { userId: 'u1', requestId: 'req-1', amount: 20, method: 'moncash', fetchImpl: providerResponse(200, validCreate) });
  const result = await verifyPayment(state, { userId: 'u1', requestId: 'req-1', fetchImpl: providerResponse(200, validVerify({ method: 'natcash' })) });
  assert.equal(result.body.status, 'manual_review');
  assert.equal(state.wallet, 0);
});

await test('montant différent : manual_review, aucun crédit', async () => {
  const state = makeState();
  await createPayment(state, { userId: 'u1', requestId: 'req-1', amount: 20, method: 'moncash', fetchImpl: providerResponse(200, validCreate) });
  const result = await verifyPayment(state, { userId: 'u1', requestId: 'req-1', fetchImpl: providerResponse(200, validVerify({ montant: 21 })) });
  assert.equal(result.body.status, 'manual_review');
  assert.equal(state.wallet, 0);
});

await test('transaction fournisseur dupliquée : second dépôt manual_review et aucun deuxième crédit', async () => {
  const state = makeState();
  await createPayment(state, { userId: 'u1', requestId: 'req-1', amount: 20, method: 'moncash', fetchImpl: providerResponse(200, { ...validCreate, transaction_id: 'same-tx' }) });
  await verifyPayment(state, { userId: 'u1', requestId: 'req-1', fetchImpl: providerResponse(200, validVerify({ id_transaction: 'same-tx' })) });
  await createPayment(state, { userId: 'u2', requestId: 'req-2', amount: 20, method: 'moncash', fetchImpl: providerResponse(200, { ...validCreate, transaction_id: 'create-2' }) });
  state.deposits.get('u2:req-2').provider_transaction_id = null;
  const result = await verifyPayment(state, { userId: 'u2', requestId: 'req-2', fetchImpl: providerResponse(200, validVerify({ refference_id: 'PP-req-2', id_transaction: 'same-tx' })) });
  assert.equal(result.body.status, 'manual_review');
  assert.equal(state.wallet, 20);
  assert.equal(state.transactions.length, 1);
  assert.equal(state.alerts.length, 1);
});

await test('changement inattendu de transaction : manual_review', async () => {
  const state = makeState();
  await createPayment(state, { userId: 'u1', requestId: 'req-1', amount: 20, method: 'moncash', fetchImpl: providerResponse(200, validCreate) });
  const deposit = state.deposits.get('u1:req-1');
  deposit.provider_transaction_id = 'first-transaction';
  const result = await verifyPayment(state, { userId: 'u1', requestId: 'req-1', fetchImpl: providerResponse(200, validVerify({ id_transaction: 'changed-transaction' })) });
  assert.equal(result.body.status, 'manual_review');
  assert.equal(state.wallet, 0);
});

await test('dix vérifications : toujours un seul crédit', async () => {
  const state = makeState();
  await createPayment(state, { userId: 'u1', requestId: 'req-1', amount: 20, method: 'moncash', fetchImpl: providerResponse(200, validCreate) });
  for (let i = 0; i < 10; i += 1) {
    await verifyPayment(state, { userId: 'u1', requestId: 'req-1', fetchImpl: providerResponse(200, validVerify()) });
  }
  assert.equal(state.wallet, 20);
  assert.equal(state.transactions.length, 1);
});

await test('retry même request_id : une seule création fournisseur', async () => {
  const state = makeState();
  await createPayment(state, { userId: 'u1', requestId: 'req-1', amount: 20, method: 'moncash', fetchImpl: providerResponse(200, validCreate) });
  const retry = await createPayment(state, { userId: 'u1', requestId: 'req-1', amount: 20, method: 'moncash', fetchImpl: providerResponse(200, validCreate) });
  assert.equal(retry.body.idempotent, true);
  assert.equal(state.providerCreateCalls, 1);
});

const failed = tests.filter((item) => !item.passed);
console.log(JSON.stringify({ passed: tests.length - failed.length, failed: failed.length, tests }, null, 2));
if (failed.length) process.exitCode = 1;
