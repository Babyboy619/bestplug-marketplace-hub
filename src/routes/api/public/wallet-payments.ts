import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { initializeWalletTopup, verifyWalletTopup } from "@/lib/paystack.payment.server";
import { paymentReferenceSchema, topupAmountSchema } from "@/lib/payment-validation";
import { getServerEnv, getSupabaseRuntimeConfig } from "@/lib/runtime-env.server";

const MAX_BODY_BYTES = 16_384;
const CUSTOM_ORIGIN = "https://bestplugmarketplace.shop";
const payloadSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("initialize"), amount: topupAmountSchema.shape.amount }),
  z.object({ action: z.literal("verify"), reference: paymentReferenceSchema }),
]);

function allowedOrigins(request: Request) {
  const configured = (getServerEnv("PAYMENT_ALLOWED_ORIGINS", request) ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([CUSTOM_ORIGIN, ...configured]);
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function jsonResponse(body: unknown, status: number, origin: string) {
  return Response.json(body, { status, headers: corsHeaders(origin) });
}

async function authenticate(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Unauthorized");
  const token = authorization.slice("Bearer ".length);
  if (!token || token.split(".").length !== 3) throw new Error("Unauthorized");

  const { url: supabaseUrl, publishableKey } = getSupabaseRuntimeConfig(request);
  const supabase = createClient<Database>(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== "string") throw new Error("Unauthorized");

  const profile = await supabase
    .from("profiles")
    .select("id,suspended,deleted_at")
    .eq("id", claims.sub)
    .maybeSingle();
  let account: { id: string; suspended: boolean; deleted_at?: string | null } | null = profile.data;
  let accountError = profile.error;
  if (accountError?.code === "PGRST204" || accountError?.code === "42703") {
    const fallback = await supabase
      .from("profiles")
      .select("id,suspended")
      .eq("id", claims.sub)
      .maybeSingle();
    account = fallback.data;
    accountError = fallback.error;
  }
  if (
    accountError ||
    !account ||
    account.suspended ||
    ("deleted_at" in account && account.deleted_at)
  ) {
    throw new Error("This account is suspended or deactivated.");
  }
  return {
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
  };
}

export const Route = createFileRoute("/api/public/wallet-payments")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const origin = request.headers.get("origin") ?? "";
        if (!allowedOrigins(request).has(origin)) {
          return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
        }
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      },
      POST: async ({ request }) => {
        const origin = request.headers.get("origin") ?? "";
        if (!allowedOrigins(request).has(origin))
          return Response.json(
            { error: "Origin not allowed." },
            { status: 403, headers: { "Cache-Control": "no-store" } },
          );
        const headers = corsHeaders(origin);
        const contentLength = request.headers.get("content-length");
        if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
          return Response.json({ error: "Request is too large." }, { status: 413, headers });
        }
        const rawBody = await request.text();
        if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
          return Response.json({ error: "Request is too large." }, { status: 413, headers });
        }
        let body: unknown;
        try {
          body = JSON.parse(rawBody);
        } catch {
          return Response.json({ error: "Invalid request." }, { status: 400, headers });
        }
        const parsed = payloadSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.issues[0]?.message ?? "Invalid request." },
            { status: 400, headers },
          );
        }

        const requestId = crypto.randomUUID();
        console.info("[wallet-payments] request", {
          requestId,
          action: parsed.data.action,
          origin,
        });
        try {
          const user = await authenticate(request);
          if (parsed.data.action === "initialize") {
            if (!user.email) {
              return Response.json(
                { error: "Your account needs a verified email to start payment." },
                { status: 400, headers },
              );
            }
            const result = await initializeWalletTopup({
              ...user,
              amount: parsed.data.amount,
              callbackUrl: new URL("/payments/callback", origin).toString(),
            });
            return Response.json(result, { headers });
          }
          return Response.json(await verifyWalletTopup(parsed.data.reference, user.userId), {
            headers,
          });
        } catch (error) {
          const unauthorized = error instanceof Error && error.message === "Unauthorized";
          console.error("[wallet-payments] request failed", {
            requestId,
            action: parsed.data.action,
            status: unauthorized ? 401 : 400,
            failure: unauthorized ? "authentication" : "payment_or_configuration",
          });
          return jsonResponse(
            {
              error: unauthorized
                ? "Your session is invalid. Sign in again."
                : error instanceof Error
                  ? error.message
                  : "Payment request failed.",
              requestId,
            },
            unauthorized ? 401 : 400,
            origin,
          );
        }
      },
    },
  },
});
