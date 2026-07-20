// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

const ALLOWED_ORIGINS = new Set([
  "https://tontonkondoparyaj.com",
  "https://www.tontonkondoparyaj.com",
  "https://tonton-kondo-paryaj.vercel.app",
  "https://tonton-kondo-paryaj-n75s.vercel.app",
]);

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

  // Server-to-server calls may have no Origin header.
  if (!origin) return { ...BASE_HEADERS };

  if (!ALLOWED_ORIGINS.has(origin)) return null;

  return {
    ...BASE_HEADERS,
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

function json(
  req: Request,
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...(corsHeaders(req) ?? BASE_HEADERS),
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function cleanText(value: unknown, maxLength = 500): string | null {
  if (value === null || value === undefined) return null;

  const result = String(value).trim();
  if (!result) return null;

  if (result.length > maxLength) {
    throw new Error(`Text exceeds ${maxLength} characters.`);
  }

  return result;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "Operation failed";
}

Deno.serve(async (req: Request) => {
  const requestCors = corsHeaders(req);

  if (!requestCors) {
    return json(req, { error: "Origin not allowed" }, 403);
  }

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: requestCors,
    });
  }

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization");

  if (!url || !anonKey || !serviceKey) {
    return json(req, { error: "Server configuration error" }, 500);
  }

  if (!authorization?.startsWith("Bearer ")) {
    return json(req, { error: "Unauthorized" }, 401);
  }

  const userClient = createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: authData, error: authError } =
    await userClient.auth.getUser();

  if (authError || !authData.user) {
    return json(req, { error: "Unauthorized" }, 401);
  }

  const admin = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role, status")
    .eq("id", authData.user.id)
    .single();

  if (
    profileError
    || !profile
    || profile.status !== "active"
    || !["admin", "super_admin"].includes(profile.role)
  ) {
    return json(req, { error: "Active administrator required" }, 403);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);

  if (Number.isFinite(contentLength) && contentLength > 65_536) {
    return json(req, { error: "Request body is too large" }, 413);
  }

  let body: Record<string, unknown>;

  try {
    const parsed = await req.json();

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid JSON object");
    }

    body = parsed as Record<string, unknown>;
  } catch (error) {
    return json(req, { error: errorMessage(error) }, 400);
  }

  const operation = String(body.operation ?? "").trim();

  try {
    // Read-only diagnostic used by Step 9E production tests.
    if (operation === "auth.check") {
      return json(req, {
        success: true,
        user_id: authData.user.id,
        role: profile.role,
        status: profile.status,
      });
    }

    if (operation === "draw.create") {
      const gameType = cleanText(body.game_type, 30);
      const drawName = cleanText(body.draw_name, 120);
      const drawDate = cleanText(body.draw_date, 10);

      if (!gameType || !drawName || !drawDate) {
        return json(
          req,
          {
            error:
              "game_type, draw_name and draw_date are required",
          },
          400,
        );
      }

      const payload = {
        game_type: gameType,
        draw_name: drawName,
        draw_date: drawDate,
        winning_number: cleanText(body.winning_number, 20),
        first_prize_number: cleanText(
          body.first_prize_number,
          20,
        ),
        second_prize_number: cleanText(
          body.second_prize_number,
          20,
        ),
        third_prize_number: cleanText(
          body.third_prize_number,
          20,
        ),
        first_prize_full_number: cleanText(
          body.first_prize_full_number,
          20,
        ),
        source: cleanText(body.source, 20) ?? "manual",
        status: "draft",
        created_by: authData.user.id,
        created_source: "server",
      };

      const { data, error } = await admin
        .from("draw_results")
        .insert(payload)
        .select()
        .single();

      if (error) throw error;

      return json(req, { success: true, result: data });
    }

    if (
      ["draw.update", "draw.publish", "draw.cancel"].includes(
        operation,
      )
    ) {
      const resultId = String(body.result_id ?? "").trim();

      if (!isUuid(resultId)) {
        return json(
          req,
          { error: "A valid result_id is required" },
          400,
        );
      }

      const patch: Record<string, unknown> = {};

      if (operation === "draw.update") {
        for (
          const key of [
            "game_type",
            "draw_name",
            "draw_date",
            "winning_number",
            "first_prize_number",
            "second_prize_number",
            "third_prize_number",
            "first_prize_full_number",
            "source",
          ]
        ) {
          if (body[key] !== undefined) {
            patch[key] = cleanText(body[key], 120);
          }
        }
      } else if (operation === "draw.publish") {
        patch.status = "published";
        patch.published_by = authData.user.id;
        patch.published_source = "server";
        patch.published_at = new Date().toISOString();

        for (
          const key of [
            "winning_number",
            "first_prize_number",
            "second_prize_number",
            "third_prize_number",
            "first_prize_full_number",
          ]
        ) {
          if (body[key] !== undefined) {
            patch[key] = cleanText(body[key], 20);
          }
        }
      } else {
        const reason = cleanText(body.cancel_reason, 500);

        if (!reason) {
          return json(
            req,
            { error: "cancel_reason is required" },
            400,
          );
        }

        patch.status = "cancelled";
        patch.cancel_reason = reason;
        patch.cancelled_by = authData.user.id;
        patch.cancelled_source = "server";
        patch.cancelled_at = new Date().toISOString();
      }

      if (!Object.keys(patch).length) {
        return json(req, { error: "No valid fields to update" }, 400);
      }

      const { data, error } = await admin
        .from("draw_results")
        .update(patch)
        .eq("id", resultId)
        .eq("status", "draft")
        .select()
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return json(req, { error: "Draft result not found" }, 404);
      }

      return json(req, { success: true, result: data });
    }

    if (operation === "request.review") {
      const requestType = String(body.request_type ?? "");
      const requestId = String(body.request_id ?? "");
      const action = String(body.action ?? "");

      if (
        !isUuid(requestId)
        || !["deposit", "withdrawal"].includes(requestType)
        || !["approved", "rejected", "cancelled"].includes(action)
      ) {
        return json(
          req,
          { error: "Invalid request review payload" },
          400,
        );
      }

      const note = cleanText(body.admin_note, 1_000);

      if (["rejected", "cancelled"].includes(action) && !note) {
        return json(
          req,
          { error: "admin_note is required" },
          400,
        );
      }

      const table = requestType === "deposit"
        ? "deposit_requests"
        : "withdrawal_requests";

      const { data, error } = await admin
        .from(table)
        .update({
          status: action,
          admin_note: note,
          reviewed_by: authData.user.id,
          reviewed_source: "server",
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", requestId)
        .eq("status", "pending")
        .select()
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return json(
          req,
          { error: "Pending request not found" },
          404,
        );
      }

      return json(req, { success: true, request: data });
    }

    return json(req, { error: "Unknown operation" }, 400);
  } catch (error) {
    console.error("admin-operations failed", {
      operation,
      user_id: authData.user.id,
      message: errorMessage(error),
    });

    return json(req, { error: errorMessage(error) }, 400);
  }
});