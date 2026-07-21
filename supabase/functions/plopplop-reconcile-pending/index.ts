import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

const EXPECTED_PROVIDER_ORIGIN = "https://plopplop.solutionip.app";
const BATCH_LIMIT = 20;
const MIN_AGE_MS = 45_000;
const RECHECK_COOLDOWN_MS = 90_000;
const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...BASE_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}
function clean(value: unknown, max = 500): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}
function deepFind(payload: unknown, keys: string[]): unknown {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const queue: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }];
  let visited = 0;
  while (queue.length && visited++ < 200) {
    const current = queue.shift()!;
    if (current.depth > 4 || current.value === null || current.value === undefined) continue;
    if (Array.isArray(current.value)) {
      for (const item of current.value.slice(0, 20)) queue.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (typeof current.value !== "object") continue;
    for (const [key, item] of Object.entries(current.value as Record<string, unknown>)) {
      if (wanted.has(key.toLowerCase()) && item !== null && item !== undefined) return item;
      queue.push({ value: item, depth: current.depth + 1 });
    }
  }
  return null;
}
function firstString(payload: unknown, keys: string[], max = 500): string | null {
  return clean(deepFind(payload, keys), max);
}
function firstNumber(payload: unknown, keys: string[]): number | null {
  const raw = deepFind(payload, keys);
  const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  return Number.isFinite(value) ? value : null;
}
function statusOf(value: unknown): string {
  const valueLower = String(value ?? "").trim().toLowerCase();
  return valueLower === "ok" || valueLower === "no" ? valueLower : "unknown";
}
function sameMoney(a: unknown, b: unknown): boolean {
  return Number.isFinite(Number(a)) && Number.isFinite(Number(b)) &&
    Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}
function normalizedStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
async function fetchJson(url: URL, init: RequestInit, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

function providerConfig() {
  const clientId = clean(Deno.env.get("PLOPPLOP_CLIENT_ID"), 500);
  const clientSecret = clean(Deno.env.get("PLOPPLOP_CLIENT_SECRET"), 500);
  const rawBase = clean(Deno.env.get("PLOPPLOP_BASE_URL"), 2000);
  if (!clientId || !rawBase) return null;
  try {
    const baseUrl = new URL(rawBase.endsWith("/") ? rawBase : `${rawBase}/`);
    if (baseUrl.protocol !== "https:" || baseUrl.origin !== EXPECTED_PROVIDER_ORIGIN) return null;
    return { clientId, clientSecret, baseUrl };
  } catch {
    return null;
  }
}

function depositSummary(payload: unknown, httpStatus: number) {
  return {
    http_status: httpStatus,
    received_at: new Date().toISOString(),
    trans_status: firstString(payload, ["trans_status"], 80),
    message: firstString(payload, ["message", "msg", "detail", "description"], 500),
    refference_id: firstString(payload, ["refference_id", "reference_id", "reference"], 200),
    transaction_id: firstString(payload, ["id_transaction", "transaction_id", "trans_id", "transactionId"], 200),
    montant: firstNumber(payload, ["montant", "amount", "transaction_amount"]),
    payment_method: firstString(payload, ["method", "payment_method"], 80),
  };
}
function withdrawalSummary(payload: unknown, httpStatus: number) {
  return {
    http_status: httpStatus,
    received_at: new Date().toISOString(),
    success: deepFind(payload, ["success"]),
    message: firstString(payload, ["message", "msg", "detail", "description"], 500),
    transaction_id: firstString(payload, ["transaction_id", "id_transaction"], 200),
    api_reference: firstString(payload, ["api_reference"], 200),
    reference: firstString(payload, ["reference"], 200),
    status: firstString(payload, ["status"], 80),
    amount: firstNumber(payload, ["amount"]),
    fee: firstNumber(payload, ["fee"]),
    total: firstNumber(payload, ["total"]),
    method: firstString(payload, ["method"], 80),
    recipient: firstString(payload, ["recipient"], 40),
  };
}

async function reconcileDeposit(admin: ReturnType<typeof createClient>, provider: { clientId: string; baseUrl: URL }, deposit: Record<string, unknown>) {
  const localReference = clean(deposit.provider_reference as string, 200);
  const depositId = deposit.id as string;
  const userId = deposit.user_id as string;

  const flagReview = async (code: string, transactionId: string | null, amount: number | null, providerSummary: unknown, alertType = "provider_error") => {
    await admin.rpc("flag_plopplop_manual_review", {
      p_deposit_id: depositId,
      p_user_id: userId,
      p_alert_type: alertType,
      p_error_code: code,
      p_provider_transaction_id: transactionId,
      p_confirmed_amount: amount,
      p_provider_response: providerSummary,
    });
    return "manual_review";
  };

  if (!localReference) {
    await flagReview("local_reference_missing", null, null, {});
    return "manual_review";
  }

  const { response, payload } = await fetchJson(new URL("api/paiement-verify", provider.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: provider.clientId, refference_id: localReference }),
  }, 20000);
  if (!response.ok) return "skipped";

  const providerSummary = depositSummary(payload, response.status);
  const transactionId = clean(providerSummary.transaction_id, 200);
  const confirmedAmount = typeof providerSummary.montant === "number" ? providerSummary.montant : null;
  const method = clean(providerSummary.payment_method, 80)?.toLowerCase() ?? null;
  const expectedMethod = clean(deposit.payment_method as string, 80)?.toLowerCase() ?? null;
  const returnedReference = clean(providerSummary.refference_id, 200);
  const storedTransactionId = clean(deposit.provider_transaction_id as string, 200);
  const transStatus = statusOf(providerSummary.trans_status);

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return await flagReview("provider_non_json", transactionId, confirmedAmount, providerSummary);
  if (transStatus === "unknown") return await flagReview("provider_status_missing_or_unknown", transactionId, confirmedAmount, providerSummary);
  if (returnedReference && returnedReference !== localReference) return await flagReview("reference_mismatch", transactionId, confirmedAmount, providerSummary);
  if (confirmedAmount === null) return await flagReview("confirmed_amount_missing", transactionId, confirmedAmount, providerSummary);
  if (!sameMoney(confirmedAmount, deposit.amount)) return await flagReview("confirmed_amount_mismatch", transactionId, confirmedAmount, providerSummary);
  if (!method) return await flagReview("payment_method_missing", transactionId, confirmedAmount, providerSummary);
  if (!expectedMethod) return await flagReview("payment_method_mismatch", transactionId, confirmedAmount, providerSummary);
  if (expectedMethod !== "all" && method !== expectedMethod) return await flagReview("payment_method_mismatch", transactionId, confirmedAmount, providerSummary);
  if (!transactionId) return await flagReview("provider_transaction_id_missing", transactionId, confirmedAmount, providerSummary);
  if (storedTransactionId && storedTransactionId !== transactionId) return await flagReview("provider_transaction_id_changed", transactionId, confirmedAmount, providerSummary);

  const { data: dup } = await admin.from("plopplop_deposits").select("id")
    .eq("provider_transaction_id", transactionId).neq("id", depositId).limit(1);
  if (dup?.length) return await flagReview("duplicate_provider_transaction", transactionId, confirmedAmount, providerSummary, "duplicate_transaction");

  if (transStatus === "no") {
    const { data: pending, error } = await admin.rpc("mark_plopplop_pending", {
      p_deposit_id: depositId,
      p_user_id: userId,
      p_provider_transaction_id: transactionId,
      p_confirmed_amount: confirmedAmount,
      p_provider_response: providerSummary,
    });
    if (error || !pending) return "error";
    return "pending";
  }

  const { data: completed, error } = await admin.rpc("complete_plopplop_deposit", {
    p_deposit_id: depositId,
    p_user_id: userId,
    p_provider_transaction_id: transactionId,
    p_confirmed_amount: confirmedAmount,
    p_provider_response: providerSummary,
  });
  if (error || !completed) {
    const duplicate = String(error?.message ?? "").toLowerCase().includes("déjà utilisé") || String(error?.message ?? "").toLowerCase().includes("duplicate");
    return await flagReview(duplicate ? "duplicate_provider_transaction" : "credit_failed", transactionId, confirmedAmount, providerSummary, duplicate ? "duplicate_transaction" : "provider_error");
  }
  return "completed";
}

async function reconcileWithdrawal(admin: ReturnType<typeof createClient>, merchantToken: string, provider: { baseUrl: URL }, withdrawal: Record<string, unknown>) {
  const providerReference = clean(withdrawal.provider_reference as string, 200);
  const withdrawalId = withdrawal.id as string;
  const userId = withdrawal.user_id as string;

  const flagReview = async (code: string, transactionId: string | null, providerSummary: unknown) => {
    await admin.rpc("flag_plopplop_withdrawal_manual_review", {
      p_withdrawal_id: withdrawalId,
      p_user_id: userId,
      p_error_code: code,
      p_provider_transaction_id: transactionId,
      p_api_reference: (providerSummary as Record<string, unknown>)?.api_reference ?? null,
      p_provider_response: providerSummary,
    });
    return "manual_review";
  };

  if (!providerReference) {
    await flagReview("local_reference_missing", null, {});
    return "manual_review";
  }

  const { response, payload } = await fetchJson(new URL("api/withdraw/marchand/verify", provider.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Authorization": `Bearer ${merchantToken}`,
    },
    body: JSON.stringify({ reference: providerReference }),
  }, 20000);

  const providerSummary = withdrawalSummary(payload, response.status);
  if (response.status === 404) {
    // Un 404 ne prouve pas l'absence de transfert : jamais de remboursement automatique ici.
    await admin.rpc("mark_plopplop_withdrawal_pending", {
      p_withdrawal_id: withdrawalId,
      p_user_id: userId,
      p_provider_transaction_id: withdrawal.provider_transaction_id ?? null,
      p_api_reference: withdrawal.api_reference ?? null,
      p_fee: withdrawal.fee ?? null,
      p_provider_total: withdrawal.provider_total ?? null,
      p_error_code: "provider_verify_not_found",
      p_provider_response: providerSummary,
    });
    return "pending";
  }
  if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) return "skipped";

  const status = normalizedStatus(providerSummary.status);
  const returnedReference = clean(providerSummary.reference, 200);
  const method = clean(providerSummary.method, 80)?.toLowerCase() ?? null;
  const recipient = clean(providerSummary.recipient, 40)?.replace(/\D/g, "") ?? null;
  const transactionId = clean(providerSummary.transaction_id, 200);

  const mismatch =
    (returnedReference && returnedReference !== providerReference) ||
    (method && method !== withdrawal.method) ||
    (recipient && recipient !== withdrawal.recipient) ||
    (withdrawal.provider_transaction_id && transactionId && withdrawal.provider_transaction_id !== transactionId);

  if (mismatch || !status) return await flagReview(mismatch ? "provider_data_mismatch" : "provider_status_missing", transactionId, providerSummary);

  if (status === "success") {
    if (!transactionId) return await flagReview("provider_transaction_id_missing", null, providerSummary);
    const { data: completed, error } = await admin.rpc("complete_plopplop_withdrawal", {
      p_withdrawal_id: withdrawalId,
      p_user_id: userId,
      p_provider_transaction_id: transactionId,
      p_api_reference: providerSummary.api_reference,
      p_fee: providerSummary.fee,
      p_provider_total: providerSummary.amount,
      p_provider_response: providerSummary,
    });
    if (error || !completed) return await flagReview("local_completion_failed", transactionId, providerSummary);
    return "completed";
  }

  if (["failed", "rembourse", "refunded"].includes(status)) {
    const { data: refunded, error } = await admin.rpc("refund_plopplop_withdrawal", {
      p_withdrawal_id: withdrawalId,
      p_user_id: userId,
      p_error_code: `provider_${status}`,
      p_provider_response: providerSummary,
    });
    if (error || !refunded) return await flagReview("refund_failed", transactionId, providerSummary);
    return "refunded";
  }

  if (status === "pending") {
    await admin.rpc("mark_plopplop_withdrawal_pending", {
      p_withdrawal_id: withdrawalId,
      p_user_id: userId,
      p_provider_transaction_id: transactionId,
      p_api_reference: providerSummary.api_reference,
      p_fee: providerSummary.fee,
      p_provider_total: providerSummary.amount,
      p_error_code: "provider_pending",
      p_provider_response: providerSummary,
    });
    return "pending";
  }

  return await flagReview(`provider_status_${status}`, transactionId, providerSummary);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  const cronSecret = Deno.env.get("RECONCILE_CRON_SECRET");
  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Server configuration error" }, 500);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const cutoff = new Date(Date.now() - MIN_AGE_MS).toISOString();
  const recheckCutoff = new Date(Date.now() - RECHECK_COOLDOWN_MS).toISOString();

  const results = {
    deposits: { completed: 0, pending: 0, manual_review: 0, error: 0, skipped: 0 },
    withdrawals: { completed: 0, refunded: 0, pending: 0, manual_review: 0, error: 0, skipped: 0 },
  };

  const provider = providerConfig();
  if (provider) {
    const { data: deposits } = await admin.from("plopplop_deposits")
      .select("id,user_id,provider_reference,provider_transaction_id,amount,payment_method,status")
      .eq("status", "pending")
      .lt("created_at", cutoff)
      .or(`last_verified_at.is.null,last_verified_at.lt.${recheckCutoff}`)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);

    for (const deposit of deposits ?? []) {
      try {
        const outcome = await reconcileDeposit(admin, provider, deposit as Record<string, unknown>);
        results.deposits[outcome as keyof typeof results.deposits] = (results.deposits[outcome as keyof typeof results.deposits] ?? 0) + 1;
      } catch {
        results.deposits.error += 1;
      }
    }
  }

  if (provider?.clientSecret) {
    const { data: withdrawals } = await admin.from("plopplop_withdrawals")
      .select("id,user_id,provider_reference,provider_transaction_id,api_reference,fee,provider_total,method,recipient,status")
      .eq("status", "pending")
      .lt("created_at", cutoff)
      .or(`last_verified_at.is.null,last_verified_at.lt.${recheckCutoff}`)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (withdrawals?.length) {
      const authResult = await fetchJson(new URL("api/auth/marchand", provider.baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ client_id: provider.clientId, client_secret: provider.clientSecret }),
      }, 15000);
      const merchantToken = firstString(authResult.payload, ["token"], 4000);

      if (authResult.response.ok && merchantToken) {
        for (const withdrawal of withdrawals) {
          try {
            const outcome = await reconcileWithdrawal(admin, merchantToken, provider, withdrawal as Record<string, unknown>);
            results.withdrawals[outcome as keyof typeof results.withdrawals] = (results.withdrawals[outcome as keyof typeof results.withdrawals] ?? 0) + 1;
          } catch {
            results.withdrawals.error += 1;
          }
        }
      } else {
        results.withdrawals.skipped = withdrawals.length;
      }
    }
  }

  return json({ ok: true, checked_at: new Date().toISOString(), results });
});
