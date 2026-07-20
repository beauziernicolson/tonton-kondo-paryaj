import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

const ALLOWED_ORIGINS = new Set([
  "https://tontonkondoparyaj.com",
  "https://www.tontonkondoparyaj.com",
  "https://tonton-kondo-paryaj.vercel.app",
  "https://tonton-kondo-paryaj-n75s.vercel.app",
]);

const EXPECTED_PROVIDER_ORIGIN = "https://plopplop.solutionip.app";
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
  };
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

function normalizeStatus(value: string | null): "ok" | "no" | "unknown" {
  const status = String(value ?? "").trim().toLowerCase();
  if (["ok", "success", "successful", "completed", "paid", "true", "1"].includes(status)) {
    return "ok";
  }
  if (["no", "pending", "processing", "unpaid", "false", "0", "en_attente"].includes(status)) {
    return "no";
  }
  return "unknown";
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
  if (!requestId || !UUID_RE.test(requestId)) {
    return json(req, { error: "A valid request_id UUID is required" }, 400);
  }

  const admin = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: deposit, error: depositError } = await admin
    .from("plopplop_deposits")
    .select(
      "id,user_id,request_id,provider_reference,provider_transaction_id,amount,confirmed_amount,payment_method,status,payment_url,credited_at",
    )
    .eq("request_id", requestId)
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (depositError) {
    return json(req, { error: "Unable to load deposit" }, 400);
  }
  if (!deposit) {
    return json(req, { error: "Deposit not found" }, 404);
  }
  if (deposit.status === "completed") {
    return json(req, {
      success: true,
      status: "completed",
      idempotent: true,
      request_id: requestId,
      deposit_id: deposit.id,
      credited_at: deposit.credited_at,
    });
  }

  const endpoint = new URL("api/paiement-verify", config.baseUrl);
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
        refference_id: deposit.provider_reference,
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
    if (!providerResponse.ok) {
      return json(
        req,
        {
          error: "Payment verification is temporarily unavailable",
          retryable: true,
          request_id: requestId,
        },
        503,
      );
    }

    const transStatus = normalizeStatus(cleanString(summary.trans_status, 80));
    const providerReference = cleanString(summary.refference_id, 200);
    const transactionId = cleanString(summary.transaction_id, 200);
    const confirmedAmount =
      typeof summary.montant === "number" && Number.isFinite(summary.montant)
        ? Number(summary.montant)
        : null;

    if (providerReference && providerReference !== deposit.provider_reference) {
      await admin.rpc("flag_plopplop_manual_review", {
        p_deposit_id: deposit.id,
        p_user_id: authData.user.id,
        p_alert_type: "provider_error",
        p_error_code: "reference_mismatch",
        p_provider_transaction_id: transactionId,
        p_confirmed_amount: confirmedAmount,
        p_provider_response: summary,
      });
      return json(req, { error: "Payment requires manual review", status: "manual_review" }, 409);
    }

    if (transStatus === "no" || transStatus === "unknown") {
      const { data: pending } = await admin.rpc("mark_plopplop_pending", {
        p_deposit_id: deposit.id,
        p_user_id: authData.user.id,
        p_provider_transaction_id: transactionId,
        p_confirmed_amount: confirmedAmount,
        p_provider_response: summary,
      });

      return json(req, {
        success: true,
        status: "pending",
        request_id: requestId,
        deposit_id: (pending as Record<string, unknown> | null)?.id ?? deposit.id,
        message: "Payment is still pending",
      });
    }

    if (confirmedAmount === null) {
      await admin.rpc("flag_plopplop_manual_review", {
        p_deposit_id: deposit.id,
        p_user_id: authData.user.id,
        p_alert_type: "provider_error",
        p_error_code: "confirmed_amount_missing",
        p_provider_transaction_id: transactionId,
        p_confirmed_amount: null,
        p_provider_response: summary,
      });
      return json(req, { error: "Payment requires manual review", status: "manual_review" }, 409);
    }

    if (Math.round(confirmedAmount * 100) !== Math.round(Number(deposit.amount) * 100)) {
      await admin.rpc("flag_plopplop_amount_mismatch", {
        p_deposit_id: deposit.id,
        p_user_id: authData.user.id,
        p_provider_transaction_id: transactionId,
        p_confirmed_amount: confirmedAmount,
        p_provider_response: summary,
      });
      return json(req, { error: "Confirmed amount mismatch", status: "amount_mismatch" }, 409);
    }

    if (!transactionId) {
      await admin.rpc("flag_plopplop_manual_review", {
        p_deposit_id: deposit.id,
        p_user_id: authData.user.id,
        p_alert_type: "provider_error",
        p_error_code: "provider_transaction_id_missing",
        p_provider_transaction_id: null,
        p_confirmed_amount: confirmedAmount,
        p_provider_response: summary,
      });
      return json(req, { error: "Payment requires manual review", status: "manual_review" }, 409);
    }

    const { data: completed, error: completeError } = await admin.rpc(
      "complete_plopplop_deposit",
      {
        p_deposit_id: deposit.id,
        p_user_id: authData.user.id,
        p_provider_transaction_id: transactionId,
        p_confirmed_amount: confirmedAmount,
        p_provider_response: summary,
      },
    );

    if (completeError || !completed) {
      const message = String(completeError?.message ?? "");
      const duplicate = message.includes("déjà utilisé") || message.includes("duplicate");
      await admin.rpc("flag_plopplop_manual_review", {
        p_deposit_id: deposit.id,
        p_user_id: authData.user.id,
        p_alert_type: duplicate ? "duplicate_transaction" : "provider_error",
        p_error_code: duplicate ? "duplicate_provider_transaction" : "credit_failed",
        p_provider_transaction_id: transactionId,
        p_confirmed_amount: confirmedAmount,
        p_provider_response: summary,
      });
      return json(req, { error: "Payment requires manual review", status: "manual_review" }, 409);
    }

    const saved = completed as Record<string, unknown>;
    return json(req, {
      success: true,
      status: "completed",
      request_id: requestId,
      deposit_id: saved.id,
      credited_at: saved.credited_at,
    });
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === "AbortError";
    return json(
      req,
      {
        error: timeout
          ? "Payment verification timed out"
          : "Payment verification is temporarily unavailable",
        retryable: true,
        request_id: requestId,
      },
      503,
    );
  } finally {
    clearTimeout(timer);
  }
});
