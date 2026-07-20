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
const METHODS = new Set(["moncash", "natcash", "kashpaw", "all"]);
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
  const number = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  return Number.isFinite(number) ? number : null;
}
function safeSummary(payload, status) {
  return {
    http_status: status,
    received_at: new Date().toISOString(),
    message: firstString(payload, ["message", "msg", "detail", "description"], 500),
    transaction_id: firstString(payload, ["transaction_id", "id_transaction", "trans_id", "transactionId"], 200),
    payment_url: firstString(payload, ["url", "payment_url", "redirect_url", "redirectUrl", "checkout_url"], 2000),
    montant: firstNumber(payload, ["montant", "amount", "transaction_amount"]),
    payment_method: firstString(payload, ["payment_method", "method"], 80),
  };
}
function isPrivateOrLocalHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return true;
  return octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) || octets[0] === 0;
}
function parseRedirectOrigins(raw) {
  const values = String(raw ?? "").split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
  const origins = new Set();
  for (const value of values) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || isPrivateOrLocalHostname(url.hostname)) continue;
      origins.add(url.origin);
    } catch {
      // Ignore malformed values. An empty final set keeps the function locked.
    }
  }
  return origins;
}
function providerConfig() {
  const clientId = clean(Deno.env.get("PLOPPLOP_CLIENT_ID"), 500);
  const rawBase = clean(Deno.env.get("PLOPPLOP_BASE_URL"), 2000);
  const redirectOrigins = parseRedirectOrigins(Deno.env.get("PLOPPLOP_REDIRECT_ORIGINS"));
  if (!clientId || !rawBase) return null;
  try {
    const baseUrl = new URL(rawBase.endsWith("/") ? rawBase : `${rawBase}/`);
    if (baseUrl.protocol !== "https:" || baseUrl.origin !== EXPECTED_PROVIDER_ORIGIN) return null;
    return { clientId, baseUrl, redirectOrigins };
  } catch {
    return null;
  }
}
function validPaymentUrl(value, allowedOrigins) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (isPrivateOrLocalHostname(url.hostname)) return null;
    // Mode strict optionnel : si une allowlist existe, elle est imposée.
    // Sans allowlist, l'URL reste acceptable uniquement parce qu'elle provient
    // directement de la réponse HTTPS serveur-à-serveur du fournisseur fixe.
    if (allowedOrigins.size > 0 && !allowedOrigins.has(url.origin)) return null;
    return url.toString();
  } catch {
    return null;
  }
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

  const provider = providerConfig();
  if (!provider) {
    return json(req, {
      error: "Payment provider is not configured",
      retryable: true,
      lock_reason: "missing_or_invalid_provider_configuration",
    }, 503);
  }

  let body;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const requestId = clean(body.request_id, 36);
  const amount = Number(body.amount);
  const method = String(body.payment_method ?? "").trim().toLowerCase();
  if (!requestId || !UUID_RE.test(requestId)) return json(req, { error: "A valid request_id UUID is required" }, 400);
  if (!Number.isFinite(amount) || amount < 20 || Math.round(amount * 100) !== amount * 100) {
    return json(req, { error: "Minimum deposit is 20 HTG" }, 400);
  }
  if (!METHODS.has(method)) return json(req, { error: "Invalid payment method" }, 400);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: deposit, error: depositError } = await admin.rpc("create_or_get_plopplop_deposit", {
    p_user_id: authData.user.id,
    p_request_id: requestId,
    p_amount: amount,
    p_payment_method: method,
  });
  if (depositError || !deposit) {
    const conflict = String(depositError?.message ?? "").includes("paramètres différents");
    return json(req, { error: conflict ? "request_id conflict" : "Unable to create deposit request" }, conflict ? 409 : 400);
  }

  const existingUrl = validPaymentUrl(clean(deposit.payment_url, 2000), provider.redirectOrigins);
  if (existingUrl) {
    return json(req, {
      success: true,
      idempotent: true,
      request_id: requestId,
      deposit_id: deposit.id,
      status: deposit.status,
      payment_url: existingUrl,
      provider_reference: deposit.provider_reference,
      redirect_policy: provider.redirectOrigins.size > 0 ? "strict_allowlist" : "provider_https_only",
    });
  }

  const { data: claim, error: claimError } = await admin.rpc("claim_plopplop_creation", {
    p_deposit_id: deposit.id,
    p_user_id: authData.user.id,
  });
  if (claimError || !claim) return json(req, { error: "Unable to lock payment creation", retryable: true }, 409);
  if (claim.claimed !== true) {
    const current = claim.deposit && typeof claim.deposit === "object" ? claim.deposit : deposit;
    const currentUrl = validPaymentUrl(clean(current.payment_url, 2000), provider.redirectOrigins);
    return json(req, {
      success: Boolean(currentUrl),
      idempotent: true,
      processing: !currentUrl,
      request_id: requestId,
      deposit_id: current.id,
      status: current.status ?? "pending",
      payment_url: currentUrl,
      provider_reference: current.provider_reference,
      redirect_policy: provider.redirectOrigins.size > 0 ? "strict_allowlist" : "provider_https_only",
    }, currentUrl ? 200 : 202);
  }

  const providerReference = clean(deposit.provider_reference, 200);
  if (!providerReference) {
    await admin.rpc("fail_plopplop_creation", {
      p_deposit_id: deposit.id,
      p_user_id: authData.user.id,
      p_error_code: "missing_provider_reference",
      p_provider_response: {},
    });
    return json(req, { error: "Unable to prepare provider reference" }, 500);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(new URL("api/paiement-marchand", provider.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: provider.clientId,
        refference_id: providerReference,
        montant: amount,
        payment_method: method,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    const providerSummary = safeSummary(payload, response.status);
    const paymentUrl = validPaymentUrl(clean(providerSummary.payment_url, 2000), provider.redirectOrigins);
    const transactionId = clean(providerSummary.transaction_id, 200);

    if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload) || !paymentUrl || !transactionId) {
      const code = !response.ok ? `provider_http_${response.status}` :
        (!payload || typeof payload !== "object" || Array.isArray(payload)) ? "provider_non_json" :
        !paymentUrl ? "invalid_or_missing_payment_url" : "missing_provider_transaction_id";
      await admin.rpc("fail_plopplop_creation", {
        p_deposit_id: deposit.id,
        p_user_id: authData.user.id,
        p_error_code: code,
        p_provider_response: providerSummary,
      });
      return json(req, { error: "Payment provider response was rejected", retryable: true, request_id: requestId }, 503);
    }

    const { data: saved, error } = await admin.rpc("update_plopplop_creation", {
      p_deposit_id: deposit.id,
      p_user_id: authData.user.id,
      p_provider_transaction_id: transactionId,
      p_payment_url: paymentUrl,
      p_provider_response: providerSummary,
    });
    if (error || !saved) return json(req, { error: "Payment created but local update failed", retryable: true }, 503);
    return json(req, {
      success: true,
      idempotent: false,
      request_id: requestId,
      deposit_id: saved.id,
      status: saved.status,
      payment_url: saved.payment_url,
      provider_reference: saved.provider_reference,
      redirect_policy: provider.redirectOrigins.size > 0 ? "strict_allowlist" : "provider_https_only",
    });
  } catch (error) {
    const code = error instanceof DOMException && error.name === "AbortError" ? "provider_timeout" : "provider_network_error";
    await admin.rpc("fail_plopplop_creation", {
      p_deposit_id: deposit.id,
      p_user_id: authData.user.id,
      p_error_code: code,
      p_provider_response: { error_code: code, occurred_at: new Date().toISOString() },
    });
    return json(req, { error: "Payment provider is temporarily unavailable", retryable: true, request_id: requestId }, 503);
  } finally {
    clearTimeout(timer);
  }
});
