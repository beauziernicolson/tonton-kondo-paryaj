import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

const ALLOWED_ORIGINS = new Set([
  "https://tontonkondoparyaj.com",
  "https://www.tontonkondoparyaj.com",
  "https://tonton-kondo-paryaj.vercel.app",
  "https://tonton-kondo-paryaj-n75s.vercel.app",
]);

const EXPECTED_PROVIDER_ORIGIN = "https://plopplop.solutionip.app";
const METHODS = new Set(["moncash", "natcash", "kashpaw", "all"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BASE_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function corsHeaders(req: Request): Record<string, string> | null {
  const origin = req.headers.get("Origin");
  if (!origin) return { ...BASE_HEADERS };
  if (!ALLOWED_ORIGINS.has(origin)) return null;
  return { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...(corsHeaders(req) ?? BASE_HEADERS),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function cleanString(value: unknown, max = 500): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

function deepFind(payload: unknown, wantedKeys: string[]): unknown {
  const wanted = new Set(wantedKeys.map((key) => key.toLowerCase()));
  const queue: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }];
  let visited = 0;

  while (queue.length && visited < 200) {
    const current = queue.shift()!;
    visited += 1;
    if (current.depth > 4 || current.value === null) continue;

    if (Array.isArray(current.value)) {
      for (const item of current.value.slice(0, 20)) {
        queue.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }

    if (typeof current.value !== "object") continue;

    for (const [key, value] of Object.entries(current.value as Record<string, unknown>)) {
      if (wanted.has(key.toLowerCase()) && value !== null && value !== undefined) {
        return value;
      }
      queue.push({ value, depth: current.depth + 1 });
    }
  }

  return null;
}

function firstString(payload: unknown, keys: string[], max = 500): string | null {
  return cleanString(deepFind(payload, keys), max);
}

function firstNumber(payload: unknown, keys: string[]): number | null {
  const value = deepFind(payload, keys);
  const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(number) ? number : null;
}

function safeProviderSummary(payload: unknown, httpStatus: number): Record<string, unknown> {
  return {
    http_status: httpStatus,
    received_at: new Date().toISOString(),
    trans_status: firstString(payload, ["trans_status", "transaction_status", "status"], 80),
    message: firstString(payload, ["message", "msg", "detail", "description"], 500),
    refference_id: firstString(payload, ["refference_id", "reference_id", "reference"], 200),
    transaction_id: firstString(
      payload,
      ["transaction_id", "trans_id", "id_transaction", "transactionId"],
      200,
    ),
    montant: firstNumber(payload, ["montant", "amount", "transaction_amount"]),
    payment_method: firstString(payload, ["payment_method", "method"], 80),
    payment_url: firstString(
      payload,
      ["payment_url", "url", "redirect_url", "redirectUrl", "checkout_url"],
      2_000,
    ),
  };
}

function validPaymentUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function providerConfig():
  | { ok: true; clientId: string; baseUrl: URL }
  | { ok: false } {
  const clientId = cleanString(Deno.env.get("PLOPPLOP_CLIENT_ID"), 500);
  const rawBase = cleanString(Deno.env.get("PLOPPLOP_BASE_URL"), 2_000);
  if (!clientId || !rawBase) return { ok: false };

  try {
    const baseUrl = new URL(rawBase.endsWith("/") ? rawBase : `${rawBase}/`);
    if (baseUrl.protocol !== "https:" || baseUrl.origin !== EXPECTED_PROVIDER_ORIGIN) {
      return { ok: false };
    }
    return { ok: true, clientId, baseUrl };
  } catch {
    return { ok: false };
  }
}

Deno.serve(async (req: Request) => {
  const requestCors = corsHeaders(req);
  if (!requestCors) return json(req, { error: "Origin not allowed" }, 403);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: requestCors });
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json(req, { error: "Unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return json(req, { error: "Server configuration error" }, 500);
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    return json(req, { error: "Unauthorized" }, 401);
  }

  const config = providerConfig();
  if (!config.ok) {
    return json(
      req,
      {
        error: "Payment provider is not configured",
        retryable: true,
      },
      503,
    );
  }

  const length = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(length) && length > 32_768) {
    return json(req, { error: "Request body is too large" }, 413);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid JSON object");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const requestId = cleanString(body.request_id, 36);
  const amount = Number(body.amount);
  const method = String(body.payment_method ?? "").trim().toLowerCase();

  if (!requestId || !UUID_RE.test(requestId)) {
    return json(req, { error: "A valid request_id UUID is required" }, 400);
  }
  if (!Number.isFinite(amount) || amount < 20 || Math.round(amount * 100) !== amount * 100) {
    return json(req, { error: "Minimum deposit is 20 HTG" }, 400);
  }
  if (!METHODS.has(method)) {
    return json(req, { error: "Invalid payment method" }, 400);
  }

  const admin = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: depositData, error: depositError } = await admin.rpc(
    "create_or_get_plopplop_deposit",
    {
      p_user_id: authData.user.id,
      p_request_id: requestId,
      p_amount: amount,
      p_payment_method: method,
    },
  );

  if (depositError || !depositData) {
    const message = String(depositError?.message ?? "");
    const integrityConflict = message.includes("paramètres différents");
    return json(
      req,
      { error: integrityConflict ? "request_id conflict" : "Unable to create deposit request" },
      integrityConflict ? 409 : 400,
    );
  }

  const deposit = depositData as Record<string, unknown>;
  const existingUrl = validPaymentUrl(cleanString(deposit.payment_url, 2_000));
  if (existingUrl) {
    return json(req, {
      success: true,
      idempotent: true,
      request_id: requestId,
      deposit_id: deposit.id,
      status: deposit.status,
      payment_url: existingUrl,
      provider_reference: deposit.provider_reference,
    });
  }

  const { data: claimData, error: claimError } = await admin.rpc(
    "claim_plopplop_creation",
    {
      p_deposit_id: deposit.id,
      p_user_id: authData.user.id,
    },
  );

  if (claimError || !claimData) {
    return json(req, { error: "Unable to lock payment creation", retryable: true }, 409);
  }

  const claim = claimData as Record<string, unknown>;
  if (claim.claimed !== true) {
    const claimedDeposit =
      claim.deposit && typeof claim.deposit === "object"
        ? claim.deposit as Record<string, unknown>
        : deposit;
    const readyUrl = validPaymentUrl(cleanString(claimedDeposit.payment_url, 2_000));

    return json(
      req,
      {
        success: Boolean(readyUrl),
        idempotent: true,
        processing: !readyUrl,
        request_id: requestId,
        deposit_id: claimedDeposit.id,
        status: claimedDeposit.status ?? "pending",
        payment_url: readyUrl,
        provider_reference: claimedDeposit.provider_reference,
      },
      readyUrl ? 200 : 202,
    );
  }

  const providerReference = cleanString(deposit.provider_reference, 200);
  if (!providerReference) {
    await admin.rpc("fail_plopplop_creation", {
      p_deposit_id: deposit.id,
      p_user_id: authData.user.id,
      p_error_code: "missing_provider_reference",
      p_provider_response: {},
    });
    return json(req, { error: "Unable to prepare provider reference" }, 500);
  }

  const endpoint = new URL("api/paiement-marchand", config.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const providerResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: config.clientId,
        refference_id: providerReference,
        montant: amount,
        payment_method: method,
      }),
      signal: controller.signal,
    });

    const text = await providerResponse.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = {};
    }

    const summary = safeProviderSummary(payload, providerResponse.status);
    const paymentUrl = validPaymentUrl(cleanString(summary.payment_url, 2_000));
    const transactionId = cleanString(summary.transaction_id, 200);

    if (!providerResponse.ok || !paymentUrl) {
      const errorCode = !providerResponse.ok
        ? `provider_http_${providerResponse.status}`
        : "missing_payment_url";

      await admin.rpc("fail_plopplop_creation", {
        p_deposit_id: deposit.id,
        p_user_id: authData.user.id,
        p_error_code: errorCode,
        p_provider_response: summary,
      });

      return json(
        req,
        {
          error: !providerResponse.ok
            ? "Payment provider rejected the request"
            : "Payment URL was not returned",
          retryable: true,
          request_id: requestId,
        },
        !providerResponse.ok ? 502 : 503,
      );
    }

    const { data: updated, error: updateError } = await admin.rpc(
      "update_plopplop_creation",
      {
        p_deposit_id: deposit.id,
        p_user_id: authData.user.id,
        p_provider_transaction_id: transactionId,
        p_payment_url: paymentUrl,
        p_provider_response: summary,
      },
    );

    if (updateError || !updated) {
      return json(req, { error: "Payment created but local update failed", retryable: true }, 503);
    }

    const saved = updated as Record<string, unknown>;
    return json(req, {
      success: true,
      idempotent: false,
      request_id: requestId,
      deposit_id: saved.id,
      status: saved.status,
      payment_url: saved.payment_url,
      provider_reference: saved.provider_reference,
    });
  } catch (error) {
    const code = error instanceof DOMException && error.name === "AbortError"
      ? "provider_timeout"
      : "provider_network_error";

    await admin.rpc("fail_plopplop_creation", {
      p_deposit_id: deposit.id,
      p_user_id: authData.user.id,
      p_error_code: code,
      p_provider_response: {
        error_code: code,
        occurred_at: new Date().toISOString(),
      },
    });

    return json(
      req,
      {
        error: "Payment provider is temporarily unavailable",
        retryable: true,
        request_id: requestId,
      },
      503,
    );
  } finally {
    clearTimeout(timer);
  }
});
