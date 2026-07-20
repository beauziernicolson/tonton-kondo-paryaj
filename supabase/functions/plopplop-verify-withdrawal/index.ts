import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

const ALLOWED_ORIGINS = new Set([
  "https://tontonkondoparyaj.com",
  "https://www.tontonkondoparyaj.com",
  "https://tonton-kondo-paryaj.vercel.app",
  "https://tonton-kondo-paryaj-n75s.vercel.app",
]);
const VERCEL_PREVIEW_ORIGIN_RE = /^https:\/\/tonton-kondo-paryaj-[a-z0-9-]+-nicko07-projects\.vercel\.app$/i;
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
  if (!origin) return { ...BASE_HEADERS };
  if (!ALLOWED_ORIGINS.has(origin) && !VERCEL_PREVIEW_ORIGIN_RE.test(origin)) return null;
  return { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}
function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...(cors(req) ?? BASE_HEADERS), "Content-Type": "application/json; charset=utf-8" },
  });
}
function clean(value: unknown, max = 500): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}
function config() {
  const clientId = clean(Deno.env.get("PLOPPLOP_CLIENT_ID"), 500);
  const clientSecret = clean(Deno.env.get("PLOPPLOP_CLIENT_SECRET"), 500);
  const rawBase = clean(Deno.env.get("PLOPPLOP_BASE_URL"), 2000);
  if (!clientId || !clientSecret || clientSecret.length < 32 || !rawBase) return null;
  try {
    const baseUrl = new URL(rawBase.endsWith("/") ? rawBase : `${rawBase}/`);
    if (baseUrl.protocol !== "https:" || baseUrl.origin !== EXPECTED_PROVIDER_ORIGIN) return null;
    return { clientId, clientSecret, baseUrl };
  } catch {
    return null;
  }
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
function summary(payload: unknown, httpStatus: number) {
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
function normalizedStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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

Deno.serve(async (req: Request) => {
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
  if (!provider) return json(req, { error: "Withdrawal provider is not configured", retryable: true }, 503);

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const requestId = clean(body.request_id, 36);
  if (!requestId || !UUID_RE.test(requestId)) return json(req, { error: "A valid request_id UUID is required" }, 400);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: withdrawal, error: loadError } = await admin.from("plopplop_withdrawals")
    .select("id,user_id,request_id,provider_reference,provider_transaction_id,api_reference,amount,fee,provider_total,method,recipient,status,funds_reserved_at,completed_at,refunded_at,last_error_code")
    .eq("request_id", requestId).eq("user_id", authData.user.id).maybeSingle();
  if (loadError) return json(req, { error: "Unable to load withdrawal" }, 400);
  if (!withdrawal) return json(req, { error: "Withdrawal not found" }, 404);

  if (withdrawal.status === "completed") {
    return json(req, { success: true, status: "completed", idempotent: true, request_id: requestId, withdrawal_id: withdrawal.id, completed_at: withdrawal.completed_at });
  }
  if (withdrawal.status === "refunded") {
    return json(req, { success: false, status: "refunded", idempotent: true, request_id: requestId, withdrawal_id: withdrawal.id, refunded_at: withdrawal.refunded_at });
  }
  if (withdrawal.status === "manual_review") {
    return json(req, { success: false, status: "manual_review", idempotent: true, request_id: requestId, withdrawal_id: withdrawal.id }, 409);
  }

  const providerReference = clean(withdrawal.provider_reference, 200);
  if (!providerReference) {
    await admin.rpc("flag_plopplop_withdrawal_manual_review", {
      p_withdrawal_id: withdrawal.id,
      p_user_id: authData.user.id,
      p_error_code: "local_reference_missing",
      p_provider_transaction_id: withdrawal.provider_transaction_id,
      p_api_reference: withdrawal.api_reference,
      p_provider_response: {},
    });
    return json(req, { error: "Withdrawal requires manual review", status: "manual_review" }, 409);
  }

  try {
    const authResult = await fetchJson(new URL("api/auth/marchand", provider.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: provider.clientId, client_secret: provider.clientSecret }),
    }, 15000);
    const merchantToken = firstString(authResult.payload, ["token"], 4000);
    if (!authResult.response.ok || !merchantToken) {
      return json(req, { error: "Merchant authentication failed", retryable: true }, 503);
    }

    const verifyResult = await fetchJson(new URL("api/withdraw/marchand/verify", provider.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${merchantToken}`,
      },
      body: JSON.stringify({ reference: providerReference }),
    }, 20000);

    const providerSummary = summary(verifyResult.payload, verifyResult.response.status);
    if (verifyResult.response.status === 404) {
      // Après une exécution potentiellement incertaine, un 404 ne suffit pas à prouver
      // qu'aucun transfert n'a eu lieu. On ne rembourse donc jamais automatiquement ici.
      await admin.rpc("mark_plopplop_withdrawal_pending", {
        p_withdrawal_id: withdrawal.id,
        p_user_id: authData.user.id,
        p_provider_transaction_id: withdrawal.provider_transaction_id,
        p_api_reference: withdrawal.api_reference,
        p_fee: withdrawal.fee,
        p_provider_total: withdrawal.provider_total,
        p_error_code: "provider_verify_not_found",
        p_provider_response: providerSummary,
      });
      return json(req, { success: false, status: "pending", retryable: true, request_id: requestId, message: "Provider has not confirmed this withdrawal yet." }, 202);
    }
    if (!verifyResult.response.ok || !verifyResult.payload || typeof verifyResult.payload !== "object" || Array.isArray(verifyResult.payload)) {
      return json(req, { error: "Withdrawal verification is temporarily unavailable", retryable: true, request_id: requestId }, 503);
    }

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

    if (mismatch || !status) {
      await admin.rpc("flag_plopplop_withdrawal_manual_review", {
        p_withdrawal_id: withdrawal.id,
        p_user_id: authData.user.id,
        p_error_code: mismatch ? "provider_data_mismatch" : "provider_status_missing",
        p_provider_transaction_id: transactionId,
        p_api_reference: providerSummary.api_reference,
        p_provider_response: providerSummary,
      });
      return json(req, { error: "Withdrawal requires manual review", status: "manual_review" }, 409);
    }

    if (status === "success") {
      if (!transactionId) {
        await admin.rpc("flag_plopplop_withdrawal_manual_review", {
          p_withdrawal_id: withdrawal.id,
          p_user_id: authData.user.id,
          p_error_code: "provider_transaction_id_missing",
          p_provider_transaction_id: null,
          p_api_reference: providerSummary.api_reference,
          p_provider_response: providerSummary,
        });
        return json(req, { error: "Withdrawal requires manual review", status: "manual_review" }, 409);
      }
      const { data: completed, error } = await admin.rpc("complete_plopplop_withdrawal", {
        p_withdrawal_id: withdrawal.id,
        p_user_id: authData.user.id,
        p_provider_transaction_id: transactionId,
        p_api_reference: providerSummary.api_reference,
        p_fee: providerSummary.fee,
        p_provider_total: providerSummary.amount,
        p_provider_response: providerSummary,
      });
      if (error || !completed) {
        await admin.rpc("flag_plopplop_withdrawal_manual_review", {
          p_withdrawal_id: withdrawal.id,
          p_user_id: authData.user.id,
          p_error_code: "local_completion_failed",
          p_provider_transaction_id: transactionId,
          p_api_reference: providerSummary.api_reference,
          p_provider_response: providerSummary,
        });
        return json(req, { error: "Withdrawal paid but requires local review", status: "manual_review" }, 409);
      }
      return json(req, { success: true, status: "completed", request_id: requestId, withdrawal_id: completed.id, completed_at: completed.completed_at });
    }

    if (["failed", "rembourse", "refunded"].includes(status)) {
      const { data: refunded, error } = await admin.rpc("refund_plopplop_withdrawal", {
        p_withdrawal_id: withdrawal.id,
        p_user_id: authData.user.id,
        p_error_code: `provider_${status}`,
        p_provider_response: providerSummary,
      });
      if (error || !refunded) {
        await admin.rpc("flag_plopplop_withdrawal_manual_review", {
          p_withdrawal_id: withdrawal.id,
          p_user_id: authData.user.id,
          p_error_code: "refund_failed",
          p_provider_transaction_id: transactionId,
          p_api_reference: providerSummary.api_reference,
          p_provider_response: providerSummary,
        });
        return json(req, { error: "Refund requires manual review", status: "manual_review" }, 409);
      }
      return json(req, { success: false, status: "refunded", request_id: requestId, withdrawal_id: refunded.id, refunded_at: refunded.refunded_at });
    }

    if (status === "pending") {
      await admin.rpc("mark_plopplop_withdrawal_pending", {
        p_withdrawal_id: withdrawal.id,
        p_user_id: authData.user.id,
        p_provider_transaction_id: transactionId,
        p_api_reference: providerSummary.api_reference,
        p_fee: providerSummary.fee,
        p_provider_total: providerSummary.amount,
        p_error_code: "provider_pending",
        p_provider_response: providerSummary,
      });
      return json(req, { success: false, status: "pending", retryable: true, request_id: requestId, withdrawal_id: withdrawal.id }, 202);
    }

    await admin.rpc("flag_plopplop_withdrawal_manual_review", {
      p_withdrawal_id: withdrawal.id,
      p_user_id: authData.user.id,
      p_error_code: `provider_status_${status}`,
      p_provider_transaction_id: transactionId,
      p_api_reference: providerSummary.api_reference,
      p_provider_response: providerSummary,
    });
    return json(req, { error: "Withdrawal requires manual review", status: "manual_review" }, 409);
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === "AbortError";
    return json(req, { error: timeout ? "Withdrawal verification timed out" : "Withdrawal verification is temporarily unavailable", retryable: true, request_id: requestId }, 503);
  }
});
