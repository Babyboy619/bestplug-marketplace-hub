import { createFileRoute } from "@tanstack/react-router";
import { getPaystarkConfigStatus } from "@/lib/paystark.server";

const MAIN_ORIGIN = "https://bestplug-marketplace-hub.lovable.app";
const CUSTOM_ORIGIN = "https://bestplugmarketplace.shop";

function allowedOrigins() {
  const configured = (process.env["PAYMENT_ALLOWED_ORIGINS"] ?? "")
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
        if (!allowedOrigins().has(origin)) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      },
      GET: async ({ request }) => {
        const origin = request.headers.get("origin") ?? "";
        if (origin && !allowedOrigins().has(origin)) {
          return Response.json({ error: "Origin not allowed." }, { status: 403 });
        }

        const paystack = getPaystarkConfigStatus();
        const supabaseUrl = process.env["SUPABASE_URL"] || import.meta.env["VITE_SUPABASE_URL"];
        const publishableKey =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ||
          import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
        const authenticationConfigured = Boolean(supabaseUrl && publishableKey);
        const databaseUrlConfigured = Boolean(process.env["SUPABASE_URL"]);
        const databaseServiceRoleConfigured = Boolean(process.env["SUPABASE_SERVICE_ROLE_KEY"]);
        const databaseConfigured = databaseUrlConfigured && databaseServiceRoleConfigured;
        const healthy = paystack.configured && authenticationConfigured && databaseConfigured;
        const body = {
          status: healthy ? "ok" : "degraded",
          backend: "available",
          paymentInitializationRoute: "available",
          paymentVerificationRoute: "available",
          provider: "paystack",
          providerConfigured: paystack.configured,
          paystackSecretConfigured: paystack.secretConfigured,
          paystackApiUrlConfigured: paystack.apiUrlConfigured,
          authenticationConfigured,
          databaseConfigured,
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
