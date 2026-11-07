import { createFileRoute } from "@tanstack/react-router";
import { createSupabaseAdminClient } from "@/integrations/supabase/client.server";
import { getServerEnv } from "@/lib/runtime-env.server";
import { getPaystackConfigStatus } from "@/lib/paystack.server";

const MAIN_ORIGIN = "https://bestplug-marketplace-hub.lovable.app";
const CUSTOM_ORIGIN = "https://bestplugmarketplace.shop";

function allowedOrigins(request: Request) {
  const configured = (getServerEnv("PAYMENT_ALLOWED_ORIGINS", request) ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([MAIN_ORIGIN, CUSTOM_ORIGIN, ...configured]);
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export const Route = createFileRoute("/api/public/payment-health")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const origin = request.headers.get("origin") ?? "";
        if (!allowedOrigins(request).has(origin)) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      },
      GET: async ({ request }) => {
        const origin = request.headers.get("origin") ?? "";
        if (origin && !allowedOrigins(request).has(origin)) {
          return Response.json({ error: "Origin not allowed." }, { status: 403 });
        }

        const paystack = getPaystackConfigStatus(request);
        const supabaseUrl =
          getServerEnv("SUPABASE_URL", request) || import.meta.env["VITE_SUPABASE_URL"];
        const publishableKey =
          getServerEnv("SUPABASE_PUBLISHABLE_KEY", request) ||
          import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
        const authenticationConfigured = Boolean(supabaseUrl && publishableKey);
        const databaseUrl = getServerEnv("SUPABASE_URL", request);
        const serviceRoleKey = getServerEnv("SUPABASE_SERVICE_ROLE_KEY", request);
        const databaseUrlConfigured = Boolean(databaseUrl);
        const databaseServiceRoleConfigured = Boolean(serviceRoleKey);
        let databaseStatus: "missing_url" | "missing_service_role_key" | "connection_failed" | "ok";
        if (!databaseUrlConfigured) {
          databaseStatus = "missing_url";
        } else if (!databaseServiceRoleConfigured) {
          databaseStatus = "missing_service_role_key";
        } else {
          try {
            const { error } = await createSupabaseAdminClient(request)
              .from("profiles")
              .select("id")
              .limit(1);
            databaseStatus = error ? "connection_failed" : "ok";
            if (error) {
              console.error("[payment-health] runtime database check failed", {
                code: error.code ?? "unknown",
              });
            }
          } catch (error) {
            databaseStatus = "connection_failed";
            console.error("[payment-health] runtime database check failed", {
              errorName: error instanceof Error ? error.name : "UnknownError",
            });
          }
        }
        const databaseConfigured = databaseStatus === "ok";
        const healthy = paystack.configured && authenticationConfigured && databaseConfigured;
        const body = {
          status: healthy ? "ok" : "degraded",
          backend: "available",
          paymentInitializationRoute: "available",
          paymentVerificationRoute: "available",
          provider: "paystack",
          providerConfigured: paystack.configured,
          paystackSecretConfigured: paystack.secretConfigured,
          paystackPublicKeyConfigured: paystack.publicConfigured,
          paystackApiUrlConfigured: paystack.apiUrlConfigured,
          authenticationConfigured,
          databaseConfigured,
          databaseStatus,
          databaseUrlConfigured,
          databaseServiceRoleConfigured,
        };

        return Response.json(body, {
          status: healthy ? 200 : 503,
          headers: {
            "Cache-Control": "no-store",
            ...(origin ? corsHeaders(origin) : {}),
          },
        });
      },
    },
  },
});
