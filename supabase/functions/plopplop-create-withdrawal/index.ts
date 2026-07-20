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
const METHODS = new Set(["moncash", "natcash"]);
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
function normalizeRecipient(value: unknown): string | null {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) digits = `509${digits}`;
  return /^509\d{8}$/.test(digits) ? digits : null;
}
function providerConfig() {
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
function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
    error_code: firstString(payload, ["error_code", "code"], 120),
    transaction_id: firstString(payload, ["transaction_id", "id_transaction"], 200),
    api_reference: firstString(payload, ["api_reference"], 200),
    status: firstString(payload, ["status"], 80),
    amount: firstNumber(payload, ["amount"]),
    fee: firstNumber(payload, ["fee"]),
    total: firstNumber(payload, ["total"]),
    method: firstString(payload, ["method"], 80),
    recipient: firstString(payload, ["recipient"], 40),
    reference: firstString(payload, ["reference"], 200),
  };
}
async function fetchJson(url: URL, init: RequestInit, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    return { response, payload, text };
  } finally {
    clearTimeout(timer);
  }
}
async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function canonicalAmount(amount: number): string {
  return Number(amount.toFixed(2)).toString();
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

  const provider = providerConfig();
  if (!provider) return json(req, { error: "Withdrawal provider is not configured", retryable: true }, 503);

  let body: Record<string, unknown>;
  try {
    body = safeObject(await req.json());
    if (!Object.keys(body).length) throw new Error();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const requestId = clean(body.request_id, 36);
  const amount = Number(body.amount);
  const method = String(body.method ?? "").trim().toLowerCase();
  const recipient = normalizeRecipient(body.recipient);
  if (!requestId || !UUID_RE.test(requestId)) return json(req, { error: "A valid request_id UUID is required" }, 400);
  if (!Number.isFinite(amount) || amount < 20 || amount > 100000 || Math.round(amount * 100) !== amount * 100) {
    return json(req, { error: "Withdrawal must be between 20 and 100000 HTG" }, 400);
  }
  if (!METHODS.has(method)) return json(req, { error: "Invalid withdrawal method" }, 400);
  if (!recipient) return json(req, { error: "Recipient must use format 509XXXXXXXX" }, 400);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: withdrawal, error: createError } = await admin.rpc("create_or_get_plopplop_withdrawal", {
    p_user_id: authData.user.id,
    p_request_id: requestId,
    p_amount: amount,
    p_method: method,
    p_recipient: recipient,
  });
  if (createError || !withdrawal) {
    const message = String(createError?.message ?? "").toLowerCase();
    const insufficient = message.includes("solde") || message.includes("insuff");
    const conflict = message.includes("paramètres différents");
    return json(req, {
      error: insufficient ? "Insufficient wallet balance" : conflict ? "request_id conflict" : "Unable to reserve withdrawal",
    }, insufficient ? 400 : conflict ? 409 : 400);
  }

  if (["completed", "refunded", "manual_review", "pending"].includes(withdrawal.status)) {
    return json(req, {
      success: withdrawal.status === "completed",
      idempotent: true,
      request_id: requestId,
      withdrawal_id: withdrawal.id,
      status: withdrawal.status,
      provider_reference: withdrawal.provider_reference,
    }, withdrawal.status === "manual_review" ? 409 : 200);
  }

  const { data: claim, error: claimError } = await admin.rpc("claim_plopplop_withdrawal_execution", {
    p_withdrawal_id: withdrawal.id,
    p_user_id: authData.user.id,
  });
  if (claimError || !claim) return json(req, { error: "Unable to lock withdrawal execution", retryable: true }, 409);
  if (claim.claimed !== true) {
    const current = safeObject(claim.withdrawal);
    return json(req, {
      success: current.status === "completed",
      idempotent: true,
      processing: current.status === "processing",
      request_id: requestId,
      withdrawal_id: current.id ?? withdrawal.id,
      status: current.status ?? withdrawal.status,
      provider_reference: current.provider_reference ?? withdrawal.provider_reference,
    }, current.status === "processing" ? 202 : 200);
  }

  const providerReference = clean(withdrawal.provider_reference, 200);
  if (!providerReference) {
    await admin.rpc("refund_plopplop_withdrawal", {
      p_withdrawal_id: withdrawal.id,
      p_user_id: authData.user.id,
      p_error_code: "missing_provider_reference",
      p_provider_response: {},
    });
    return json(req, { error: "Unable to prepare withdrawal reference", status: "refunded" }, 500);
  }

  let merchantToken: string | null = null;
  let withdrawalToken: string | null = null;
  let executeStarted = false;

  try {
    const authResult = await fetchJson(new URL("api/auth/marchand", provider.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: provider.clientId, client_secret: provider.clientSecret }),
    }, 15000);
    merchantToken = firstString(authResult.payload, ["token"], 4000);
    if (!authResult.response.ok || !merchantToken) {
      await admin.rpc("refund_plopplop_withdrawal", {
        p_withdrawal_id: withdrawal.id,
        p_user_id: authData.user.id,
        p_error_code: `merchant_auth_${authResult.response.status}`,
        p_provider_response: summary(authResult.payload, authResult.response.status),
      });
      return json(req, { error: "Merchant authentication failed", status: "refunded", retryable: true }, 503);
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const amountText = canonicalAmount(amount);
    const signaturePayload = [amountText, method, recipient, providerReference, timestamp].join("|");
    const signature = await hmacHex(provider.clientSecret, signaturePayload);

    const tokenResult = await fetchJson(new URL("api/auth/marchand/withdrawal-token", provider.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${merchantToken}`,
      },
      body: JSON.stringify({
        amount: Number(amountText),
        method,
        recipient,
        reference: providerReference,
        timestamp,
        withdrawal_signature: signature,
      }),
    }, 15000);
    withdrawalToken = firstString(tokenResult.payload, ["withdrawal_token"], 5000);
    if (!tokenResult.response.ok || !withdrawalToken) {
      const tokenSummary = summary(tokenResult.payload, tokenResult.response.status);
      await admin.rpc("refund_plopplop_withdrawal", {
        p_withdrawal_id: withdrawal.id,
        p_user_id: authData.user.id,
        p_error_code: tokenSummary.error_code ?? `withdrawal_token_${tokenResult.response.status}`,
        p_provider_response: tokenSummary,
      });
      return json(req, { error: "Withdrawal authorization failed", status: "refunded", retryable: true }, tokenResult.response.status === 429 ? 429 : 503);
    }

    executeStarted = true;
    const executeResult = await fetchJson(new URL("api/withdraw/marchand", provider.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${withdrawalToken}`,
      },
      body: JSON.stringify({ amount: Number(amountText), method, recipient, reference: providerReference }),
    }, 25000);

    const executeSummary = summary(executeResult.payload, executeResult.response.status);
    const success = executeResult.response.ok && executeSummary.success === true && String(executeSummary.status ?? "").toLowerCase() === "success";
    if (success && executeSummary.transaction_id) {
      const { data: completed, error } = await admin.rpc("complete_plopplop_withdrawal", {
        p_withdrawal_id: withdrawal.id,
        p_user_id: authData.user.id,
        p_provider_transaction_id: executeSummary.transaction_id,
        p_api_reference: executeSummary.api_reference,
        p_fee: executeSummary.fee,
        p_provider_total: executeSummary.total,
        p_provider_response: executeSummary,
      });
      if (error || !completed) {
        await admin.rpc("flag_plopplop_withdrawal_manual_review", {
          p_withdrawal_id: withdrawal.id,
          p_user_id: authData.user.id,
          p_error_code: "local_completion_failed",
          p_provider_transaction_id: executeSummary.transaction_id,
          p_api_reference: executeSummary.api_reference,
          p_provider_response: executeSummary,
        });
        return json(req, { error: "Withdrawal paid but requires local review", status: "manual_review" }, 409);
      }
      return json(req, {
        success: true,
        status: "completed",
        request_id: requestId,
        withdrawal_id: completed.id,
        provider_reference: completed.provider_reference,
        provider_transaction_id: completed.provider_transaction_id,
        amount: completed.amount,
        fee: completed.fee,
      });
    }

    const errorCode = String(executeSummary.error_code ?? "").toUpperCase();
    const definitiveNoTransfer = executeResult.response.status === 400 && [
      "API_TRANSFER_FAILED", "INSUFFICIENT_BALANCE", "METHOD_NOT_CONFIGURED",
    ].includes(errorCode);

    if (definitiveNoTransfer) {
      const { data: refunded, error } = await admin.rpc("refund_plopplop_withdrawal", {
        p_withdrawal_id: withdrawal.id,
        p_user_id: authData.user.id,
        p_error_code: errorCode,
        p_provider_response: executeSummary,
      });
      if (error || !refunded) return json(req, { error: "Withdrawal failed and refund requires review", status: "manual_review" }, 409);
      return json(req, { success: false, status: "refunded", request_id: requestId, withdrawal_id: refunded.id, error_code: errorCode }, 400);
    }

    await admin.rpc("mark_plopplop_withdrawal_pending", {
      p_withdrawal_id: withdrawal.id,
      p_user_id: authData.user.id,
      p_provider_transaction_id: executeSummary.transaction_id,
      p_api_reference: executeSummary.api_reference,
      p_fee: executeSummary.fee,
      p_provider_total: executeSummary.total,
      p_error_code: errorCode || `provider_http_${executeResult.response.status}`,
      p_provider_response: executeSummary,
    });
    return json(req, {
      success: false,
      status: "pending",
      retryable: true,
      request_id: requestId,
      withdrawal_id: withdrawal.id,
      message: "Withdrawal status is uncertain and will be verified without a second debit.",
    }, 202);
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === "AbortError";
    const code = timeout ? "provider_timeout" : "provider_network_error";
    if (executeStarted) {
      await admin.rpc("mark_plopplop_withdrawal_pending", {
        p_withdrawal_id: withdrawal.id,
        p_user_id: authData.user.id,
        p_provider_transaction_id: null,
        p_api_reference: null,
        p_fee: null,
        p_provider_total: null,
        p_error_code: code,
        p_provider_response: { error_code: code, occurred_at: new Date().toISOString() },
      });
      return json(req, { error: "Withdrawal status is uncertain; verify it before retrying", status: "pending", retryable: true, request_id: requestId }, 202);
    }
    await admin.rpc("refund_plopplop_withdrawal", {
      p_withdrawal_id: withdrawal.id,
      p_user_id: authData.user.id,
      p_error_code: code,
      p_provider_response: { error_code: code, occurred_at: new Date().toISOString() },
    });
    return json(req, { error: "Withdrawal provider is temporarily unavailable", status: "refunded", retryable: true, request_id: requestId }, 503);
  } finally {
    merchantToken = null;
    withdrawalToken = null;
  }
});
