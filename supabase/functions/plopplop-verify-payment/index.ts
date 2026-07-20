import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

const ALLOWED_ORIGINS = new Set([
  "https://tontonkondoparyaj.com",
  "https://www.tontonkondoparyaj.com",
  "https://tonton-kondo-paryaj.vercel.app",
  "https://tonton-kondo-paryaj-n75s.vercel.app",
  "https://tonton-kondo-paryaj-d9bfh4yvb-nicko07-projects.vercel.app",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
]);

const EXPECTED_PROVIDER_ORIGIN = "https://plopplop.solutionip.app";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function cors(req: Request): Record<string, string> | null {
  const origin = req.headers.get("Origin");

  if (!origin) {
    return { ...BASE_HEADERS };
  }

  if (!ALLOWED_ORIGINS.has(origin)) {
    return null;
  }

  return {
    ...BASE_HEADERS,
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
  };
}
function json(req, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...(cors(req) ?? BASE_HEADERS), "Content-Type": "application/json; charset=utf-8" },
  });
}
function clean(value, max = 500) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}
function deepFind(payload, keys) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const queue = [{ value: payload, depth: 0 }];
  let visited = 0;
  while (queue.length && visited++ < 200) {
    const { value, depth } = queue.shift();
    if (depth > 4 || value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 20)) queue.push({ value: item, depth: depth + 1 });
      continue;
    }
    if (typeof value !== "object") continue;
    for (const [key, item] of Object.entries(value)) {
      if (wanted.has(key.toLowerCase()) && item !== null && item !== undefined) return item;
      queue.push({ value: item, depth: depth + 1 });
    }
  }
  return null;
}
function firstString(payload, keys, max = 500) {
  return clean(deepFind(payload, keys), max);
}
function firstNumber(payload, keys) {
  const raw = deepFind(payload, keys);
  const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  return Number.isFinite(value) ? value : null;
}
function summary(payload, httpStatus) {
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
function config() {
  const clientId = clean(Deno.env.get("PLOPPLOP_CLIENT_ID"), 500);
  const rawBase = clean(Deno.env.get("PLOPPLOP_BASE_URL"), 2000);
  if (!clientId || !rawBase) return null;
  try {
    const baseUrl = new URL(rawBase.endsWith("/") ? rawBase : `${rawBase}/`);
    if (baseUrl.protocol !== "https:" || baseUrl.origin !== EXPECTED_PROVIDER_ORIGIN) return null;
    return { clientId, baseUrl };
  } catch {
    return null;
  }
}
function statusOf(value) {
  const valueLower = String(value ?? "").trim().toLowerCase();
  return valueLower === "ok" || valueLower === "no" ? valueLower : "unknown";
}
function sameMoney(a, b) {
  return Number.isFinite(Number(a)) && Number.isFinite(Number(b)) &&
    Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}
async function manualReview(admin, deposit, userId, code, transactionId, amount, providerSummary, alertType = "provider_error") {
  const { error } = await admin.rpc("flag_plopplop_manual_review", {
    p_deposit_id: deposit.id,
    p_user_id: userId,
    p_alert_type: alertType,
    p_error_code: code,
    p_provider_transaction_id: transactionId,
    p_confirmed_amount: amount,
    p_provider_response: providerSummary,
  });
  if (error) throw error;
}
async function transactionUsed(admin, depositId, transactionId) {
  const { data, error } = await admin.from("plopplop_deposits").select("id")
    .eq("provider_transaction_id", transactionId).neq("id", depositId).limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

Deno.serve(async (req) => {
  const requestCors = cors(req);
  if (!requestCors) return json(req, { error: "Origin not allowed" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: requestCors });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json(req, { error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json(req, { error: "Server configuration error" }, 500);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json(req, { error: "Unauthorized" }, 401);

  const provider = config();
  if (!provider) return json(req, { error: "Payment provider is not configured", retryable: true }, 503);

  let body;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const requestId = clean(body.request_id, 36);
  if (!requestId || !UUID_RE.test(requestId)) return json(req, { error: "A valid request_id UUID is required" }, 400);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: deposit, error: depositError } = await admin.from("plopplop_deposits")
    .select("id,user_id,request_id,provider_reference,provider_transaction_id,amount,confirmed_amount,payment_method,status,payment_url,credited_at")
    .eq("request_id", requestId).eq("user_id", authData.user.id).maybeSingle();
  if (depositError) return json(req, { error: "Unable to load deposit" }, 400);
  if (!deposit) return json(req, { error: "Deposit not found" }, 404);
  if (deposit.status === "completed") {
    return json(req, { success: true, status: "completed", idempotent: true, request_id: requestId, deposit_id: deposit.id, credited_at: deposit.credited_at });
  }
  if (["manual_review", "amount_mismatch"].includes(deposit.status)) {
    return json(req, { success: false, status: "manual_review", idempotent: true, request_id: requestId, deposit_id: deposit.id }, 409);
  }

  const localReference = clean(deposit.provider_reference, 200);
  if (!localReference) {
    await manualReview(admin, deposit, authData.user.id, "local_reference_missing", null, null, {});
    return json(req, { error: "Payment requires manual review", status: "manual_review" }, 409);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(new URL("api/paiement-verify", provider.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: provider.clientId, refference_id: localReference }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (!response.ok) {
      return json(req, { error: "Payment verification is temporarily unavailable", provider_status: response.status, retryable: true, request_id: requestId }, 503);
    }

    const providerSummary = summary(payload, response.status);
    const transactionId = clean(providerSummary.transaction_id, 200);
    const confirmedAmount = typeof providerSummary.montant === "number" ? providerSummary.montant : null;
    const method = clean(providerSummary.payment_method, 80)?.toLowerCase() ?? null;
    const expectedMethod = clean(deposit.payment_method, 80)?.toLowerCase() ?? null;
    const returnedReference = clean(providerSummary.refference_id, 200);
    const storedTransactionId = clean(deposit.provider_transaction_id, 200);
    const transStatus = statusOf(providerSummary.trans_status);

    const review = async (code, alertType = "provider_error") => {
      await manualReview(admin, deposit, authData.user.id, code, transactionId, confirmedAmount, providerSummary, alertType);
      return json(req, { error: "Payment requires manual review", status: "manual_review" }, 409);
    };

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return await review("provider_non_json");
    if (transStatus === "unknown") return await review("provider_status_missing_or_unknown");
    if (returnedReference && returnedReference !== localReference) return await review("reference_mismatch");
    if (confirmedAmount === null) return await review("confirmed_amount_missing");
    if (!sameMoney(confirmedAmount, deposit.amount)) return await review("confirmed_amount_mismatch");
    if (!method) return await review("payment_method_missing");
    if (!expectedMethod || method !== expectedMethod) return await review("payment_method_mismatch");
    if (!transactionId) return await review("provider_transaction_id_missing");
    if (storedTransactionId && storedTransactionId !== transactionId) return await review("provider_transaction_id_changed");
    if (await transactionUsed(admin, deposit.id, transactionId)) return await review("duplicate_provider_transaction", "duplicate_transaction");

    if (transStatus === "no") {
      const { data: pending, error } = await admin.rpc("mark_plopplop_pending", {
        p_deposit_id: deposit.id,
        p_user_id: authData.user.id,
        p_provider_transaction_id: transactionId,
        p_confirmed_amount: confirmedAmount,
        p_provider_response: providerSummary,
      });
      if (error || !pending) return json(req, { error: "Unable to save pending status", retryable: true }, 503);
      return json(req, { success: true, status: "pending", request_id: requestId, deposit_id: pending.id, message: "Payment is still pending" });
    }

    const { data: completed, error } = await admin.rpc("complete_plopplop_deposit", {
      p_deposit_id: deposit.id,
      p_user_id: authData.user.id,
      p_provider_transaction_id: transactionId,
      p_confirmed_amount: confirmedAmount,
      p_provider_response: providerSummary,
    });
    if (error || !completed) {
      const duplicate = String(error?.message ?? "").toLowerCase().includes("déjà utilisé") || String(error?.message ?? "").toLowerCase().includes("duplicate");
      return await review(duplicate ? "duplicate_provider_transaction" : "credit_failed", duplicate ? "duplicate_transaction" : "provider_error");
    }
    return json(req, { success: true, status: "completed", request_id: requestId, deposit_id: completed.id, credited_at: completed.credited_at });
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === "AbortError";
    return json(req, { error: timeout ? "Payment verification timed out" : "Payment verification is temporarily unavailable", retryable: true, request_id: requestId }, 503);
  } finally {
    clearTimeout(timer);
  }
});
