import { createFileRoute } from "@tanstack/react-router";
import { getPaystarkConfig } from "@/lib/paystark.server";

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

        let providerConfigured = false;
        try {
          getPaystarkConfig();
          providerConfigured = true;
        } catch {
          providerConfigured = false;
        }

        const supabaseUrl = process.env["SUPABASE_URL"] || import.meta.env["VITE_SUPABASE_URL"];
        const publishableKey =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ||
          import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
        const authenticationConfigured = Boolean(supabaseUrl && publishableKey);
        const databaseConfigured = Boolean(
          process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"],
        );
        const healthy = providerConfigured && authenticationConfigured && databaseConfigured;
        const body = {
          status: healthy ? "ok" : "degraded",
          backend: "available",
          paymentInitializationRoute: "available",
          provider: "paystack",
          providerConfigured,
          authenticationConfigured,
          databaseConfigured,
        };

        return Response.json(body, {
          status: healthy ? 200 : 503,
          ...(origin ? { headers: corsHeaders(origin) } : {}),
        });
      },
    },
  },
});
